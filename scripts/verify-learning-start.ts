import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { Book } from "../apps/web/src/lib/learning";
loadEnvConfig(path.resolve("apps/web"));
async function main() {
  if (process.env.FIREBASE_ADMIN_PROJECT_ID !== "barum-10aad")
    throw Error("Unexpected test project");
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const { saveBook, addCatalogBooks, runJob } =
    await import("../apps/web/src/lib/server/workspace");
  const { startLearning } =
    await import("../apps/web/src/lib/server/learning-start");
  const { resolveLearningMaterial } =
    await import("../apps/web/src/lib/server/learning-material");
  const { aiConfigured } = await import("../apps/web/src/lib/server/ai");
  const { entitlement } = await import("../apps/web/src/lib/server/workspace");
  const { canPrepareCurriculum } =
    await import("../apps/web/src/lib/learning-material");
  const { learningUnit, DEFAULT_STATE } =
    await import("../apps/web/src/lib/learning");
  assert.ok(
    aiConfigured(),
    "Live catalog learning requires the configured OpenAI key",
  );
  const { PUBLISHER_CATALOG } = await import("../apps/web/src/lib/catalog");
  const db = adminDb(),
    uid = `launch-${randomUUID()}`,
    sid = `launch-${randomUUID()}`;
  const ref = db.collection("students").doc(sid);
  try {
    await ref.set({
      guardianUid: uid,
      nickname: "Disposable learning start",
      grade: 1,
      createdAt: new Date().toISOString(),
    });
    await db.collection("users").doc(uid).set({ activeStudentId: sid });
    const custom = await saveBook(uid, {
      title: "목차만 등록한 자체 자료",
      publisher: "직접 등록",
      subject: "math",
      grade: 1,
      units: [
        {
          id: "unit-1",
          title: "자료 확인",
          concepts: ["자료 확인"],
          source: "",
        },
      ],
      currentUnit: "unit-1",
      endUnit: "unit-1",
      active: true,
    });
    await assert.rejects(
      () =>
        startLearning(uid, {
          action: "start",
          mode: "daily",
          bookId: custom.id,
        }),
      /본문 사진/,
    );
    assert.equal((await ref.collection("jobs").get()).size, 0);
    console.log(
      "PASS an unverified custom TOC requests its body explicitly without fabricating questions",
    );
    const requested = (
      process.argv.find((a) => a.startsWith("--subjects="))?.split("=")[1] ?? ""
    )
      .split(",")
      .filter(Boolean);
    const selected = PUBLISHER_CATALOG.filter(
      (b) =>
        (b.publisher === "해냄에듀" &&
          b.subject === "korean" &&
          b.volume === "1-1" &&
          b.grade === 1) ||
        b.id === "visang-2022-B0318" ||
        (process.argv.includes("--all-subjects") &&
          (b.id === "visang-2022-B0319" ||
            b.id === "visang-2022-B0317" ||
            b.id === "visang-2022-B0309")),
    )
      .filter((b) => !requested.length || requested.includes(b.subject))
      .sort(
        (a, b) =>
          (a.subject === "korean" ? -1 : 1) - (b.subject === "korean" ? -1 : 1),
      );
    assert.equal(
      selected.length,
      requested.length || (process.argv.includes("--all-subjects") ? 5 : 2),
    );
    for (const canonical of selected) {
      const saved = await addCatalogBooks(uid, [
        {
          catalogId: canonical.id,
          selection: { currentUnit: "unit-1", endUnit: "unit-1" },
        },
      ]);
      const book = saved.books[0] as Book;
      assert.equal(book.origin, "catalog");
      assert.ok(book.catalogId);
      assert.ok(book.units.some((u) => u.id === book.currentUnit));
      assert.ok(canPrepareCurriculum(book));
      assert.equal(entitlement((await ref.get()).data()!).status, "trial");
      assert.ok(
        learningUnit(book, DEFAULT_STATE, 3, { plans: [], skills: [] }),
      );
      const request = {
        action: "start",
        mode: "daily",
        bookId: book.id,
        requestId: randomUUID(),
      };
      const preparing = await startLearning(uid, request);
      assert.equal(preparing.status, 202);
      assert.ok("preparing" in preparing.payload);
      assert.equal(preparing.jobs.length, 1);
      const again = await startLearning(uid, request);
      assert.equal(again.jobs[0].id, preparing.jobs[0].id);
      assert.equal(
        (await ref.collection("jobs").where("bookId", "==", book.id).get())
          .size,
        1,
      );
      console.log(
        `PASS ${book.subject}: first start returns preparation; repeat requests share one job`,
      );
      await runJob(uid, sid, preparing.jobs[0].id);
      const job = (
        await ref.collection("jobs").doc(preparing.jobs[0].id).get()
      ).data()!;
      assert.equal(job.status, "completed", `${book.subject}: ${job.error}`);
      if (!job.accepted) {
        const generated = await ref
          .collection("questions")
          .where("bookId", "==", book.id)
          .get();
        console.log(
          "Pending checks",
          generated.docs.map((d) => ({
            concept: d.data().concept,
            type: d.data().skillType,
            reason: d.data().reviewReason,
          })),
        );
      }
      assert.ok(job.accepted > 0, `${book.subject}: no approved questions`);
      const ready = await startLearning(uid, request);
      assert.equal(ready.status, 200);
      assert.ok("questions" in ready.payload);
      if (!("questions" in ready.payload)) throw Error("No assignment");
      assert.ok(ready.payload.questions.length > 0);
      assert.ok(
        ready.payload.questions.every(
          (q) =>
            q.sourceKind === "curriculum" &&
            q.references?.length &&
            !("answer" in q) &&
            !("explanation" in q),
        ),
      );
      const original = (
        await ref.collection("books").doc(book.id).get()
      ).data() as Book;
      assert.equal(original.units[0].source, "");
      const resume = await startLearning(uid, request);
      assert.equal(resume.status, 200);
      assert.equal(resume.jobs.length, 0);
      assert.equal((resume.payload as any).id, ready.payload.id);
      await assert.rejects(
        () =>
          resolveLearningMaterial(uid, ref, book, {
            ...book.units[0],
            title: "확인되지 않은 사용자 변경 제목",
          }),
        /본문/,
      );
      const withBody = await resolveLearningMaterial(uid, ref, book, {
        ...book.units[0],
        source: "사용자가 제공한 실제 학습 본문",
      });
      assert.equal(withBody.provenance.sourceKind, "uploaded");
      assert.equal(withBody.unit.source, "사용자가 제공한 실제 학습 본문");
      console.log(
        `PASS ${book.subject}: real source search, independent material review and question checks produce ${job.accepted} approved / ${job.rejected} pending; assignment resumes without answers or extra generation`,
      );
    }
  } finally {
    await db.recursiveDelete(ref);
    await db.collection("users").doc(uid).delete();
    for (const name of ["aiUsage", "aiQuotas"]) {
      const rows = await db.collection(name).where("uid", "==", uid).get();
      await Promise.all(rows.docs.map((d) => d.ref.delete()));
    }
    console.log(
      "Disposable learning-start fixtures cleaned. No learner answers or progress changed.",
    );
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Verification failed");
  process.exitCode = 1;
});
