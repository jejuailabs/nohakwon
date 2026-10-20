import "server-only";
import { AccountError } from "@/lib/account";
import { id, text, type Job, type LearnMode, type Book } from "@/lib/learning";
import {
  createAssignment,
  replenishQuestions,
  studentFor,
  entitlement,
} from "./workspace";
import { learningUnit } from "@/lib/learning";
import { loadAdaptive } from "./adaptive";
import { loadLearningState } from "@/lib/learning";
import {
  prepareCatalogLearning,
  prefetchFollowingCatalogUnits,
  requestMoreCatalogQuestions,
} from "./catalog-preparation";

/** A normal first visit starts preparation (202), rather than reporting a 409 failure. */
export async function startLearning(
  uid: string,
  input: Record<string, unknown>,
) {
  const mode = String(input.mode ?? "daily") as LearnMode;
  const bookId = input.bookId ? id(input.bookId) : undefined;
  const { ref, data } = await studentFor(uid);
  if (entitlement(data).status === "expired" && mode !== "practice")
    throw new AccountError(
      402,
      "무료 체험이 끝났어요. 구독 후 새 학습을 시작할 수 있어요.",
    );
  const supported = ["daily", "extra"].includes(mode);
  const catalog = supported
    ? await prepareCatalogLearning(
        ref,
        bookId,
        input.unitId ? id(input.unitId) : undefined,
      )
    : { current: [], keys: [] };
  // Ready stock is served before considering generation. Another learner's entry
  // never causes an unnecessary private AI batch for an already prepared scope.
  try {
    const assignment = await createAssignment(uid, input);
    const next = ["daily", "extra"].includes(mode)
      ? await prefetchFollowingCatalogUnits(ref, assignment.questions)
      : [];
    return {
      status: 200,
      payload: assignment,
      jobs: [],
      catalogJobs: [...catalog.keys, ...next],
    };
  } catch (error) {
    if (!(error instanceof AccountError) || error.status !== 409) throw error;
  }
  const available = await requestMoreCatalogQuestions(
    ref.id,
    catalog.current,
    String(input.requestId ?? "daily"),
  );
  const pendingCatalog = available.filter((p) =>
    ["queued", "running"].includes(p.status),
  );
  if (pendingCatalog.length)
    return {
      status: 202,
      payload: {
        preparing: true as const,
        jobs: pendingCatalog.map(
          (p): Job => ({
            id: p.id,
            bookId: p.catalogId,
            unitId: p.unitId,
            status: p.status === "running" ? "running" : "queued",
            stage: p.stage,
            createdAt: p.createdAt,
            error: p.error,
            accepted: p.approved,
            rejected: p.rejected,
            inputTokens: p.inputTokens,
            outputTokens: p.outputTokens,
            estimatedUsd: p.estimatedUsd,
          }),
        ),
      },
      jobs: [],
      catalogJobs: catalog.keys,
    };
  const failedCatalog = catalog.current.find((p) =>
    ["blocked", "failed"].includes(p.status),
  );
  if (failedCatalog)
    throw new AccountError(
      422,
      failedCatalog.error ||
        "교재 범위와 정답 검증을 통과하지 못해 운영 확인이 필요해요.",
    );
  const jobs = ["daily", "extra", "reinforce"].includes(mode)
    ? await replenishQuestions(uid, bookId, {
        mode,
        ...(input.requestId ? { requestId: id(input.requestId) } : {}),
        ...(input.unitId ? { unitId: id(input.unitId) } : {}),
        ...(input.concept ? { concept: text(input.concept, 80, "개념") } : {}),
        ...(input.skillType
          ? { skillType: text(input.skillType, 80, "문제 유형") }
          : {}),
      })
    : [];
  try {
    const assignment = await createAssignment(uid, input);
    const next = ["daily", "extra"].includes(mode)
      ? await prefetchFollowingCatalogUnits(ref, assignment.questions)
      : [];
    return {
      status: 200,
      payload: assignment,
      jobs,
      catalogJobs: [...catalog.keys, ...next],
    };
  } catch (error) {
    if (!(error instanceof AccountError) || error.status !== 409) throw error;
    const current = await Promise.all(
      jobs.map((j) => ref.collection("jobs").doc(j.id).get()),
    );
    const pending = current
      .map((j) => j.data() as Job)
      .filter((j) => ["queued", "running"].includes(j.status));
    if (pending.length)
      return {
        status: 202,
        payload: { preparing: true as const, jobs: pending },
        jobs,
        catalogJobs: catalog.keys,
      };
    if (bookId && ["daily", "extra"].includes(mode)) {
      const book = (await ref.collection("books").doc(bookId).get()).data() as
        | Book
        | undefined;
      if (book) {
        const state = loadLearningState(
          (await ref.collection("state").doc("learning").get()).data(),
        );
        const unit = input.unitId
          ? book.units.find((u) => u.id === input.unitId)
          : learningUnit(book, state, 3, await loadAdaptive(ref));
        if (unit) {
          const latest = await ref
            .collection("jobs")
            .orderBy("createdAt", "desc")
            .limit(100)
            .get();
          const job = latest.docs
            .map((j) => j.data())
            .find(
              (j) =>
                j.bookId === book.id &&
                j.unitId === unit.id &&
                j.revision === (unit.revision ?? book.revision),
            );
          if (job?.status === "failed")
            throw new AccountError(
              422,
              String(
                job.error ||
                  "문제를 준비하지 못했어요. 교재의 학습 자료를 확인해 주세요.",
              ),
            );
          if (job?.status === "completed" && job.accepted === 0)
            throw new AccountError(
              422,
              "생성한 문제의 정답·근거 검증을 통과하지 못했어요. 본문을 추가하거나 출제 작업에서 다시 준비해 주세요.",
            );
          if (!unit.source && book.origin !== "catalog")
            throw new AccountError(
              422,
              "목차만 등록된 자료예요. 해당 단원의 본문 사진·PDF·학습 내용을 추가하면 문제를 만들 수 있어요.",
            );
        }
      }
    }
    throw error;
  }
}
