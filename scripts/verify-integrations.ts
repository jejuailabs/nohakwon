import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
loadEnvConfig(path.resolve("apps/web"));
async function main() {
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const {
    saveBook,
    studentFor,
    createAssignment,
    openQuestion,
    answerQuestion,
    assessQuestion,
    queueJob,
    runJob,
    updateSettings,
  } = await import("../apps/web/src/lib/server/workspace");
  const { changeFamilyLink } = await import(
    "../apps/web/src/lib/server/family-links"
  );
  const { applyPayment } = await import(
    "../apps/web/src/lib/server/billing-service"
  );
  const { extractMaterial } = await import("../apps/web/src/lib/server/ai");
  const db = adminDb(),
    uid = `integration-${randomUUID()}`,
    sid = `integration-${randomUUID()}`,
    other = `integration-${randomUUID()}`;
  const student = db.collection("students").doc(sid),
    user = db.collection("users").doc(uid),
    orderRef = db.collection("orders").doc("test-" + sid),
    subRef = db.collection("subscriptions").doc(sid);
  let inviteHash = "";
  let passed = 0;
  const check = (name: string) => {
    passed++;
    console.log("PASS " + name);
  };
  try {
    await student.set({
      guardianUid: uid,
      nickname: "Disposable integration",
      grade: 1,
      createdAt: new Date().toISOString(),
    });
    await user.set({ activeStudentId: sid, role: "guardian" });
    await db.collection("users").doc(other).set({ activeStudentId: sid });
    await assert.rejects(() => studentFor(other));
    check("cross-owner student access blocked");
    const book = await saveBook(uid, {}, undefined, "foundation-math");
    assert.equal(book.id, "foundation-math");
    const [a, b] = await Promise.all([
      createAssignment(uid, { mode: "daily", bookId: book.id }),
      createAssignment(uid, { mode: "daily", bookId: book.id }),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(a.questions.length, 10);
    assert.equal("answer" in a.questions[0], false);
    check("concurrent assignment is idempotent and hides answers");
    const q = a.questions[0];
    await assert.rejects(() =>
      answerQuestion(uid, {
        assignmentId: a.id,
        questionId: q.id,
        answer: 0,
        confidence: "known",
      }),
    );
    check("answer before opening rejected");
    await openQuestion(uid, a.id, q.id);
    await assert.rejects(() =>
      assessQuestion(uid, {
        assignmentId: a.id,
        questionId: q.id,
        confidence: "known",
      }),
    );
    check("understanding cannot be saved before the answer is revealed");
    const assignmentRef = student.collection("assignments").doc(a.id);
    const assignment = (await assignmentRef.get()).data()!;
    await assignmentRef.update({
      opened: {
        ...assignment.opened,
        [q.id]: new Date(Date.now() - 5000).toISOString(),
      },
    });
    const input = {
      assignmentId: a.id,
      questionId: q.id,
      answer: 0,
    };
    const feedbacks = await Promise.all([
      answerQuestion(uid, input),
      answerQuestion(uid, input),
      answerQuestion(uid, input),
    ]);
    assert.deepEqual(feedbacks[0], feedbacks[1]);
    assert.deepEqual(feedbacks[0], feedbacks[2]);
    assert.equal(typeof feedbacks[0].correct, "boolean");
    assert.ok(feedbacks[0].explanation);
    assert.equal("confidence" in feedbacks[0], false);
    assert.equal("points" in feedbacks[0], false);
    assert.equal((await student.collection("attempts").get()).size, 0);
    assert.equal((await student.collection("ledger").get()).size, 0);
    assert.equal(
      (await student.collection("state").doc("learning").get()).exists,
      false,
    );
    assert.equal(
      (await student.collection("days").doc(a.date).get()).data()?.count,
      0,
    );
    check(
      "answer reveals explanation without understanding, progress or rewards",
    );
    assert.deepEqual(
      await answerQuestion(uid, { ...input, answer: 3 }),
      feedbacks[0],
    );
    const resumed = await createAssignment(uid, {
      mode: "daily",
      bookId: book.id,
    });
    assert.deepEqual(resumed.answers[q.id], feedbacks[0]);
    assert.equal(resumed.results[q.id], undefined);
    assert.deepEqual(
      (await openQuestion(uid, a.id, q.id)).answer,
      feedbacks[0],
    );
    check("revealed answer is locked and resumes after reopening");
    const assessment = {
      assignmentId: a.id,
      questionId: q.id,
      confidence: "unknown",
    };
    await assert.rejects(() =>
      assessQuestion(uid, { ...assessment, confidence: "invalid" }),
    );
    // The second phase must use the frozen solving time, not time spent reading.
    await assignmentRef.update({
      opened: {
        ...assignment.opened,
        [q.id]: new Date(Date.now() - 120000).toISOString(),
      },
    });
    const results = await Promise.all([
      assessQuestion(uid, { ...assessment, answer: 3, seconds: 999 }),
      assessQuestion(uid, assessment),
      assessQuestion(uid, assessment),
    ]);
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal(results[0].answer, feedbacks[0].answer);
    assert.equal(results[0].seconds, feedbacks[0].seconds);
    assert.equal(results[0].at, feedbacks[0].at);
    assert.equal(results[0].confidence, "unknown");
    assert.equal(results[0].points, 3);
    assert.equal((await student.collection("attempts").get()).size, 1);
    assert.equal((await student.collection("ledger").get()).size, 1);
    assert.equal(
      (await student.collection("days").doc(a.date).get()).data()?.count,
      1,
    );
    assert.deepEqual(
      await assessQuestion(uid, { ...assessment, confidence: "known" }),
      results[0],
    );
    assert.deepEqual((await openQuestion(uid, a.id, q.id)).result, results[0]);
    check(
      "parallel understanding saves one attempt and reward with locked answer and solving time",
    );
    const isolatedRef = db.collection("students").doc(sid + "-isolated");
    await isolatedRef.set({
      guardianUid: uid,
      createdAt: new Date().toISOString(),
    });
    await user.update({ activeStudentId: isolatedRef.id });
    const isolatedState = await updateSettings(uid, { theme: "dark" });
    assert.equal(Object.keys(isolatedState.concepts).length, 0);
    assert.equal(isolatedState.points, 0);
    await user.update({ activeStudentId: sid });
    check(
      "a second learner starts without another learner's concepts or points",
    );
    await assert.rejects(() => answerQuestion(other, input));
    await assert.rejects(() => assessQuestion(other, assessment));
    check("cross-owner answer and understanding submissions blocked");
    await assert.rejects(() => updateSettings(uid, { cosmetic: "aurora" }));
    check("cosmetic cannot overspend");
    if (process.argv.includes("--learning-only")) {
      console.log("Completed " + passed + " learning integration checks");
      return;
    }
    const source =
      "일차방정식은 미지수의 차수가 1인 방정식이다. 등식의 양변에 같은 수를 더하거나 빼도 등식은 성립한다. 등식의 양변에 0이 아닌 같은 수를 곱하거나 나누어도 등식은 성립한다. 2x + 3 = 11에서 양변에서 3을 빼면 2x = 8이고 양변을 2로 나누면 x = 4이다. 해는 방정식을 참이 되게 하는 미지수의 값이다. 구한 해는 원래 방정식에 대입하여 검산한다. 이항할 때는 항의 부호가 바뀐다.";
    const extracted = await extractMaterial(
      uid,
      "중학교 1학년 수학. 자체 학습 노트. 1단원 일차방정식.\n" + source,
      "content",
    );
    assert.ok(extracted.units.length);
    check("real AI text extraction returns editable units");
    const custom = await saveBook(uid, {
      title: "통합 검증용 자료",
      publisher: "자체 테스트",
      grade: 1,
      subject: "math",
      units: [
        { id: "u1", title: "일차방정식", concepts: ["일차방정식"], source },
      ],
      currentUnit: "u1",
      endUnit: "u1",
      active: true,
    });
    const job = await queueJob(uid, custom.id, "u1");
    await runJob(uid, job.studentId, job.id);
    const result = (await student.collection("jobs").doc(job.id).get()).data()!;
    assert.equal(result.status, "completed", result.error);
    assert.ok(result.accepted > 0);
    console.log(
      JSON.stringify({
        accepted: result.accepted,
        pending: result.rejected,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedUsd: result.estimatedUsd,
      }),
    );
    check("real AI generation and blind recheck persist approved questions");
    const newJob = await queueJob(uid, custom.id, "u1");
    assert.notEqual(newJob.id, job.id);
    check("additional generation can replenish the bank");
    const changed = await saveBook(
      uid,
      { ...custom, currentUnit: "u1" },
      custom.id,
    );
    assert.equal(changed.revision, custom.revision);
    check("range-only update preserves question revision");
    await assert.rejects(() =>
      createAssignment(uid, { mode: "daily", bookId: custom.id }),
    );
    check("daily subject cap applies across multiple textbooks");
    await student.collection("days").doc(a.date).set({
      reserved: 0,
      count: 0,
      points: 0,
      questionIds: [],
      dailySubjects: {},
    });
    const customAssignment = await createAssignment(uid, {
      mode: "daily",
      bookId: custom.id,
    });
    assert.ok(customAssignment.questions.length);
    assert.ok(customAssignment.questions.every((q) => q.bookId === custom.id));
    check("uploaded unit gets only its own verified questions");
    const stored = (
      await student
        .collection("questions")
        .where("bookId", "==", custom.id)
        .get()
    ).docs.map((d) => d.data());
    assert.ok(stored.some((q) => q.kind === "short"));
    check("real mixed generation includes short-answer questions");
    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    await subRef.set({
      uid,
      studentId: sid,
      paidUntil: "",
      test: true,
      cancelAtPeriodEnd: false,
    });
    await orderRef.set({
      uid,
      studentId: sid,
      amount: 5000,
      status: "PENDING",
      periodEnd: future,
      createdAt: new Date().toISOString(),
    });
    const payment = {
      orderId: orderRef.id,
      paymentKey: "synthetic-test-key",
      totalAmount: 5000,
      currency: "KRW",
      status: "DONE",
    };
    await Promise.all([
      applyPayment(payment, orderRef.id),
      applyPayment(payment, orderRef.id),
    ]);
    assert.equal((await student.get()).data()!.paidUntil, future);
    await applyPayment({ ...payment, status: "CANCELED" }, orderRef.id);
    await applyPayment(payment, orderRef.id);
    assert.equal((await orderRef.get()).data()!.status, "CANCELED");
    assert.notEqual((await student.get()).data()!.paidUntil, future);
    check(
      "duplicate payment confirmation and stale webhook cannot resurrect canceled subscription",
    );
    await db.collection("users").doc(other).delete();
    const invite = await changeFamilyLink(uid, undefined, {
      action: "invite",
      email: "synthetic-student@example.invalid",
    });
    inviteHash = (await student.get()).data()!.inviteHash;
    await assert.rejects(() =>
      changeFamilyLink(other, "wrong@example.invalid", {
        action: "redeem",
        code: invite.code,
      }),
    );
    await changeFamilyLink(other, "synthetic-student@example.invalid", {
      action: "redeem",
      code: invite.code,
    });
    await assert.rejects(() => studentFor(other));
    await changeFamilyLink(uid, undefined, { action: "approve", id: other });
    assert.equal((await studentFor(other)).ref.id, sid);
    await assert.rejects(() => studentFor(other, true));
    await changeFamilyLink(uid, undefined, { action: "unlink" });
    await assert.rejects(() => studentFor(other));
    check(
      "student invitation requires matching email and guardian approval, never grants billing access",
    );
    console.log("Completed " + passed + " integration checks");
  } finally {
    await db.recursiveDelete(student);
    await db.recursiveDelete(db.collection("students").doc(sid + "-isolated"));
    await orderRef.delete();
    await subRef.delete();
    if (inviteHash)
      await db.collection("familyInvites").doc(inviteHash).delete();
    await db.collection("linkRateLimits").doc(other).delete();
    await user.delete();
    await db.collection("users").doc(other).delete();
    for (const name of ["aiUsage", "aiQuotas"]) {
      const docs = await db.collection(name).where("uid", "==", uid).get();
      const batch = db.batch();
      docs.docs.forEach((d) => batch.delete(d.ref));
      if (docs.size) await batch.commit();
    }
    console.log("Disposable test data cleaned");
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Integration failed");
  process.exitCode = 1;
});
