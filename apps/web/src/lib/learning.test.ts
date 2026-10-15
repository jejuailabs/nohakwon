import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBook,
  parseQuestion,
  publicQuestion,
  checkAnswer,
  gradeAnswer,
  reviewInterval,
  makeReport,
  conceptKey,
  learningUnit,
  reserveQuestions,
  DEFAULT_CONFIG,
  DEFAULT_STATE,
  loadLearningState,
  type Book,
  type BankQuestion,
} from "./learning";
import { duplicateQuestion, suggestedBooks } from "./matching";
import { CATALOG, starterQuestions } from "./catalog";
import messages from "./messages.generated.json";
test("new learners never share mutable concept or cosmetic defaults", () => {
  const first = loadLearningState(),
    second = loadLearningState();
  first.cosmetics.push("starlight");
  first.concepts.example = {} as never;
  assert.deepEqual(second.cosmetics, []);
  assert.deepEqual(second.concepts, {});
  assert.deepEqual(DEFAULT_STATE.concepts, {});
  assert.deepEqual(DEFAULT_STATE.cosmetics, []);
});
import { nextBillingMonth, verifyPayment } from "./billing";
const q: BankQuestion = {
  id: "q1",
  bookId: "b1",
  unitId: "u1",
  concept: "일차방정식",
  subject: "math",
  grade: 1,
  prompt: "x + 2 = 5 의 해는?",
  choices: ["1", "2", "3", "4"],
  answer: 2,
  explanation: "양변에서 2를 빼면 x = 3",
  evidence: "등식의 양변에서 같은 수를 빼도 등식은 성립한다.",
  difficulty: 2,
  variant: "v1",
  expectedSeconds: 30,
  status: "approved",
  origin: "editor",
};
test("assigned question payload never exposes answer, explanation or evidence", () => {
  assert.equal("answer" in publicQuestion(q), false);
  assert.equal("explanation" in publicQuestion(q), false);
  assert.equal("evidence" in publicQuestion(q), false);
  assert.equal(publicQuestion(q).choices.length, 4);
});
test("answer checking is independent of understanding and validates the answer type", () => {
  assert.equal(checkAnswer(q, 2), true);
  assert.equal(checkAnswer(q, 0), false);
  assert.throws(() => checkAnswer(q, "2"));
  assert.throws(() => checkAnswer(q, 4));
  const short = {
    ...q,
    kind: "short" as const,
    answer: "x = 3",
    acceptable: ["3"],
  };
  assert.equal(checkAnswer(short, " X=3 "), true);
  assert.equal(checkAnswer(short, "3"), true);
  assert.equal(checkAnswer(short, "4"), false);
  assert.throws(() => checkAnswer(short, ""));
});
test("book range and duplicate units cannot be forged", () => {
  const b = {
    title: "교재",
    publisher: "자체",
    grade: 1,
    subject: "math",
    units: [
      { id: "u1", title: "1단원", concepts: ["개념"], source: "" },
      { id: "u2", title: "2단원", concepts: ["개념"], source: "" },
    ],
    currentUnit: "u2",
    endUnit: "u1",
  };
  assert.throws(() => parseBook(b));
  assert.throws(() => parseBook({ ...b, units: [b.units[0], b.units[0]] }));
  assert.throws(() => parseBook({ ...b, currentUnit: "../users" }));
});
test("duplicate options and invalid answer indices are rejected", () => {
  assert.throws(() => parseQuestion({ ...q, choices: ["1", "1", "2", "3"] }));
  assert.throws(() => parseQuestion({ ...q, answer: 4 }));
  assert.equal(parseQuestion(q).answer, 2);
});
test("trial review intervals differ from paid review schedule", () => {
  assert.equal(reviewInterval("unknown", false, undefined, true, 30, 30, 0), 1);
  assert.equal(reviewInterval("known", true, undefined, true, 30, 30, 0), 4);
  assert.equal(reviewInterval("known", true, undefined, false, 30, 30, 0), 21);
  assert.equal(reviewInterval("known", false, undefined, false, 30, 30, 0), 3);
});
test("confidence is rewarded once per concept per day and practice cannot earn", () => {
  const now = new Date("2026-10-14T03:00:00Z");
  const first = gradeAnswer(q, undefined, 0, "unknown", 5, "daily", true, now);
  assert.equal(first.points, 3);
  const next = gradeAnswer(
    { ...q, id: "q2" },
    first.progress,
    2,
    "known",
    5,
    "daily",
    true,
    now,
  );
  assert.equal(next.points, 0);
  assert.equal(
    gradeAnswer(q, undefined, 2, "known", 2, "daily", true, now).points,
    0,
  );
  assert.equal(
    gradeAnswer(q, undefined, 2, "known", 20, "practice", true, now).points,
    0,
  );
  assert.equal(conceptKey(q), conceptKey({ ...q, id: "q2" } as BankQuestion));
});
test("difficulty follows answer accuracy and time, not reported confidence", () => {
  const now = new Date("2026-10-14T03:00:00Z");
  let p = gradeAnswer(
    q,
    undefined,
    2,
    "unknown",
    20,
    "daily",
    false,
    now,
  ).progress;
  p = {
    ...p,
    difficultyChanged: "2026-10-01",
    history: Array(4).fill({
      correct: true,
      confidence: "unknown",
      seconds: 20,
    }),
  };
  assert.equal(
    gradeAnswer(q, p, 2, "unknown", 20, "daily", false, now).progress
      .difficulty,
    3,
  );
  p.history = Array(4).fill({
    correct: false,
    confidence: "known",
    seconds: 20,
  });
  assert.equal(
    gradeAnswer(q, p, 0, "known", 20, "daily", false, now).progress.difficulty,
    1,
  );
});
test("small report sample is explicitly inconclusive", () => {
  assert.equal(makeReport([], {}).reliable, false);
  assert.equal(makeReport([], {}).accuracy, 0);
});
test("monthly billing clamps month end and validates amount/currency/order", () => {
  assert.equal(
    nextBillingMonth("2026-01-31T10:00:00.000Z"),
    "2026-02-28T10:00:00.000Z",
  );
  const p = {
    orderId: "order1",
    paymentKey: "test_key",
    totalAmount: 5000,
    currency: "KRW",
    status: "DONE",
  };
  assert.equal(verifyPayment(p, { id: "order1", amount: 5000 }), "DONE");
  assert.throws(() =>
    verifyPayment({ ...p, totalAmount: 1 }, { id: "order1", amount: 5000 }),
  );
  assert.throws(() =>
    verifyPayment({ ...p, currency: "USD" }, { id: "order1", amount: 5000 }),
  );
  assert.throws(() =>
    verifyPayment({ ...p, orderId: "other" }, { id: "order1", amount: 5000 }),
  );
});

test("short answers normalize spelling but do not accept partial matches", () => {
  const short = parseQuestion({
    ...q,
    kind: "short",
    answer: "x = −４",
    acceptable: ["-4"],
    choices: [],
  });
  const now = new Date();
  assert.ok(
    gradeAnswer(short, undefined, "X=-4", "known", 20, "daily", true, now)
      .correct,
  );
  assert.ok(
    gradeAnswer(short, undefined, " -4 ", "known", 20, "daily", true, now)
      .correct,
  );
  assert.equal(
    gradeAnswer(short, undefined, "4", "known", 20, "daily", true, now).correct,
    false,
  );
  assert.equal("acceptable" in publicQuestion(short), false);
  assert.throws(() =>
    gradeAnswer(short, undefined, 1, "known", 20, "daily", true, now),
  );
});
test("daily subject and global limits survive changing books and modes", () => {
  const bank = Array.from({ length: 10 }, (_, i) => ({
    ...q,
    id: `q${i}`,
    variant: `v${i}`,
  }));
  assert.equal(
    reserveQuestions(
      bank,
      "daily",
      { reserved: 9, questionIds: [], dailySubjects: { math: 9 } },
      DEFAULT_CONFIG,
      10,
    ).selected.length,
    1,
  );
  assert.equal(
    reserveQuestions(
      bank,
      "review",
      { reserved: 99, questionIds: [] },
      DEFAULT_CONFIG,
      10,
    ).selected.length,
    1,
  );
  assert.equal(
    reserveQuestions(
      bank,
      "practice",
      { reserved: 100, questionIds: bank.map((q) => q.id) },
      DEFAULT_CONFIG,
      10,
    ).selected.length,
    1,
  );
});
test("progression follows selected unit order after required new attempts", () => {
  const book = {
    ...CATALOG[0],
    id: "b1",
    currentUnit: "u1",
    endUnit: "u2",
    units: [
      { id: "u1", title: "First", concepts: ["일차방정식"], source: "" },
      { id: "u2", title: "Second", concepts: ["next"], source: "" },
    ],
  } as Book;
  assert.equal(learningUnit(book, DEFAULT_STATE)?.id, "u1");
  const p = gradeAnswer(
    q,
    undefined,
    2,
    "known",
    20,
    "daily",
    true,
    new Date(),
  ).progress;
  p.newCount = 3;
  assert.equal(
    learningUnit(book, { ...DEFAULT_STATE, concepts: { [p.key]: p } })?.id,
    "u2",
  );
});
test("publisher catalog has verified metadata and never reuses starter questions", () => {
  for (const b of CATALOG.filter((b) => !b.id.startsWith("foundation-"))) {
    assert.ok(
      [
        "textbook.visang.com",
        "22txbook.m-teacher.co.kr",
        "e.m-teacher.co.kr",
      ].includes(new URL(b.sourceUrl!).hostname),
    );
    assert.equal(starterQuestions(b).length, 0);
    assert.ok(b.units.every((u) => u.source === ""));
  }
  const b = CATALOG[0];
  assert.ok(suggestedBooks(b, CATALOG).some((m) => m.book.id === b.id));
});
test("duplicate detection rejects formatting-only variations", () => {
  assert.equal(
    duplicateQuestion(q, { ...q, prompt: "x + 2 = 5  의 해는?" }),
    true,
  );
  assert.equal(
    duplicateQuestion(q, { ...q, prompt: "What is the capital of France?" }),
    false,
  );
});
test("source links cannot run scripts or embed credentials", () => {
  const b = CATALOG[0];
  assert.throws(() => parseBook({ ...b, sourceUrl: "javascript:alert(1)" }));
  assert.throws(() =>
    parseBook({ ...b, sourceUrl: "https://secret@example.com" }),
  );
  assert.equal(
    parseBook({ ...b, sourceUrl: "https://example.com/book" }).sourceUrl,
    "https://example.com/book",
  );
});
test("translations preserve every variable placeholder", () => {
  for (const [key, locales] of Object.entries(messages)) {
    for (const translation of Object.values(locales))
      assert.deepEqual(
        (translation.match(/\{\d+\}/g) ?? []).sort(),
        (key.match(/\{\d+\}/g) ?? []).sort(),
        key,
      );
  }
});
