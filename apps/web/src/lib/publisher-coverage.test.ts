import { test } from "node:test";
import assert from "node:assert/strict";
import inventory from "../data/publisher-inventory.json";
import additions from "../data/publisher-textbooks.json";
import { PUBLISHER_CATALOG } from "./catalog";
import { canonicalPublisher, publisherInText } from "./publishers";
import { identityFromText, matchTextbooks } from "./matching";
import { schoolLevelOf } from "./education";

test("every current association listing maps to its own publisher, author, edition and volume", () => {
  assert.equal(inventory.length, 283);
  assert.equal(new Set(inventory.map((b) => b.canonicalPublisher)).size, 18);
  const byId = new Map(PUBLISHER_CATALOG.map((b) => [b.id, b]));
  for (const row of inventory) {
    const book = byId.get(row.catalogId);
    assert.ok(book, `${row.publisher} ${row.title} (${row.author})`);
    assert.equal(book.publisher, row.canonicalPublisher);
    assert.equal(book.author, row.author);
    assert.equal(book.subject, row.subject);
    assert.equal(schoolLevelOf(book), row.schoolLevel);
    assert.equal(book.curriculum, row.curriculum);
    assert.equal(book.volume, row.volume);
    if (!book.flexibleGrade) assert.equal(book.grade, row.grade);
    const matches = matchTextbooks(
      {
        title: book.title,
        publisher: row.publisher,
        author: row.author,
        curriculum: book.curriculum,
        volume: row.volume,
        schoolLevel: row.schoolLevel as "middle" | "elementary",
        grade: row.grade as 1 | 2 | 3 | 4 | 5 | 6,
        subject: book.subject,
      },
      PUBLISHER_CATALOG,
    );
    assert.deepEqual(
      matches.map((m) => m.book.id),
      [book.id],
      row.title,
    );
  }
});

test("all catalog identities are distinct and new TOCs retain public source evidence", () => {
  assert.equal(PUBLISHER_CATALOG.length, 407);
  assert.equal(
    PUBLISHER_CATALOG.reduce((n, b) => n + b.units.length, 0),
    2514,
  );
  const identities = PUBLISHER_CATALOG.map((b) =>
    [
      schoolLevelOf(b),
      b.grade,
      b.publisher,
      b.author,
      b.subject,
      b.curriculum,
      b.volume,
    ].join("|"),
  );
  assert.equal(new Set(identities).size, identities.length);
  for (const book of additions) {
    assert.ok(book.units.length > 0);
    assert.equal(new Set(book.units).size, book.units.length);
    assert.ok(book.tocSourceUrls.length > 0);
    assert.ok(book.tocSourceUrls.every((url) => url.startsWith("https://")));
    assert.ok(
      book.units.every(
        (u) =>
          !/^(부록|Wrap-up|Special Lesson|Review|프로젝트$|정답과 풀이$)/i.test(
            u,
          ),
      ),
    );
  }
});

test("publisher aliases match legal names without merging different imprints", () => {
  for (const [name, expected] of [
    ["㈜와이비엠", "YBM"],
    ["주식회사 엔이능률", "NE능률"],
    ["(주)디딤돌교육", "디딤돌교육"],
    ["좋은책 신사고", "좋은책신사고"],
  ]) {
    assert.equal(canonicalPublisher(name), expected);
    assert.equal(publisherInText(`${name} 중학교 교과서`), expected);
  }
  assert.notEqual(
    canonicalPublisher("천재교육"),
    canonicalPublisher("천재교과서"),
  );
  assert.notEqual(canonicalPublisher("창비"), canonicalPublisher("창비교육"));
  assert.equal(
    identityFromText("창비교육 중학교 국어 2-1 (이도영) 2022 개정").publisher,
    "창비교육",
  );
});

test("same publisher's different authors and curricula stay separate", () => {
  for (const [query, author] of [
    ["동아출판 중학교 영어 1 (이병민) 2022 개정", "이병민"],
    ["동아출판 중학교 영어 1 (윤정미) 2022 개정", "윤정미"],
    ["비상교육 중학교 국어 1-1 (박영민) 2022 개정", "박영민"],
    ["비상교육 중학교 국어 1-1 (박현숙) 2022 개정", "박현숙"],
  ]) {
    const matches = matchTextbooks(identityFromText(query), PUBLISHER_CATALOG);
    assert.equal(matches.length, 1, query);
    assert.equal(matches[0].book.author, author);
    assert.equal(matches[0].book.curriculum, "2022");
  }
  const old = matchTextbooks(
    identityFromText("다락원 중학교 영어 3 (강용순) 2015 개정"),
    PUBLISHER_CATALOG,
  );
  assert.equal(old.length, 1);
  assert.equal(old[0].book.units.length, 9);
  assert.deepEqual(
    matchTextbooks(
      identityFromText("다락원 중학교 영어 3 (강용순) 2022 개정"),
      PUBLISHER_CATALOG,
    ),
    [],
  );
});

test("textbook TOCs keep major chapter headings above numbered subchapters", () => {
  const math = PUBLISHER_CATALOG.find(
    (b) =>
      b.publisher === "천재교과서" &&
      b.author === "김동재" &&
      b.subject === "math" &&
      b.grade === 3 &&
      b.curriculum === "2022",
  )!;
  assert.deepEqual(
    math.units.map((u) => u.title),
    ["수와 연산", "문자와 식", "함수", "기하", "통계"],
  );
});
