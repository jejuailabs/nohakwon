import "server-only";
import { randomUUID, createHash } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import { addDays, seoulDate, type Confidence } from "@nohakwon/core";
import {
  loadLearningState,
  DEFAULT_CONFIG,
  learningUnit,
  reserveQuestions,
  makeReport,
  parseBook,
  id,
  object,
  text,
  integer,
  publicQuestion,
  checkAnswer,
  gradeAnswer,
  conceptKey,
  COSMETICS,
  type Book,
  type LearningState,
  type Entitlement,
  type BankQuestion,
  type Result,
  type AnswerFeedback,
  type Job,
  type LearnMode,
  type LearningConfig,
  type HistoryEntry,
  type Unit,
} from "@/lib/learning";
import { starterQuestions } from "@/lib/catalog";
import { catalogTextbook } from "./textbook-catalog";
import { catalogSelection } from "@/lib/textbook-catalog";
import { aiConfigured, generateQuestions, generateUnitPlan } from "./ai";
import { adminRole } from "./admin-service";
import { duplicateQuestion } from "@/lib/matching";
import { schoolLevelOf } from "@/lib/education";
import { parseCatalogAdditions } from "@/lib/textbook-recognition";
import type { DocumentReference } from "firebase-admin/firestore";
import {
  loadAdaptive,
  loadBank,
  ensureExposureIndex,
  exposureSet,
  fingerprint,
  identityHash,
  assignmentIdentity,
  answerIdentity,
} from "./adaptive";
import {
  ADAPTIVE_POLICY,
  advanceSkill,
  skillIdentity,
  generationTargets,
  planFor,
  unitCoverage,
  unitRevision,
  unitContent,
  type SelectionReason,
  type SkillProgress,
  type UnitPlan,
} from "@/lib/adaptive-learning";
import { selectAdaptiveQuestions } from "@/lib/assignment-selection";
import { canPrepareCurriculum } from "@/lib/learning-material";
import { resolveLearningMaterial } from "./learning-material";
import { hydrateCatalogUnit } from "./catalog-preparation";

export function isAdmin(user: DecodedIdToken) {
  return ["owner", "admin", "editor", "reviewer"].includes(user.nohakwonRole);
}
export async function studentFor(uid: string, guardianOnly = false) {
  const db = adminDb(),
    user = (await db.doc(`users/${uid}`).get()).data();
  if (!user?.activeStudentId)
    throw new AccountError(409, "학습 프로필을 먼저 설정해 주세요.");
  const ref = db.collection("students").doc(id(user.activeStudentId)),
    snap = await ref.get(),
    data = snap.data();
  if (
    !data ||
    (data.guardianUid !== uid && (guardianOnly || data.linkedUid !== uid))
  )
    throw new AccountError(403, "이 학습 프로필에 접근할 수 없어요.");
  return { ref, data };
}
export async function learningConfig(): Promise<LearningConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...(await adminDb().doc("settings/learning").get()).data(),
  };
}
export function entitlement(
  student: Record<string, any>,
  now = new Date(),
): Entitlement {
  const created =
    student.createdAt?.toDate?.()?.toISOString() ??
    student.createdAt ??
    now.toISOString();
  const trialEndsAt =
      student.trialEndsAt ??
      new Date(new Date(created).getTime() + 7 * 86400000).toISOString(),
    paidUntil = student.paidUntil ?? "";
  const active = paidUntil && Date.parse(paidUntil) > now.getTime();
  return {
    status: active
      ? "active"
      : Date.parse(trialEndsAt) > now.getTime()
        ? "trial"
        : "expired",
    trialEndsAt,
    paidUntil,
    daysLeft: Math.max(
      0,
      Math.ceil(
        (Date.parse(active ? paidUntil : trialEndsAt) - now.getTime()) /
          86400000,
      ),
    ),
    test: student.billingTest === true,
    cancelAtPeriodEnd: student.cancelAtPeriodEnd === true,
  };
}
export async function getWorkspace(user: DecodedIdToken) {
  const { ref, data } = await studentFor(user.uid);
  const [booksSnap, stateSnap, resultsSnap, jobsSnap, config, adaptive] =
    await Promise.all([
      ref.collection("books").get(),
      ref.collection("state").doc("learning").get(),
      ref.collection("attempts").orderBy("at", "desc").limit(1500).get(),
      ref.collection("jobs").orderBy("createdAt", "desc").limit(30).get(),
      learningConfig(),
      loadAdaptive(ref),
    ]);
  const books = booksSnap.docs.map((d) => d.data() as Book),
    state = loadLearningState(stateSnap.data()),
    results = resultsSnap.docs.map((d) => d.data() as Result);
  return {
    guardian: data.guardianUid === user.uid,
    books,
    state,
    results,
    entitlement: entitlement(data),
    jobs: jobsSnap.docs.map((d) => d.data() as Job),
    aiConfigured: aiConfigured(),
    billingConfigured:
      !!process.env.TOSS_SECRET_KEY &&
      !!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
    admin: ["owner", "admin", "editor", "reviewer"].includes(
      (await adminRole(user.uid)) ?? "",
    ),
    report: makeReport(results, state.concepts),
    config,
    adaptive,
  };
}
export async function saveBook(
  uid: string,
  value: unknown,
  bookId?: string,
  catalogId?: string,
  selection?: unknown,
) {
  const { ref } = await studentFor(uid);
  const input = catalogId
    ? await catalogTextbook(id(catalogId))
    : parseBook(value);
  if (!input) throw new AccountError(404, "선택한 교재가 없어요.");
  const parsed = catalogId
      ? catalogSelection(input as Book, selection)
      : parseBook(input),
    bid = bookId ? id(bookId) : catalogId ? id(catalogId) : randomUUID(),
    bookRef = ref.collection("books").doc(bid);
  const book = await adminDb().runTransaction(async (tx) => {
    const [old, list] = await Promise.all([
      tx.get(bookRef),
      tx.get(ref.collection("books")),
    ]);
    if (!old.exists && list.size >= 20)
      throw new AccountError(409, "교재는 최대 20개까지 등록할 수 있어요.");
    const prior = old.data();
    if (catalogId && prior) return prior as Book;
    const identityChanged =
      prior &&
      (prior.subject !== parsed.subject ||
        schoolLevelOf(prior) !== schoolLevelOf(parsed) ||
        prior.grade !== parsed.grade);
    const shape = (units: Unit[]) =>
      JSON.stringify(units.map((u) => [u.id, u.title, unitContent(u)]));
    const changed =
      !prior ||
      shape(prior.units) !== shape(parsed.units) ||
      prior.subject !== parsed.subject ||
      schoolLevelOf(prior) !== schoolLevelOf(parsed) ||
      prior.grade !== parsed.grade;
    const b: Book = {
      ...parsed,
      units: parsed.units.map((unit) => {
        const previous = prior?.units.find((u: Unit) => u.id === unit.id) as
          Unit | undefined;
        const oldRevision = previous?.revision ?? prior?.revision ?? 0;
        return {
          ...unit,
          revision: previous
            ? oldRevision +
              (identityChanged || unitContent(previous) !== unitContent(unit)
                ? 1
                : 0)
            : 1,
        };
      }),
      id: bid,
      createdAt: prior?.createdAt ?? new Date().toISOString(),
      revision: (prior?.revision ?? 0) + (changed ? 1 : 0),
      origin: prior?.origin ?? (catalogId ? "catalog" : "upload"),
      ...(catalogId || prior?.catalogId
        ? { catalogId: catalogId || prior!.catalogId }
        : {}),
    };
    tx.set(bookRef, b);
    return b;
  });
  if (catalogId) await seedCatalogQuestions(ref, book);
  return book;
}

async function seedCatalogQuestions(ref: DocumentReference, book: Book) {
  const shared = (
    await adminDb()
      .collection("questionBank")
      .where("bookId", "==", book.id)
      .limit(200)
      .get()
  ).docs
    .map((d) => d.data() as BankQuestion)
    .filter((q) => q.status === "approved" && !q.poolId && q.grade === book.grade && schoolLevelOf(q) === schoolLevelOf(book));
  const questions = [...starterQuestions(book), ...shared];
  if (questions.length) {
    const batch = adminDb().batch();
    questions.forEach((q) =>
      batch.set(ref.collection("questions").doc(q.id), {
        ...q,
        revision:
          q.revision ??
          unitRevision(
            book,
            book.units.find((u) => u.id === q.unitId),
          ),
      }),
    );
    if (book.id.startsWith("foundation-"))
      for (const unit of book.units) {
        const plan: UnitPlan = {
          id: identityHash(`${book.id}:${unit.id}:${unitRevision(book, unit)}`),
          bookId: book.id,
          unitId: unit.id,
          revision: unitRevision(book, unit),
          skills: unit.concepts.map((concept) => ({
            concept,
            type: "기본 확인",
          })),
          origin: "editor",
          createdAt: new Date().toISOString(),
        };
        batch.set(ref.collection("unitPlans").doc(plan.id), plan);
      }
    await batch.commit();
  }
  const unit = book.units.find((u) => u.id === book.currentUnit);
  if (unit) await hydrateCatalogUnit(ref, book, unit);
}

/** Validate every selection before one transaction adds the complete confirmed list. */
export async function addCatalogBooks(uid: string, value: unknown) {
  const additions = parseCatalogAdditions(value);
  const { ref } = await studentFor(uid);
  const catalog = await Promise.all(
    additions.map((entry) => catalogTextbook(entry.catalogId)),
  );
  const plans = additions.map((entry, i) => {
    const book = catalog[i];
    if (!book)
      throw new AccountError(
        404,
        "선택한 교과서가 더 이상 목록에 없어요. 인식 결과를 다시 확인해 주세요.",
      );
    return { id: entry.catalogId, ...catalogSelection(book, entry.selection) };
  });
  const result = await adminDb().runTransaction(async (tx) => {
    const saved = await tx.get(ref.collection("books"));
    const prior = new Map(saved.docs.map((d) => [d.id, d.data() as Book]));
    const fresh = plans.filter((book) => !prior.has(book.id));
    if (saved.size + fresh.length > 20)
      throw new AccountError(
        409,
        `교재는 최대 20권까지 등록할 수 있어요. 현재 ${saved.size}권이 있어 ${fresh.length}권을 추가할 수 없어요.`,
      );
    const books = plans.map((plan): Book => {
      const existing = prior.get(plan.id);
      if (existing) return existing;
      const book: Book = {
        ...plan,
        catalogId: plan.id,
        origin: "catalog",
        revision: 1,
        createdAt: new Date().toISOString(),
      };
      tx.set(ref.collection("books").doc(book.id), book);
      return book;
    });
    return {
      books,
      added: fresh.length,
      existing: plans.length - fresh.length,
    };
  });
  // A problem-bank refresh failure must not misreport the committed books as unsaved.
  const seeded = await Promise.allSettled(
    result.books.map((book) => seedCatalogQuestions(ref, book)),
  );
  return {
    ...result,
    warning: seeded.some((r) => r.status === "rejected")
      ? "교재는 추가됐지만 일부 문제를 불러오지 못했어요. 교재에서 다시 시도해 주세요."
      : "",
  };
}
export async function queueJob(
  uid: string,
  bookId: string,
  unitId: string,
  options: { mode?: LearnMode; concept?: string; skillType?: string } = {},
) {
  if (!aiConfigured())
    throw new AccountError(503, "AI 연결 설정이 필요합니다.");
  const { ref, data } = await studentFor(uid);
  if (entitlement(data).status === "expired")
    throw new AccountError(
      402,
      "체험 기간이 끝났어요. 구독 후 새 문제를 만들 수 있어요.",
    );
  const book = (await ref.collection("books").doc(id(bookId)).get()).data() as
      Book | undefined,
    unit = book?.units.find((u) => u.id === unitId);
  if (!book || !unit)
    throw new AccountError(404, "교재와 단원을 확인해 주세요.");
  if (!unit.source && !canPrepareCurriculum(book))
    throw new AccountError(422, "이 단원의 학습 본문을 먼저 등록해 주세요.");
  const lockId = createHash("sha256")
      .update(`${bookId}:${unitId}:${unitRevision(book, unit)}`)
      .digest("hex")
      .slice(0, 32),
    lockRef = ref.collection("generationLocks").doc(lockId);
  const jid = await adminDb().runTransaction(async (tx) => {
    const lock = (await tx.get(lockRef)).data();
    const previous = lock?.jobId
      ? (await tx.get(ref.collection("jobs").doc(lock.jobId))).data()
      : null;
    if (previous && ["queued", "running"].includes(previous.status))
      return previous.id as string;
    const jobId = randomUUID();
    tx.set(ref.collection("jobs").doc(jobId), {
      id: jobId,
      bookId,
      unitId,
      status: "queued",
      createdAt: new Date().toISOString(),
      error: "",
      accepted: 0,
      rejected: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
      revision: unitRevision(book, unit),
      attempts: 0,
      purpose: options.mode ?? "extra",
      targetConcept: options.concept ?? "",
      targetType: options.skillType ?? "",
    });
    tx.set(lockRef, { jobId });
    return jobId;
  });
  return { id: jid, studentId: ref.id };
}
export async function runJob(uid: string, studentId: string, jobId: string) {
  const db = adminDb(),
    ref = db.collection("students").doc(id(studentId));
  const data = (await ref.get()).data();
  if (data?.guardianUid !== uid && data?.linkedUid !== uid)
    throw new AccountError(403, "작업 접근 권한이 없어요.");
  const jobRef = ref.collection("jobs").doc(id(jobId));
  const job = await db.runTransaction(async (tx) => {
    const j = (await tx.get(jobRef)).data();
    if (!j) throw new AccountError(404, "작업이 없어요.");
    if (
      j.status === "completed" ||
      (j.status === "running" && Date.parse(j.startedAt) > Date.now() - 300000)
    )
      return null;
    if ((j.attempts ?? 0) >= 3)
      throw new AccountError(
        409,
        "재시도 횟수를 초과했어요. 자료를 수정해 새 작업을 만들어 주세요.",
      );
    tx.update(jobRef, {
      status: "running",
      startedAt: new Date().toISOString(),
      attempts: (j.attempts ?? 0) + 1,
      error: "",
    });
    return j;
  });
  if (!job) return;
  try {
    const book = (
        await ref.collection("books").doc(job.bookId).get()
      ).data() as Book | undefined,
      registeredUnit = book?.units.find((u) => u.id === job.unitId);
    if (
      !book ||
      !registeredUnit ||
      unitRevision(book, registeredUnit) !== job.revision
    )
      throw new AccountError(
        409,
        "교재가 수정됐어요. 새 내용으로 다시 출제해 주세요.",
      );
    const { unit, provenance } = await resolveLearningMaterial(
      uid,
      ref,
      book,
      registeredUnit,
      (stage) => jobRef.update({ stage }),
    );
    await jobRef.update({ stage: "개념·유형 학습지도를 준비하고 있어요." });
    await ensureExposureIndex(ref);
    const [allBank, adaptive, learningSnapshot] = await Promise.all([
      loadBank(ref),
      loadAdaptive(ref),
      ref.collection("state").doc("learning").get(),
    ]);
    const oldQuestions = allBank.filter(
      (q) =>
        q.bookId === book.id &&
        q.unitId === unit.id &&
        (q.revision ?? 1) === unitRevision(book, unit),
    );
    let plan = planFor(book, unit, adaptive);
    if (!plan) {
      plan = await generateUnitPlan(uid, book, unit, oldQuestions.length > 0);
      Object.assign(plan, provenance);
      plan.id = identityHash(
        `${book.id}:${unit.id}:${unitRevision(book, unit)}`,
      );
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref.collection("books").doc(book.id));
        const currentBook = current.data() as Book | undefined;
        if (
          !currentBook ||
          unitRevision(
            currentBook,
            currentBook.units.find((u) => u.id === unit.id),
          ) !== unitRevision(book, unit)
        )
          throw new AccountError(
            409,
            "교재가 수정됐어요. 새 본문으로 학습지도를 다시 준비해 주세요.",
          );
        tx.set(ref.collection("unitPlans").doc(plan!.id), plan!);
      });
    }
    const exposed = await exposureSet(ref, oldQuestions);
    const scopedPlan = {
      ...plan,
      skills: plan.skills.filter(
        (s) =>
          (!job.targetConcept || s.concept === job.targetConcept) &&
          (!job.targetType || s.type === job.targetType),
      ),
    };
    const progress =
      job.purpose === "extra"
        ? []
        : adaptive.skills.filter(
            (s) =>
              s.bookId === book.id &&
              s.unitId === unit.id &&
              s.revision === unitRevision(book, unit),
          );
    const targets = generationTargets(
      scopedPlan,
      oldQuestions,
      exposed,
      fingerprint,
      progress,
      job.purpose === "reinforce" ? "reinforce" : "daily",
      new Set(
        Object.values(loadLearningState(learningSnapshot.data()).concepts)
          .filter(
            (c) =>
              c.bookId === book.id &&
              c.unitId === unit.id &&
              (!c.history.at(-1)?.correct ||
                c.history.at(-1)?.confidence !== "known"),
          )
          .map((c) => c.concept),
      ),
    );
    if (!targets.length) {
      await jobRef.update({
        status: "completed",
        completedAt: new Date().toISOString(),
        note: "현재 유형에 필요한 새 문제가 준비되어 있어 추가 생성하지 않았어요.",
      });
      return;
    }
    await jobRef.update({
      stage: "유형별 새 문제를 만들고 정답·근거를 검증하고 있어요.",
    });
    const output = await generateQuestions(uid, book, unit, {
      targets,
      exclude: oldQuestions.map((q) => q.prompt),
    });
    // Preserve failed checks, and make one bounded attempt with new variants.
    // Neither a zero-result first batch nor a retry relaxes the answer checks.
    if (!output.questions.some((q) => q.status === "approved")) {
      await jobRef.update({
        stage: "검증한 문제가 부족해 다른 새 변형을 준비하고 있어요.",
      });
      const retry = await generateQuestions(uid, book, unit, {
        targets,
        exclude: [...oldQuestions, ...output.questions].map((q) => q.prompt),
      });
      output.questions.push(...retry.questions);
      output.usage.inputTokens += retry.usage.inputTokens;
      output.usage.outputTokens += retry.usage.outputTokens;
      output.usage.estimatedUsd += retry.usage.estimatedUsd;
    }
    const accepted: BankQuestion[] = [];
    for (const q of output.questions) {
      Object.assign(q, provenance);
      if (
        [...oldQuestions, ...accepted].some((existing) =>
          duplicateQuestion(existing, q),
        )
      ) {
        q.status = "pending";
        q.reviewReason =
          "기존 문항과 유사합니다. 변형 내용과 정답을 검토해 주세요.";
      }
      accepted.push(q);
    }
    await db.runTransaction(async (batch) => {
      const [currentStudent, currentBook, currentJob] = await Promise.all([
        batch.get(ref),
        batch.get(ref.collection("books").doc(book.id)),
        batch.get(jobRef),
      ]);
      if (!currentStudent.exists || !currentJob.exists) return;
      if (
        currentStudent.data()?.guardianUid !== uid &&
        currentStudent.data()?.linkedUid !== uid
      )
        throw new AccountError(403, "작업 접근 권한이 변경됐어요.");
      const currentData = currentBook.data() as Book | undefined;
      if (
        !currentData ||
        unitRevision(
          currentData,
          currentData.units.find((u) => u.id === unit.id),
        ) !== unitRevision(book, unit)
      )
        throw new AccountError(
          409,
          "출제 중 교재가 수정됐어요. 새 내용으로 다시 출제해 주세요.",
        );
      output.questions.forEach((q) =>
        batch.set(ref.collection("questions").doc(q.id), {
          ...q,
          revision: unitRevision(book, unit),
        }),
      );
      batch.update(jobRef, {
        status: "completed",
        accepted: output.questions.filter((q) => q.status === "approved")
          .length,
        rejected: output.questions.filter((q) => q.status !== "approved")
          .length,
        ...output.usage,
        completedAt: new Date().toISOString(),
      });
    });
  } catch (error) {
    await jobRef.update({
      status: "failed",
      error:
        error instanceof AccountError
          ? error.message
          : "출제 작업을 완료하지 못했어요. 다시 시도해 주세요.",
    });
  }
}

export async function replenishQuestions(
  uid: string,
  bookId?: string,
  options: {
    mode?: LearnMode;
    unitId?: string;
    concept?: string;
    skillType?: string;
    requestId?: string;
  } = {},
) {
  if (!aiConfigured()) return [];
  const { ref, data } = await studentFor(uid);
  if (entitlement(data).status === "expired") return [];
  await ensureExposureIndex(ref);
  const [b, s, bank, j, config, adaptive] = await Promise.all([
    ref.collection("books").get(),
    ref.collection("state").doc("learning").get(),
    loadBank(ref),
    ref.collection("jobs").orderBy("createdAt", "desc").limit(100).get(),
    learningConfig(),
    loadAdaptive(ref),
  ]);
  const state = loadLearningState(s.data()),
    jobs: { id: string; studentId: string }[] = [];
  if (!options.mode || options.mode === "daily" || options.requestId) {
    const candidates = b.docs
      .map((d) => d.data() as Book)
      .filter((book) => book.active && (!bookId || book.id === bookId));
    const resume = await currentAssignment(
      ref,
      assignmentIdentity(
        seoulDate(),
        options.mode ?? "daily",
        bookId ?? "",
        options.requestId ?? "",
      ),
      candidates,
    );
    if (resume.old) return [];
  }
  const exposed = await exposureSet(ref, bank);
  for (const book of b.docs
    .map((d) => d.data() as Book)
    .filter((b) => b.active && (!bookId || b.id === bookId))
    .slice(0, 5)) {
    const units = options.unitId
      ? book.units.filter((u) => u.id === options.unitId)
      : options.mode === "reinforce"
        ? book.units.filter((u) =>
            Object.values(state.concepts).some(
              (c) =>
                c.bookId === book.id &&
                c.unitId === u.id &&
                (!options.concept || options.concept === c.concept) &&
                (adaptive.skills.some(
                  (s) =>
                    s.bookId === book.id &&
                    s.unitId === u.id &&
                    s.revision === unitRevision(book, u) &&
                    s.concept === c.concept &&
                    s.status === "needs-work" &&
                    (!options.skillType || s.type === options.skillType),
                ) ||
                  !c.history.at(-1)?.correct ||
                  c.history.at(-1)?.confidence !== "known"),
            ),
          )
        : [
            learningUnit(book, state, config.minimumNewPerConcept, adaptive),
          ].filter((u): u is NonNullable<typeof u> => !!u);
    for (const unit of units.slice(0, 3)) {
      if (!unit.source && !canPrepareCurriculum(book)) continue;
      const last = j.docs
        .map((d) => d.data())
        .find(
          (j) =>
            j.bookId === book.id &&
            j.unitId === unit.id &&
            j.revision === unitRevision(book, unit),
        );
      if (
        last &&
        (last.status === "failed" ||
          (last.status === "completed" && last.accepted === 0)) &&
        Date.now() - Date.parse(last.createdAt) < 30 * 60000
      )
        continue;
      const plan = planFor(book, unit, adaptive);
      const eligible = bank.filter(
        (q) =>
          q.bookId === book.id &&
          q.unitId === unit.id &&
          (q.revision ?? 1) === unitRevision(book, unit),
      );
      const progress =
        options.mode === "extra"
          ? []
          : adaptive.skills.filter(
              (p) =>
                p.bookId === book.id &&
                p.unitId === unit.id &&
                p.revision === unitRevision(book, unit),
            );
      const scopedPlan = plan && {
        ...plan,
        skills: plan.skills.filter(
          (p) =>
            (!options.concept || p.concept === options.concept) &&
            (!options.skillType || p.type === options.skillType),
        ),
      };
      if (
        !scopedPlan ||
        generationTargets(
          scopedPlan,
          eligible,
          exposed,
          fingerprint,
          progress,
          options.mode === "reinforce" ? "reinforce" : "daily",
          new Set(
            Object.values(state.concepts)
              .filter(
                (c) =>
                  c.bookId === book.id &&
                  c.unitId === unit.id &&
                  (!c.history.at(-1)?.correct ||
                    c.history.at(-1)?.confidence !== "known"),
              )
              .map((c) => c.concept),
          ),
        ).length
      )
        jobs.push(await queueJob(uid, book.id, unit.id, options));
    }
  }
  return jobs;
}

type Assignment = {
  id: string;
  date: string;
  mode: LearnMode;
  questions: BankQuestion[];
  results: Record<string, Result>;
  answers?: Record<string, AnswerFeedback>;
  opened: Record<string, string>;
  reasons?: Record<string, SelectionReason>;
  context?: Record<
    string,
    { bookTitle: string; unitTitle: string; bookRevision: number }
  >;
  createdAt: string;
};
function assignmentView(a: Assignment) {
  return {
    id: a.id,
    date: a.date,
    mode: a.mode,
    questions: a.questions.map((q) => ({
      ...publicQuestion(q),
      ...(a.reasons?.[q.id] ? { selectionReason: a.reasons[q.id] } : {}),
    })),
    results: a.results,
    answers: a.answers ?? {},
  };
}
async function currentAssignment(
  ref: DocumentReference,
  baseId: string,
  books: Book[],
) {
  let target = ref.collection("assignments").doc(baseId);
  let old = (await target.get()).data() as Assignment | undefined;
  const valid = (a: Assignment) =>
    a.questions.every((q) => {
      const book = books.find((b) => b.id === q.bookId);
      if (
        !book ||
        (q.revision ?? 1) !==
          unitRevision(
            book,
            book.units.find((u) => u.id === q.unitId),
          )
      )
        return false;
      if (a.mode !== "daily" && a.mode !== "exam") return true;
      return book.units
        .slice(
          book.units.findIndex((u) => u.id === book.currentUnit),
          book.units.findIndex((u) => u.id === book.endUnit) + 1,
        )
        .some((u) => u.id === q.unitId);
    });
  if (old && !valid(old)) {
    const scope = books.map((b) => [
      b.id,
      b.revision,
      b.currentUnit,
      b.endUnit,
    ]);
    target = ref
      .collection("assignments")
      .doc(`${baseId}-r${identityHash(JSON.stringify(scope)).slice(0, 16)}`);
    old = (await target.get()).data() as Assignment | undefined;
    if (old && !valid(old)) old = undefined;
  }
  return { ref: target, old };
}
function pendingHistory(
  a: Assignment,
  q: BankQuestion,
  feedback: AnswerFeedback,
): HistoryEntry {
  return {
    id: answerIdentity(a.id, q.id),
    assignmentId: a.id,
    questionId: q.id,
    bookId: q.bookId,
    unitId: q.unitId,
    concept: q.concept,
    subject: q.subject,
    date: a.date,
    at: feedback.at,
    answer: feedback.answer,
    correctAnswer: feedback.correctAnswer,
    correct: feedback.correct,
    seconds: feedback.seconds,
    mode: a.mode,
    prompt: q.prompt,
    choices: q.choices,
    explanation: feedback.explanation,
    reason: "",
    bookmarked: false,
    fingerprint: fingerprint(q),
    skillType: q.skillType ?? "기본 확인",
    phase: "awaiting-understanding",
    ...(q.sourceKind
      ? { sourceKind: q.sourceKind, references: q.references ?? [] }
      : {}),
    ...(a.context?.[q.id] ?? {}),
    ...(a.reasons?.[q.id] ? { selectionReason: a.reasons[q.id] } : {}),
  };
}
export async function createAssignment(uid: string, raw: unknown) {
  const input = object(raw),
    mode = (input.mode ?? "daily") as LearnMode;
  if (
    ![
      "daily",
      "extra",
      "review",
      "reinforce",
      "assessment",
      "practice",
      "exam",
    ].includes(mode)
  )
    throw new AccountError(400, "학습 유형을 확인해 주세요.");
  const selectedBook = input.bookId ? id(input.bookId) : "",
    selectedQuestion = input.questionId ? id(input.questionId) : "";
  const targetConcept = input.concept ? text(input.concept, 80, "개념") : "",
    targetType = input.skillType ? text(input.skillType, 80, "문제 유형") : "",
    selectedUnit = input.unitId ? id(input.unitId) : "";
  if (mode === "extra" && (!selectedBook || !selectedUnit))
    throw new AccountError(400, "추가로 풀 단원을 선택해 주세요.");
  const { ref, data } = await studentFor(uid),
    config = await learningConfig(),
    db = adminDb(),
    date = seoulDate();
  if (entitlement(data).status === "expired" && mode !== "practice")
    throw new AccountError(
      402,
      "무료 체험이 끝났어요. 기존 오답은 계속 열어볼 수 있으며, 새 학습은 구독 후 시작할 수 있어요.",
    );
  const requestId = input.requestId ? id(input.requestId) : randomUUID();
  const booksSnap = await ref.collection("books").get();
  const books = booksSnap.docs
    .map((d) => d.data() as Book)
    .filter((b) => b.active && (!selectedBook || b.id === selectedBook));
  const { ref: aRef, old } = await currentAssignment(
    ref,
    assignmentIdentity(date, mode, selectedBook, requestId),
    books,
  );
  const aid = aRef.id;
  if (old) return assignmentView(old);
  await ensureExposureIndex(ref);
  const [allBank, stateSnap, adaptive] = await Promise.all([
    loadBank(ref),
    ref.collection("state").doc("learning").get(),
    loadAdaptive(ref),
  ]);
  const state = loadLearningState(stateSnap.data());
  if (!books.length)
    throw new AccountError(409, "교재를 등록하고 학습 범위를 선택해 주세요.");
  if (
    selectedUnit &&
    !books.some((b) => b.units.some((u) => u.id === selectedUnit))
  )
    throw new AccountError(400, "등록한 교재의 단원을 선택해 주세요.");
  // Upgrade the authored starter curriculum without deriving coverage from whichever
  // questions happened to be served. Uploaded materials require a source-based plan.
  for (const book of books.filter((b) => b.id.startsWith("foundation-")))
    for (const unit of book.units) {
      if (!planFor(book, unit, adaptive)) {
        const plan: UnitPlan = {
          id: identityHash(`${book.id}:${unit.id}:${unitRevision(book, unit)}`),
          bookId: book.id,
          unitId: unit.id,
          revision: unitRevision(book, unit),
          skills: unit.concepts.map((concept) => ({
            concept,
            type: "기본 확인",
          })),
          origin: "editor",
          createdAt: new Date().toISOString(),
        };
        await ref.collection("unitPlans").doc(plan.id).set(plan);
        adaptive.plans.push(plan);
      }
    }
  if (mode === "practice") {
    const previous = await ref
      .collection("attempts")
      .where("questionId", "==", selectedQuestion)
      .limit(1)
      .get();
    if (
      previous.empty &&
      (
        await ref
          .collection("answerEvents")
          .where("questionId", "==", selectedQuestion)
          .limit(1)
          .get()
      ).empty
    )
      throw new AccountError(403, "풀었던 문제만 다시 풀 수 있어요.");
  }
  const inRange = (q: { bookId: string; unitId: string }) =>
    books.some(
      (b) =>
        b.id === q.bookId &&
        b.units
          .slice(
            b.units.findIndex((u) => u.id === b.currentUnit),
            b.units.findIndex((u) => u.id === b.endUnit) + 1,
          )
          .some((u) => u.id === q.unitId),
    );
  const bank = allBank
    .filter(
      (q) =>
        q.status === "approved" &&
        (mode !== "exam" || inRange(q)) &&
        books.some(
          (b) =>
            b.id === q.bookId &&
            (q.revision ?? 1) ===
              unitRevision(
                b,
                b.units.find((u) => u.id === q.unitId),
              ),
        ),
    )
    .map((q) => ({
      ...q,
      revision: q.revision ?? 1,
    }));
  const exposed = await exposureSet(ref, bank);
  const selections = selectAdaptiveQuestions({
    mode,
    books,
    bank,
    state,
    adaptive,
    exposed,
    date,
    fingerprint,
    limit: Math.min(state.dailyTarget, config.dailyPerSubject),
    selectedQuestion,
    targetConcept,
    targetType,
    unitId: selectedUnit,
  }).slice(0, mode === "practice" ? 1 : config.maxDaily);
  if (!selections.length) {
    const awaiting = adaptive.skills.some(
      (s) =>
        books.some(
          (b) =>
            b.id === s.bookId &&
            unitRevision(
              b,
              b.units.find((u) => u.id === s.unitId),
            ) === s.revision,
        ) && s.status === "awaiting-check",
    );
    throw new AccountError(
      409,
      mode === "review"
        ? "오늘 예정된 복습에 사용할 문항이 없어요. 새 변형 문제를 준비한 뒤 다시 시작해 주세요."
        : mode === "reinforce"
          ? "현재 보강할 취약 유형이 없거나 아직 보지 않은 변형 문제가 부족해요. 나의 교재에서 출제 상태를 확인해 주세요."
          : awaiting && mode === "daily"
            ? "오늘 확인한 유형은 다른 날의 새 문제로 다시 확인해요. 더 풀고 싶으면 나의 교재에서 단원별 새 문제를 선택해 주세요."
            : "아직 보지 않은 문제가 부족하거나 선택 범위의 확인을 마쳤어요. 나의 교재에서 학습지도·출제 상태와 범위를 확인해 주세요.",
    );
  }
  const assignment = await db.runTransaction(async (tx) => {
    const keys = [
      ...new Set(selections.map(({ question }) => fingerprint(question))),
    ];
    const eRefs = keys.map((key) =>
      ref.collection("questionExposures").doc(key),
    );
    const [existing, daySnap, exposureDocs] = await Promise.all([
      tx.get(aRef),
      tx.get(ref.collection("days").doc(date)),
      tx.getAll(...eRefs),
    ]);
    if (existing.exists) return existing.data() as Assignment;
    const currentExposures = new Map(exposureDocs.map((d) => [d.id, d]));
    const available = selections.filter(({ question: q, reason }) => {
      if (mode === "practice") return true;
      const exposure = currentExposures.get(fingerprint(q));
      return reason.repeated
        ? exposure?.data()?.lastAssignedDate !== date
        : !exposure?.exists;
    });
    const day = daySnap.data() ?? {
      reserved: 0,
      count: 0,
      points: 0,
      questionIds: [],
    };
    const { selected: unique, dailySubjects } = reserveQuestions(
      available.map((s) => s.question),
      mode,
      {
        reserved: day.reserved ?? 0,
        questionIds: day.questionIds ?? [],
        dailySubjects: day.dailySubjects,
      },
      config,
      state.dailyTarget,
    );
    if (!unique.length)
      throw new AccountError(
        409,
        "오늘의 학습 한도에 도달했거나 다른 학습에 배정된 문제예요. 진행 중인 학습을 이어가 주세요.",
      );
    const reasons = Object.fromEntries(
      unique.map((q) => [
        q.id,
        available.find((s) => s.question.id === q.id)!.reason,
      ]),
    );
    const context = Object.fromEntries(
      unique.map((q) => {
        const book = books.find((b) => b.id === q.bookId)!;
        return [
          q.id,
          {
            bookTitle: book.title,
            unitTitle: book.units.find((u) => u.id === q.unitId)!.title,
            bookRevision: book.revision,
          },
        ];
      }),
    );
    const a: Assignment = {
      id: aid,
      date,
      mode,
      questions: unique,
      reasons,
      context,
      results: {},
      opened: {},
      createdAt: new Date().toISOString(),
    };
    tx.set(aRef, a);
    for (const q of unique) {
      const key = fingerprint(q),
        eRef = ref.collection("questionExposures").doc(key),
        prior = currentExposures.get(key)?.data();
      tx.set(
        eRef,
        {
          fingerprint: key,
          firstAssignedAt: prior?.firstAssignedAt ?? a.createdAt,
          firstAssignmentId: prior?.firstAssignmentId ?? aid,
          lastAssignedAt: a.createdAt,
          lastAssignedDate: date,
          lastAssignmentId: aid,
          questionId: q.id,
          assignments: (prior?.assignments ?? 0) + 1,
        },
        { merge: true },
      );
    }
    if (mode !== "practice")
      tx.set(ref.collection("days").doc(date), {
        ...day,
        reserved: day.reserved + unique.length,
        dailySubjects,
        questionIds: [...day.questionIds, ...unique.map((q) => q.id)],
      });
    return a;
  });
  return assignmentView(assignment);
}

const SUBJECT_NAMES_LOCAL = {
  korean: 1,
  english: 1,
  math: 1,
  social: 1,
  science: 1,
};
export async function openQuestion(
  uid: string,
  assignmentId: string,
  questionId: string,
) {
  const { ref } = await studentFor(uid),
    aRef = ref.collection("assignments").doc(id(assignmentId));
  return adminDb().runTransaction(async (tx) => {
    const a = (await tx.get(aRef)).data() as Assignment | undefined;
    const question = a?.questions.find((q) => q.id === questionId);
    if (!a || !question) throw new AccountError(404, "문제가 없어요.");
    if (a.date !== seoulDate())
      throw new AccountError(
        409,
        "날짜가 바뀌었어요. 오늘 학습을 다시 열어 주세요.",
      );
    const opened = {
      ...a.opened,
      [questionId]: a.opened[questionId] ?? new Date().toISOString(),
    };
    const eRef = ref.collection("questionExposures").doc(fingerprint(question)),
      oldExposure = (await tx.get(eRef)).data();
    tx.update(aRef, { opened });
    tx.set(
      eRef,
      {
        fingerprint: fingerprint(question),
        firstOpenedAt: oldExposure?.firstOpenedAt ?? opened[questionId],
        lastOpenedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    return {
      openedAt: opened[questionId],
      result: a.results[questionId] ?? null,
      answer: a.answers?.[questionId] ?? null,
    };
  });
}
export async function answerQuestion(uid: string, raw: unknown) {
  const input = object(raw),
    aid = id(input.assignmentId),
    qid = id(input.questionId),
    answer =
      typeof input.answer === "string"
        ? text(input.answer, 200, "답안")
        : integer(input.answer, 0, 3, "답안");
  const { ref } = await studentFor(uid),
    aRef = ref.collection("assignments").doc(aid),
    now = new Date();
  return adminDb().runTransaction(async (tx) => {
    const [aSnap, liveQuestion] = await Promise.all([
      tx.get(aRef),
      tx.get(ref.collection("questions").doc(qid)),
    ]);
    const a = aSnap.data() as Assignment | undefined,
      q = a?.questions.find((q) => q.id === qid);
    if (!a || !q) throw new AccountError(404, "배정된 문제가 없어요.");
    // Replays return the locked answer, even if another tab submits a new choice.
    if (a.results[qid]) return a.results[qid];
    if (a.answers?.[qid]) return a.answers[qid];
    if (liveQuestion.data()?.status !== "approved")
      throw new AccountError(
        409,
        "검수 중인 문항입니다. 교재 관리에서 다른 학습을 선택해 주세요.",
      );
    if (a.date !== seoulDate(now))
      throw new AccountError(
        409,
        "날짜가 바뀌었어요. 오늘 학습을 다시 열어 주세요.",
      );
    if (!a.opened[qid]) throw new AccountError(409, "문제를 먼저 열어 주세요.");
    const feedback: AnswerFeedback = {
      answer,
      correctAnswer: q.answer,
      correct: checkAnswer(q, answer),
      explanation: q.explanation,
      seconds: Math.max(
        0,
        Math.min(
          3600,
          Math.floor((now.getTime() - Date.parse(a.opened[qid])) / 1000),
        ),
      ),
      at: now.toISOString(),
    };
    tx.update(aRef, { answers: { ...a.answers, [qid]: feedback } });
    tx.set(
      ref.collection("answerEvents").doc(answerIdentity(aid, qid)),
      pendingHistory(a, q, feedback),
    );
    tx.set(
      ref.collection("questionExposures").doc(fingerprint(q)),
      { fingerprint: fingerprint(q), lastAnsweredAt: feedback.at },
      { merge: true },
    );
    return feedback;
  });
}
export async function assessQuestion(uid: string, raw: unknown) {
  const input = object(raw),
    aid = id(input.assignmentId),
    qid = id(input.questionId),
    confidence = input.confidence as Confidence;
  if (!["known", "unsure", "unknown"].includes(confidence))
    throw new AccountError(400, "이해도를 선택해 주세요.");
  const { ref } = await studentFor(uid),
    db = adminDb(),
    aRef = ref.collection("assignments").doc(aid),
    sRef = ref.collection("state").doc("learning"),
    now = new Date(),
    date = seoulDate(now),
    config = await learningConfig();
  return db.runTransaction(async (tx) => {
    const [aSnap, sSnap, daySnap, studentSnap, liveQuestion] =
      await Promise.all([
        tx.get(aRef),
        tx.get(sRef),
        tx.get(ref.collection("days").doc(date)),
        tx.get(ref),
        tx.get(ref.collection("questions").doc(qid)),
      ]);
    const a = aSnap.data() as Assignment | undefined,
      q = a?.questions.find((q) => q.id === qid);
    if (!a || !q) throw new AccountError(404, "배정된 문제가 없어요.");
    if (a.results[qid]) return a.results[qid];
    if (liveQuestion.data()?.status !== "approved")
      throw new AccountError(
        409,
        "검수 중인 문항입니다. 교재 관리에서 다른 학습을 선택해 주세요.",
      );
    if (a.date !== date)
      throw new AccountError(
        409,
        "날짜가 바뀌었어요. 오늘 학습을 다시 열어 주세요.",
      );
    if (!a.opened[qid]) throw new AccountError(409, "문제를 먼저 열어 주세요.");
    const feedback = a.answers?.[qid];
    if (!feedback)
      throw new AccountError(409, "정답과 해설을 먼저 확인해 주세요.");
    const book = (
      await tx.get(ref.collection("books").doc(q.bookId))
    ).data() as Book | undefined;
    if (
      !book ||
      (q.revision ?? 1) !==
        unitRevision(
          book,
          book.units.find((u) => u.id === q.unitId),
        )
    )
      throw new AccountError(
        409,
        "교재가 수정됐어요. 새 본문으로 준비된 학습을 시작해 주세요.",
      );
    const revision = q.revision ?? 1;
    const skillId = identityHash(
      skillIdentity(q.bookId, q.unitId, revision, {
        concept: q.concept,
        type: q.skillType ?? "기본 확인",
      }),
    );
    const skillRef = ref.collection("skillProgress").doc(skillId);
    const groupKey = identityHash(
      JSON.stringify([q.bookId, q.unitId, revision, q.concept]),
    );
    const [skillSnap, groupSnap] = await Promise.all([
      tx.get(skillRef),
      tx.get(ref.collection("skillProgress").where("groupKey", "==", groupKey)),
    ]);
    const previousSkill = skillSnap.data() as SkillProgress | undefined;
    const { answer, seconds } = feedback,
      state = loadLearningState(sSnap.data()),
      previous = state.concepts[conceptKey(q)],
      previousSchedule = previousSkill?.dueDate ? previousSkill : previous,
      out = gradeAnswer(
        q,
        previous && previousSchedule
          ? {
              ...previous,
              interval: previousSchedule.interval ?? 1,
              dueDate: previousSchedule.dueDate ?? "",
              reviewStreak: previousSchedule.reviewStreak ?? 0,
            }
          : previous,
        answer,
        confidence,
        seconds,
        a.mode,
        entitlement(studentSnap.data()!).status === "trial",
        now,
        config,
        {
          baseDifficulty: state.baseDifficulty,
          autoDifficulty: state.autoDifficulty,
        },
      ),
      day = daySnap.data() ?? {
        reserved: 0,
        count: 0,
        points: 0,
        questionIds: [],
      };
    const points = Math.min(out.points, Math.max(0, 100 - (day.points ?? 0)));
    const rid = answerIdentity(aid, qid);
    const nextSkill = advanceSkill(
      previousSkill,
      {
        id: skillId,
        bookId: q.bookId,
        unitId: q.unitId,
        revision,
        groupKey,
        concept: q.concept,
        type: q.skillType ?? "기본 확인",
      },
      {
        questionId: qid,
        fingerprint: fingerprint(q),
        date,
        at: feedback.at,
        correct: out.correct,
        confidence,
        seconds,
        mode: a.mode,
      },
      rid,
    );
    if (a.mode !== "practice" && nextSkill.status !== "secure") {
      out.interval = Math.min(
        out.interval,
        nextSkill.status === "learning" ? 3 : 1,
      );
      out.progress.interval = out.interval;
      out.progress.dueDate = addDays(date, out.interval);
    }
    const nextDue =
      a.mode === "practice"
        ? (previousSchedule?.dueDate ?? "")
        : out.progress.dueDate;
    const nextInterval =
      a.mode === "practice" ? (previousSchedule?.interval ?? 0) : out.interval;
    if (a.mode !== "practice") {
      nextSkill.dueDate = nextDue;
      nextSkill.interval = nextInterval;
      nextSkill.reviewStreak = out.progress.reviewStreak;
      const earliest = [
        ...groupSnap.docs
          .filter((d) => d.id !== skillId)
          .map((d) => d.data() as SkillProgress),
        nextSkill,
      ]
        .filter((s) => !!s.dueDate)
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
      out.progress.dueDate = earliest.dueDate!;
      out.progress.interval = earliest.interval ?? nextInterval;
    }
    const result: Result = {
      id: rid,
      questionId: qid,
      bookId: q.bookId,
      unitId: q.unitId,
      concept: q.concept,
      subject: q.subject,
      date,
      at: feedback.at,
      answer,
      correctAnswer: q.answer,
      correct: out.correct,
      confidence,
      seconds,
      points,
      interval: nextInterval,
      dueDate: nextDue,
      mode: a.mode,
      prompt: q.prompt,
      choices: q.choices,
      explanation: q.explanation,
      reason: "",
      bookmarked: false,
      assignmentId: aid,
      skillType: q.skillType ?? "기본 확인",
      fingerprint: fingerprint(q),
      ...(q.sourceKind
        ? { sourceKind: q.sourceKind, references: q.references ?? [] }
        : {}),
      ...(a.context?.[q.id] ?? {
        bookTitle: book.title,
        unitTitle: book.units.find((u) => u.id === q.unitId)?.title ?? "",
        bookRevision: revision,
      }),
      ...(a.reasons?.[qid] ? { selectionReason: a.reasons[qid] } : {}),
      reviewChange: {
        previousDue: previousSchedule?.dueDate ?? "",
        nextDue,
        previousInterval: previousSchedule?.interval ?? 0,
        nextInterval,
        previousWeakness: previous?.weakness ?? 0,
        nextWeakness:
          a.mode === "practice"
            ? (previous?.weakness ?? 0)
            : out.progress.weakness,
        previousMastery: previousSkill?.status ?? "learning",
        nextMastery: nextSkill.status,
        policyVersion: ADAPTIVE_POLICY.version,
      },
    };
    if (a.mode !== "practice") {
      state.concepts[conceptKey(q)] = { ...out.progress, lastAttemptId: rid };
      tx.set(skillRef, nextSkill);
    }
    state.points += points;
    state.updatedAt = now.toISOString();
    tx.set(sRef, state);
    tx.update(aRef, { results: { ...a.results, [qid]: result } });
    tx.set(ref.collection("attempts").doc(rid), result);
    tx.set(ref.collection("answerEvents").doc(rid), {
      ...result,
      phase: "complete",
    });
    if (a.mode !== "practice")
      tx.set(ref.collection("days").doc(date), {
        ...day,
        count: day.count + 1,
        points: (day.points ?? 0) + points,
      });
    if (points)
      tx.set(ref.collection("ledger").doc(rid), {
        id: rid,
        amount: points,
        reason: "answer",
        at: now.toISOString(),
      });
    return result;
  });
}
export async function updateNote(uid: string, raw: unknown) {
  const v = object(raw),
    { ref } = await studentFor(uid),
    rRef = ref.collection("attempts").doc(id(v.id));
  const r = await rRef.get();
  if (!r.exists) throw new AccountError(404, "학습 기록이 없어요.");
  const patch = {
    reason: text(v.reason ?? "", 500, "오답 메모", true),
    bookmarked: v.bookmarked === true,
  };
  const batch = adminDb().batch();
  batch.update(rRef, patch);
  const event = ref.collection("answerEvents").doc(rRef.id);
  batch.set(
    event,
    { ...r.data(), ...patch, phase: "complete" },
    { merge: true },
  );
  await batch.commit();
  return patch;
}
export async function updateSettings(uid: string, raw: unknown) {
  const v = object(raw),
    { ref } = await studentFor(uid),
    sRef = ref.collection("state").doc("learning");
  return adminDb().runTransaction(async (tx) => {
    const state = loadLearningState((await tx.get(sRef)).data());
    if (v.theme !== undefined) {
      if (!["dark", "light", "system"].includes(String(v.theme)))
        throw new AccountError(400, "테마를 확인해 주세요.");
      state.theme = v.theme as LearningState["theme"];
    }
    if (v.locale !== undefined) {
      if (!["ko", "en", "ja", "zh"].includes(String(v.locale)))
        throw new AccountError(400, "언어를 확인해 주세요.");
      state.locale = v.locale as LearningState["locale"];
    }
    if (v.baseDifficulty !== undefined)
      state.baseDifficulty = integer(v.baseDifficulty, 1, 5, "기본 난이도");
    if (v.autoDifficulty !== undefined) {
      if (typeof v.autoDifficulty !== "boolean")
        throw new AccountError(400, "자동 난이도 설정을 확인해 주세요.");
      state.autoDifficulty = v.autoDifficulty;
    }
    if (v.dailyTarget !== undefined)
      state.dailyTarget = integer(v.dailyTarget, 1, 10, "하루 과목별 목표");
    if (v.examDate !== undefined) {
      const date = text(v.examDate, 10, "시험일", true);
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        throw new AccountError(400, "시험일을 확인해 주세요.");
      state.examDate = date;
    }
    if (v.cosmetic !== undefined) {
      const c = COSMETICS.find((c) => c.id === v.cosmetic);
      if (!c) throw new AccountError(400, "장식을 확인해 주세요.");
      if (!state.cosmetics.includes(c.id)) {
        if (state.points - state.spent < c.price)
          throw new AccountError(409, "포인트가 부족해요.");
        state.spent += c.price;
        state.cosmetics.push(c.id);
      }
      state.equipped = c.id;
    }
    tx.set(sRef, state);
    return state;
  });
}
