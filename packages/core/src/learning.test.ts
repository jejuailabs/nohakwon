import test from "node:test";
import assert from "node:assert/strict";
import { addDays, claimDailyReward, dailyAttempts, DEFAULT_PROGRESS, dueReviews, nextReview, parseProgress, seoulDate, studyStreak, submitAnswer, totalPoints } from "./index";
import { QUESTIONS, SUBJECTS } from "../../../apps/web/src/lib/questions";

const now = new Date("2026-10-14T10:00:00Z");
const q = QUESTIONS.find(q => q.id === "math-1")!;
test("sample bank has 10 valid questions per subject and unique IDs", () => {
  assert.equal(new Set(QUESTIONS.map(q => q.id)).size, 50);
  for (const s of SUBJECTS) assert.equal(QUESTIONS.filter(q => q.subject === s.id).length, 10);
  for (const question of QUESTIONS) {
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices).size, 4);
    assert.ok(question.choices[question.answer]);
    if (question.expression) {
      const [, a, b, result] = question.expression.match(/(\d+)x \+ (\d+) = (\d+)/)!;
      assert.equal(Number(a) * Number(question.choices[question.answer]) + Number(b), Number(result));
    }
  }
});
test("daily boundary follows Seoul time across UTC midnight and leap days", () => {
  assert.equal(seoulDate(new Date("2026-10-14T14:59:59Z")), "2026-10-14");
  assert.equal(seoulDate(new Date("2026-10-14T15:00:00Z")), "2026-10-15");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("self-assessment plans review independently of reward points", () => {
  assert.equal(nextReview("known", true), 21);
  assert.equal(nextReview("known", false), 3);
  assert.equal(nextReview("unsure", true), 14);
  assert.equal(nextReview("unknown", false), 7);
  const first = submitAnswer(DEFAULT_PROGRESS, q, 0, "unknown", "daily", 10, now);
  assert.equal(first.attempt.points, 3);
  assert.equal(first.attempt.dueDate, "2026-10-21");
  assert.equal(dueReviews(first.progress, "2026-10-20").length, 0);
  assert.equal(dueReviews(first.progress, "2026-10-21").length, 1);
});
test("repeated submission cannot duplicate progress or rewards", () => {
  const first = submitAnswer(DEFAULT_PROGRESS, q, q.answer, "known", "daily", 10, now);
  const duplicate = submitAnswer(first.progress, q, 0, "unknown", "daily", 10, now);
  assert.equal(duplicate.progress.attempts.length, 1);
  assert.deepEqual(duplicate.attempt, first.attempt);
  assert.equal(totalPoints(duplicate.progress), 1);
});
test("under-three-second answers get no points but retain review planning", () => {
  const { attempt } = submitAnswer(DEFAULT_PROGRESS, q, 0, "unknown", "daily", 1, now);
  assert.equal(attempt.points, 0);
  assert.equal(attempt.interval, 7);
});
test("successful due review replaces old schedule and awards overcome points", () => {
  const first = submitAnswer(DEFAULT_PROGRESS, q, 0, "unknown", "daily", 10, now);
  const reviewed = submitAnswer(first.progress, q, q.answer, "known", "review", 10, new Date("2026-10-21T10:00:00Z"));
  assert.equal(reviewed.attempt.points, 6);
  assert.equal(reviewed.attempt.interval, 14);
  assert.equal(dueReviews(reviewed.progress, "2026-10-21").length, 0);
  assert.equal(dailyAttempts(reviewed.progress, "2026-10-21").length, 0);
});
test("daily completion reward requires all 50 questions and is idempotent", () => {
  let progress = DEFAULT_PROGRESS;
  for (const question of QUESTIONS.slice(0, 49)) progress = submitAnswer(progress, question, question.answer, "known", "daily", 10, now).progress;
  assert.equal(claimDailyReward(progress, "2026-10-14").claimedDays.length, 0);
  const final = QUESTIONS[49];
  progress = submitAnswer(progress, final, final.answer, "known", "daily", 10, now).progress;
  progress = claimDailyReward(progress, "2026-10-14");
  assert.equal(totalPoints(progress), 100);
  assert.equal(claimDailyReward(progress, "2026-10-14").claimedDays.length, 1);
});
test("streak handles empty hydration date and tolerates today not yet started", () => {
  assert.equal(studyStreak(DEFAULT_PROGRESS, ""), 0);
  let progress = submitAnswer(DEFAULT_PROGRESS, q, 0, "known", "daily", 10, now).progress;
  progress = submitAnswer(progress, q, 0, "known", "daily", 10, new Date("2026-10-15T10:00:00Z")).progress;
  assert.equal(studyStreak(progress, "2026-10-15"), 2);
  assert.equal(studyStreak(progress, "2026-10-16"), 2);
  assert.equal(studyStreak(progress, "2026-10-17"), 0);
});
test("persisted progress round-trips and rejects malformed records", () => {
  const first = submitAnswer(DEFAULT_PROGRESS, q, 0, "unsure", "daily", 10, now);
  assert.deepEqual(parseProgress(JSON.stringify(first.progress)), first.progress);
  assert.equal(parseProgress("broken"), null);
  assert.equal(parseProgress(JSON.stringify({ ...DEFAULT_PROGRESS, attempts: [{}] })), null);
  assert.equal(parseProgress(JSON.stringify({ ...DEFAULT_PROGRESS, attempts: [{ ...first.attempt, confidence: "bogus" }] })), null);
});
test("answer selection is validated", () => {
  assert.throws(() => submitAnswer(DEFAULT_PROGRESS, q, -1, "known", "daily", 10, now));
  assert.throws(() => submitAnswer(DEFAULT_PROGRESS, q, 4, "known", "daily", 10, now));
});
test("practice can be retried without earning points or postponing a scheduled review", () => {
  const first = submitAnswer(DEFAULT_PROGRESS, q, 0, "unknown", "daily", 10, now);
  const practice = submitAnswer(first.progress, q, 0, "unknown", "practice", 10, now);
  const retry = submitAnswer(practice.progress, q, q.answer, "known", "practice", 10, now);
  assert.equal(retry.attempt.correct, true);
  assert.equal(retry.attempt.points, 0);
  assert.equal(retry.attempt.dueDate, first.attempt.dueDate);
  assert.equal(retry.progress.attempts.length, 3);
  assert.equal(dueReviews(retry.progress, "2026-10-21").length, 1);
});
