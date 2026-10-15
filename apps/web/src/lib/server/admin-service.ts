import "server-only";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import {
  DEFAULT_CONFIG,
  id,
  integer,
  object,
  parseBook,
  parseQuestion,
  text,
} from "@/lib/learning";
import { requireUser } from "./session";
import { textbookCatalog, catalogTextbook } from "./textbook-catalog";
import { schoolLevelOf } from "@/lib/education";
export const ADMIN_ROLES = ["owner", "admin", "editor", "reviewer"];
export async function adminRole(uid: string) {
  return (await adminAuth().getUser(uid)).customClaims?.nohakwonRole as
    string | undefined;
}
export async function requireAdmin(roles = ADMIN_ROLES) {
  const user = await requireUser(),
    role = await adminRole(user.uid);
  if (!role || !roles.includes(role))
    throw new AccountError(403, "관리자 권한이 필요합니다.");
  return { ...user, role };
}
export async function audit(
  uid: string,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  await adminDb()
    .collection("auditLogs")
    .add({ uid, action, target, details, at: new Date().toISOString() });
}
export async function adminSnapshot(
  uid: string,
  role: string,
  studentId?: string,
) {
  const db = adminDb(),
    [textbooks, disputes, usage, config, audits, textbookRequests] =
      await Promise.all([
        textbookCatalog(true),
        db.collection("disputes").orderBy("createdAt", "desc").limit(100).get(),
        db.collection("aiUsage").orderBy("at", "desc").limit(100).get(),
        db.doc("settings/learning").get(),
        db.collection("auditLogs").orderBy("at", "desc").limit(50).get(),
        db
          .collection("textbookRequests")
          .where("status", "==", "pending")
          .limit(100)
          .get(),
      ]);
  let students: unknown[] = [],
    questions: unknown[] = [],
    jobs: unknown[] = [];
  if (["owner", "admin"].includes(role)) {
    const s = await db.collection("students").limit(100).get();
    students = s.docs.map((d) => ({
      id: d.id,
      nickname: d.data().nickname,
      schoolLevel: schoolLevelOf(d.data()),
      grade: d.data().grade,
      guardianUid: d.data().guardianUid,
      paidUntil: d.data().paidUntil ?? "",
      cancelAtPeriodEnd: d.data().cancelAtPeriodEnd ?? false,
    }));
  }
  if (studentId) {
    if (!["owner", "admin"].includes(role))
      throw new AccountError(
        403,
        "개인 교재와 학습 기록은 운영 관리자만 조회할 수 있습니다.",
      );
    const ref = db.collection("students").doc(id(studentId));
    const [q, j] = await Promise.all([
      ref.collection("questions").limit(300).get(),
      ref.collection("jobs").orderBy("createdAt", "desc").limit(30).get(),
    ]);
    questions = q.docs.map((d) => d.data());
    jobs = j.docs.map((d) => d.data());
    await audit(uid, "read-question-bank", studentId);
  } else
    questions = (await db.collection("questionBank").limit(300).get()).docs.map(
      (d) => d.data(),
    );
  const rows = usage.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    role,
    textbooks,
    textbookRequests: textbookRequests.docs.map((d) => ({
      id: d.id,
      title: d.data().title,
      createdAt: d.data().createdAt,
    })),
    students,
    questions,
    jobs,
    disputes: ["owner", "admin"].includes(role)
      ? disputes.docs.map((d) => ({ id: d.id, ...d.data() }))
      : [],
    usage: rows,
    config: { ...DEFAULT_CONFIG, ...config.data() },
    audit: ["owner", "admin"].includes(role)
      ? audits.docs.map((d) => ({ id: d.id, ...d.data() }))
      : [],
    aiConfigured: !!process.env.OPENAI_API_KEY,
    billingConfigured: !!process.env.TOSS_SECRET_KEY,
  };
}
export async function adminMutation(uid: string, role: string, value: unknown) {
  const v = object(value),
    db = adminDb();
  if (v.action === "resolve-textbook-request") {
    if (!["owner", "admin", "editor"].includes(role))
      throw new AccountError(403, "교재 편집 권한이 없습니다.");
    const requestId = id(v.id);
    await db.collection("textbookRequests").doc(requestId).update({
      status: "resolved",
      resolvedBy: uid,
      resolvedAt: new Date().toISOString(),
    });
    await audit(uid, "resolve-textbook-request", requestId);
    return;
  }
  if (v.action === "textbook") {
    if (!["owner", "admin", "editor"].includes(role))
      throw new AccountError(403, "교재 편집 권한이 없습니다.");
    const b = parseBook(v.book),
      bid = id(v.id);
    const ref = db.collection("textbooks").doc(bid);
    await db.runTransaction(async (tx) => {
      const old = (await tx.get(ref)).data();
      tx.set(ref, {
        ...b,
        id: bid,
        origin: "catalog",
        revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? new Date().toISOString(),
        published: v.published === true,
      });
    });
    await audit(uid, "save-textbook", bid);
    return;
  }
  if (v.action === "question") {
    const sid = v.studentId ? id(v.studentId) : "",
      q = parseQuestion(v.question);
    if (sid && !["owner", "admin"].includes(role))
      throw new AccountError(403, "개인 교재 검수 권한이 없습니다.");
    const ref = sid
      ? db.collection("students").doc(sid).collection("questions").doc(q.id)
      : db.collection("questionBank").doc(q.id);
    if (role === "reviewer" && q.status === "pending")
      throw new AccountError(403, "검수 결과를 선택해 주세요.");
    const previous = (await ref.get()).data();
    if (!previous && role === "reviewer")
      throw new AccountError(403, "검수자는 기존 문항만 검토할 수 있어요.");
    const book = sid
      ? (
          await db
            .collection("students")
            .doc(sid)
            .collection("books")
            .doc(q.bookId)
            .get()
        ).data()
      : await catalogTextbook(q.bookId);
    if (
      !book ||
      schoolLevelOf(book) !== schoolLevelOf(q) ||
      book.grade !== q.grade ||
      book.subject !== q.subject ||
      !book.units.some(
        (u: { id: string; concepts: string[] }) =>
          u.id === q.unitId && u.concepts.includes(q.concept),
      )
    )
      throw new AccountError(400, "문항의 교재·단원·개념이 일치하지 않습니다.");
    await ref.set({
      ...q,
      revision: book.revision,
      reviewedBy: uid,
      reviewedAt: new Date().toISOString(),
    });
    await audit(uid, "review-question", `${sid || "shared"}/${q.id}`, {
      status: q.status,
    });
    return;
  }
  if (v.action === "dispute") {
    if (!["owner", "admin"].includes(role))
      throw new AccountError(403, "개인 학습 신고 처리 권한이 없습니다.");
    const did = id(v.id),
      ref = db.collection("disputes").doc(did);
    await ref.update({
      status: "resolved",
      resolution: text(v.resolution, 1000, "검토 결과"),
      resolvedBy: uid,
      resolvedAt: new Date().toISOString(),
    });
    await audit(uid, "resolve-dispute", did);
    return;
  }
  if (v.action === "config") {
    if (!["owner", "admin"].includes(role))
      throw new AccountError(403, "운영 설정 권한이 없습니다.");
    const c = object(v.config),
      next = {
        dailyPerSubject: integer(c.dailyPerSubject, 1, 10, "과목별 문항"),
        maxDaily: integer(c.maxDaily, 10, 100, "하루 문항"),
        minRewardSeconds: integer(c.minRewardSeconds, 3, 60, "최소 풀이 시간"),
        minimumNewPerConcept: integer(
          c.minimumNewPerConcept,
          1,
          20,
          "개념별 최소 문항",
        ),
        subscriptionWon: integer(c.subscriptionWon, 100, 100000, "월 구독료"),
        aiDailyCalls: integer(c.aiDailyCalls, 1, 200, "AI 일일 호출"),
      };
    await db.runTransaction(async (tx) => {
      const ref = db.doc("settings/learning"),
        old = (await tx.get(ref)).data();
      tx.set(ref, { ...next, version: (old?.version ?? 0) + 1 });
      tx.set(db.collection("configVersions").doc(), {
        previous: old ?? DEFAULT_CONFIG,
        next,
        uid,
        at: new Date().toISOString(),
      });
    });
    await audit(uid, "change-config", "learning");
    return;
  }
  if (v.action === "role") {
    if (role !== "owner")
      throw new AccountError(403, "소유자만 역할을 변경할 수 있습니다.");
    const target = id(v.uid),
      next = text(v.role, 20, "역할");
    if (![...ADMIN_ROLES, "none"].includes(next) || target === uid)
      throw new AccountError(400, "역할 또는 대상 계정을 확인해 주세요.");
    const user = await adminAuth().getUser(target),
      claims = { ...user.customClaims };
    if (next === "none") delete claims.nohakwonRole;
    else claims.nohakwonRole = next;
    await adminAuth().setCustomUserClaims(target, claims);
    await audit(uid, "change-role", target, { role: next });
    return;
  }
  throw new AccountError(400, "관리 작업을 확인해 주세요.");
}
