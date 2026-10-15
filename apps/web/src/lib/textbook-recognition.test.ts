import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLISHER_CATALOG } from "./catalog";
import {
  parseTextbookRecognition,
  matchRecognizedTextbooks,
  parseCatalogAdditions,
} from "./textbook-recognition";
const row = {
  title: "중학교 수학 1",
  publisher: "천재교과서",
  author: "김화경",
  schoolLevel: "middle",
  subject: "math",
  grade: 1,
  curriculum: "2022",
  volume: "",
  isbn: "",
  warning: "",
} as const;

test("a five-subject list keeps each publisher/author attached to its own subject", () => {
  const identities = [
    {
      ...row,
      title: "국어 1-1",
      publisher: "미래엔",
      author: "신유식",
      subject: "korean",
      volume: "1-1",
    },
    {
      ...row,
      title: "영어 1",
      publisher: "동아출판",
      author: "윤정미",
      subject: "english",
    },
    row,
    {
      ...row,
      title: "사회 ①",
      publisher: "비상교육",
      author: "강창숙",
      subject: "social",
      volume: "1",
    },
    {
      ...row,
      title: "과학 1",
      publisher: "지학사",
      author: "홍훈기",
      subject: "science",
    },
  ];
  const result = matchRecognizedTextbooks(
    parseTextbookRecognition({ identities, warning: "" }),
    PUBLISHER_CATALOG,
  );
  assert.equal(result.groups.length, 5);
  assert.equal(new Set(result.groups.map((g) => g.id)).size, 5);
  for (const [i, group] of result.groups.entries()) {
    assert.equal(group.matches.length, 1);
    assert.equal(group.matches[0].book.publisher, identities[i].publisher);
    assert.equal(group.matches[0].book.author, identities[i].author);
    assert.equal(group.matches[0].book.subject, identities[i].subject);
  }
});

test("one book uses the same recognition list and repeated rows are not duplicated", () => {
  const parsed = parseTextbookRecognition({
    identities: [row, { ...row }],
    warning: "共通 안내",
  });
  assert.equal(parsed.identities.length, 1);
  assert.equal(parsed.warning, "共通 안내");
  const result = matchRecognizedTextbooks(parsed, PUBLISHER_CATALOG);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].matches.length, 1);
});

test("grade/curriculum-only recognition cannot return unrelated books", () => {
  const result = matchRecognizedTextbooks(
    {
      identities: [
        { title: "", schoolLevel: "middle", grade: 1, curriculum: "2022" },
      ],
      warning: "흐린 사진",
    },
    PUBLISHER_CATALOG,
  );
  assert.deepEqual(result.groups[0].matches, []);
  assert.deepEqual(
    parseTextbookRecognition({ identities: [], warning: "읽을 수 없음" })
      .identities,
    [],
  );
});

test("ambiguous authors and national Korean split volumes remain choices, not a guessed book", () => {
  const result = matchRecognizedTextbooks(
    {
      identities: [
        {
          title: "국어 1-1",
          publisher: "비상교육",
          curriculum: "2022",
          subject: "korean",
          schoolLevel: "middle",
          grade: 1,
        },
        {
          title: "국어 4-1",
          publisher: "교육부",
          subject: "korean",
          curriculum: "2022",
          schoolLevel: "elementary",
          grade: 4,
        },
      ],
      warning: "",
    },
    PUBLISHER_CATALOG,
  );
  assert.equal(result.groups[0].matches.length, 2);
  assert.equal(result.groups[1].matches.length, 2);
});

test("an OCR author mismatch suggests separately marked candidates without changing the read identity", () => {
  const result = matchRecognizedTextbooks(
    { identities: [{ ...row, author: "김화겸" }], warning: "" },
    PUBLISHER_CATALOG,
  );
  assert.equal(result.groups[0].requiresReview, true);
  assert.equal(result.groups[0].identity.author, "김화겸");
  assert.ok(result.groups[0].matches.some((m) => m.book.author === "김화경"));
  assert.ok(
    result.groups[0].matches.every(
      (m) => m.book.publisher === "천재교과서" && m.book.curriculum === "2022",
    ),
  );
});

test("unmatched publisher rows remain visible without substituting another publisher", () => {
  const result = matchRecognizedTextbooks(
    { identities: [{ ...row, publisher: "없는출판사" }], warning: "" },
    PUBLISHER_CATALOG,
  );
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].matches, []);
});

test("malformed recognition and oversized image lists are rejected", () => {
  assert.throws(() =>
    parseTextbookRecognition({ identities: Array(21).fill(row), warning: "" }),
  );
  assert.throws(() =>
    parseTextbookRecognition({ identities: row, warning: "" }),
  );
  const parsed = parseTextbookRecognition({
    identities: [
      {
        ...row,
        subject: "constructor",
        grade: 99,
        curriculum: "2025",
        schoolLevel: "other",
      },
    ],
    warning: "",
  });
  assert.equal(parsed.identities[0].subject, undefined);
  assert.equal(parsed.identities[0].grade, undefined);
  assert.equal(parsed.identities[0].curriculum, undefined);
});

test("final additions reject duplicate IDs, path injection and oversized/empty batches", () => {
  assert.deepEqual(
    parseCatalogAdditions([
      {
        catalogId: "miraen-2022-24",
        selection: { currentUnit: "unit-2" },
        title: "untrusted",
      },
    ]),
    [{ catalogId: "miraen-2022-24", selection: { currentUnit: "unit-2" } }],
  );
  for (const value of [
    [],
    Array.from({ length: 21 }, (_, i) => ({ catalogId: `book-${i}` })),
    [{ catalogId: "a" }, { catalogId: "a" }],
    [{ catalogId: "../../students" }],
    [{ catalogId: "a/b" }],
  ])
    assert.throws(() => parseCatalogAdditions(value));
});
