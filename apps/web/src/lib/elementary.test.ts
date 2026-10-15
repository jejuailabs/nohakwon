import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProfileInput, parseSchoolGrade } from "./account";
import { gradeLabel, schoolLevelOf } from "./education";
import { CATALOG, PUBLISHER_CATALOG, starterQuestions } from "./catalog";
import { ELEMENTARY_FOUNDATION } from "./elementary-foundation";
import { parseBook, parseQuestion } from "./learning";
import { catalogSelection } from "./textbook-catalog";
import { identityFromText, matchTextbooks } from "./matching";
import elementaryData from "../data/elementary-textbooks.json";
import publisherData from "../data/publisher-textbooks.json";

test("legacy records remain middle school while elementary requires an explicit school level", () => {
  assert.equal(schoolLevelOf({}), "middle");
  assert.deepEqual(parseSchoolGrade({ grade: 2 }), {
    schoolLevel: "middle",
    grade: 2,
  });
  assert.equal(gradeLabel({ grade: 2 }), "중학교 2학년");
  for (const grade of [4, 5, 6] as const) {
    assert.equal(
      parseProfileInput({
        nickname: "초등 학생",
        schoolLevel: "elementary",
        grade,
        calm: false,
      }).grade,
      grade,
    );
    assert.equal(
      gradeLabel({ schoolLevel: "elementary", grade }, true),
      `초${grade}`,
    );
    assert.throws(() => parseSchoolGrade({ grade }));
    assert.throws(() => parseSchoolGrade({ schoolLevel: "middle", grade }));
  }
  for (const grade of [0, 1, 2, 3, 7, "4"])
    assert.throws(() => parseSchoolGrade({ schoolLevel: "elementary", grade }));
  assert.throws(() => parseSchoolGrade({ schoolLevel: "other", grade: 4 }));
});

test("official elementary TOCs cover every supported grade and subject without inventing body passages", () => {
  const books = PUBLISHER_CATALOG.filter((b) => b.schoolLevel === "elementary");
  const expected = [
    ...elementaryData,
    ...publisherData.filter((b) => b.schoolLevel === "elementary"),
  ];
  assert.equal(books.length, expected.length);
  assert.equal(
    books.reduce((n, b) => n + b.units.length, 0),
    expected.reduce((n, b) => n + b.units.length, 0),
  );
  for (const grade of [4, 5, 6]) {
    assert.deepEqual(
      [
        ...new Set(
          books.filter((b) => b.grade === grade).map((b) => b.subject),
        ),
      ].sort(),
      ["english", "korean", "math", "science", "social"],
    );
  }
  for (const book of books) {
    assert.equal(parseBook(book).schoolLevel, "elementary");
    assert.ok(book.sourceUrl?.startsWith("https://"));
    assert.ok(book.units.every((u) => !u.source && !/^\[보완\]/.test(u.title)));
    assert.deepEqual(starterQuestions(book), []);
  }
});

test("elementary semesters and Korean split volumes never match a conflicting edition", () => {
  const math = matchTextbooks(
    identityFromText("미래엔 초등 수학 4-2 (장혜원) 2022 개정"),
    CATALOG,
  );
  assert.deepEqual(
    math.map((m) => m.book.id),
    ["miraen-elementary-2022-1417"],
  );
  const korean = matchTextbooks(
    identityFromText("미래엔 초등 국어 4-1 (가) 2022 개정"),
    CATALOG,
  );
  assert.deepEqual(
    korean.map((m) => m.book.id),
    ["national-elementary-2022-1540"],
  );
  const unspecifiedPart = matchTextbooks(
    identityFromText("교육부 초등 국어 4-1 2022 개정"),
    CATALOG,
  );
  assert.equal(unspecifiedPart.length, 2);
  assert.ok(unspecifiedPart.every((m) => m.book.volume?.startsWith("4-1")));
  assert.equal(
    matchTextbooks(identityFromText("미래엔 초등 수학 4-2 2015 개정"), CATALOG)
      .length,
    0,
  );
});

test("school level conflicts exclude candidates and elementary social semesters remain distinct", () => {
  const matches = matchTextbooks(
    identityFromText("미래엔 초등 사회 6-2 (전종한) 2022 개정"),
    CATALOG,
  );
  assert.deepEqual(
    matches.map((m) => m.book.id),
    ["miraen-elementary-2022-1587"],
  );
  assert.equal(
    matchTextbooks(
      { title: "수학 4-1", schoolLevel: "middle", grade: 4, subject: "math" },
      CATALOG,
    ).length,
    0,
  );
  assert.equal(identityFromText("사회 ②").grade, undefined);
  assert.equal(
    identityFromText("초등학교 6학년 영어").schoolLevel,
    "elementary",
  );
});

test("canonical elementary identity cannot be changed through catalog selection", () => {
  const book = PUBLISHER_CATALOG.find(
    (b) => b.id === "miraen-elementary-2022-1416",
  )!;
  const selected = catalogSelection(book, {
    schoolLevel: "middle",
    grade: 1,
    currentUnit: "unit-2",
    endUnit: "unit-4",
  });
  assert.equal(selected.schoolLevel, "elementary");
  assert.equal(selected.grade, 4);
  assert.equal(selected.currentUnit, "unit-2");
  assert.equal(selected.endUnit, "unit-4");
});

test("elementary practice uses its own source notes and cannot inherit middle-school starter questions", () => {
  assert.equal(ELEMENTARY_FOUNDATION.length, 15);
  for (const book of ELEMENTARY_FOUNDATION) {
    assert.match(book.publisher, /자체 제작/);
    assert.ok(book.units[0].source.length > 100);
    assert.deepEqual(starterQuestions(book), []);
  }
  const book = ELEMENTARY_FOUNDATION.find(
    (b) => b.grade === 4 && b.subject === "math",
  )!;
  const question = parseQuestion({
    id: "test",
    bookId: book.id,
    unitId: "basics",
    concept: book.units[0].concepts[0],
    schoolLevel: "elementary",
    grade: 4,
    subject: "math",
    prompt: "48325에서 4의 자릿값은?",
    choices: ["40000", "4000", "400", "40"],
    answer: 0,
    explanation: "4는 만의 자리에 있으므로 40000입니다.",
    evidence: "4는 40000",
    difficulty: 1,
    expectedSeconds: 30,
    variant: "place-4",
    status: "approved",
    origin: "original",
  });
  assert.equal(question.schoolLevel, "elementary");
  assert.throws(() => parseQuestion({ ...question, schoolLevel: "middle" }));
});
