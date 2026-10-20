import "server-only";
import { randomUUID } from "node:crypto";
import type { DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import {
  type Book,
  type Unit,
  type BankQuestion,
  type MaterialProvenance,
  learningUnit,
  loadLearningState,
} from "@/lib/learning";
import {
  type UnitPlan,
  unitRevision,
  unitContent,
} from "@/lib/adaptive-learning";
import {
  CATALOG_AI_UID,
  CATALOG_PREPARATION,
  catalogContext,
  catalogScopeIdentity,
  followingCatalogUnit,
  initialCatalogScopes,
  poolCanRun,
  preparationTargets,
  type CatalogPool,
} from "@/lib/catalog-preparation";
import { duplicateQuestion } from "@/lib/matching";
import { schoolLevelOf } from "@/lib/education";
import { identityHash, loadAdaptive } from "./adaptive";
import { catalogTextbook, textbookCatalog } from "./textbook-catalog";
import { generateQuestions, generateUnitPlan } from "./ai";
import { resolveLearningMaterial } from "./learning-material";

const pools = () => adminDb().collection("catalogPools");
const slots = () => adminDb().doc("operations/catalogWorkerSlots");
export const catalogPoolId = (book: Book, unit: Unit) =>
  identityHash(catalogScopeIdentity(book, unit));
export async function catalogPoolQuestions(poolId: string) {
  return (
    await adminDb()
      .collection("questionBank")
      .where("poolId", "==", poolId)
      .get()
  ).docs.map((d) => d.data() as BankQuestion);
}

export async function enqueueCatalogUnit(
  book: Book,
  unit: Unit,
  priority = 0,
  retry = false,
) {
  const identity = catalogScopeIdentity(book, unit),
    key = identityHash(identity),
    ref = pools().doc(key);
  await adminDb().runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data() as CatalogPool | undefined;
    if (old) {
      const changes: Partial<CatalogPool> = {};
      if (priority > old.priority) changes.priority = priority;
      if (retry && ["blocked", "failed"].includes(old.status))
        Object.assign(changes, {
          status: "queued",
          cycle: old.cycle + 1,
          sequence: old.sequence + 1,
          phase: old.plan ? "questions" : old.material ? "plan" : "material",
          failures: 0,
          batches: 0,
          retryAt: 0,
          leaseUntil: 0,
          leaseToken: "",
          error: "",
          reviewFeedback: old.error,
        });
      if (Object.keys(changes).length)
        tx.update(ref, { ...changes, updatedAt: new Date().toISOString() });
      return;
    }
    const now = new Date().toISOString();
    const state: CatalogPool = {
      id: key,
      catalogId: book.catalogId ?? book.id,
      grade: book.grade,
      unitId: unit.id,
      bookTitle: book.title,
      unitTitle: unit.title,
      publisher: book.publisher,
      subject: book.subject,
      schoolLevel: schoolLevelOf(book),
      identity,
      status: "queued",
      phase: "material",
      sequence: 0,
      cycle: 0,
      target: CATALOG_PREPARATION.initialQuestions,
      approved: 0,
      rejected: 0,
      batches: 0,
      failures: 0,
      priority,
      createdAt: now,
      updatedAt: now,
      retryAt: 0,
      leaseUntil: 0,
      leaseToken: "",
      stage: "단원 공통 문제를 준비할 차례를 기다리고 있어요.",
      error: "",
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
    };
    tx.create(ref, state);
  });
  return key;
}

export async function bootstrapCatalogPreparation() {
  const scopes = initialCatalogScopes(await textbookCatalog());
  const keys: string[] = [];
  // Bound Firestore concurrency; include every publisher and selectable grade.
  for (let offset = 0; offset < scopes.length; offset += 20)
    keys.push(
      ...(await Promise.all(
        scopes
          .slice(offset, offset + 20)
          .map(({ book, unit }) => enqueueCatalogUnit(book, unit)),
      )),
    );
  await adminDb().doc("operations/catalogPreparation").set(
    {
      version: CATALOG_PREPARATION.version,
      initialScopes: keys.length,
      lastBootstrap: new Date().toISOString(),
    },
    { merge: true },
  );
  return { scopes: keys.length };
}

type Services = {
  catalog: typeof catalogTextbook;
  material: typeof resolveLearningMaterial;
  plan: typeof generateUnitPlan;
  questions: typeof generateQuestions;
};
const services: Services = {
  catalog: catalogTextbook,
  material: resolveLearningMaterial,
  plan: generateUnitPlan,
  questions: generateQuestions,
};

/** One checkpoint per queue delivery. A killed function never loses the completed phases. */
export async function runCatalogPoolStep(
  key: string,
  sequence?: number,
  overrides: Partial<Services> = {},
) {
  const api = { ...services, ...overrides },
    db = adminDb(),
    ref = pools().doc(key),
    token = randomUUID(),
    now = Date.now();
  const claim = await db.runTransaction(async (tx) => {
    const [snapshot, slotDoc] = await Promise.all([
      tx.get(ref),
      tx.get(slots()),
    ]);
    const state = snapshot.data() as CatalogPool | undefined;
    if (!state || ["ready", "blocked", "failed"].includes(state.status))
      return { kind: "done" as const };
    if (sequence !== undefined && sequence !== state.sequence)
      return { kind: "stale" as const };
    if (!poolCanRun(state, now)) return { kind: "busy" as const };
    const active: Record<string, number> = Object.fromEntries(
      Object.entries(slotDoc.data()?.active ?? {})
        .filter(([, until]) => Number(until) > now)
        .map(([k, until]) => [k, Number(until)]),
    );
    if (
      Object.keys(active).length >= CATALOG_PREPARATION.concurrency &&
      !active[key]
    )
      return { kind: "busy" as const };
    active[key] = now + CATALOG_PREPARATION.leaseMs;
    tx.set(slots(), { active });
    tx.update(ref, {
      status: "running",
      leaseToken: token,
      leaseUntil: active[key],
      updatedAt: new Date().toISOString(),
    });
    return { kind: "claimed" as const, state };
  });
  if (claim.kind !== "claimed") return claim.kind;
  const state = claim.state;
  async function checkpoint(
    changes: Partial<CatalogPool>,
    questions: BankQuestion[] = [],
  ) {
    return db.runTransaction(async (tx) => {
      const [snapshot, slotDoc] = await Promise.all([
        tx.get(ref),
        tx.get(slots()),
      ]);
      if (snapshot.data()?.leaseToken !== token) return false;
      const active = { ...(slotDoc.data()?.active ?? {}) };
      delete active[key];
      for (const q of questions)
        tx.create(db.collection("questionBank").doc(q.id), {
          ...q,
          poolId: key,
        });
      tx.update(ref, {
        ...changes,
        sequence: state.sequence + 1,
        leaseUntil: 0,
        leaseToken: "",
        updatedAt: new Date().toISOString(),
      });
      tx.set(slots(), { active });
      return true;
    });
  }
  async function stage(message: string) {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).data()?.leaseToken === token)
        tx.update(ref, { stage: message });
    });
  }
  try {
    const canonical = await api.catalog(state.catalogId);
    const book = canonical && {
      ...canonical,
      catalogId: canonical.id,
      grade: state.grade,
    };
    const unit = book?.units.find((u) => u.id === state.unitId);
    if (!book || !unit || catalogScopeIdentity(book, unit) !== state.identity)
      throw new AccountError(
        422,
        "교재의 공개 상태나 목차가 변경됐어요. 최신 교재 범위로 다시 준비해 주세요.",
      );
    if (state.phase === "material") {
      const material = await api.material(
        CATALOG_AI_UID,
        ref,
        book,
        unit,
        stage,
        state.error || state.reviewFeedback,
      );
      await checkpoint({
        status: "queued",
        phase: "plan",
        material: material.unit,
        ...material.provenance,
        failures: 0,
        error: "",
        stage: "확인한 개념으로 유형 학습지도를 준비하고 있어요.",
      } as Partial<CatalogPool>);
    } else if (state.phase === "plan") {
      if (!state.material) throw new Error("Missing material checkpoint");
      await stage("개념·유형 학습지도를 준비하고 있어요.");
      const plan = await api.plan(CATALOG_AI_UID, book, state.material);
      const provenance = state as CatalogPool & MaterialProvenance;
      Object.assign(plan, {
        id: key,
        sourceKind: provenance.sourceKind,
        references: provenance.references ?? [],
      });
      await checkpoint({
        status: "queued",
        phase: "questions",
        plan,
        failures: 0,
        error: "",
        stage: "검증할 새 문제를 준비하고 있어요.",
      });
    } else {
      if (!state.material || !state.plan)
        throw new Error("Missing generation checkpoint");
      const existing = await catalogPoolQuestions(key);
      const targets = preparationTargets(state.plan, existing, state.target);
      if (!targets.length) {
        await checkpoint({
          status: "ready",
          approved: existing.filter((q) => q.status === "approved").length,
          stage: "첫 학습 문제가 준비됐어요.",
          error: "",
        });
        return "done";
      }
      await stage(
        `새 문제의 정답·근거를 검증하고 있어요. (${state.approved}/${state.target})`,
      );
      const result = await api.questions(CATALOG_AI_UID, book, state.material, {
        targets,
        exclude: existing.map((q) => q.prompt),
      });
      // A pool only contains canonical public curriculum material, never learner uploads.
      const accepted: BankQuestion[] = [];
      const provenance = state as CatalogPool & MaterialProvenance;
      for (const q of result.questions) {
        Object.assign(q, {
          sourceKind: provenance.sourceKind,
          references: provenance.references ?? [],
        });
        if (
          [...existing, ...accepted].some((prior) =>
            duplicateQuestion(prior, q),
          )
        ) {
          q.status = "pending";
          q.reviewReason =
            "공용 문제은행의 기존 문항과 유사합니다. 새 변형이 필요합니다.";
        }
        accepted.push(q);
      }
      const refreshed = await api.catalog(state.catalogId);
      const latestBook = refreshed && {
        ...refreshed,
        catalogId: refreshed.id,
        grade: state.grade,
      };
      const latestUnit = latestBook?.units.find((u) => u.id === state.unitId);
      if (
        !latestBook ||
        !latestUnit ||
        catalogScopeIdentity(latestBook, latestUnit) !== state.identity
      )
        throw new AccountError(
          422,
          "출제 중 교재가 변경돼 이전 범위의 문제를 배포하지 않았어요.",
        );
      const all = [...existing, ...accepted],
        approved = all.filter((q) => q.status === "approved").length;
      const done = approved >= state.target,
        blocked = !done && state.batches + 1 >= CATALOG_PREPARATION.maxBatches;
      await checkpoint(
        {
          status: done ? "ready" : blocked ? "blocked" : "queued",
          approved,
          rejected: all.length - approved,
          batches: state.batches + 1,
          failures: 0,
          inputTokens: state.inputTokens + result.usage.inputTokens,
          outputTokens: state.outputTokens + result.usage.outputTokens,
          estimatedUsd: state.estimatedUsd + result.usage.estimatedUsd,
          stage: done
            ? "첫 학습 문제가 준비됐어요."
            : blocked
              ? "검수 통과 문항이 부족해 운영 확인이 필요해요."
              : "검증한 문항을 저장하고 부족한 문제를 보충하고 있어요.",
          error: blocked
            ? `정답·근거 검증을 통과한 문제가 ${approved}개입니다. 검증 기준을 유지한 채 추가 검토가 필요해요.`
            : "",
        },
        accepted,
      );
    }
  } catch (error) {
    const repairableMaterial =
      state.phase === "material" &&
      error instanceof AccountError &&
      error.status === 422 &&
      error.message.startsWith("단원 개념 자료의 검증을 통과하지 못했어요.");
    const permanent =
      error instanceof AccountError &&
      [400, 404, 409, 422].includes(error.status) &&
      !repairableMaterial;
    const failures = state.failures + 1;
    const message =
      error instanceof AccountError
        ? error.message
        : "문제 준비가 중단됐어요. 저장된 단계부터 다시 시도합니다.";
    const exhausted = failures >= CATALOG_PREPARATION.maxFailures;
    const delay =
      error instanceof AccountError && error.status === 429
        ? 86400000
        : 60000 * 2 ** state.failures;
    await checkpoint({
      status: permanent ? "blocked" : exhausted ? "failed" : "queued",
      failures,
      retryAt: permanent || exhausted ? 0 : Date.now() + delay,
      error: message,
      stage: message,
    });
  }
  const latest = (await ref.get()).data() as CatalogPool;
  return ["ready", "blocked", "failed"].includes(latest.status)
    ? "done"
    : "processed";
}

export async function hydrateCatalogUnit(
  student: DocumentReference,
  book: Book,
  unit: Unit,
  canonical?: Book,
) {
  canonical ??= book.catalogId
    ? await catalogTextbook(book.catalogId)
    : undefined;
  const context = canonical && catalogContext(book, canonical, unit);
  if (!context) return null;
  const key = catalogPoolId(context.book, context.unit),
    pool = (await pools().doc(key).get()).data() as CatalogPool | undefined;
  if (!pool?.plan || pool.approved < CATALOG_PREPARATION.initialQuestions)
    return pool ?? null;
  const shared = (await catalogPoolQuestions(key)).filter(
    (q) => q.status === "approved",
  );
  const planId = identityHash(
    `${book.id}:${unit.id}:${unitRevision(book, unit)}`,
  );
  await adminDb().runTransaction(async (tx) => {
    const planRef = student.collection("unitPlans").doc(planId);
    const [current, prior, ...old] = await Promise.all([
      tx.get(student.collection("books").doc(book.id)),
      tx.get(planRef),
      ...shared.map((q) => tx.get(student.collection("questions").doc(q.id))),
    ]);
    const latest = current.data() as Book | undefined;
    const currentUnit = latest?.units.find((u) => u.id === unit.id);
    if (
      !latest ||
      !currentUnit ||
      !catalogContext(latest, canonical!, currentUnit) ||
      unitRevision(latest, currentUnit) !== unitRevision(book, unit)
    )
      return;
    const plan: UnitPlan = {
      ...pool.plan!,
      id: planId,
      bookId: book.id,
      unitId: unit.id,
      revision: unitRevision(book, unit),
    };
    if (!prior.exists) tx.create(planRef, plan);
    const skills = ((prior.data() as UnitPlan | undefined) ?? plan).skills;
    shared.forEach((q, index) => {
      if (
        !old[index].exists &&
        skills.some(
          (s) =>
            s.concept === q.concept && s.type === (q.skillType ?? "기본 확인"),
        )
      )
        tx.create(student.collection("questions").doc(q.id), {
          ...q,
          bookId: book.id,
          revision: unitRevision(book, unit),
          poolId: key,
        });
    });
  });
  return pool;
}

/** Prepare the current selected unit, without changing the learner's range or progress. */
export async function prepareCatalogLearning(
  student: DocumentReference,
  selectedBook?: string,
  selectedUnit?: string,
  resolveCatalog = catalogTextbook,
) {
  const [snapshot, state, adaptive] = await Promise.all([
    student.collection("books").get(),
    student.collection("state").doc("learning").get(),
    loadAdaptive(student),
  ]);
  const current: CatalogPool[] = [],
    keys: string[] = [];
  for (const book of snapshot.docs
    .map((d) => d.data() as Book)
    .filter(
      (b) =>
        b.active && b.catalogId && (!selectedBook || b.id === selectedBook),
    )
    .slice(0, 5)) {
    const unit = selectedUnit
      ? book.units.find((u) => u.id === selectedUnit)
      : learningUnit(book, loadLearningState(state.data()), 3, adaptive);
    const canonical = await resolveCatalog(book.catalogId!);
    const context = unit && canonical && catalogContext(book, canonical, unit);
    if (!context) continue;
    const key = await enqueueCatalogUnit(context.book, context.unit, 2);
    keys.push(key);
    const pool = await hydrateCatalogUnit(student, book, unit!, canonical);
    const personal = adaptive.plans.find(
      (p) =>
        p.bookId === book.id &&
        p.unitId === unit!.id &&
        p.revision === unitRevision(book, unit),
    );
    // Preserve previously edited/personal learning maps. Their targeted top-ups
    // remain private rather than spending public stock on incompatible types.
    if (
      pool &&
      (!personal ||
        (pool.plan &&
          JSON.stringify(personal.skills) === JSON.stringify(pool.plan.skills)))
    )
      current.push(pool);
  }
  return { current, keys };
}

export async function requestMoreCatalogQuestions(
  studentId: string,
  current: CatalogPool[],
  requestId: string,
) {
  const refreshed: CatalogPool[] = [];
  for (const p of current) {
    if (p.status !== "ready") {
      refreshed.push(p);
      continue;
    }
    const ref = pools().doc(p.id),
      receipt = adminDb()
        .collection("catalogDemands")
        .doc(identityHash(`${studentId}:${p.id}:${requestId}`));
    const state = await adminDb().runTransaction(async (tx) => {
      const [snapshot, prior] = await Promise.all([
        tx.get(ref),
        tx.get(receipt),
      ]);
      const old = snapshot.data() as CatalogPool;
      if (
        prior.exists ||
        old.status !== "ready" ||
        old.approved >= CATALOG_PREPARATION.maxPoolQuestions
      )
        return old;
      const next: CatalogPool = {
        ...old,
        status: "queued",
        phase: "questions",
        sequence: old.sequence + 1,
        cycle: old.cycle + 1,
        target: Math.min(
          CATALOG_PREPARATION.maxPoolQuestions,
          old.approved + CATALOG_PREPARATION.initialQuestions,
        ),
        batches: 0,
        failures: 0,
        retryAt: 0,
        priority: 2,
        error: "",
        updatedAt: new Date().toISOString(),
        stage: "이미 본 문제를 제외하고 새로운 변형 문제를 보충하고 있어요.",
      };
      tx.set(ref, next);
      tx.create(receipt, {
        poolId: p.id,
        target: next.target,
        at: new Date().toISOString(),
      });
      return next;
    });
    refreshed.push(state);
  }
  return refreshed;
}

export async function prefetchFollowingCatalogUnits(
  student: DocumentReference,
  questions: { bookId: string; unitId: string }[],
  resolveCatalog = catalogTextbook,
) {
  const keys = new Set<string>(),
    entered = new Set(questions.map((q) => `${q.bookId}/${q.unitId}`));
  for (const scope of entered) {
    const [bookId, unitId] = scope.split("/");
    const book = (
      await student.collection("books").doc(bookId).get()
    ).data() as Book | undefined;
    if (!book?.catalogId) continue;
    const canonical = await resolveCatalog(book.catalogId),
      current = book.units.find((u) => u.id === unitId);
    const context =
      canonical && current && catalogContext(book, canonical, current);
    if (!context) continue;
    // Fetch only one unit ahead; preparation never marks it learned or opens it.
    const next = followingCatalogUnit(context.book, unitId);
    if (next) keys.add(await enqueueCatalogUnit(context.book, next, 1));
  }
  return [...keys];
}

export async function catalogPreparationSnapshot() {
  const list = (await pools().get()).docs.map((d) => d.data() as CatalogPool);
  const counts = Object.fromEntries(
    ["queued", "running", "ready", "blocked", "failed"].map((s) => [
      s,
      list.filter((p) => p.status === s).length,
    ]),
  );
  return {
    total: list.length,
    counts,
    approved: list.reduce((n, p) => n + p.approved, 0),
    initialQuestions: CATALOG_PREPARATION.initialQuestions,
    rows: list
      .sort(
        (a, b) =>
          b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
      )
      .map((p) => ({
        id: p.id,
        bookTitle: p.bookTitle,
        publisher: p.publisher,
        grade: p.grade,
        schoolLevel: p.schoolLevel,
        unitTitle: p.unitTitle,
        status: p.status,
        approved: p.approved,
        target: p.target,
        stage: p.stage,
        error: p.error || p.dispatchError || "",
        updatedAt: p.updatedAt,
        phase: p.phase,
      })),
  };
}

export async function retryCatalogPool(key: string) {
  const pool = (await pools().doc(key).get()).data() as CatalogPool | undefined;
  if (!pool) throw new AccountError(404, "준비 작업이 없어요.");
  const canonical = await catalogTextbook(pool.catalogId);
  const book = canonical && {
    ...canonical,
    catalogId: canonical.id,
    grade: pool.grade,
  };
  const unit = book?.units.find((u) => u.id === pool.unitId);
  if (!book || !unit) throw new AccountError(404, "교재가 공개 목록에 없어요.");
  return enqueueCatalogUnit(book, unit, 2, true);
}
