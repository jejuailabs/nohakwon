import type { Book, BankQuestion } from "./learning";
import type { SubjectId } from "@nohakwon/core";
function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}
export type TextbookIdentity = {
  title: string;
  publisher?: string;
  author?: string;
  subject?: SubjectId;
  grade?: 1 | 2 | 3;
  curriculum?: "2015" | "2022";
  volume?: string;
  isbn?: string;
  warning?: string;
};
export type TextbookMatch = { book: Book; score: number; reasons: string[] };
const known = (value?: string) =>
  value && !/확인 필요|불명|모름|unknown/i.test(value) ? value : "";
function publisherKey(value?: string) {
  return normalized(known(value) || "")
    .split(/·|ㆍ/)[0]
    .replace(/비상교육.*/, "비상")
    .replace(/미래엔.*/, "미래엔")
    .replace(/동아출판.*/, "동아")
    .replace(/천재교과서.*/, "천재교과서")
    .replace(/천재교육.*/, "천재교육")
    .replace(/주식회사|주$/, "");
}
function volumeKey(value?: string) {
  return (value || "")
    .normalize("NFKC")
    .replace(/[①②③]/g, (s) => String("①②③".indexOf(s) + 1))
    .replace(/[^0-9-]/g, "");
}
export function identityFromText(query: string): TextbookIdentity {
  const subject = /국어/.test(query)
    ? "korean"
    : /영어/.test(query)
      ? "english"
      : /수학/.test(query)
        ? "math"
        : /과학/.test(query)
          ? "science"
          : /사회/.test(query)
            ? "social"
            : undefined;
  const grade =
    query.match(/(?:중학교\s*|중학\s*|중\s*)([123])(?:\s*학년)?/)?.[1] ||
    (subject !== "social"
      ? query.match(/(?:국어|영어|수학|과학)\s*([123])/)?.[1]
      : undefined);
  const publisher = [
    "천재교과서",
    "천재교육",
    "비상교육",
    "미래엔",
    "동아출판",
    "지학사",
    "금성출판사",
    "능률",
    "YBM",
    "비상",
    "동아",
  ].find((p) => query.toLowerCase().includes(p.toLowerCase()));
  const author = query.match(/[（(]([가-힣]{2,5})[）)]/)?.[1];
  const curriculum = query.match(
    /2015|2022/,
  )?.[0] as TextbookIdentity["curriculum"];
  const volume =
    subject === "korean"
      ? query.match(/[123]\s*-\s*[12]/)?.[0].replace(/\s/g, "")
      : subject === "social"
        ? query.match(/[①②]|(?:사회\s*)([12])/)?.[0].replace(/사회\s*/, "")
        : undefined;
  const isbn = query.match(/97[89][\d-]{10,17}/)?.[0].replace(/-/g, "");
  return {
    title: query,
    subject,
    grade: grade ? (Number(grade) as 1 | 2 | 3) : undefined,
    publisher,
    author,
    curriculum,
    volume,
    isbn,
  };
}
/** Rank candidates, but never silently equate different authors, editions or volumes. */
export function matchTextbooks(
  input: TextbookIdentity,
  catalog: Book[],
): TextbookMatch[] {
  const hints = {
    ...identityFromText(input.title),
    ...Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined && v !== ""),
    ),
  } as TextbookIdentity;
  const title = normalized(hints.title).replace(
    /중학교|중학|교과서|2022개정|2015개정/g,
    "",
  );
  const pub = publisherKey(hints.publisher),
    author = normalized(known(hints.author) || ""),
    volume = volumeKey(hints.volume);
  return catalog
    .filter((book) => !book.id.startsWith("foundation-"))
    .flatMap((book) => {
      const inferred = identityFromText(book.title);
      const bookAuthor = normalized(
        book.author || book.publisher.split("·")[1] || "",
      );
      const bookVolume = volumeKey(book.volume || inferred.volume);
      const bookCurriculum =
        book.curriculum || book.edition?.match(/2015|2022/)?.[0];
      const isbn = (hints.isbn || "").replace(/[^0-9]/g, ""),
        bookIsbn = (book.isbn || "").replace(/[^0-9]/g, "");
      if (
        (hints.subject && hints.subject !== book.subject) ||
        (hints.grade && !book.flexibleGrade && hints.grade !== book.grade) ||
        (pub && pub !== publisherKey(book.publisher)) ||
        (author && bookAuthor && author !== bookAuthor) ||
        (hints.curriculum &&
          bookCurriculum &&
          hints.curriculum !== bookCurriculum) ||
        (volume && bookVolume && volume !== bookVolume) ||
        (isbn && bookIsbn && isbn !== bookIsbn)
      )
        return [];
      if (isbn && bookIsbn === isbn)
        return [{ book, score: 200, reasons: ["ISBN 일치"] }];
      let score = 0;
      const reasons: string[] = [];
      const add = (label: string, n: number) => {
        reasons.push(label);
        score += n;
      };
      const bookTitle = normalized(book.title).replace(
        /중학교|중학|교과서/g,
        "",
      );
      if (title && (bookTitle.includes(title) || title.includes(bookTitle)))
        add("교재명", 30);
      if (!hints.author && bookAuthor && title.includes(bookAuthor))
        add("대표 저자", 25);
      if (hints.subject === book.subject) add("과목", 12);
      if (hints.grade === book.grade && !book.flexibleGrade) add("학년", 8);
      if (pub) add("출판사", 25);
      if (author && bookAuthor === author) add("대표 저자", 25);
      if (hints.curriculum && hints.curriculum === bookCurriculum)
        add("개정 교육과정", 15);
      if (volume && volume === bookVolume) add("권·학기", 15);
      return score >= 20 ? [{ book, score, reasons }] : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.book.title.localeCompare(b.book.title, "ko"),
    )
    .slice(0, 8);
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
