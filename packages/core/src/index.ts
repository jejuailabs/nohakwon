export type SubjectId = "korean" | "english" | "math" | "social" | "science";
export type Confidence = "known" | "unsure" | "unknown";
export type StudyMode = "daily" | "review" | "practice";
export type Question = {
  id: string; subject: SubjectId; topic: string; prompt: string;
  expression?: string; choices: string[]; answer: number; explanation: string;
};
export type Attempt = {
  id: string; questionId: string; subject: SubjectId; date: string; at: string;
  answer: number; confidence: Confidence; correct: boolean; mode: StudyMode;
  points: number; interval: number; dueDate: string;
};
export type Progress = {
  version: 1; name: string; attempts: Attempt[]; bookmarks: string[];
  claimedDays: string[]; calm: boolean;
};
export const DEFAULT_PROGRESS: Progress = {
  version: 1, name: "나호", attempts: [], bookmarks: [], claimedDays: [], calm: false,
};
export const LEARNING_CONFIG = {
  dailyPerSubject: 10, completionBonus: 50, minimumRewardSeconds: 3,
  intervals: { known: 21, unsure: 14, unknown: 7, misconception: 3, maximum: 60 },
  rewards: { known: 1, unsure: 2, unknown: 3, overcome: 5 },
};

export function seoulDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function nextReview(confidence: Confidence, correct: boolean, previous?: Attempt): number {
  const c = LEARNING_CONFIG.intervals;
  if (confidence === "known") return correct ? Math.min(c.maximum, previous ? previous.interval * 2 : c.known) : c.misconception;
  if (confidence === "unsure") return previous ? Math.max(3, Math.round(previous.interval / 2)) : c.unsure;
  return previous ? (correct ? c.unsure : c.misconception) : c.unknown;
}
export function latestAttempts(attempts: Attempt[]): Attempt[] {
  const latest = new Map<string, Attempt>();
  for (const attempt of attempts) latest.set(attempt.questionId, attempt);
  return [...latest.values()];
}
export function dueReviews(progress: Progress, date: string): Attempt[] {
  return latestAttempts(progress.attempts).filter(a => a.dueDate <= date).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
export function dailyAttempts(progress: Progress, date: string): Attempt[] {
  return progress.attempts.filter(a => a.date === date && a.mode === "daily");
}
export function totalPoints(progress: Progress): number {
  return progress.attempts.reduce((sum, a) => sum + a.points, 0) + progress.claimedDays.length * LEARNING_CONFIG.completionBonus;
}
export function studyStreak(progress: Progress, date: string): number {
  if (!date) return 0;
  const dates = new Set(progress.attempts.map(a => a.date));
  let cursor = dates.has(date) ? date : addDays(date, -1);
  let streak = 0;
  while (dates.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}
export function submitAnswer(progress: Progress, question: Question, answer: number, confidence: Confidence, mode: StudyMode, elapsedSeconds: number, now = new Date()): { progress: Progress; attempt: Attempt } {
  if (!Number.isInteger(answer) || answer < 0 || answer >= question.choices.length) throw new Error("답안을 선택해 주세요.");
  const date = seoulDate(now);
  // A deliberate practice retry is a new attempt, but never produces points.
  const id = `${date}:${mode}:${question.id}${mode === "practice" ? `:${progress.attempts.length}` : ""}`;
  const existing = progress.attempts.find(a => a.id === id);
  if (existing) return { progress, attempt: existing };
  const previous = latestAttempts(progress.attempts.filter(a => a.mode !== "practice")).find(a => a.questionId === question.id);
  const correct = answer === question.answer;
  const interval = mode === "practice" && previous ? previous.interval : nextReview(confidence, correct, previous);
  const rewardedToday = progress.attempts.some(a => a.questionId === question.id && a.date === date && a.points > 0);
  let points = 0;
  if (mode !== "practice" && !rewardedToday && elapsedSeconds >= LEARNING_CONFIG.minimumRewardSeconds) {
    points = confidence === "known" ? (correct ? LEARNING_CONFIG.rewards.known : 0) : LEARNING_CONFIG.rewards[confidence];
    if (mode === "review" && correct && previous && previous.confidence !== "known") points += LEARNING_CONFIG.rewards.overcome;
  }
  const dueDate = mode === "practice" && previous ? previous.dueDate : addDays(date, interval);
  const attempt: Attempt = { id, questionId: question.id, subject: question.subject, date, at: now.toISOString(), answer, confidence, correct, mode, points, interval, dueDate };
  return { progress: { ...progress, attempts: [...progress.attempts, attempt] }, attempt };
}
export function claimDailyReward(progress: Progress, date: string): Progress {
  const done = new Set(dailyAttempts(progress, date).map(a => a.questionId)).size;
  if (done < LEARNING_CONFIG.dailyPerSubject * 5 || progress.claimedDays.includes(date)) return progress;
  return { ...progress, claimedDays: [...progress.claimedDays, date] };
}

const subjects: SubjectId[] = ["korean", "english", "math", "social", "science"];
const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export function parseProgress(raw: string | null): Progress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p.version !== 1 || typeof p.name !== "string" || p.name.length > 20 || typeof p.calm !== "boolean") return null;
    if (!Array.isArray(p.attempts) || !Array.isArray(p.bookmarks) || !Array.isArray(p.claimedDays)) return null;
    if (!p.bookmarks.every((x: unknown) => typeof x === "string") || !p.claimedDays.every(validDate)) return null;
    if (!p.attempts.every((a: Attempt) => a && typeof a.id === "string" && typeof a.questionId === "string" && subjects.includes(a.subject) && validDate(a.date) && validDate(a.dueDate) && typeof a.at === "string" && Number.isFinite(Date.parse(a.at)) && ["known", "unsure", "unknown"].includes(a.confidence) && ["daily", "review", "practice"].includes(a.mode) && typeof a.correct === "boolean" && Number.isInteger(a.answer) && a.answer >= 0 && a.answer < 4 && Number.isFinite(a.points) && a.points >= 0 && a.points <= 8 && Number.isInteger(a.interval) && a.interval >= 1 && a.interval <= 60)) return null;
    return p;
  } catch { return null; }
}
