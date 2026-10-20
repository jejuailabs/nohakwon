import { loadEnvConfig } from "@next/env";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Book, BankQuestion, Unit } from "../apps/web/src/lib/learning";
import type { CatalogPool } from "../apps/web/src/lib/catalog-preparation";
loadEnvConfig(path.resolve("apps/web"));
async function main() {
  if (process.env.FIREBASE_ADMIN_PROJECT_ID !== "barum-10aad")
    throw Error("Unexpected project");
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const { AccountError } = await import("../apps/web/src/lib/account");
  const {
    enqueueCatalogUnit,
    runCatalogPoolStep,
    catalogPoolQuestions,
    hydrateCatalogUnit,
    prepareCatalogLearning,
    prefetchFollowingCatalogUnits,
    requestMoreCatalogQuestions,
  } = await import("../apps/web/src/lib/server/catalog-preparation");
  const { createAssignment } = await import(
    "../apps/web/src/lib/server/workspace"
  );
  const db = adminDb(),
    fixtureId = `pool-test-${randomUUID()}`,
    keys = new Set<string>(),
    students: string[] = [],
    users: string[] = [];
  const book: Book = {
    id: fixtureId,
    catalogId: fixtureId,
    title: "공용 문제은행 통합 검증용 임시 교재",
    publisher: "Disposable integration fixture",
    grade: 1,
    subject: "math",
    revision: 1,
    origin: "catalog",
    units: Array.from({ length: 4 }, (_, i) => ({
      id: `u${i + 1}`,
      title: `임시 단원 ${i + 1}`,
      concepts: ["A", "B"],
      source: "",
    })),
    currentUnit: "u1",
    endUnit: "u1",
    active: true,
    createdAt: new Date().toISOString(),
  };
  let generated = 0,
    materialCalls = 0;
  const api = {
    catalog: async (key: string) => (key === fixtureId ? book : undefined),
    material: async (_uid: string, _ref: unknown, _book: Book, unit: Unit) => {
      materialCalls++;
      return {
        unit: {
          ...unit,
          source:
            "통합 검증용 자체 개념 설명 A와 B. 실제 학습자에게 배포하지 않는 임시 자료.",
        },
        provenance: {
          sourceKind: "curriculum" as const,
          references: [
            { title: "Disposable reference", url: "https://www.ebs.co.kr" },
          ],
        },
      };
    },
    plan: async (_uid: string, b: Book, u: Unit) => ({
      id: "fixture-plan",
      bookId: b.id,
      unitId: u.id,
      revision: 1,
      skills: [
        { concept: "A", type: "기본 확인" },
        { concept: "B", type: "적용" },
      ],
      origin: "ai" as const,
      createdAt: new Date().toISOString(),
    }),
    questions: async (
      _uid: string,
      b: Book,
      u: Unit,
      request?: {
        targets: { concept: string; type: string }[];
        exclude: string[];
      },
    ) => {
      generated++;
      return {
        questions: request!.targets.map(
          (s, i): BankQuestion => ({
            id: randomUUID(),
            bookId: b.id,
            unitId: u.id,
            subject: b.subject,
            grade: b.grade,
            concept: s.concept,
            skillType: s.type,
            prompt: `임시 확인 ${randomUUID()} ${generated * 100 + i}`,
            choices: ["A", "B", "C", "D"],
            answer: 0,
            kind: "mcq",
            explanation: "임시 설명",
            evidence: "A와 B",
            difficulty: 2,
            variant: randomUUID(),
            expectedSeconds: 30,
            status: generated === 1 && i === 0 ? "pending" : "approved",
            origin: "ai",
            revision: 1,
          }),
        ),
        usage: { inputTokens: 1, outputTokens: 1, estimatedUsd: 0 },
      };
    },
  };
  const state = async (key: string) =>
    (await db.collection("catalogPools").doc(key).get()).data() as CatalogPool;
  const queue = async (unit: Unit) => {
    const key = await enqueueCatalogUnit(book, unit);
    keys.add(key);
    return key;
  };
  try {
    const concurrent = await Promise.all(
        Array.from({ length: 12 }, () => queue(book.units[0])),
      ),
      key = concurrent[0];
    assert.equal(new Set(concurrent).size, 1);
    console.log(
      "PASS concurrent registrations share one public job and one target",
    );

    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runCatalogPoolStep(key, 0, {
      ...api,
      material: async (...args) => {
        started();
        await gate;
        return api.material(args[0], args[1], args[2], args[3]);
      },
    });
    await entered;
    assert.equal(await runCatalogPoolStep(key, 0, api), "busy");
    release();
    await first;
    assert.equal(materialCalls, 1);
    assert.equal((await state(key)).phase, "plan");
    assert.equal(await runCatalogPoolStep(key, 0, api), "stale");
    console.log(
      "PASS live lease prevents duplicate AI work; repeated deliveries resume the checkpoint",
    );

    await runCatalogPoolStep(key, undefined, api);
    await runCatalogPoolStep(key, undefined, api);
    assert.equal((await state(key)).approved, 7);
    assert.notEqual((await state(key)).status, "ready");
    await runCatalogPoolStep(key, undefined, api);
    assert.equal((await state(key)).approved, 10);
    assert.equal((await state(key)).status, "ready");
    assert.equal(
      (await catalogPoolQuestions(key)).filter((q) => q.status === "pending")
        .length,
      1,
    );
    console.log(
      "PASS unapproved questions stay pending; top-up reaches ten independently approved questions",
    );

    const assignments: Awaited<ReturnType<typeof createAssignment>>[] = [];
    for (let n = 0; n < 2; n++) {
      const uid = `pool-user-${randomUUID()}`,
        sid = `pool-student-${randomUUID()}`;
      users.push(uid);
      students.push(sid);
      const ref = db.collection("students").doc(sid);
      await ref.set({
        guardianUid: uid,
        nickname: "Disposable pool verification",
        grade: 1,
        createdAt: new Date().toISOString(),
      });
      await db.collection("users").doc(uid).set({ activeStudentId: sid });
      await ref.collection("books").doc(book.id).set(book);
      await hydrateCatalogUnit(ref, book, book.units[0], book);
      await prepareCatalogLearning(ref, book.id, undefined, api.catalog);
      const assignment = await createAssignment(uid, {
        mode: "daily",
        bookId: book.id,
        requestId: randomUUID(),
      });
      assignments.push(assignment);
      assert.ok(assignment.questions.length > 0);
      assert.ok(assignment.questions.every((q) => !("answer" in q)));
      assert.equal((await ref.collection("attempts").get()).size, 0);
      assert.equal(
        (await ref.collection("books").doc(book.id).get()).data()!.units[0]
          .source,
        "",
      );
    }
    assert.ok(
      assignments[0].questions.some((q) =>
        assignments[1].questions.some((other) => q.id === other.id),
      ),
    );
    const extra = await createAssignment(users[0], {
      mode: "extra",
      bookId: book.id,
      unitId: "u1",
      requestId: randomUUID(),
    });
    assert.ok(
      extra.questions.every(
        (q) => !assignments[0].questions.some((old) => q.id === old.id),
      ),
    );
    console.log(
      "PASS two learners reuse shared stock; personal exposures exclude duplicates without changing attempts or rewards",
    );

    const sid = students[0],
      ref = db.collection("students").doc(sid);
    const next = await prefetchFollowingCatalogUnits(
      ref,
      assignments[0].questions,
      api.catalog,
    );
    assert.equal(next.length, 1);
    keys.add(next[0]);
    assert.equal((await state(next[0])).unitId, "u2");
    assert.deepEqual(
      await prefetchFollowingCatalogUnits(
        ref,
        assignments[0].questions,
        api.catalog,
      ),
      next,
    );
    const personalBook = (
      await ref.collection("books").doc(book.id).get()
    ).data()!;
    assert.equal(personalBook.currentUnit, "u1");
    assert.equal(personalBook.endUnit, "u1");
    assert.equal((await ref.collection("skillProgress").get()).size, 0);
    console.log(
      "PASS entering a unit queues only the next unit once, without advancing personal curriculum or mastery",
    );

    const demand = randomUUID();
    const ready = await state(key);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        requestMoreCatalogQuestions(sid, [ready], demand),
      ),
    );
    assert.equal((await state(key)).target, 20);
    assert.equal(
      (await db.collection("catalogDemands").where("poolId", "==", key).get())
        .size,
      1,
    );
    while ((await state(key)).status === "queued")
      await runCatalogPoolStep(key, undefined, api);
    assert.equal((await state(key)).approved, 20);
    await requestMoreCatalogQuestions(sid, [await state(key)], demand);
    assert.equal((await state(key)).target, 20);
    console.log(
      "PASS concurrent stock requests share one top-up; repeating a completed request does not spend again",
    );

    const second = next[0];
    await runCatalogPoolStep(second, undefined, {
      ...api,
      material: async () => {
        throw new AccountError(504, "Disposable timeout");
      },
    });
    assert.equal((await state(second)).status, "queued");
    assert.equal((await state(second)).failures, 1);
    assert.equal(await runCatalogPoolStep(second, undefined, api), "busy");
    await db.collection("catalogPools").doc(second).update({ retryAt: 0 });
    await runCatalogPoolStep(second, undefined, api);
    assert.equal((await state(second)).phase, "plan");
    console.log(
      "PASS transient errors retain the checkpoint and respect retry backoff",
    );

    let releasePlan!: () => void, planStarted!: () => void;
    const planGate = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });
    const planEntered = new Promise<void>((resolve) => {
      planStarted = resolve;
    });
    const staleWorker = runCatalogPoolStep(second, undefined, {
      ...api,
      plan: async (...args) => {
        planStarted();
        await planGate;
        return {
          ...(await api.plan(args[0], args[1], args[2])),
          createdAt: "stale-worker",
        };
      },
    });
    await planEntered;
    await db.collection("catalogPools").doc(second).update({ leaseUntil: 0 });
    await runCatalogPoolStep(second, undefined, {
      ...api,
      plan: async (...args) => ({
        ...(await api.plan(args[0], args[1], args[2])),
        createdAt: "recovered-worker",
      }),
    });
    releasePlan();
    await staleWorker;
    assert.equal((await state(second)).plan!.createdAt, "recovered-worker");
    console.log(
      "PASS an expired worker cannot overwrite a recovered worker's committed result",
    );

    const blocked = await queue(book.units[2]);
    await runCatalogPoolStep(blocked, undefined, {
      ...api,
      material: async () => {
        throw new AccountError(422, "Disposable unverified scope");
      },
    });
    assert.equal((await state(blocked)).status, "blocked");
    assert.equal((await catalogPoolQuestions(blocked)).length, 0);
    assert.equal(await runCatalogPoolStep(blocked, undefined, api), "done");
    const failed = await queue(book.units[3]);
    for (let n = 0; n < 3; n++) {
      await db.collection("catalogPools").doc(failed).update({ retryAt: 0 });
      await runCatalogPoolStep(failed, undefined, {
        ...api,
        material: async () => {
          throw new AccountError(503, "Disposable provider outage");
        },
      });
    }
    assert.equal((await state(failed)).status, "failed");
    console.log(
      "PASS unverified scopes never publish; repeated service failures stop after the bounded retry count",
    );

    if (process.argv.includes("--with-ai")) {
      const { catalogTextbook } = await import(
        "../apps/web/src/lib/server/textbook-catalog"
      );
      const { startLearning } = await import(
        "../apps/web/src/lib/server/learning-start"
      );
      const canonical = await catalogTextbook("visang-2022-B0318");
      assert.ok(canonical);
      const realBook = { ...canonical, catalogId: canonical.id };
      const realKey = await enqueueCatalogUnit(realBook, realBook.units[0], 2);
      async function finish(poolId: string) {
        for (
          let n = 0;
          n < 18 &&
          ["queued", "running"].includes((await state(poolId)).status);
          n++
        ) {
          const pool = await state(poolId);
          if (pool.retryAt > Date.now()) {
            console.log(`LIVE retry backoff: ${pool.error}`);
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(pool.retryAt - Date.now(), 60000)),
            );
            continue;
          }
          await runCatalogPoolStep(poolId);
          console.log(
            `LIVE ${pool.bookTitle} ${pool.unitTitle}: ${(await state(poolId)).phase}, ${(await state(poolId)).approved} approved`,
          );
        }
        const completed = await state(poolId);
        assert.equal(completed.status, "ready", completed.error);
        assert.ok(completed.approved >= 10);
      }
      await finish(realKey);
      const uid = `pool-user-${randomUUID()}`,
        studentId = `pool-student-${randomUUID()}`;
      users.push(uid);
      students.push(studentId);
      const learner = db.collection("students").doc(studentId);
      await learner.set({
        guardianUid: uid,
        nickname: "Disposable real preparation",
        grade: 1,
        createdAt: new Date().toISOString(),
      });
      await db.collection("users").doc(uid).set({ activeStudentId: studentId });
      await learner.collection("books").doc(realBook.id).set(realBook);
      const result = await startLearning(uid, {
        mode: "daily",
        bookId: realBook.id,
        requestId: randomUUID(),
      });
      assert.equal(result.status, 200);
      assert.equal(result.jobs.length, 0);
      assert.ok(
        "questions" in result.payload && result.payload.questions.length > 0,
      );
      const nextKey = result.catalogJobs.find((k) => k !== realKey);
      assert.ok(
        nextKey,
        "entering a real prepared unit must queue its next unit",
      );
      if (["blocked", "failed"].includes((await state(nextKey)).status))
        await enqueueCatalogUnit(realBook, realBook.units[1], 1, true);
      assert.equal((await learner.collection("attempts").get()).size, 0);
      console.log(
        "PASS LIVE prepared official textbook starts immediately without another AI batch; next unit queued without a browser",
      );
      await finish(nextKey);
      console.log(
        "PASS LIVE next unit reaches ten independently validated questions using source-based AI generation",
      );
    }
  } finally {
    for (const key of keys) {
      const qs = await db
        .collection("questionBank")
        .where("poolId", "==", key)
        .get();
      const demands = await db
        .collection("catalogDemands")
        .where("poolId", "==", key)
        .get();
      for (const d of [...qs.docs, ...demands.docs]) await d.ref.delete();
      await db.recursiveDelete(db.collection("catalogPools").doc(key));
    }
    for (const sid of students)
      await db.recursiveDelete(db.collection("students").doc(sid));
    for (const uid of users) await db.collection("users").doc(uid).delete();
    console.log(
      "Disposable public-pool fixtures cleaned; existing learner histories were not edited.",
    );
  }
}
main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
