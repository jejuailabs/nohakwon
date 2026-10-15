import type { Confidence } from "@nohakwon/core";
import type { BankQuestion, Book, LearnMode, Unit } from "./learning";

// Operational defaults, not a validated educational assessment or a fixed unit quota.
export const ADAPTIVE_POLICY = {
  version: "adaptive-v1",
  distinct: 3,
  successfulDays: 2,
  recentCorrect: 2,
  initialPerSkill: 4,
  batchSize: 8,
} as const;
export type LearningSkill = { concept: string; type: string };
export function unitRevision(book: Book, unit: Unit | undefined) {
  return unit ? (unit.revision ?? book.revision) : -1;
}
export function unitContent(unit: Unit) {
  return JSON.stringify([unit.concepts, unit.source, unit.standardCodes ?? []]);
}
export type UnitPlan = {
  id: string;
  bookId: string;
  unitId: string;
  revision: number;
  skills: LearningSkill[];
  origin: "ai" | "editor";
  createdAt: string;
};
export type SkillEvidence = {
  questionId: string;
  fingerprint: string;
  date: string;
  at: string;
  correct: boolean;
  confidence: Confidence;
  seconds: number;
  mode: LearnMode;
};
export type SkillProgress = {
  id: string;
  bookId: string;
  unitId: string;
  revision: number;
  concept: string;
  type: string;
  attempts: number;
  evidence: SkillEvidence[];
  status: "learning" | "awaiting-check" | "secure" | "needs-work";
  lastAttemptId: string;
  lastQuestionId?: string;
  lastAt: string;
  firstSecuredAt: string;
  groupKey?: string;
  dueDate?: string;
  interval?: number;
  reviewStreak?: number;
};
export type AdaptiveSnapshot = { plans: UnitPlan[]; skills: SkillProgress[] };
export type SelectionReason = {
  code:
    | "new-coverage"
    | "unit-practice"
    | "weakness"
    | "retention"
    | "retention-repeat"
    | "manual-repeat"
    | "assessment";
  label: string;
  triggerAttemptId: string;
  previousQuestionId: string;
  repeated: boolean;
  policyVersion: string;
};
export type ReviewChange = {
  previousDue: string;
  nextDue: string;
  previousInterval: number;
  nextInterval: number;
  previousWeakness: number;
  nextWeakness: number;
  previousMastery: string;
  nextMastery: string;
  policyVersion: string;
};

export function skillIdentity(
  bookId: string,
  unitId: string,
  revision: number,
  skill: LearningSkill,
) {
  return JSON.stringify([bookId, unitId, revision, skill.concept, skill.type]);
}
export function questionContent(q: Pick<BankQuestion, "prompt" | "choices">) {
  const normalize = (s: string) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');
  return JSON.stringify([normalize(q.prompt), q.choices.map(normalize).sort()]);
}
export function planFor(book: Book, unit: Unit, adaptive: AdaptiveSnapshot) {
  return adaptive.plans.find(
    (p) =>
      p.bookId === book.id &&
      p.unitId === unit.id &&
      p.revision === unitRevision(book, unit),
  );
}
export function progressFor(
  book: Book,
  unit: Unit,
  skill: LearningSkill,
  adaptive: AdaptiveSnapshot,
) {
  return adaptive.skills.find(
    (s) =>
      s.bookId === book.id &&
      s.unitId === unit.id &&
      s.revision === unitRevision(book, unit) &&
      s.concept === skill.concept &&
      s.type === skill.type,
  );
}
export function unitCoverage(
  book: Book,
  unit: Unit,
  adaptive: AdaptiveSnapshot,
) {
  const plan = planFor(book, unit, adaptive);
  const skills =
    plan?.skills ??
    unit.concepts.map((concept) => ({ concept, type: "기본 확인" }));
  const rows = skills.map((skill) => ({
    ...skill,
    progress: progressFor(book, unit, skill, adaptive),
  }));
  const secure = rows.filter((s) => s.progress?.status === "secure").length;
  const confirmed = rows.filter((s) => !!s.progress?.firstSecuredAt).length;
  return {
    planned: !!plan,
    rows,
    secure,
    confirmed,
    total: rows.length,
    complete: !!plan && rows.length > 0 && confirmed === rows.length,
    initialBankTarget: rows.length * ADAPTIVE_POLICY.initialPerSkill,
  };
}
export function nextLearningUnit(book: Book, adaptive: AdaptiveSnapshot) {
  const units = book.units.slice(
    book.units.findIndex((u) => u.id === book.currentUnit),
    book.units.findIndex((u) => u.id === book.endUnit) + 1,
  );
  return units.find((unit) => !unitCoverage(book, unit, adaptive).complete);
}
export function evaluateEvidence(
  evidence: SkillEvidence[],
): SkillProgress["status"] {
  const latest = evidence.at(-1);
  if (!latest) return "learning";
  if (!latest.correct || latest.confidence !== "known") return "needs-work";
  const distinct = new Set(evidence.map((e) => e.fingerprint)).size;
  if (distinct < ADAPTIVE_POLICY.distinct) return "learning";
  const recent = evidence.slice(-ADAPTIVE_POLICY.recentCorrect);
  if (recent.some((e) => !e.correct || e.confidence !== "known"))
    return "learning";
  return new Set(recent.map((e) => e.date)).size >=
    ADAPTIVE_POLICY.successfulDays
    ? "secure"
    : "awaiting-check";
}
export function advanceSkill(
  previous: SkillProgress | undefined,
  context: Omit<
    SkillProgress,
    | "attempts"
    | "evidence"
    | "status"
    | "lastAttemptId"
    | "lastAt"
    | "firstSecuredAt"
  >,
  evidence: SkillEvidence,
  attemptId: string,
): SkillProgress {
  // Re-reading an answer never adds transfer/mastery evidence. A repeated question
  // may reveal weakness, but must not stand in for a new variant on a later day.
  if (evidence.mode === "practice")
    return (
      previous ?? {
        ...context,
        attempts: 0,
        evidence: [],
        status: "learning",
        lastAttemptId: "",
        lastAt: "",
        firstSecuredAt: "",
      }
    );
  const old = previous?.evidence ?? [];
  const repeated = old.some((e) => e.fingerprint === evidence.fingerprint);
  const fresh =
    !repeated || !evidence.correct || evidence.confidence !== "known"
      ? [...old, evidence].slice(-16)
      : old;
  const status =
    !evidence.correct || evidence.confidence !== "known"
      ? "needs-work"
      : repeated
        ? (previous?.status ?? "learning")
        : evaluateEvidence(fresh);
  return {
    ...previous,
    ...context,
    attempts: (previous?.attempts ?? 0) + 1,
    evidence: fresh,
    status,
    lastAttemptId: attemptId,
    lastQuestionId: evidence.questionId,
    lastAt: evidence.at,
    firstSecuredAt:
      previous?.firstSecuredAt || (status === "secure" ? evidence.at : ""),
  };
}
export function selectionReason(
  mode: LearnMode,
  previous: { lastAttemptId?: string; questionId?: string } | undefined,
  repeated = false,
): SelectionReason {
  const code =
    mode === "practice"
      ? "manual-repeat"
      : mode === "extra"
        ? "unit-practice"
        : mode === "reinforce"
          ? "weakness"
          : mode === "review"
            ? repeated
              ? "retention-repeat"
              : "retention"
            : mode === "assessment" || mode === "exam"
              ? "assessment"
              : "new-coverage";
  const label = {
    "manual-repeat": "내가 선택한 문제 다시 풀기",
    "unit-practice": "선택한 단원의 아직 보지 않은 추가 문제",
    weakness: "헷갈리거나 어려웠던 유형의 새 문제",
    retention: "복습 시점이 된 개념을 새 문제로 확인",
    "retention-repeat": "새 변형 문제가 없어 이전 문제로 기억 확인",
    assessment: "배운 개념을 다른 문제로 점검",
    "new-coverage": "아직 확인하지 않은 개념·유형 학습",
  }[code];
  return {
    code,
    label,
    triggerAttemptId: previous?.lastAttemptId ?? "",
    previousQuestionId: previous?.questionId ?? "",
    repeated,
    policyVersion: ADAPTIVE_POLICY.version,
  };
}

export function generationTargets(
  plan: UnitPlan,
  bank: BankQuestion[],
  excluded: Set<string>,
  fingerprint: (q: BankQuestion) => string,
  progress: SkillProgress[],
  mode: "daily" | "reinforce",
  legacyWeak: Set<string> = new Set(),
) {
  const targets: LearningSkill[] = [];
  const ordered = plan.skills
    .filter((skill) => {
      const p = progress.find(
        (p) =>
          p.concept === skill.concept &&
          p.type === skill.type &&
          p.revision === plan.revision,
      );
      return mode === "reinforce"
        ? p?.status === "needs-work" || (!p && legacyWeak.has(skill.concept))
        : p?.status !== "secure";
    })
    .sort((a, b) => {
      const count = (s: LearningSkill) =>
        new Set(
          progress
            .find((p) => p.concept === s.concept && p.type === s.type)
            ?.evidence.map((e) => e.fingerprint) ?? [],
        ).size;
      const stock = (s: LearningSkill) =>
        bank.filter(
          (q) =>
            q.concept === s.concept && (q.skillType ?? "기본 확인") === s.type,
        ).length;
      return count(a) - count(b) || stock(a) - stock(b);
    });
  // Round-robin deficits: large units don't monopolize one generation batch.
  for (
    let layer = 0;
    layer < ADAPTIVE_POLICY.initialPerSkill &&
    targets.length < ADAPTIVE_POLICY.batchSize;
    layer++
  ) {
    for (const skill of ordered) {
      const available = new Set(
        bank
          .filter(
            (q) =>
              q.concept === skill.concept &&
              (q.skillType ?? "기본 확인") === skill.type &&
              q.status === "approved" &&
              !excluded.has(fingerprint(q)),
          )
          .map(fingerprint),
      ).size;
      const p = progress.find(
        (p) => p.concept === skill.concept && p.type === skill.type,
      );
      const distinct = new Set(p?.evidence.map((e) => e.fingerprint) ?? [])
        .size;
      const deficit =
        Math.max(0, ADAPTIVE_POLICY.initialPerSkill - distinct) +
        (p?.status === "needs-work" || p?.status === "awaiting-check" ? 2 : 0);
      if (available + layer < Math.max(1, deficit)) targets.push(skill);
      if (targets.length >= ADAPTIVE_POLICY.batchSize) break;
    }
  }
  return targets;
}
