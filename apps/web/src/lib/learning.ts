import {
  addDays,
  seoulDate,
  type Confidence,
  type SubjectId,
} from "@nohakwon/core";
import { AccountError, parseSchoolGrade } from "./account";
import type { Grade, SchoolLevel } from "./education";

export const SUBJECT_NAMES: Record<SubjectId, string> = {
  korean: "국어",
  english: "영어",
  math: "수학",
  social: "사회",
  science: "과학",
};
export type Unit = {
  id: string;
  title: string;
  concepts: string[];
  source: string;
  standardCodes?: string[];
};
export type Book = {
  id: string;
  title: string;
  publisher: string;
  publisherAliases?: string[];
  edition?: string;
  author?: string;
  curriculum?: "2015" | "2022";
  volume?: string;
  isbn?: string;
  flexibleGrade?: boolean;
  catalogId?: string;
  sourceUrl?: string;
  schoolLevel?: SchoolLevel;
  grade: Grade;
  subject: SubjectId;
  units: Unit[];
  currentUnit: string;
  endUnit: string;
  active: boolean;
  createdAt: string;
  revision: number;
  origin: "upload" | "catalog";
};
export type BankQuestion = {
  id: string;
  bookId: string;
  unitId: string;
  concept: string;
  subject: SubjectId;
  grade: number;
  schoolLevel?: SchoolLevel;
  prompt: string;
  choices: string[];
  answer: number | string;
  kind?: "mcq" | "short";
  acceptable?: string[];
  explanation: string;
  evidence: string;
  reviewReason?: string;
  difficulty: number;
  variant: string;
  expectedSeconds: number;
  status: "approved" | "pending" | "disabled";
  origin: "original" | "ai" | "editor";
};
export type ServedQuestion = Pick<
  BankQuestion,
  | "id"
  | "bookId"
  | "unitId"
  | "concept"
  | "subject"
  | "prompt"
  | "choices"
  | "difficulty"
  | "kind"
>;
export type LearnMode = "daily" | "review" | "assessment" | "practice" | "exam";
export type Result = {
  id: string;
  questionId: string;
  bookId: string;
  unitId: string;
  concept: string;
  subject: SubjectId;
  date: string;
  at: string;
  answer: number | string;
  correctAnswer: number | string;
  correct: boolean;
  confidence: Confidence;
  seconds: number;
  points: number;
  interval: number;
  dueDate: string;
  mode: LearnMode;
  prompt: string;
  choices: string[];
  explanation: string;
  reason: string;
  bookmarked: boolean;
};
// Stored when the answer is revealed; understanding and rewards are saved later.
export type AnswerFeedback = Pick<
  Result,
  "answer" | "correctAnswer" | "correct" | "seconds" | "explanation" | "at"
>;
export type ConceptProgress = {
  key: string;
  bookId: string;
  unitId: string;
  concept: string;
  subject: SubjectId;
  questionId: string;
  interval: number;
  dueDate: string;
  history: { correct: boolean; confidence: Confidence; seconds: number }[];
  newCount: number;
  reviewStreak: number;
  difficulty: number;
  difficultyChanged: string;
  lastRewardDate: string;
  weakness: number;
};
export type LearningState = {
  points: number;
  spent: number;
  concepts: Record<string, ConceptProgress>;
  cosmetics: string[];
  equipped: string;
  theme: "dark" | "light" | "system";
  locale: "ko" | "en" | "ja" | "zh";
  dailyTarget: number;
  baseDifficulty: number;
  autoDifficulty: boolean;
  examDate: string;
  updatedAt: string;
};
export type LearningConfig = {
  dailyPerSubject: number;
  maxDaily: number;
  minRewardSeconds: number;
  minimumNewPerConcept: number;
  subscriptionWon: number;
  aiDailyCalls: number;
};
export const DEFAULT_CONFIG: LearningConfig = {
  dailyPerSubject: 10,
  maxDaily: 100,
  minRewardSeconds: 3,
  minimumNewPerConcept: 3,
  subscriptionWon: 5000,
  aiDailyCalls: 40,
};
export const DEFAULT_STATE: LearningState = {
  points: 0,
  spent: 0,
  concepts: {},
  cosmetics: [],
  equipped: "",
  theme: "dark",
  locale: "ko",
  dailyTarget: 10,
  baseDifficulty: 2,
  autoDifficulty: true,
  examDate: "",
  updatedAt: "",
};
export type Entitlement = {
  status: "trial" | "active" | "expired";
  trialEndsAt: string;
  paidUntil: string;
  daysLeft: number;
  test: boolean;
  cancelAtPeriodEnd: boolean;
};
export type Job = {
  id: string;
  bookId: string;
  unitId: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  error: string;
  accepted: number;
  rejected: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};
export type Report = {
  count: number;
  correct: number;
  accuracy: number;
  seconds: number;
  days: number;
  confidence: Record<Confidence, number>;
  subjects: { subject: SubjectId; count: number; accuracy: number }[];
  daily: { date: string; count: number; accuracy: number }[];
  weak: ConceptProgress[];
  reliable: boolean;
  recommendation: string;
};
export type Workspace = {
  guardian: boolean;
  books: Book[];
  state: LearningState;
  results: Result[];
  entitlement: Entitlement;
  jobs: Job[];
  aiConfigured: boolean;
  billingConfigured: boolean;
  admin: boolean;
  report: Report;
  config: LearningConfig;
};
export const COSMETICS = [
  { id: "starlight", name: "별빛 배지", price: 30 },
  { id: "forest", name: "숲의 수호자", price: 80 },
  { id: "aurora", name: "오로라 탐험가", price: 150 },
];

export function loadLearningState(
  saved?: Record<string, unknown>,
): LearningState {
  // Nested defaults must be unique per learner and per request.
  return { ...structuredClone(DEFAULT_STATE), ...saved } as LearningState;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccountError(400, "입력 형식을 확인해 주세요.");
  return value as Record<string, unknown>;
}
export function text(
  value: unknown,
  max: number,
  label: string,
  optional = false,
): string {
  if (typeof value !== "string")
    throw new AccountError(400, `${label}을 확인해 주세요.`);
  const result = value.normalize("NFC").trim();
  if (
    (!optional && !result) ||
    result.length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)
  )
    throw new AccountError(400, `${label}은 ${max}자 이내로 입력해 주세요.`);
  return result;
}
export function id(value: unknown): string {
  const result = text(value, 240, "ID");
  if (!/^[a-zA-Z0-9_-]+$/.test(result))
    throw new AccountError(400, "올바르지 않은 ID입니다.");
  return result;
}
export function integer(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  )
    throw new AccountError(400, `${label}은 ${min}~${max} 사이여야 합니다.`);
  return value as number;
}
export function subject(value: unknown): SubjectId {
  if (typeof value !== "string" || !Object.keys(SUBJECT_NAMES).includes(value))
    throw new AccountError(400, "과목을 선택해 주세요.");
  return value as SubjectId;
}
export function parseBook(
  value: unknown,
): Omit<Book, "id" | "createdAt" | "revision" | "origin"> {
  const b = object(value);
  if (!Array.isArray(b.units) || b.units.length < 1 || b.units.length > 60)
    throw new AccountError(400, "단원은 1~60개까지 등록할 수 있어요.");
  const units = b.units.map((v, i) => {
    const u = object(v);
    const concepts = Array.isArray(u.concepts)
      ? [
          ...new Set(
            u.concepts
              .filter((c) => typeof c === "string" && c.trim())
              .map((c) => text(c, 80, "개념")),
          ),
        ].slice(0, 12)
      : [];
    const title = text(u.title, 120, "단원명");
    return {
      id: u.id ? id(u.id) : `unit-${i + 1}`,
      title,
      concepts: concepts.length ? concepts : [title.slice(0, 80)],
      source: text(u.source ?? "", 24000, "단원 본문", true),
      standardCodes: Array.isArray(u.standardCodes)
        ? u.standardCodes.slice(0, 20).map((c) => text(c, 40, "성취기준 코드"))
        : [],
    };
  });
  if (new Set(units.map((u) => u.id)).size !== units.length)
    throw new AccountError(400, "단원 ID가 중복됩니다.");
  if (units.reduce((n, u) => n + u.source.length, 0) > 100000)
    throw new AccountError(
      413,
      "교재 본문은 단원별로 나누어 총 10만 자 이내로 등록해 주세요.",
    );
  const currentUnit = b.currentUnit ? id(b.currentUnit) : units[0].id;
  const endUnit = b.endUnit ? id(b.endUnit) : currentUnit;
  if (
    !units.some((u) => u.id === currentUnit) ||
    units.findIndex((u) => u.id === endUnit) <
      units.findIndex((u) => u.id === currentUnit)
  )
    throw new AccountError(400, "학습 시작·종료 단원을 확인해 주세요.");
  const sourceUrl = text(b.sourceUrl ?? "", 500, "출처 URL", true);
  if (sourceUrl) {
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw new AccountError(400, "출처는 올바른 HTTPS 주소여야 합니다.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new AccountError(400, "출처는 올바른 HTTPS 주소여야 합니다.");
  }
  return {
    title: text(b.title, 120, "교재명"),
    publisher: text(b.publisher ?? "직접 등록", 80, "출판사"),
    publisherAliases: Array.isArray(b.publisherAliases)
      ? b.publisherAliases.slice(0, 6).map((p) => text(p, 80, "출판사 별칭"))
      : [],
    edition: text(b.edition ?? "", 100, "판본", true),
    author: text(b.author ?? "", 80, "대표 저자", true),
    ...(b.curriculum === "2015" || b.curriculum === "2022"
      ? { curriculum: b.curriculum }
      : {}),
    volume: text(b.volume ?? "", 20, "권·학기", true),
    isbn: text(b.isbn ?? "", 20, "ISBN", true),
    flexibleGrade: b.flexibleGrade === true,
    sourceUrl,
    ...parseSchoolGrade(b),
    subject: subject(b.subject),
    units,
    currentUnit,
    endUnit,
    active: b.active !== false,
  };
}
export function learningUnit(book: Book, state: LearningState, minimum = 3) {
  const units = book.units.slice(
    book.units.findIndex((u) => u.id === book.currentUnit),
    book.units.findIndex((u) => u.id === book.endUnit) + 1,
  );
  return (
    units.find((u) =>
      u.concepts.some(
        (concept) =>
          (state.concepts[
            conceptKey({ bookId: book.id, unitId: u.id, concept })
          ]?.newCount ?? 0) < minimum,
      ),
    ) ?? units.at(-1)
  );
}
export function reserveQuestions(
  candidates: BankQuestion[],
  mode: LearnMode,
  day: {
    reserved: number;
    questionIds: string[];
    dailySubjects?: Record<string, number>;
  },
  config: LearningConfig,
  target: number,
) {
  const subjects = { ...day.dailySubjects },
    selected: BankQuestion[] = [];
  for (const q of candidates) {
    if (
      mode !== "practice" &&
      (day.questionIds.includes(q.id) ||
        selected.length >= Math.max(0, config.maxDaily - day.reserved))
    )
      continue;
    if (
      mode === "daily" &&
      (subjects[q.subject] ?? 0) >= Math.min(target, config.dailyPerSubject)
    )
      continue;
    selected.push(q);
    if (mode === "daily") subjects[q.subject] = (subjects[q.subject] ?? 0) + 1;
    if (mode === "practice") break;
  }
  return { selected, dailySubjects: subjects };
}
export function parseQuestion(value: unknown): BankQuestion {
  const q = object(value),
    kind = q.kind === "short" ? "short" : "mcq";
  if (kind === "mcq" && (!Array.isArray(q.choices) || q.choices.length !== 4))
    throw new AccountError(400, "보기는 4개가 필요합니다.");
  const choices =
    kind === "short"
      ? []
      : (q.choices as unknown[]).map((c) => text(c, 800, "보기"));
  if (kind === "mcq" && new Set(choices).size !== 4)
    throw new AccountError(400, "중복된 보기가 있습니다.");
  const acceptable =
    kind === "short" && Array.isArray(q.acceptable)
      ? q.acceptable.slice(0, 10).map((a) => text(a, 200, "허용 답안"))
      : [];
  return {
    id: id(q.id),
    bookId: id(q.bookId),
    unitId: id(q.unitId),
    concept: text(q.concept, 80, "개념"),
    subject: subject(q.subject),
    ...parseSchoolGrade(q),
    prompt: text(q.prompt, 5000, "문제"),
    choices,
    kind,
    acceptable,
    answer:
      kind === "short"
        ? text(q.answer, 200, "정답")
        : integer(q.answer, 0, 3, "정답"),
    explanation: text(q.explanation, 4000, "해설"),
    evidence: text(q.evidence ?? "", 2000, "근거", true),
    reviewReason: text(q.reviewReason ?? "", 1000, "검증 메모", true),
    difficulty: integer(q.difficulty, 1, 5, "난이도"),
    variant: text(q.variant, 120, "유형"),
    expectedSeconds: integer(q.expectedSeconds ?? 60, 10, 600, "예상 시간"),
    status: ["approved", "pending", "disabled"].includes(String(q.status))
      ? (q.status as BankQuestion["status"])
      : "pending",
    origin:
      q.origin === "ai"
        ? "ai"
        : q.origin === "original"
          ? "original"
          : "editor",
  };
}
export function publicQuestion(q: BankQuestion): ServedQuestion {
  return {
    id: q.id,
    bookId: q.bookId,
    unitId: q.unitId,
    concept: q.concept,
    subject: q.subject,
    prompt: q.prompt,
    choices: q.choices,
    difficulty: q.difficulty,
    kind: q.kind ?? "mcq",
  };
}
export function normalizeShortAnswer(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, "")
    .replace(/[−–]/g, "-")
    .trim();
}
export function answerLabel(answer: number | string, choices: string[]) {
  return typeof answer === "number"
    ? `${answer + 1}. ${choices[answer] ?? ""}`
    : answer;
}
export function conceptKey(
  q: Pick<BankQuestion, "bookId" | "unitId" | "concept">,
) {
  return `${q.bookId}::${q.unitId}::${q.concept}`;
}
export function reviewInterval(
  confidence: Confidence,
  correct: boolean,
  previous: ConceptProgress | undefined,
  trial: boolean,
  seconds: number,
  expected: number,
  streak: number,
): number {
  let n = trial
    ? confidence === "known"
      ? correct
        ? 4
        : 1
      : confidence === "unsure"
        ? 2
        : 1
    : confidence === "known"
      ? correct
        ? previous
          ? previous.interval * 2
          : 21
        : 3
      : confidence === "unsure"
        ? previous
          ? Math.max(3, Math.round(previous.interval / 2))
          : 14
        : previous
          ? correct
            ? 14
            : 3
          : 7;
  if (correct && seconds > expected * 2) n *= 0.8;
  if (streak >= 3) n *= 1.2;
  return Math.min(60, Math.max(1, Math.round(n)));
}
export function checkAnswer(q: BankQuestion, answer: number | string): boolean {
  if (q.kind === "short") text(answer, 200, "답안");
  else integer(answer, 0, q.choices.length - 1, "답안");
  return q.kind === "short"
    ? [String(q.answer), ...(q.acceptable ?? [])].some(
        (a) => normalizeShortAnswer(a) === normalizeShortAnswer(String(answer)),
      )
    : answer === q.answer;
}
export function gradeAnswer(
  q: BankQuestion,
  previous: ConceptProgress | undefined,
  answer: number | string,
  confidence: Confidence,
  seconds: number,
  mode: LearnMode,
  trial: boolean,
  now: Date,
  config = DEFAULT_CONFIG,
  preferences = { baseDifficulty: 2, autoDifficulty: true },
) {
  if (!["known", "unsure", "unknown"].includes(confidence))
    throw new AccountError(400, "이해도를 선택해 주세요.");
  const correct = checkAnswer(q, answer),
    date = seoulDate(now),
    key = conceptKey(q);
  const reviewStreak =
    mode === "review"
      ? correct
        ? (previous?.reviewStreak ?? 0) + 1
        : 0
      : (previous?.reviewStreak ?? 0);
  const interval =
    mode === "practice" && previous
      ? previous.interval
      : reviewInterval(
          confidence,
          correct,
          previous,
          trial,
          seconds,
          q.expectedSeconds,
          reviewStreak,
        );
  const history = [
    ...(previous?.history ?? []),
    { correct, confidence, seconds },
  ].slice(-10);
  const weakness =
    0.5 * (1 - history.filter((h) => h.correct).length / history.length) +
    (0.3 * history.filter((h) => h.confidence !== "known").length) /
      history.length +
    (0.2 *
      history.filter((h) => h.confidence === "known" && !h.correct).length) /
      history.length;
  let difficulty = previous?.difficulty ?? preferences.baseDifficulty,
    difficultyChanged = previous?.difficultyChanged ?? date;
  const last5 = history.slice(-5);
  if (
    preferences.autoDifficulty &&
    last5.length === 5 &&
    date >= addDays(difficultyChanged, 3)
  ) {
    const accuracy = last5.filter((h) => h.correct).length / 5;
    const time = last5.reduce((n, h) => n + h.seconds, 0) / 5;
    if (accuracy >= 0.8 && time <= q.expectedSeconds)
      difficulty = Math.min(5, difficulty + 1);
    else if (accuracy <= 0.4) difficulty = Math.max(1, difficulty - 1);
    if (difficulty !== previous?.difficulty) difficultyChanged = date;
  }
  let points = 0;
  if (
    mode !== "practice" &&
    seconds >= config.minRewardSeconds &&
    previous?.lastRewardDate !== date
  ) {
    points =
      confidence === "unknown"
        ? 3
        : confidence === "unsure"
          ? 2
          : correct
            ? 1
            : 0;
    if (
      mode === "review" &&
      correct &&
      previous?.history.at(-1)?.correct === false
    )
      points += 5;
    if (mode === "review" && correct && reviewStreak === 2) points += 3;
  }
  const progress: ConceptProgress = {
    key,
    bookId: q.bookId,
    unitId: q.unitId,
    concept: q.concept,
    subject: q.subject,
    questionId: q.id,
    interval,
    dueDate:
      mode === "practice" && previous
        ? previous.dueDate
        : addDays(date, interval),
    history,
    newCount: (previous?.newCount ?? 0) + (mode === "daily" ? 1 : 0),
    reviewStreak,
    difficulty,
    difficultyChanged,
    lastRewardDate: points > 0 ? date : (previous?.lastRewardDate ?? ""),
    weakness,
  };
  return { correct, interval, points, progress };
}
export function makeReport(
  results: Result[],
  concepts: Record<string, ConceptProgress>,
  days = 7,
  now = new Date(),
): Report {
  const end = seoulDate(now),
    start = addDays(end, 1 - days),
    recent = results.filter(
      (r) => r.date >= start && r.date <= end && r.mode !== "practice",
    );
  const count = recent.length,
    correct = recent.filter((r) => r.correct).length;
  const weak = Object.values(concepts)
    .filter((c) => c.weakness > 0.15)
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 8);
  return {
    count,
    correct,
    accuracy: count ? Math.round((correct / count) * 100) : 0,
    seconds: recent.reduce((n, r) => n + r.seconds, 0),
    days: new Set(recent.map((r) => r.date)).size,
    confidence: {
      known: recent.filter((r) => r.confidence === "known").length,
      unsure: recent.filter((r) => r.confidence === "unsure").length,
      unknown: recent.filter((r) => r.confidence === "unknown").length,
    },
    subjects: (Object.keys(SUBJECT_NAMES) as SubjectId[]).map((subject) => {
      const rows = recent.filter((r) => r.subject === subject);
      return {
        subject,
        count: rows.length,
        accuracy: rows.length
          ? Math.round(
              (rows.filter((r) => r.correct).length / rows.length) * 100,
            )
          : 0,
      };
    }),
    daily: Array.from({ length: days }, (_, i) => {
      const date = addDays(start, i),
        rows = recent.filter((r) => r.date === date);
      return {
        date,
        count: rows.length,
        accuracy: rows.length
          ? Math.round(
              (rows.filter((r) => r.correct).length / rows.length) * 100,
            )
          : 0,
      };
    }),
    weak,
    reliable: count >= 5,
    recommendation:
      count < 5
        ? "학습 기록이 5개 이상 쌓이면 변화 추이를 확인할 수 있어요."
        : weak.length
          ? `${weak[0].concept} 개념을 먼저 복습하고 새 단원으로 이어가세요.`
          : "현재 범위를 꾸준히 학습하고 주간 평가로 이해를 점검해 보세요.",
  };
}
