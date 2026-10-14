import type { Book, BankQuestion } from "./learning";
function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}
export function suggestedBooks(
  input: Pick<Book, "subject" | "grade" | "title" | "publisher" | "units">,
  catalog: Book[],
) {
  return catalog
    .filter((b) => b.subject === input.subject && b.grade === input.grade)
    .map((book) => {
      const a = new Set(input.units.map((u) => normalized(u.title))),
        b = new Set(book.units.map((u) => normalized(u.title))),
        overlap =
          [...a].filter((s) => b.has(s)).length / Math.max(a.size, b.size, 1),
        sameTitle = normalized(input.title) === normalized(book.title),
        publisher =
          input.publisher !== "확인 필요" &&
          normalized(input.publisher) === normalized(book.publisher);
      return {
        book,
        score: Math.round(
          (overlap * 0.6 + Number(sameTitle) * 0.3 + Number(publisher) * 0.1) *
            100,
        ),
      };
    })
    .filter((m) => m.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
export function duplicateQuestion(
  a: Pick<BankQuestion, "prompt" | "choices">,
  b: Pick<BankQuestion, "prompt" | "choices">,
) {
  const x = normalized(a.prompt + a.choices.join("|")),
    y = normalized(b.prompt + b.choices.join("|"));
  if (x === y) return true;
  if (x.length < 20 || y.length < 20) return false;
  const grams = (s: string) =>
    new Set(Array.from({ length: s.length - 3 }, (_, i) => s.slice(i, i + 4)));
  const left = grams(x),
    right = grams(y),
    intersection = [...left].filter((s) => right.has(s)).length;
  return (2 * intersection) / (left.size + right.size) > 0.93;
}
