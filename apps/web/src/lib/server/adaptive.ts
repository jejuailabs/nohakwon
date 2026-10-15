import "server-only";
import { createHash } from "node:crypto";
import type {
  CollectionReference,
  DocumentReference,
} from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import {
  questionContent,
  type AdaptiveSnapshot,
  type SkillProgress,
  type UnitPlan,
} from "@/lib/adaptive-learning";
import {
  id,
  type BankQuestion,
  type Result,
  type HistoryEntry,
  type LearnMode,
} from "@/lib/learning";

export const identityHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const fingerprint = (q: Pick<BankQuestion, "prompt" | "choices">) =>
  identityHash(questionContent(q));
export function assignmentIdentity(
  date: string,
  mode: LearnMode,
  bookId: string,
  requestId: string,
) {
  const scope =
    bookId.length > 100 ? identityHash(bookId).slice(0, 32) : bookId || "all";
  return `${date}-${mode}-${scope}${["practice", "reinforce", "extra"].includes(mode) ? `-${identityHash(requestId).slice(0, 32)}` : ""}`;
}
export function answerIdentity(assignmentId: string, questionId: string) {
  const raw = `${assignmentId}_${questionId}`;
  return raw.length <= 240 ? raw : `answer-${identityHash(raw)}`;
}
export async function allDocuments<T>(
  collection: CollectionReference,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor = "";
  for (;;) {
    let query = collection.orderBy("__name__").limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    rows.push(...page.docs.map((d) => d.data() as T));
    if (page.size < pageSize) return rows;
    cursor = page.docs.at(-1)!.id;
  }
}
export async function loadAdaptive(
  ref: DocumentReference,
): Promise<AdaptiveSnapshot> {
  const [plans, skills] = await Promise.all([
    allDocuments<UnitPlan>(ref.collection("unitPlans")),
    allDocuments<SkillProgress>(ref.collection("skillProgress")),
  ]);
  return { plans, skills };
}
export async function loadBank(
  ref: DocumentReference,
): Promise<BankQuestion[]> {
  return allDocuments<BankQuestion>(ref.collection("questions"));
}
export async function exposureSet(
  ref: DocumentReference,
  questions: BankQuestion[],
) {
  const keys = [...new Set(questions.map(fingerprint))];
  const exposed = new Set<string>();
  for (let i = 0; i < keys.length; i += 250) {
    const part = keys.slice(i, i + 250);
    if (!part.length) continue;
    const docs = await adminDb().getAll(
      ...part.map((key) => ref.collection("questionExposures").doc(key)),
    );
    docs.forEach((d) => {
      if (d.exists) exposed.add(d.id);
    });
  }
  return exposed;
}

/** Resumable, idempotent backfill. Neither the old attempts nor assignments are edited. */
export async function ensureExposureIndex(ref: DocumentReference) {
  const marker = ref.collection("indexes").doc("learning-history-v1");
  let state = (await marker.get()).data() ?? {
    phase: "assignments",
    cursor: "",
  };
  if (state.complete) return;
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    let query = ref.collection(state.phase).orderBy("__name__").limit(50);
    if (state.cursor) query = query.startAfter(state.cursor);
    const page = await query.get();
    const contents = new Map<
      string,
      { fingerprint: string; historical: boolean }
    >();
    const events = new Map<string, HistoryEntry>();
    for (const doc of page.docs) {
      const data = doc.data();
      const questions =
        state.phase === "assignments" ? (data.questions ?? []) : [data];
      for (const q of questions) {
        if (typeof q.prompt !== "string" || !Array.isArray(q.choices)) continue;
        const key = fingerprint(q);
        contents.set(key, { fingerprint: key, historical: true });
      }
      if (state.phase === "attempts") {
        events.set(doc.id, { ...data, phase: "complete" } as HistoryEntry);
      } else {
        for (const [qid, answer] of Object.entries(data.answers ?? {})) {
          const q = questions.find((q: BankQuestion) => q.id === qid);
          if (!q) continue;
          const result = data.results?.[qid];
          const eventId = answerIdentity(doc.id, qid);
          const feedback = answer as Record<string, unknown>;
          events.set(
            eventId,
            result
              ? { ...result, phase: "complete" }
              : ({
                  id: eventId,
                  assignmentId: doc.id,
                  questionId: qid,
                  bookId: q.bookId,
                  unitId: q.unitId,
                  concept: q.concept,
                  subject: q.subject,
                  date: data.date,
                  at: feedback.at,
                  answer: feedback.answer,
                  correctAnswer: feedback.correctAnswer,
                  correct: feedback.correct,
                  seconds: feedback.seconds,
                  mode: data.mode,
                  prompt: q.prompt,
                  choices: q.choices,
                  explanation: feedback.explanation,
                  reason: "",
                  bookmarked: false,
                  fingerprint: fingerprint(q),
                  skillType: q.skillType ?? "기본 확인",
                  phase: "awaiting-understanding",
                } as HistoryEntry),
          );
        }
      }
    }
    const writes = [...contents];
    for (let i = 0; i < writes.length; i += 400) {
      const batch = adminDb().batch();
      for (const [key, value] of writes.slice(i, i + 400))
        batch.set(ref.collection("questionExposures").doc(key), value, {
          merge: true,
        });
      await batch.commit();
    }
    const history = [...events];
    for (let i = 0; i < history.length; i += 200) {
      const part = history.slice(i, i + 200);
      await adminDb().runTransaction(async (tx) => {
        const docs = await tx.getAll(
          ...part.map(([key]) => ref.collection("answerEvents").doc(key)),
        );
        docs.forEach((doc, index) => {
          if (!doc.exists) tx.set(doc.ref, part[index][1]);
        });
      });
    }
    state =
      page.size === 50
        ? { phase: state.phase, cursor: page.docs.at(-1)!.id }
        : state.phase === "assignments"
          ? { phase: "attempts", cursor: "" }
          : { phase: "attempts", cursor: "", complete: true };
    await marker.set(state);
    if (state.complete) return;
  }
  throw new AccountError(
    409,
    "기존 풀이 이력을 정리하고 있어요. 잠시 후 다시 시도해 주세요. 이전 문제는 새 문제로 배정하지 않습니다.",
  );
}

export async function historyPage(
  ref: DocumentReference,
  params: URLSearchParams,
) {
  const date = params.get("date") ?? "",
    mode = params.get("mode") ?? "",
    bookId = params.get("bookId") ?? "";
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    throw new AccountError(400, "조회 날짜를 확인해 주세요.");
  let cursor = params.get("cursor") ?? "";
  const attempts: HistoryEntry[] = [];
  let hasMore = false;
  // Bounded filtering, with a cursor on the last inspected document (no skipped matches).
  for (let scan = 0; scan < 6 && attempts.length < 30; scan++) {
    let query = ref.collection("answerEvents").orderBy("at", "desc").limit(50);
    if (date) {
      const start = new Date(`${date}T00:00:00+09:00`);
      query = query
        .where("at", ">=", start.toISOString())
        .where("at", "<", new Date(start.getTime() + 86400000).toISOString());
    }
    if (cursor) {
      const old = await ref.collection("answerEvents").doc(id(cursor)).get();
      if (!old.exists)
        throw new AccountError(
          400,
          "조회 위치를 찾지 못했어요. 처음부터 다시 조회해 주세요.",
        );
      query = query.startAfter(old);
    }
    const page = await query.get();
    hasMore = page.size === 50;
    for (const [i, doc] of page.docs.entries()) {
      cursor = doc.id;
      const value = doc.data() as HistoryEntry;
      if (
        (!mode || value.mode === mode) &&
        (!bookId || value.bookId === bookId)
      )
        attempts.push(value);
      if (attempts.length === 30) {
        hasMore = i < page.size - 1 || page.size === 50;
        break;
      }
    }
    if (page.size < 50 || attempts.length >= 30) break;
  }
  return { attempts, nextCursor: hasMore ? cursor : "" };
}
