import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_PREPARATION,
  catalogContext,
  catalogScopeIdentity,
  initialCatalogScopes,
  followingCatalogUnit,
  preparationTargets,
  poolCanRun,
  type CatalogPool,
} from "./catalog-preparation";
import type { Book, BankQuestion } from "./learning";
import type { UnitPlan } from "./adaptive-learning";
import { reviewedScope } from "./reviewed-material";
const book: Book = {
  id: "publisher-1",
  catalogId: "publisher-1",
  title: "중학교 수학 1",
  publisher: "출판사",
  author: "저자",
  curriculum: "2022",
  grade: 1,
  subject: "math",
  origin: "catalog",
  revision: 2,
  units: [
    { id: "u1", title: "수와 연산", concepts: ["수와 연산"], source: "" },
    { id: "u2", title: "문자와 식", concepts: ["문자와 식"], source: "" },
  ],
  currentUnit: "u1",
  endUnit: "u1",
  active: true,
  createdAt: "",
};

test("first-stage bootstrap includes every publisher, elementary grade and flexible middle grade", () => {
  const books = [
    book,
    { ...book, id: "publisher-2" },
    { ...book, id: "elementary", grade: 4, schoolLevel: "elementary" },
    { ...book, id: "flexible", flexibleGrade: true },
    { ...book, id: "foundation-math" },
  ] as Book[];
  const scopes = initialCatalogScopes(books);
  assert.equal(scopes.length, 6);
  assert.deepEqual(
    scopes.filter((s) => s.book.id === "flexible").map((s) => s.book.grade),
    [1, 2, 3],
  );
  assert.ok(scopes.every((s) => s.unit.id === "u1"));
  assert.ok(scopes.some((s) => s.book.id === "publisher-2"));
});
test("public pool identity changes with edition, grade, author, unit content or catalog revision", () => {
  const key = catalogScopeIdentity(book, book.units[0]);
  for (const change of [
    { grade: 2 },
    { author: "다른 저자" },
    { curriculum: "2015" },
    { revision: 3 },
  ])
    assert.notEqual(
      catalogScopeIdentity({ ...book, ...change } as Book, book.units[0]),
      key,
    );
  assert.notEqual(
    catalogScopeIdentity(book, { ...book.units[0], title: "다른 단원" }),
    key,
  );
  assert.notEqual(
    catalogScopeIdentity(book, { ...book.units[0], source: "새 본문" }),
    key,
  );
});
test("private uploaded bodies and edited concepts cannot match the shared curriculum pool", () => {
  assert.ok(catalogContext(book, book, book.units[0]));
  assert.equal(
    catalogContext({ ...book, origin: "upload" }, book, book.units[0]),
    null,
  );
  assert.equal(
    catalogContext(book, book, {
      ...book.units[0],
      source: "학습자의 비공개 본문",
    }),
    null,
  );
  assert.equal(
    catalogContext(book, book, { ...book.units[0], concepts: ["개인 개념"] }),
    null,
  );
  assert.equal(
    catalogContext({ ...book, grade: 2 }, book, book.units[0]),
    null,
  );
  assert.ok(
    catalogContext(
      { ...book, grade: 2 },
      { ...book, flexibleGrade: true },
      book.units[0],
    ),
  );
});
test("entry prepares exactly the following unit without advancing the selected range", () => {
  assert.equal(followingCatalogUnit(book, "u1")?.id, "u2");
  assert.equal(followingCatalogUnit(book, "u2"), undefined);
  assert.equal(followingCatalogUnit(book, "missing"), undefined);
  assert.equal(book.currentUnit, "u1");
  assert.equal(book.endUnit, "u1");
});
test("only approved stock counts toward ten questions and generation balances concept types", () => {
  const skills = [
    { concept: "A", type: "기본" },
    { concept: "B", type: "적용" },
  ];
  const plan = { skills } as UnitPlan;
  const bank = [
    { concept: "A", skillType: "기본", status: "approved" },
    { concept: "B", skillType: "적용", status: "pending" },
  ] as BankQuestion[];
  const targets = preparationTargets(plan, bank, 10);
  assert.equal(targets.length, 8);
  assert.deepEqual(targets[0], skills[1]);
  assert.equal(targets.filter((s) => s.concept === "B").length, 4);
  assert.equal(preparationTargets(plan, bank, 1).length, 0);
  assert.equal(
    preparationTargets(plan, [], CATALOG_PREPARATION.initialQuestions).length,
    8,
  );
});
test("queued retries respect backoff, live leases block duplicate work and expired leases recover", () => {
  const state = {
    status: "queued",
    retryAt: 100,
    leaseUntil: 0,
  } as CatalogPool;
  assert.equal(poolCanRun(state, 99), false);
  assert.equal(poolCanRun(state, 100), true);
  assert.equal(
    poolCanRun({ ...state, status: "running", leaseUntil: 200 }, 199),
    false,
  );
  assert.equal(
    poolCanRun({ ...state, status: "running", leaseUntil: 200 }, 200),
    true,
  );
  assert.equal(poolCanRun({ ...state, status: "ready" }, 999), false);
  assert.equal(poolCanRun({ ...state, status: "blocked" }, 999), false);
});
test("reviewed next-unit scope stays inside its exact publisher, author, grade and curriculum", () => {
  const math = { ...book, publisher: "비상교육", author: "이진호" };
  assert.deepEqual(reviewedScope(math, math.units[1])?.concepts, [
    "문자의 사용과 식",
    "일차방정식",
  ]);
  assert.equal(
    reviewedScope({ ...math, author: "다른 저자" }, math.units[1]),
    undefined,
  );
  assert.equal(reviewedScope({ ...math, grade: 2 }, math.units[1]), undefined);
  assert.equal(
    reviewedScope({ ...math, curriculum: "2015" }, math.units[1]),
    undefined,
  );
});
