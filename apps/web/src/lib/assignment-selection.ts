import {
  conceptKey,
  type BankQuestion,
  type Book,
  type LearnMode,
  type LearningState,
} from "./learning";
import {
  ADAPTIVE_POLICY,
  nextLearningUnit,
  planFor,
  progressFor,
  unitRevision,
  selectionReason,
  type AdaptiveSnapshot,
  type SelectionReason,
} from "./adaptive-learning";

export type SelectedQuestion = {
  question: BankQuestion;
  reason: SelectionReason;
};
export function selectAdaptiveQuestions({
  mode,
  books,
  bank,
  state,
  adaptive,
  exposed,
  date,
  fingerprint,
  limit,
  selectedQuestion = "",
  targetConcept = "",
  targetType = "",
  unitId = "",
}: {
  mode: LearnMode;
  books: Book[];
  bank: BankQuestion[];
  state: LearningState;
  adaptive: AdaptiveSnapshot;
  exposed: Set<string>;
  date: string;
  fingerprint: (q: BankQuestion) => string;
  limit: number;
  selectedQuestion?: string;
  targetConcept?: string;
  targetType?: string;
  unitId?: string;
}): SelectedQuestion[] {
  const selections: SelectedQuestion[] = [],
    used = new Set<string>();
  const append = (q: BankQuestion, purpose = mode) => {
    const key = fingerprint(q);
    if (used.has(key)) return;
    used.add(key);
    const book = books.find((b) => b.id === q.bookId),
      unit = book?.units.find((u) => u.id === q.unitId);
    const skill =
      book && unit
        ? progressFor(
            book,
            unit,
            { concept: q.concept, type: q.skillType ?? "기본 확인" },
            adaptive,
          )
        : undefined;
    const previous = state.concepts[conceptKey(q)];
    selections.push({
      question: q,
      reason: selectionReason(
        purpose,
        skill && (purpose === "reinforce" || purpose === "review")
          ? {
              ...previous,
              lastAttemptId: skill.lastAttemptId,
              questionId:
                skill.lastQuestionId ??
                skill.evidence.at(-1)?.questionId ??
                previous?.questionId,
            }
          : previous,
        exposed.has(key),
      ),
    });
  };
  if (mode === "practice") {
    const q = bank.find((q) => q.id === selectedQuestion);
    if (q) append(q);
    return selections;
  }
  if (mode === "daily" || mode === "extra") {
    for (const book of books) {
      const unit = unitId
        ? book.units.find((u) => u.id === unitId)
        : nextLearningUnit(book, adaptive);
      if (!unit) continue;
      const plan = planFor(book, unit, adaptive);
      const skills =
        plan?.skills ??
        unit.concepts.map((concept) => ({ concept, type: "기본 확인" }));
      const pools = skills.map((skill) => {
        const progress = progressFor(book, unit, skill, adaptive);
        if (
          mode === "daily" &&
          (progress?.status === "secure" ||
            (progress?.status === "awaiting-check" &&
              progress.evidence.at(-1)?.date === date))
        )
          return [];
        const distinct = new Set(
          progress?.evidence.map((e) => e.fingerprint) ?? [],
        ).size;
        const need =
          mode === "extra"
            ? limit
            : progress?.status === "needs-work"
              ? 3
              : Math.max(1, ADAPTIVE_POLICY.distinct - distinct);
        const options = bank.filter(
          (q) =>
            q.bookId === book.id &&
            q.unitId === unit.id &&
            q.concept === skill.concept &&
            (q.skillType ?? "기본 확인") === skill.type &&
            !exposed.has(fingerprint(q)),
        );
        const difficulty = state.autoDifficulty
          ? (state.concepts[
              conceptKey({
                bookId: book.id,
                unitId: unit.id,
                concept: skill.concept,
              })
            ]?.difficulty ?? state.baseDifficulty)
          : state.baseDifficulty;
        return options
          .sort(
            (a, b) =>
              Math.abs(a.difficulty - difficulty) -
                Math.abs(b.difficulty - difficulty) || a.id.localeCompare(b.id),
          )
          .slice(0, need);
      });
      let count = 0;
      for (let round = 0; round < limit && count < limit; round++)
        for (const pool of pools) {
          if (pool[round] && count < limit) {
            append(pool[round]);
            count++;
          }
        }
    }
  } else {
    const scheduledSkills = (concept: LearningState["concepts"][string]) => {
      const book = books.find((b) => b.id === concept.bookId),
        unit = book?.units.find((u) => u.id === concept.unitId);
      return book && unit
        ? adaptive.skills.filter(
            (s) =>
              s.bookId === book.id &&
              s.unitId === unit.id &&
              s.revision === unitRevision(book, unit) &&
              s.concept === concept.concept &&
              !!s.dueDate &&
              (!targetType || s.type === targetType),
          )
        : [];
    };
    const concepts = Object.values(state.concepts).filter(
      (c) =>
        books.some((b) => b.id === c.bookId) &&
        (!targetConcept || c.concept === targetConcept) &&
        (mode !== "review" ||
          (scheduledSkills(c).length
            ? scheduledSkills(c).some((s) => s.dueDate! <= date)
            : c.dueDate <= date)),
    );
    concepts.sort(
      (a, b) => b.weakness - a.weakness || a.dueDate.localeCompare(b.dueDate),
    );
    for (const concept of concepts) {
      let options = bank.filter(
        (q) =>
          conceptKey(q) === concept.key &&
          (!targetType || (q.skillType ?? "기본 확인") === targetType),
      );
      if (mode === "review") {
        const schedules = scheduledSkills(concept);
        if (schedules.length) {
          for (const skill of schedules
            .filter((s) => s.dueDate! <= date)
            .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))) {
            const pool = options.filter(
              (q) => (q.skillType ?? "기본 확인") === skill.type,
            );
            const fresh = pool
              .filter((q) => !exposed.has(fingerprint(q)))
              .sort(
                (a, b) =>
                  Math.abs(a.difficulty - concept.difficulty) -
                    Math.abs(b.difficulty - concept.difficulty) ||
                  a.id.localeCompare(b.id),
              )[0];
            const old = [...skill.evidence]
              .reverse()
              .map((e) => pool.find((q) => q.id === e.questionId))
              .find(Boolean);
            if (fresh || old) append((fresh ?? old)!);
          }
          continue;
        }
      }
      if (mode === "reinforce") {
        options = options.filter((q) => {
          const book = books.find((b) => b.id === q.bookId)!,
            unit = book.units.find((u) => u.id === q.unitId);
          const skill =
            unit &&
            progressFor(
              book,
              unit,
              { concept: q.concept, type: q.skillType ?? "기본 확인" },
              adaptive,
            );
          return skill
            ? skill.status === "needs-work"
            : !concept.history.at(-1)?.correct ||
                concept.history.at(-1)?.confidence !== "known";
        });
      }
      const fresh = options
        .filter((q) => !exposed.has(fingerprint(q)))
        .sort(
          (a, b) =>
            Math.abs(a.difficulty - concept.difficulty) -
              Math.abs(b.difficulty - concept.difficulty) ||
            a.id.localeCompare(b.id),
        );
      if (mode === "reinforce") fresh.slice(0, 3).forEach((q) => append(q));
      else if (fresh[0]) append(fresh[0]);
      else if (mode === "review") {
        const old = options.find((q) => q.id === concept.questionId);
        if (old) append(old);
      }
    }
    if (mode === "assessment" || mode === "exam")
      for (const q of bank) {
        if (state.concepts[conceptKey(q)] && !exposed.has(fingerprint(q)))
          append(q);
      }
  }
  const perSubject = new Map<string, number>();
  return selections.filter(({ question: q }) => {
    const max = mode === "exam" || mode === "assessment" ? 5 : limit;
    const count = perSubject.get(q.subject) ?? 0;
    if (count >= max) return false;
    perSubject.set(q.subject, count + 1);
    return true;
  });
}
