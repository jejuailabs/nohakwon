import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import {
  loadLearningState,
  makeReport,
  id,
  integer,
  object,
  subject,
  text,
  type Result,
  type LearningState,
} from "@/lib/learning";
import { audit } from "./admin-service";
import { saveWeeklyReport } from "./reports";
import { runMaintenance } from "./maintenance";
function operator(role: string) {
  if (!["owner", "admin"].includes(role))
    throw new AccountError(403, "운영 관리자 권한이 필요합니다.");
}
export async function operationSnapshot(
  uid: string,
  role: string,
  studentId?: string,
) {
  operator(role);
  const db = adminDb(),
    [orders, deletions, status] = await Promise.all([
      db.collection("orders").orderBy("createdAt", "desc").limit(100).get(),
      db
        .collection("deletionRequests")
        .orderBy("createdAt", "desc")
        .limit(30)
        .get(),
      db.doc("operations/maintenance").get(),
    ]);
  let learner = null;
  if (studentId) {
    const ref = db.collection("students").doc(id(studentId)),
      [s, b, a, st, r] = await Promise.all([
        ref.get(),
        ref.collection("books").get(),
        ref.collection("attempts").orderBy("at", "desc").limit(1500).get(),
        ref.collection("state").doc("learning").get(),
        ref.collection("reports").orderBy("createdAt", "desc").limit(12).get(),
      ]);
    if (!s.exists) throw new AccountError(404, "학습 프로필이 없어요.");
    const state = loadLearningState(st.data()),
      attempts = a.docs.map((d) => d.data() as Result);
    learner = {
      id: ref.id,
      nickname: s.data()!.nickname,
      trialEndsAt: s.data()!.trialEndsAt ?? "",
      books: b.docs.map((d) => d.data()),
      report: makeReport(attempts, state.concepts),
      recent: attempts.slice(0, 50),
      reports: r.docs.map((d) => d.data()),
    };
    await audit(uid, "read-learner-report", ref.id);
  }
  return {
    orders: orders.docs.map((d) => {
      const o = d.data();
      return {
        id: d.id,
        studentId: o.studentId,
        amount: o.amount,
        status: o.status,
        createdAt: o.createdAt,
        periodEnd: o.periodEnd,
        lastError: o.lastError ?? "",
      };
    }),
    deletions: deletions.docs.map((d) => ({
      id: d.id,
      status: d.data().status,
      createdAt: d.data().createdAt,
      resolution: d.data().resolution ?? "",
    })),
    maintenance: status.data() ?? null,
    learner,
  };
}
export async function operationMutation(
  uid: string,
  role: string,
  raw: unknown,
) {
  operator(role);
  const v = object(raw),
    db = adminDb();
  if (v.action === "maintenance") {
    const result = await runMaintenance();
    await audit(uid, "run-maintenance", "system");
    return result;
  }
  if (v.action === "report") {
    const sid = id(v.studentId);
    await saveWeeklyReport(sid);
    await audit(uid, "generate-report", sid);
    return { ok: true };
  }
  if (v.action === "extendTrial") {
    const sid = id(v.studentId),
      days = integer(v.days, 1, 30, "연장 일수"),
      ref = db.collection("students").doc(sid);
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s) throw new AccountError(404, "학습 프로필이 없어요.");
      const created = s.createdAt?.toDate?.()?.toISOString() ?? s.createdAt;
      const end =
        s.trialEndsAt ??
        new Date(Date.parse(created) + 7 * 86400000).toISOString();
      tx.update(ref, {
        trialEndsAt: new Date(
          Math.max(Date.now(), Date.parse(end)) + days * 86400000,
        ).toISOString(),
      });
    });
    await audit(uid, "extend-trial", sid, { days });
    return { ok: true };
  }
  if (v.action === "deletionReview") {
    const target = id(v.id),
      resolution = text(v.resolution, 1000, "처리 메모"),
      ref = db.collection("deletionRequests").doc(target);
    await ref.update({
      resolution,
      status: "reviewing",
      reviewedBy: uid,
      reviewedAt: new Date().toISOString(),
    });
    await audit(uid, "review-deletion-request", target);
    return { ok: true };
  }
  throw new AccountError(400, "운영 작업을 확인해 주세요.");
}
export async function conceptList() {
  return (
    await adminDb().collection("curriculumConcepts").limit(500).get()
  ).docs.map((d) => d.data());
}
export async function saveConcept(uid: string, role: string, raw: unknown) {
  if (!["owner", "admin", "editor"].includes(role))
    throw new AccountError(403, "개념 편집 권한이 없습니다.");
  const v = object(raw),
    cid = id(v.id),
    list = await conceptList(),
    prerequisites = Array.isArray(v.prerequisites)
      ? [...new Set(v.prerequisites.map(id))]
      : [];
  if (
    prerequisites.length > 20 ||
    prerequisites.some((p) => p === cid || !list.some((c) => c.id === p))
  )
    throw new AccountError(400, "선수 개념을 먼저 등록해 주세요.");
  const next = {
    id: cid,
    title: text(v.title, 80, "개념명"),
    subject: subject(v.subject),
    grade: integer(v.grade, 1, 3, "학년"),
    standardCodes: Array.isArray(v.standardCodes)
      ? v.standardCodes.slice(0, 20).map((c) => text(c, 40, "성취기준 코드"))
      : [],
    prerequisites,
  };
  const graph = new Map(
    [...list, next].map((c) => [c.id, c.prerequisites as string[]]),
  );
  function cycle(node: string, path: Set<string>): boolean {
    if (path.has(node)) return true;
    return (graph.get(node) ?? []).some((p) =>
      cycle(p, new Set([...path, node])),
    );
  }
  if (cycle(cid, new Set()))
    throw new AccountError(400, "선수 개념이 순환하지 않도록 연결해 주세요.");
  await adminDb().collection("curriculumConcepts").doc(cid).set(next);
  await audit(uid, "save-concept", cid);
  return { ok: true };
}
