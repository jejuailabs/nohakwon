import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, PUBLISHER_CATALOG } from "./catalog";
import { identityFromText, matchTextbooks } from "./matching";
import { mergeTextbookCatalog, catalogSelection } from "./textbook-catalog";
import { parseBook, type Book } from "./learning";

const math = PUBLISHER_CATALOG.find((b) => b.id === "miraen-2022-24")!;
test("catalog contains source-backed books in all five subjects and keeps identity metadata", () => {
  assert.deepEqual(
    [...new Set(PUBLISHER_CATALOG.map((b) => b.subject))].sort(),
    ["english", "korean", "math", "science", "social"],
  );
  assert.equal(new Set(CATALOG.map((b) => b.id)).size, CATALOG.length);
  for (const b of PUBLISHER_CATALOG) {
    const parsed = parseBook(b);
    assert.ok(parsed.units.length > 0);
    assert.ok(parsed.author);
    assert.equal(parsed.curriculum, "2022");
    assert.ok(parsed.sourceUrl?.startsWith("https://"));
    assert.ok(parsed.units.every((u) => !u.source));
  }
});
test("publisher, author, curriculum and semester conflicts cannot be matched away", () => {
  const otherEdition: Book = { ...math, id: "old", curriculum: "2015" };
  const otherAuthor: Book = { ...math, id: "other", author: "다른저자" };
  const result = matchTextbooks(
    {
      title: "중학교 수학 1",
      publisher: "미래엔",
      author: "황선욱",
      grade: 1,
      curriculum: "2022",
    },
    [math, otherEdition, otherAuthor, ...CATALOG],
  );
  assert.ok(result.length > 0);
  assert.ok(result.every((m) => m.book.id === math.id));
  const korean = matchTextbooks(
    identityFromText("미래엔 국어 1-2 (신유식) 2022 개정"),
    CATALOG,
  );
  assert.deepEqual(
    korean.map((m) => m.book.id),
    ["miraen-2022-20"],
  );
  assert.equal(
    matchTextbooks(
      identityFromText("미래엔 국어 1-2 (신유식) 2015 개정"),
      CATALOG,
    ).length,
    0,
  );
});
test("a cover without author or edition returns candidates rather than inventing identity", () => {
  const matches = matchTextbooks(
    { title: "국어 1-1", publisher: "미래엔", subject: "korean", grade: 1 },
    CATALOG,
  );
  assert.equal(matches.length, 2);
  assert.equal(new Set(matches.map((m) => m.book.author)).size, 2);
  assert.equal(
    matchTextbooks({ title: "", publisher: "확인 필요" }, CATALOG).length,
    0,
  );
});
test("social volume is independent of learner grade, with distinct official TOCs", () => {
  const first = PUBLISHER_CATALOG.find((b) => b.id === "miraen-2022-25")!;
  const second = PUBLISHER_CATALOG.find((b) => b.id === "miraen-2022-26")!;
  assert.notDeepEqual(
    first.units.map((u) => u.title),
    second.units.map((u) => u.title),
  );
  assert.equal(second.units[0].title, "헌법과 국가 기관");
  const matches = matchTextbooks(
    { title: "사회 ②", publisher: "미래엔", subject: "social", grade: 3 },
    CATALOG,
  );
  assert.deepEqual(
    matches.map((m) => m.book.id),
    [second.id],
  );
  const parsed = catalogSelection(second, {
    grade: 3,
    currentUnit: second.units[2].id,
    endUnit: second.units[5].id,
    units: [],
  });
  assert.equal(parsed.grade, 3);
  assert.equal(parsed.units.length, 12);
});
test("database updates and unpublished books override bundled catalog entries", () => {
  const edited = {
    ...math,
    title: "수정된 교재",
    published: true,
    revision: 7,
  };
  const merged = mergeTextbookCatalog([math], [edited]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, edited.title);
  assert.equal(merged[0].revision, 7);
  assert.deepEqual(
    mergeTextbookCatalog([math], [{ ...edited, published: false }]),
    [],
  );
});
test("catalog registration accepts ranges but rejects arbitrary unit IDs and identity changes", () => {
  const parsed = catalogSelection(math, {
    grade: 3,
    currentUnit: "unit-2",
    endUnit: "unit-4",
    title: "fake",
    publisher: "fake",
    units: [],
  });
  assert.equal(parsed.grade, 1);
  assert.equal(parsed.title, math.title);
  assert.deepEqual(parsed.units, parseBook(math).units);
  assert.throws(() => catalogSelection(math, { currentUnit: "fake" }));
  assert.throws(() =>
    catalogSelection(math, { currentUnit: "unit-4", endUnit: "unit-1" }),
  );
});
