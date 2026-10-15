import test from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTIVE_POLICY,
  advanceSkill,
  unitCoverage,
  nextLearningUnit,
  questionContent,
  generationTargets,
  type AdaptiveSnapshot,
  type SkillEvidence,
  type SkillProgress,
  type UnitPlan,
} from "./adaptive-learning";
import { selectAdaptiveQuestions } from "./assignment-selection";
import {
  DEFAULT_STATE,
  conceptKey,
  type BankQuestion,
  type Book,
} from "./learning";
import { duplicateQuestion } from "./matching";
const book: Book = {
  id: "b",
  title: "수학",
  publisher: "자체",
  grade: 1,
  subject: "math",
  units: [
    { id: "u1", title: "방정식", concepts: ["등식"], source: "자체 내용" },
    { id: "u2", title: "다음 단원", concepts: ["다음"], source: "자체 내용" },
  ],
  currentUnit: "u1",
  endUnit: "u2",
  active: true,
  createdAt: "",
  revision: 1,
  origin: "upload",
};
const plan: UnitPlan = {
  id: "p",
  bookId: "b",
  unitId: "u1",
  revision: 1,
  skills: [
    { concept: "등식", type: "기본 이해" },
    { concept: "등식", type: "적용" },
  ],
  origin: "editor",
  createdAt: "",
};
const question = (n: number, skillType = "기본 이해"): BankQuestion => ({
  id: `q${n}`,
  bookId: "b",
  unitId: "u1",
  concept: "등식",
  skillType,
  subject: "math",
  grade: 1,
  prompt: `x + ${n} = ${n + 2}의 해는?`,
  choices: ["1", "2", "3", "4"],
  answer: 1,
  explanation: "양변에서 같은 수를 뺀다.",
  evidence: "",
  difficulty: 2,
  variant: `v${n}`,
  expectedSeconds: 30,
  status: "approved",
  origin: "editor",
});
const evidence = (
  n: number,
  date = "2026-10-14",
  extra: Partial<SkillEvidence> = {},
): SkillEvidence => ({
  questionId: `q${n}`,
  fingerprint: `f${n}`,
  date,
  at: `${date}T03:00:00Z`,
  correct: true,
  confidence: "known",
  seconds: 20,
  mode: "daily",
  ...extra,
});
function step(
  old: SkillProgress | undefined,
  e: SkillEvidence,
  type = "기본 이해",
) {
  return advanceSkill(
    old,
    { id: type, bookId: "b", unitId: "u1", revision: 1, concept: "등식", type },
    e,
    `attempt-${e.questionId}`,
  );
}
function secure(type = "기본 이해") {
  let p = step(undefined, evidence(1), type);
  p = step(p, evidence(2), type);
  return step(p, evidence(3, "2026-10-15"), type);
}
const select = (
  mode: Parameters<typeof selectAdaptiveQuestions>[0]["mode"],
  extra: Partial<Parameters<typeof selectAdaptiveQuestions>[0]> = {},
) =>
  selectAdaptiveQuestions({
    mode,
    books: [book],
    bank: Array.from({ length: 12 }, (_, n) =>
      question(n + 1, n % 2 ? "적용" : "기본 이해"),
    ),
    state: structuredClone(DEFAULT_STATE),
    adaptive: { plans: [plan], skills: [] },
    exposed: new Set(),
    date: "2026-10-15",
    fingerprint: (q) => q.id,
    limit: 10,
    ...extra,
  });
test("changing question IDs or option order does not make identical content new", () => {
  const renamed = {
    ...question(1),
    id: "new-id",
    prompt: "x + 1 = 3의   해는?",
    choices: ["4", "2", "1", "3"],
  };
  assert.equal(questionContent(question(1)), questionContent(renamed));
  assert.notEqual(questionContent(question(1)), questionContent(question(2)));
});
test("same-day correct answers and post-explanation confidence cannot alone finish a skill", () => {
  let p = step(undefined, evidence(1));
  p = step(p, evidence(2));
  p = step(p, evidence(3));
  assert.equal(p.status, "awaiting-check");
  assert.equal(p.firstSecuredAt, "");
  assert.equal(step(p, evidence(4, "2026-10-15")).status, "secure");
});
test("repeating an old question on a new day is not transfer evidence", () => {
  let p = step(undefined, evidence(1));
  p = step(p, evidence(2));
  p = step(p, evidence(3));
  const repeated = step(p, evidence(1, "2026-10-15", { mode: "review" }));
  assert.equal(repeated.status, "awaiting-check");
  assert.equal(repeated.evidence.length, 3);
  assert.equal(repeated.lastQuestionId, "q1");
  assert.equal(repeated.evidence.at(-1)?.questionId, "q3");
  assert.deepEqual(step(p, evidence(4, "2026-10-15", { mode: "practice" })), p);
});
test("a confident wrong answer and uncertain correct answer both require reinforcement", () => {
  assert.equal(
    step(undefined, evidence(1, undefined, { correct: false })).status,
    "needs-work",
  );
  assert.equal(
    step(undefined, evidence(1, undefined, { confidence: "unsure" })).status,
    "needs-work",
  );
});
test("a repeated failure resets current mastery while preserving the completed curriculum milestone", () => {
  const done = secure();
  let p = step(
    done,
    evidence(3, "2026-10-16", { correct: false, mode: "review" }),
  );
  assert.equal(p.status, "needs-work");
  assert.equal(p.firstSecuredAt, done.firstSecuredAt);
  p = step(p, evidence(4, "2026-10-16", { mode: "reinforce" }));
  assert.notEqual(p.status, "secure");
});
test("a missing expected type blocks progression; coverage is not inferred only from answered questions", () => {
  const adaptive: AdaptiveSnapshot = { plans: [plan], skills: [secure()] };
  assert.equal(unitCoverage(book, book.units[0], adaptive).complete, false);
  assert.equal(nextLearningUnit(book, adaptive)?.id, "u1");
  adaptive.skills.push(secure("적용"));
  assert.equal(nextLearningUnit(book, adaptive)?.id, "u2");
  adaptive.skills[0] = step(
    adaptive.skills[0],
    evidence(1, "2026-10-17", { correct: false }),
  );
  assert.equal(nextLearningUnit(book, adaptive)?.id, "u2");
  assert.equal(
    unitCoverage({ ...book, revision: 2 }, book.units[0], adaptive).complete,
    false,
  );
});
test("lifetime exposure excludes an old item without any 30-day expiry", () => {
  assert.ok(
    select("daily", { exposed: new Set(["q1", "q2", "q3"]) }).every(
      (s) => !["q1", "q2", "q3"].includes(s.question.id),
    ),
  );
});
test("daily selection balances the planned types before taking additional variants", () => {
  const chosen = select("daily");
  assert.equal(chosen[0].question.skillType, "기본 이해");
  assert.equal(chosen[1].question.skillType, "적용");
  assert.ok(chosen.length <= 10);
  assert.ok(chosen.every((s) => s.reason.code === "new-coverage"));
});
test("reinforcement uses unseen variants without waiting for the scheduled review date", () => {
  const weak = {
    key: conceptKey(question(1)),
    bookId: "b",
    unitId: "u1",
    concept: "등식",
    subject: "math" as const,
    questionId: "q1",
    interval: 30,
    dueDate: "2026-11-01",
    history: [{ correct: false, confidence: "unknown" as const, seconds: 20 }],
    newCount: 1,
    reviewStreak: 0,
    difficulty: 2,
    difficultyChanged: "",
    lastRewardDate: "",
    weakness: 1,
    lastAttemptId: "old-attempt",
  };
  const state = {
    ...structuredClone(DEFAULT_STATE),
    concepts: { [weak.key]: weak },
  };
  const chosen = select("reinforce", { state, exposed: new Set(["q1"]) });
  assert.ok(chosen.length);
  assert.ok(
    chosen.every(
      (s) =>
        s.question.id !== "q1" &&
        s.reason.code === "weakness" &&
        s.reason.triggerAttemptId === "old-attempt",
    ),
  );
  assert.equal(select("review", { state }).length, 0);
});
test("scheduled review marks a deliberate repeated question when no fresh variant exists", () => {
  const q = question(1),
    key = conceptKey(q);
  const state = {
    ...structuredClone(DEFAULT_STATE),
    concepts: {
      [key]: {
        key,
        bookId: "b",
        unitId: "u1",
        concept: "등식",
        subject: "math" as const,
        questionId: q.id,
        interval: 1,
        dueDate: "2026-10-15",
        history: [],
        newCount: 1,
        reviewStreak: 0,
        difficulty: 2,
        difficultyChanged: "",
        lastRewardDate: "",
        weakness: 1,
      },
    },
  };
  const chosen = select("review", {
    state,
    bank: [q],
    exposed: new Set([q.id]),
  });
  assert.equal(chosen[0].reason.code, "retention-repeat");
  assert.equal(chosen[0].reason.repeated, true);
});
test("extra unit practice uses fresh questions even after the curriculum milestone was reached", () => {
  const adaptive = { plans: [plan], skills: [secure(), secure("적용")] };
  assert.equal(select("daily", { adaptive, bank: [question(1)] }).length, 0);
  assert.ok(select("extra", { adaptive, unitId: "u1" }).length);
});
test("review follows each type's due date and causal record, including intentional fallback repeats", () => {
  const key = conceptKey(question(1));
  const state = {
    ...structuredClone(DEFAULT_STATE),
    concepts: {
      [key]: {
        key,
        bookId: "b",
        unitId: "u1",
        concept: "등식",
        subject: "math" as const,
        questionId: "q2",
        interval: 1,
        dueDate: "2026-10-15",
        history: [],
        newCount: 2,
        reviewStreak: 0,
        difficulty: 2,
        difficultyChanged: "",
        lastRewardDate: "",
        weakness: 0.5,
        lastAttemptId: "different-type-answer",
      },
    },
  };
  const weak = {
    ...step(undefined, evidence(1, "2026-10-14", { correct: false })),
    dueDate: "2026-10-15",
    lastAttemptId: "weak-type-answer",
  };
  const strong = {
    ...secure("적용"),
    dueDate: "2026-11-01",
  };
  const bank = [question(1), question(2, "적용"), question(3)];
  const adaptive = { plans: [plan], skills: [weak, strong] };
  const fresh = select("review", {
    state,
    bank,
    adaptive,
    exposed: new Set(["q1"]),
  });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].question.id, "q3");
  assert.equal(fresh[0].reason.triggerAttemptId, "weak-type-answer");
  const repeated = select("review", {
    state,
    bank,
    adaptive,
    exposed: new Set(bank.map((q) => q.id)),
  });
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].question.id, "q1");
  assert.equal(repeated[0].reason.code, "retention-repeat");
  assert.equal(
    select("review", { state, bank, adaptive, targetType: "적용" }).length,
    0,
  );
});
test("generation volume follows skill deficits and stops when the unseen pool is sufficient", () => {
  const adaptive = { plans: [plan], skills: [] };
  assert.equal(
    unitCoverage(book, book.units[0], adaptive).initialBankTarget,
    2 * ADAPTIVE_POLICY.initialPerSkill,
  );
  const empty = generationTargets(
    plan,
    [],
    new Set(),
    (q) => q.id,
    [],
    "daily",
  );
  assert.equal(empty.length, 8);
  const bank = Array.from({ length: 12 }, (_, i) =>
    question(i + 1, i % 2 ? "적용" : "기본 이해"),
  );
  assert.equal(
    generationTargets(plan, bank, new Set(), (q) => q.id, [], "daily").length,
    0,
  );
  assert.ok(
    generationTargets(
      plan,
      bank,
      new Set(bank.map((q) => q.id)),
      (q) => q.id,
      [],
      "daily",
    ).length,
  );
});
test("new numeric variants remain usable while reordered identical questions are rejected", () => {
  assert.equal(
    duplicateQuestion(question(1), {
      ...question(1),
      choices: [...question(1).choices].reverse(),
    }),
    true,
  );
  assert.equal(duplicateQuestion(question(1), question(2)), false);
});
test("reinforcement follows the weak type's own causal record rather than a different type's latest answer", () => {
  const weakSkill = step(
    undefined,
    evidence(1, "2026-10-14", { correct: false }),
  );
  weakSkill.lastAttemptId = "weak-type-attempt";
  const key = conceptKey(question(1));
  const state = {
    ...structuredClone(DEFAULT_STATE),
    concepts: {
      [key]: {
        key,
        bookId: "b",
        unitId: "u1",
        concept: "등식",
        subject: "math" as const,
        questionId: "other-question",
        interval: 20,
        dueDate: "2026-11-01",
        history: [{ correct: true, confidence: "known" as const, seconds: 20 }],
        newCount: 1,
        reviewStreak: 0,
        difficulty: 2,
        difficultyChanged: "",
        lastRewardDate: "",
        weakness: 0.5,
        lastAttemptId: "different-type-attempt",
      },
    },
  };
  const chosen = select("reinforce", {
    state,
    adaptive: { plans: [plan], skills: [weakSkill] },
  });
  assert.ok(
    chosen.some(
      (q) =>
        q.question.skillType === "기본 이해" &&
        q.reason.triggerAttemptId === "weak-type-attempt",
    ),
  );
});
test("editing another unit does not invalidate this unit's verified skills", () => {
  const adaptive = { plans: [plan], skills: [secure(), secure("적용")] };
  const newerBook = {
    ...book,
    revision: 2,
    units: [
      { ...book.units[0], revision: 1 },
      { ...book.units[1], revision: 2 },
    ],
  };
  assert.equal(
    unitCoverage(newerBook, newerBook.units[0], adaptive).complete,
    true,
  );
  assert.equal(nextLearningUnit(newerBook, adaptive)?.id, "u2");
});
