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
} from "@/lib/learning";
import { starterQuestions } from "@/lib/catalog";
import { catalogTextbook } from "./textbook-catalog";
import { catalogSelection } from "@/lib/textbook-catalog";
import { aiConfigured, generateQuestions } from "./ai";
import { adminRole } from "./admin-service";
import { duplicateQuestion } from "@/lib/matching";
import { schoolLevelOf } from "@/lib/education";

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
  const [booksSnap, stateSnap, resultsSnap, jobsSnap, config] =
    await Promise.all([
      ref.collection("books").get(),
      ref.collection("state").doc("learning").get(),
      ref.collection("attempts").orderBy("at", "desc").limit(1500).get(),
      ref.collection("jobs").orderBy("createdAt", "desc").limit(30).get(),
      learningConfig(),
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
    const changed =
      !prior ||
      JSON.stringify(prior.units) !== JSON.stringify(parsed.units) ||
      prior.subject !== parsed.subject ||
      schoolLevelOf(prior) !== schoolLevelOf(parsed) ||
      prior.grade !== parsed.grade;
    const b: Book = {
      ...parsed,
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
  if (catalogId) {
    const shared = (
      await adminDb()
        .collection("questionBank")
        .where("bookId", "==", book.id)
        .limit(200)
        .get()
    ).docs
      .map((d) => d.data() as BankQuestion)
      .filter((q) => q.status === "approved");
    const questions = [...starterQuestions(book), ...shared];
    if (questions.length) {
      const batch = adminDb().batch();
      questions.forEach((q) =>
        batch.set(ref.collection("questions").doc(q.id), q),
      );
      await batch.commit();
    }
  }
  return book;
}
export async function queueJob(uid: string, bookId: string, unitId: string) {
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
  if (!unit.source)
    throw new AccountError(422, "이 단원의 학습 본문을 먼저 등록해 주세요.");
  const lockId = createHash("sha256")
      .update(`${bookId}:${unitId}:${book.revision}`)
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
      revision: book.revision,
      attempts: 0,
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
      unit = book?.units.find((u) => u.id === job.unitId);
    if (!book || !unit || book.revision !== job.revision)
      throw new AccountError(
        409,
        "교재가 수정됐어요. 새 내용으로 다시 출제해 주세요.",
      );
    const output = await generateQuestions(uid, book, unit);
    const oldQuestions = (
      await ref
        .collection("questions")
        .where("bookId", "==", book.id)
        .limit(1000)
        .get()
    ).docs.map((d) => d.data() as BankQuestion);
    const accepted: BankQuestion[] = [];
    for (const q of output.questions) {
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
      if (currentBook.data()?.revision !== book.revision)
        throw new AccountError(
          409,
          "출제 중 교재가 수정됐어요. 새 내용으로 다시 출제해 주세요.",
        );
      output.questions.forEach((q) =>
        batch.set(ref.collection("questions").doc(q.id), {
          ...q,
          revision: book.revision,
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

export async function replenishQuestions(uid: string, bookId?: string) {
  if (!aiConfigured()) return [];
  const { ref, data } = await studentFor(uid);
  if (entitlement(data).status === "expired") return [];
  const [b, s, q, j, config] = await Promise.all([
    ref.collection("books").get(),
    ref.collection("state").doc("learning").get(),
    ref.collection("questions").limit(2500).get(),
    ref.collection("jobs").orderBy("createdAt", "desc").limit(100).get(),
    learningConfig(),
  ]);
  const state = loadLearningState(s.data()),
    jobs = [];
  for (const book of b.docs
    .map((d) => d.data() as Book)
    .filter((b) => b.active && (!bookId || b.id === bookId))
    .slice(0, 5)) {
    const unit = learningUnit(book, state, config.minimumNewPerConcept);
    if (!unit?.source) continue;
    const last = j.docs
      .map((d) => d.data())
      .find((j) => j.bookId === book.id && j.unitId === unit.id);
    if (last && Date.now() - Date.parse(last.createdAt) < 30 * 60000) continue;
    const available = q.docs.filter((d) => {
      const v = d.data();
      return (
        v.bookId === book.id &&
        v.unitId === unit.id &&
        v.status === "approved" &&
        (!v.revision || v.revision === book.revision)
      );
    }).length;
    const consumed = Object.values(state.concepts)
      .filter((c) => c.bookId === book.id && c.unitId === unit.id)
      .reduce((n, c) => n + c.newCount, 0);
    if (available - consumed < state.dailyTarget)
      jobs.push(await queueJob(uid, book.id, unit.id));
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
  createdAt: string;
};
function assignmentView(a: Assignment) {
  return {
    id: a.id,
    date: a.date,
    mode: a.mode,
    questions: a.questions.map(publicQuestion),
    results: a.results,
    answers: a.answers ?? {},
  };
}
export async function createAssignment(uid: string, raw: unknown) {
  const input = object(raw),
    mode = (input.mode ?? "daily") as LearnMode;
  if (!["daily", "review", "assessment", "practice", "exam"].includes(mode))
    throw new AccountError(400, "학습 유형을 확인해 주세요.");
  const selectedBook = input.bookId ? id(input.bookId) : "",
    selectedQuestion = input.questionId ? id(input.questionId) : "";
  const { ref, data } = await studentFor(uid),
    access = entitlement(data),
    config = await learningConfig(),
    db = adminDb(),
    date = seoulDate();
  if (access.status === "expired" && mode !== "practice")
    throw new AccountError(
      402,
      "무료 체험이 끝났어요. 기존 오답은 계속 열어볼 수 있으며, 새 학습은 구독 후 시작할 수 있어요.",
    );
  const aid = `${date}-${mode}-${selectedBook || "all"}${mode === "practice" ? `-${randomUUID()}` : ""}`;
  const aRef = ref.collection("assignments").doc(aid);
  const old = (await aRef.get()).data() as Assignment | undefined;
  if (old) return assignmentView(old);
  const [booksSnap, bankSnap, stateSnap, recentSnap] = await Promise.all([
    ref.collection("books").get(),
    ref.collection("questions").limit(2500).get(),
    ref.collection("state").doc("learning").get(),
    ref.collection("attempts").orderBy("at", "desc").limit(4000).get(),
  ]);
  const books = booksSnap.docs
      .map((d) => d.data() as Book)
      .filter((b) => b.active && (!selectedBook || b.id === selectedBook)),
    state = loadLearningState(stateSnap.data()),
    recent = recentSnap.docs.map((d) => d.data() as Result);
  if (!books.length)
    throw new AccountError(409, "교재를 등록하고 학습 범위를 선택해 주세요.");
  const seen = new Set(
      recent
        .filter((r) => r.date >= addDays(date, -30))
        .map((r) => r.questionId),
    ),
    allBank = bankSnap.docs.map(
      (d) => d.data() as BankQuestion & { revision?: number },
    );
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
  const bank = allBank.filter(
    (q) =>
      q.status === "approved" &&
      (mode !== "exam" || inRange(q)) &&
      books.some(
        (b) => b.id === q.bookId && (!q.revision || q.revision === b.revision),
      ),
  );
  let candidates: BankQuestion[] = [];
  if (mode === "practice") {
    const previous = recent.find((r) => r.questionId === selectedQuestion);
    if (!previous)
      throw new AccountError(403, "풀었던 문제만 다시 풀 수 있어요.");
    candidates = bank.filter((q) => q.id === selectedQuestion);
  } else if (mode === "review" || mode === "assessment" || mode === "exam") {
    const concepts = Object.values(state.concepts)
      .filter(
        (c) =>
          books.some((b) => b.id === c.bookId) &&
          (mode !== "review" || c.dueDate <= date),
      )
      .sort((a, b) => {
        const score = (c: typeof a) => {
          const overdue = Math.min(
              1,
              Math.max(
                0,
                (Date.parse(date) - Date.parse(c.dueDate)) / 86400000 / 7,
              ),
            ),
            daysUntil =
              (Date.parse(state.examDate) - Date.parse(date)) / 86400000,
            exam =
              inRange(c) && daysUntil >= 0 && daysUntil <= 14
                ? 1 - daysUntil / 14
                : 0;
          return 0.5 * c.weakness + 0.3 * overdue + 0.2 * exam;
        };
        return score(b) - score(a) || a.dueDate.localeCompare(b.dueDate);
      });
    for (const c of concepts) {
      const options = bank
        .filter((q) => conceptKey(q) === c.key)
        .sort(
          (a, b) =>
            Number(a.id === c.questionId) - Number(b.id === c.questionId),
        );
      const q =
        options.find((q) => !seen.has(q.id)) ??
        options.find((q) => q.id === c.questionId);
      if (q) candidates.push(q);
    }
    if (mode !== "review")
      for (const s of Object.keys(SUBJECT_NAMES_LOCAL)) {
        const extras = bank.filter(
          (q) =>
            q.subject === s &&
            state.concepts[conceptKey(q)] &&
            !candidates.some((c) => c.id === q.id),
        );
        candidates.push(
          ...extras.slice(
            0,
            Math.max(0, 5 - candidates.filter((c) => c.subject === s).length),
          ),
        );
      }
  } else {
    for (const book of books) {
      const unit = learningUnit(book, state, config.minimumNewPerConcept);
      if (!unit) continue;
      const options = bank.filter(
        (q) => q.bookId === book.id && q.unitId === unit.id && !seen.has(q.id),
      );
      options.sort((a, b) => {
        const pa = state.concepts[conceptKey(a)],
          pb = state.concepts[conceptKey(b)];
        return (
          Math.abs(
            a.difficulty -
              (state.autoDifficulty
                ? (pa?.difficulty ?? state.baseDifficulty)
                : state.baseDifficulty),
          ) -
            Math.abs(
              b.difficulty -
                (state.autoDifficulty
                  ? (pb?.difficulty ?? state.baseDifficulty)
                  : state.baseDifficulty),
            ) ||
          (pa?.newCount ?? 0) - (pb?.newCount ?? 0) ||
          a.id.localeCompare(b.id)
        );
      });
      candidates.push(
        ...options.slice(
          0,
          Math.min(state.dailyTarget, config.dailyPerSubject),
        ),
      );
    }
  }
  const used = new Set<string>(),
    subjects = new Map<string, number>();
  candidates = candidates
    .filter((q) => {
      if (
        used.has(q.variant) ||
        ((subjects.get(q.subject) ?? 0) >=
          (mode === "assessment" || mode === "exam"
            ? 5
            : config.dailyPerSubject) &&
          mode !== "review")
      )
        return false;
      used.add(q.variant);
      subjects.set(q.subject, (subjects.get(q.subject) ?? 0) + 1);
      return true;
    })
    .slice(0, mode === "practice" ? 1 : config.maxDaily);
  if (!candidates.length)
    throw new AccountError(
      409,
      mode === "review"
        ? "오늘 예정된 복습이 없어요."
        : mode === "assessment" || mode === "exam"
          ? "먼저 학습 기록을 쌓아 주세요."
          : "현재 단원에 새 문제가 부족해요. 교재 관리에서 본문을 등록하고 AI 출제를 실행해 주세요.",
    );
  // Reservation is transactional across tabs and all daily session modes.
  const assignment = await db.runTransaction(async (tx) => {
    const [existing, daySnap] = await Promise.all([
      tx.get(aRef),
      tx.get(ref.collection("days").doc(date)),
    ]);
    if (existing.exists) return existing.data() as Assignment;
    const day = daySnap.data() ?? {
      reserved: 0,
      count: 0,
      points: 0,
      questionIds: [],
    };
    const { selected: unique, dailySubjects } = reserveQuestions(
      candidates,
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
        "오늘의 학습 한도에 도달했거나 이미 다른 학습에 배정된 문제예요. 진행 중인 학습을 이어가 주세요.",
      );
    const a: Assignment = {
      id: aid,
      date,
      mode,
      questions: unique,
      results: {},
      opened: {},
      createdAt: new Date().toISOString(),
    };
    tx.set(aRef, a);
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
    if (!a || !a.questions.some((q) => q.id === questionId))
      throw new AccountError(404, "문제가 없어요.");
    if (a.date !== seoulDate())
      throw new AccountError(
        409,
        "날짜가 바뀌었어요. 오늘 학습을 다시 열어 주세요.",
      );
    const opened = {
      ...a.opened,
      [questionId]: a.opened[questionId] ?? new Date().toISOString(),
    };
    tx.update(aRef, { opened });
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
    const { answer, seconds } = feedback,
      state = loadLearningState(sSnap.data()),
      previous = state.concepts[conceptKey(q)],
      out = gradeAnswer(
        q,
        previous,
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
    const rid = `${aid}_${qid}`;
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
      interval: out.interval,
      dueDate: out.progress.dueDate,
      mode: a.mode,
      prompt: q.prompt,
      choices: q.choices,
      explanation: q.explanation,
      reason: "",
      bookmarked: false,
    };
    if (a.mode !== "practice") state.concepts[conceptKey(q)] = out.progress;
    state.points += points;
    state.updatedAt = now.toISOString();
    tx.set(sRef, state);
    tx.update(aRef, { results: { ...a.results, [qid]: result } });
    tx.set(ref.collection("attempts").doc(rid), result);
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
  await rRef.update(patch);
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
