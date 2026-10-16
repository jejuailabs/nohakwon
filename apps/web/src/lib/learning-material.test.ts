import test from "node:test";
import assert from "node:assert/strict";
import {
  canPrepareCurriculum,
  materialDomains,
  materialIdentity,
  verifiedReferences,
} from "./learning-material";
import { PUBLISHER_CATALOG } from "./catalog";
import { reviewedMaterial, reviewedScope } from "./reviewed-material";

const book = {
  ...PUBLISHER_CATALOG.find(
    (b) => b.publisher === "해냄에듀" && b.volume === "1-1" && b.grade === 1,
  )!,
  catalogId: "official",
};
test("only server-registered catalog books can prepare public concept material", () => {
  assert.equal(canPrepareCurriculum(book), true);
  assert.equal(canPrepareCurriculum({ ...book, origin: "upload" }), false);
  assert.equal(
    canPrepareCurriculum({ ...book, id: "foundation-korean" }),
    false,
  );
  assert.ok(materialDomains(book).includes("hnedu.co.kr"));
});
test("material citations must match actual retrieved official sources", () => {
  const known = {
    title: "단원 안내",
    url: "https://preview.hnedu.co.kr/hnedu/mid_korean_12.html",
  };
  const requested = [
    known,
    { title: "허위 출처", url: "https://preview.hnedu.co.kr/made-up" },
    { title: "다른 도메인", url: "https://evil-hnedu.co.kr/content" },
    { title: "비보안 주소", url: "http://preview.hnedu.co.kr/content" },
  ];
  assert.deepEqual(
    verifiedReferences(
      requested,
      [known, ...requested.slice(2)],
      materialDomains(book),
    ),
    [known],
  );
});
test("material cache identity separates school grade, curriculum and unit", () => {
  const key = materialIdentity(book, book.units[0]);
  assert.notEqual(key, materialIdentity({ ...book, grade: 2 }, book.units[0]));
  assert.notEqual(
    key,
    materialIdentity({ ...book, curriculum: "2015" }, book.units[0]),
  );
  assert.notEqual(
    key,
    materialIdentity(book, { ...book.units[0], title: "다른 단원" }),
  );
});
test("reviewed mathematics material respects grade and exact topic boundaries", () => {
  const math = PUBLISHER_CATALOG.find((b) => b.id === "visang-2022-B0318")!;
  const first = reviewedMaterial(math, math.units[0]);
  assert.ok(first?.concepts.includes("소수와 합성수"));
  assert.ok(first?.concepts.includes("유리수의 사칙연산"));
  assert.equal(
    reviewedMaterial({ ...math, grade: 2 }, math.units[0]),
    undefined,
  );
  assert.equal(
    reviewedMaterial(
      { ...math, schoolLevel: "elementary", grade: 4 },
      math.units[0],
    ),
    undefined,
  );
  assert.equal(
    reviewedMaterial(math, {
      ...math.units[0],
      title: "수와 연산 추가 사용자 단원",
    }),
    undefined,
  );
  const onlyFactors = reviewedMaterial(math, {
    ...math.units[0],
    title: "소인수분해",
  })!;
  assert.ok(!onlyFactors.concepts.includes("유리수의 사칙연산"));
});
test("official English scope separates lesson grammar and publisher editions", () => {
  const english = PUBLISHER_CATALOG.find((b) => b.id === "visang-2022-B0319")!;
  assert.deepEqual(reviewedScope(english, english.units[0])?.concepts, [
    "be동사",
    "일반동사",
  ]);
  assert.deepEqual(reviewedScope(english, english.units[1])?.concepts, [
    "There is/are",
    "현재진행형",
  ]);
  assert.equal(
    reviewedScope({ ...english, author: "다른 저자" }, english.units[0]),
    undefined,
  );
  assert.equal(
    reviewedScope({ ...english, curriculum: "2015" }, english.units[0]),
    undefined,
  );
});
test("reviewed geography and science scopes do not spill into other grades or subjects", () => {
  const social = PUBLISHER_CATALOG.find((b) => b.id === "visang-2022-B0317")!;
  assert.ok(
    reviewedScope(social, social.units[0])?.concepts.includes(
      "공간적 상호 작용",
    ),
  );
  assert.equal(
    reviewedScope({ ...social, volume: "2" }, social.units[0]),
    undefined,
  );
  const science = PUBLISHER_CATALOG.find((b) => b.id === "visang-2022-B0309")!;
  assert.ok(
    reviewedScope(science, science.units[0])?.concepts.includes(
      "과학적 탐구 방법",
    ),
  );
  assert.equal(
    reviewedScope({ ...science, grade: 2 }, science.units[0]),
    undefined,
  );
});
