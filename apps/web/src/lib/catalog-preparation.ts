import type { Book, Unit, BankQuestion, MaterialProvenance } from "./learning";
import type { LearningSkill, UnitPlan } from "./adaptive-learning";
import { unitContent } from "./adaptive-learning";
import { SCHOOL_GRADES, schoolLevelOf } from "./education";

export const CATALOG_PREPARATION = {
  version: "catalog-bank-v1",
  initialQuestions: 10,
  batchSize: 8,
  maxBatches: 6,
  maxFailures: 3,
  maxPoolQuestions: 160,
  concurrency: 4,
  leaseMs: 330000,
  dailyAiCalls: 4000,
} as const;
export const CATALOG_AI_UID = "system:catalog-preparation";
export type CatalogPool = MaterialProvenance & {
  id: string;
  catalogId: string;
  grade: Book["grade"];
  unitId: string;
  bookTitle: string;
  unitTitle: string;
  publisher: string;
  subject: Book["subject"];
  schoolLevel: ReturnType<typeof schoolLevelOf>;
  identity: string;
  status: "queued" | "running" | "ready" | "blocked" | "failed";
  phase: "material" | "plan" | "questions";
  sequence: number;
  cycle: number;
  target: number;
  approved: number;
  rejected: number;
  batches: number;
  failures: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
  retryAt: number;
  leaseUntil: number;
  leaseToken: string;
  stage: string;
  error: string;
  material?: Unit;
  plan?: UnitPlan;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  publishedSequence?: number;
  publishedCycle?: number;
  publishedAt?: number;
  publishingUntil?: number;
  dispatchError?: string;
  reviewFeedback?: string;
};

// Only canonical catalog content can enter the public preparation pipeline.
export function catalogScopeIdentity(book: Book, unit: Unit) {
  return JSON.stringify([
    CATALOG_PREPARATION.version,
    book.catalogId ?? book.id,
    schoolLevelOf(book),
    book.grade,
    book.subject,
    book.publisher,
    book.title,
    book.author ?? "",
    book.curriculum ?? "",
    book.edition ?? "",
    book.volume ?? "",
    book.revision,
    unit.revision ?? book.revision,
    unit.id,
    unit.title,
    unitContent(unit),
  ]);
}
export function catalogContext(book: Book, canonical: Book, unit: Unit) {
  const original = canonical.units.find((u) => u.id === unit.id);
  if (
    book.origin !== "catalog" ||
    !book.catalogId ||
    book.catalogId !== canonical.id ||
    canonical.id.startsWith("foundation-") ||
    unit.source.trim() ||
    !original ||
    original.title !== unit.title ||
    unitContent(unit) !== unitContent(original) ||
    book.subject !== canonical.subject ||
    schoolLevelOf(book) !== schoolLevelOf(canonical) ||
    book.title !== canonical.title ||
    book.publisher !== canonical.publisher ||
    (book.author ?? "") !== (canonical.author ?? "") ||
    (book.curriculum ?? "") !== (canonical.curriculum ?? "") ||
    (!canonical.flexibleGrade && book.grade !== canonical.grade)
  )
    return null;
  return {
    book: { ...canonical, catalogId: canonical.id, grade: book.grade },
    unit: original,
  };
}
export function initialCatalogScopes(books: Book[]) {
  return books
    .filter((b) => !b.id.startsWith("foundation-") && b.units.length)
    .flatMap((b) =>
      (b.flexibleGrade ? SCHOOL_GRADES[schoolLevelOf(b)] : [b.grade]).map(
        (grade) => ({
          book: { ...b, catalogId: b.id, grade },
          unit: b.units[0],
        }),
      ),
    );
}
export function followingCatalogUnit(book: Book, entered: string) {
  const index = book.units.findIndex((u) => u.id === entered);
  return index < 0 ? undefined : book.units[index + 1];
}
export function preparationTargets(
  plan: UnitPlan,
  bank: BankQuestion[],
  target: number,
): LearningSkill[] {
  const approved = bank.filter((q) => q.status === "approved");
  const stock = new Map(
    plan.skills.map((s) => [
      JSON.stringify(s),
      approved.filter(
        (q) =>
          q.concept === s.concept && (q.skillType ?? "기본 확인") === s.type,
      ).length,
    ]),
  );
  const attempts = new Map(
    plan.skills.map((s) => [
      JSON.stringify(s),
      bank.filter(
        (q) =>
          q.concept === s.concept && (q.skillType ?? "기본 확인") === s.type,
      ).length,
    ]),
  );
  const targets: LearningSkill[] = [];
  const count = Math.min(
    CATALOG_PREPARATION.batchSize,
    Math.max(0, target - approved.length),
  );
  for (let n = 0; n < count && plan.skills.length; n++) {
    const skill = [...plan.skills].sort(
      (a, b) =>
        stock.get(JSON.stringify(a))! - stock.get(JSON.stringify(b))! ||
        attempts.get(JSON.stringify(a))! - attempts.get(JSON.stringify(b))!,
    )[0];
    targets.push(skill);
    const key = JSON.stringify(skill);
    stock.set(key, stock.get(key)! + 1);
  }
  return targets;
}
export function poolCanRun(pool: CatalogPool, now: number) {
  return (
    (pool.status === "queued" && pool.retryAt <= now) ||
    (pool.status === "running" && pool.leaseUntil <= now)
  );
}
