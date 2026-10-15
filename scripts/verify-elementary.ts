import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { DecodedIdToken } from "firebase-admin/auth";
import { parseProfileInput } from "../apps/web/src/lib/account";
import type { BankQuestion } from "../apps/web/src/lib/learning";
loadEnvConfig(path.resolve("apps/web"));

async function main() {
  if (!process.argv.includes("--live"))
    throw Error("Use --live for disposable Firebase fixtures.");
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const { saveProfile, readProfile } =
    await import("../apps/web/src/lib/server/profiles");
  const { textbookCatalog } =
    await import("../apps/web/src/lib/server/textbook-catalog");
  const {
    saveBook,
    queueJob,
    runJob,
    createAssignment,
    openQuestion,
    answerQuestion,
    assessQuestion,
  } = await import("../apps/web/src/lib/server/workspace");
  const { identifyTextbook } = await import("../apps/web/src/lib/server/ai");
  const { matchTextbooks, identityFromText } =
    await import("../apps/web/src/lib/matching");
  const db = adminDb(),
    uid = `elementary-check-${randomUUID()}`,
    user = db.collection("users").doc(uid);
  const students: string[] = [];
  let passed = 0;
  const check = (label: string) => {
    passed++;
    console.log("PASS " + label);
  };
  try {
    const catalog = await textbookCatalog();
    assert.equal(
      catalog.filter(
        (b) =>
          b.schoolLevel === "elementary" && !b.id.startsWith("foundation-"),
      ).length,
      33,
    );
    const legacy = db
      .collection("students")
      .doc(`elementary-check-${randomUUID()}`);
    students.push(legacy.id);
    await legacy.set({
      guardianUid: uid,
      nickname: "Disposable legacy",
      grade: 2,
      createdAt: new Date().toISOString(),
    });
    await user.set({ role: "guardian", activeStudentId: legacy.id });
    assert.equal((await readProfile(uid))?.schoolLevel, "middle");
    const legacyBefore = (await legacy.get()).data();
    check(
      "Firebase elementary catalog and legacy middle profile compatibility",
    );

    for (const grade of [4, 5, 6] as const) {
      if (process.argv.includes("--grade5-only") && grade !== 5) continue;
      await user.set({ role: "guardian" });
      const profile = await saveProfile(
        { uid } as DecodedIdToken,
        parseProfileInput({
          nickname: `검증용 초등 ${grade}`,
          schoolLevel: "elementary",
          grade,
          calm: false,
        }),
      );
      students.push(profile.id);
      assert.equal((await readProfile(uid))?.schoolLevel, "elementary");
      assert.equal((await readProfile(uid))?.grade, grade);
      const updated = await saveProfile(
        { uid } as DecodedIdToken,
        parseProfileInput({
          ...{
            nickname: profile.nickname,
            schoolLevel: "elementary",
            grade,
            calm: true,
          },
        }),
      );
      assert.equal(updated.id, profile.id);
      assert.equal((await readProfile(uid))?.calm, true);
      check(
        `grade ${grade} profile creation and settings preserve school level`,
      );

      const selected = matchTextbooks(
        identityFromText(`미래엔 초등 수학 ${grade}-1 (장혜원) 2022 개정`),
        catalog,
      )[0]?.book;
      assert.ok(selected);
      const book = await saveBook(uid, {}, undefined, selected.id, {
        grade: 1,
        schoolLevel: "middle",
        currentUnit: "unit-2",
        endUnit: "unit-3",
      });
      assert.equal(book.schoolLevel, "elementary");
      assert.equal(book.grade, grade);
      assert.equal(book.currentUnit, "unit-2");
      await assert.rejects(() => queueJob(uid, book.id, "unit-2"), /본문/);
      check(
        `grade ${grade} authoritative TOC registration, range and missing-source guard`,
      );

      if (process.argv.includes("--with-ai")) {
        const subject = grade === 5 ? "english" : "math";
        const practice = await saveBook(
          uid,
          {},
          undefined,
          `foundation-elementary-${grade}-${subject}`,
        );
        const job = await queueJob(uid, practice.id, "basics");
        await runJob(uid, job.studentId, job.id);
        const student = db.collection("students").doc(profile.id);
        const result = (
          await student.collection("jobs").doc(job.id).get()
        ).data()!;
        assert.equal(result.status, "completed", result.error);
        const bank = (
          await student
            .collection("questions")
            .where("bookId", "==", practice.id)
            .get()
        ).docs.map((d) => d.data() as BankQuestion);
        assert.ok(
          bank.every(
            (q) =>
              q.schoolLevel === "elementary" &&
              q.grade === grade &&
              q.subject === subject,
          ),
        );
        if (grade === 4)
          assert.ok(
            bank.every(
              (q) => !/방정식|미지수|이항/.test(q.prompt + q.explanation),
            ),
          );
        console.log(
          JSON.stringify({
            grade,
            subject,
            approved: result.accepted,
            pending: result.rejected,
            estimatedUsd: result.estimatedUsd,
            sample: bank.find((q) => q.status === "approved")?.prompt,
            pendingReasons: bank
              .filter((q) => q.status !== "approved")
              .map((q) => ({
                concept: q.concept,
                evidence: q.evidence,
                reason: q.reviewReason,
              })),
          }),
        );
        assert.ok(result.accepted > 0);
        check(
          `grade ${grade} real AI generation and independent answer verification`,
        );
        const assignment = await createAssignment(uid, {
          mode: "daily",
          bookId: practice.id,
        });
        assert.ok(assignment.questions.length);
        assert.ok(
          assignment.questions.every(
            (q) => q.bookId === practice.id && !("answer" in q),
          ),
        );
        const question = assignment.questions[0];
        const answer = bank.find((q) => q.id === question.id)!.answer;
        await openQuestion(uid, assignment.id, question.id);
        await assert.rejects(() =>
          assessQuestion(uid, {
            assignmentId: assignment.id,
            questionId: question.id,
            confidence: "known",
          }),
        );
        const feedback = await answerQuestion(uid, {
          assignmentId: assignment.id,
          questionId: question.id,
          answer,
        });
        assert.equal(feedback.correct, true);
        assert.ok(feedback.explanation);
        assert.equal((await student.collection("attempts").get()).size, 0);
        const assessment = await assessQuestion(uid, {
          assignmentId: assignment.id,
          questionId: question.id,
          confidence: "known",
        });
        assert.equal(assessment.correct, true);
        assert.equal((await student.collection("attempts").get()).size, 1);
        check(
          `grade ${grade} own questions -> answer/explanation -> understanding -> stored attempt`,
        );
      }
    }
    assert.deepEqual(
      (await db.collection("students").doc(students[0]).get()).data(),
      legacyBefore,
    );
    check("elementary learners leave existing middle-school data unchanged");
    if (process.argv.includes("--with-ai")) {
      const identity = await identifyTextbook(
        uid,
        "초등학교 국어 4-1 가 / 교육부 / 2022 개정 교육과정",
      );
      assert.equal(identity.schoolLevel, "elementary");
      assert.equal(identity.grade, 4);
      assert.deepEqual(
        matchTextbooks(identity, catalog).map((m) => m.book.id),
        ["national-elementary-2022-1540"],
      );
      check("real AI elementary identification retains Korean split volume");
    }
    console.log(`Completed ${passed} elementary integration checks`);
  } finally {
    for (const sid of students)
      await db.recursiveDelete(db.collection("students").doc(sid));
    await user.delete();
    for (const collection of ["aiUsage", "aiQuotas"]) {
      const docs = await db
        .collection(collection)
        .where("uid", "==", uid)
        .get();
      if (docs.size) {
        const batch = db.batch();
        docs.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    console.log("Disposable elementary test fixtures cleaned");
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
