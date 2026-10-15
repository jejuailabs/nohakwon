import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { addDays, seoulDate } from "../packages/core/src";
import {
  conceptKey,
  type BankQuestion,
  type Result,
} from "../apps/web/src/lib/learning";
import {
  nextLearningUnit,
  unitCoverage,
  skillIdentity,
  type SkillProgress,
  type UnitPlan,
} from "../apps/web/src/lib/adaptive-learning";
loadEnvConfig(path.resolve("apps/web"));
async function main() {
  if (process.env.FIREBASE_ADMIN_PROJECT_ID !== "barum-10aad")
    throw Error("Unexpected test project");
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const {
    createAssignment,
    saveBook,
    openQuestion,
    answerQuestion,
    assessQuestion,
    studentFor,
    queueJob,
    runJob,
  } = await import("../apps/web/src/lib/server/workspace");
  const {
    fingerprint,
    identityHash,
    ensureExposureIndex,
    historyPage,
    loadAdaptive,
  } = await import("../apps/web/src/lib/server/adaptive");
  const db = adminDb(),
    uid = `adaptive-${randomUUID()}`,
    sid = `adaptive-${randomUUID()}`,
    other = `adaptive-${randomUUID()}`;
  const ref = db.collection("students").doc(sid),
    user = db.collection("users").doc(uid),
    date = seoulDate();
  const source =
    "등식의 성질: 등식의 양변에 같은 수를 더하거나 빼도 등식은 성립한다. 양변에 0이 아닌 같은 수를 곱하거나 나누어도 등식은 성립한다. 일차방정식의 해는 방정식을 참이 되게 하는 미지수의 값이다. 2x + 3 = 11에서 양변에서 3을 빼면 2x = 8이며 양변을 2로 나누면 x = 4이다. 구한 해는 원래 방정식에 대입하여 검산한다.";
  try {
    await ref.set({
      guardianUid: uid,
      nickname: "Disposable adaptive verification",
      grade: 1,
      createdAt: new Date().toISOString(),
    });
    await user.set({ activeStudentId: sid });
    await db.collection("users").doc(other).set({ activeStudentId: sid });
    await assert.rejects(() => studentFor(other));
    const book = await saveBook(uid, {
      title: "적응 출제 검증 자료",
      publisher: "자체 합성 자료",
      grade: 1,
      subject: "math",
      units: [
        { id: "u1", title: "방정식", concepts: ["등식"], source },
        { id: "u2", title: "다음 단원", concepts: ["다음 개념"], source },
      ],
      currentUnit: "u1",
      endUnit: "u2",
      active: true,
    });
    const plan: UnitPlan = {
      id: identityHash(`${book.id}:u1:1`),
      bookId: book.id,
      unitId: "u1",
      revision: 1,
      skills: [
        { concept: "등식", type: "기본 이해" },
        { concept: "등식", type: "적용" },
      ],
      origin: "editor",
      createdAt: new Date().toISOString(),
    };
    await ref.collection("unitPlans").doc(plan.id).set(plan);
    const bank: BankQuestion[] = Array.from({ length: 80 }, (_, i) => ({
      id: `q-${i}`,
      bookId: book.id,
      unitId: "u1",
      concept: "등식",
      skillType: i % 2 ? "적용" : "기본 이해",
      revision: 1,
      subject: "math",
      grade: 1,
      prompt: `x + ${i + 3} = ${i + 5}의 해는?`,
      choices: ["0", "1", "2", "3"],
      answer: 2,
      explanation: "양변에서 같은 수를 빼면 x = 2이다.",
      evidence: "등식의 양변에 같은 수를 더하거나 빼도 등식은 성립한다.",
      difficulty: 2,
      variant: `v-${i}`,
      expectedSeconds: 30,
      status: "approved",
      origin: "editor",
    }));
    const batch = db.batch();
    bank.forEach((q) => batch.set(ref.collection("questions").doc(q.id), q));
    batch.set(ref.collection("questions").doc("same-content-new-id"), {
      ...bank[0],
      id: "same-content-new-id",
      choices: bank[0].choices.slice().reverse(),
    });
    await batch.commit();
    const old = (q: BankQuestion, id: string): Result => ({
      id,
      questionId: q.id,
      bookId: book.id,
      unitId: "u1",
      concept: "등식",
      subject: "math",
      date: "2025-01-01",
      at: "2025-01-01T03:00:00.000Z",
      answer: 2,
      correctAnswer: 2,
      correct: true,
      confidence: "known",
      seconds: 30,
      points: 0,
      interval: 4,
      dueDate: "2025-01-05",
      mode: "daily",
      prompt: q.prompt,
      choices: q.choices,
      explanation: q.explanation,
      reason: "preserve-me",
      bookmarked: false,
    });
    const legacy = old(bank[0], "legacy-old");
    await ref.collection("attempts").doc(legacy.id).set(legacy);
    const older = db.batch();
    for (let i = 0; i < 61; i++)
      older.set(
        ref.collection("attempts").doc(`legacy-${i}`),
        old(
          { ...bank[0], id: `archived-${i}`, prompt: `예전 학습 문제 ${i}` },
          `legacy-${i}`,
        ),
      );
    await older.commit();
    await ref
      .collection("assignments")
      .doc("legacy-unassessed")
      .set({
        id: "legacy-unassessed",
        date: "2025-01-01",
        mode: "daily",
        questions: [bank[1]],
        opened: { [bank[1].id]: "2025-01-01T03:00:00.000Z" },
        answers: {
          [bank[1].id]: {
            answer: 0,
            correctAnswer: 2,
            correct: false,
            explanation: bank[1].explanation,
            seconds: 30,
            at: "2025-01-01T03:01:00.000Z",
          },
        },
        results: {},
        createdAt: "2025-01-01T03:00:00.000Z",
      });
    await ensureExposureIndex(ref);
    assert.deepEqual(
      (await ref.collection("attempts").doc(legacy.id).get()).data(),
      legacy,
    );
    let page = await historyPage(
        ref,
        new URLSearchParams({ date: "2025-01-01" }),
      ),
      entries = page.attempts;
    while (page.nextCursor) {
      page = await historyPage(
        ref,
        new URLSearchParams({ date: "2025-01-01", cursor: page.nextCursor }),
      );
      entries.push(...page.attempts);
    }
    assert.equal(entries.length, 63);
    assert.equal(new Set(entries.map((e) => e.id)).size, 63);
    assert.ok(entries.some((e) => e.phase === "awaiting-understanding"));
    console.log(
      "PASS paginated legacy history and unassessed answers migrate without changing original attempts",
    );
    const [a, replay] = await Promise.all([
      createAssignment(uid, { mode: "daily", bookId: book.id }),
      createAssignment(uid, { mode: "daily", bookId: book.id }),
    ]);
    assert.equal(a.id, replay.id);
    assert.ok(a.questions.length > 0 && a.questions.length <= 10);
    assert.ok(
      a.questions.every(
        (q) => ![bank[0].id, bank[1].id, "same-content-new-id"].includes(q.id),
      ),
    );
    assert.ok(
      a.questions.every(
        (q) => !("answer" in q) && q.selectionReason?.code === "new-coverage",
      ),
    );
    console.log(
      "PASS all-time identity and reordered-option duplicates excluded; concurrent daily sessions resume safely",
    );
    async function solve(
      assignment: typeof a,
      questionId: string,
      answer: number,
      confidence: "known" | "unknown",
    ) {
      await openQuestion(uid, assignment.id, questionId);
      const ar = ref.collection("assignments").doc(assignment.id),
        data = (await ar.get()).data()!;
      await ar.update({
        opened: {
          ...data.opened,
          [questionId]: new Date(Date.now() - 5000).toISOString(),
        },
      });
      await answerQuestion(uid, {
        assignmentId: assignment.id,
        questionId,
        answer,
      });
      return assessQuestion(uid, {
        assignmentId: assignment.id,
        questionId,
        confidence,
      });
    }
    const q = a.questions[0];
    await openQuestion(uid, a.id, q.id);
    await answerQuestion(uid, {
      assignmentId: a.id,
      questionId: q.id,
      answer: 0,
    });
    const pending = await historyPage(ref, new URLSearchParams({ date }));
    assert.ok(
      pending.attempts.some(
        (r) => r.questionId === q.id && r.phase === "awaiting-understanding",
      ),
    );
    const first = await assessQuestion(uid, {
      assignmentId: a.id,
      questionId: q.id,
      confidence: "unknown",
    });
    assert.equal(first.reviewChange?.nextMastery, "needs-work");
    assert.equal(first.dueDate, addDays(date, 1));
    const otherType = a.questions.find((n) => n.skillType !== q.skillType)!;
    assert.ok(otherType);
    const otherResult = await solve(a, otherType.id, 2, "known");
    assert.ok(otherResult.dueDate > first.dueDate);
    const stateRef = ref.collection("state").doc("learning"),
      state = (await stateRef.get()).data()!;
    assert.equal(state.concepts[conceptKey(q)].dueDate, first.dueDate);
    const weakSkillId = identityHash(
      skillIdentity(book.id, q.unitId, 1, {
        concept: q.concept,
        type: q.skillType!,
      }),
    );
    await ref
      .collection("skillProgress")
      .doc(weakSkillId)
      .update({
        dueDate: addDays(date, 30),
        interval: 30,
      });
    state.concepts[conceptKey(q)].dueDate = addDays(date, 30);
    await stateRef.set(state);
    const reinforced = await createAssignment(uid, {
      mode: "reinforce",
      bookId: book.id,
      concept: q.concept,
      skillType: q.skillType,
      requestId: "reinforcement-check",
    });
    assert.ok(reinforced.questions.length);
    assert.ok(
      reinforced.questions.every(
        (n) =>
          n.id !== q.id &&
          n.selectionReason?.triggerAttemptId === first.id &&
          n.selectionReason.code === "weakness",
      ),
    );
    await assert.rejects(() =>
      createAssignment(uid, { mode: "review", bookId: book.id }),
    );
    console.log(
      "PASS pending answer retained; another type cannot postpone weak-type review; fresh reinforcement works before its due date",
    );
    const r2 = await solve(reinforced, reinforced.questions[0].id, 2, "known");
    assert.equal(r2.reviewChange?.previousDue, addDays(date, 30));
    assert.ok(r2.reviewChange?.nextDue);
    const previousState = (await stateRef.get()).data();
    const practice = await createAssignment(uid, {
      mode: "practice",
      bookId: book.id,
      questionId: q.id,
    });
    assert.equal(practice.questions[0].selectionReason?.code, "manual-repeat");
    await solve(practice, q.id, 2, "known");
    assert.deepEqual(
      (await stateRef.get()).data()!.concepts,
      previousState!.concepts,
    );
    console.log(
      "PASS causal review before/after snapshots retained; intentional retries cannot advance mastery or postpone review",
    );
    const extra = await createAssignment(uid, {
      mode: "extra",
      bookId: book.id,
      unitId: "u1",
      requestId: "extra-check",
    });
    assert.equal(
      (
        await createAssignment(uid, {
          mode: "extra",
          bookId: book.id,
          unitId: "u1",
          requestId: "extra-check",
        })
      ).id,
      extra.id,
    );
    const priorIds = new Set(
      [...a.questions, ...reinforced.questions].map((q) => q.id),
    );
    assert.ok(extra.questions.every((q) => !priorIds.has(q.id)));
    const races = await Promise.allSettled([
      createAssignment(uid, {
        mode: "extra",
        bookId: book.id,
        unitId: "u1",
        requestId: "race-a",
      }),
      createAssignment(uid, {
        mode: "extra",
        bookId: book.id,
        unitId: "u1",
        requestId: "race-b",
      }),
    ]);
    const assigned = races.flatMap((r) =>
      r.status === "fulfilled" ? r.value.questions : [],
    );
    assert.equal(
      new Set(assigned.map((q) => fingerprint(q))).size,
      assigned.length,
    );
    console.log(
      "PASS extra unit sessions are idempotent and cross-session reservations cannot duplicate content",
    );
    const yesterday = addDays(date, -1);
    for (const type of ["기본 이해", "적용"]) {
      const id = identityHash(
        skillIdentity(book.id, "u1", 1, { concept: "등식", type }),
      );
      const p: SkillProgress = {
        id,
        bookId: book.id,
        unitId: "u1",
        revision: 1,
        concept: "등식",
        type,
        attempts: 3,
        evidence: [0, 1, 2].map((n) => ({
          questionId: `earlier-${type}-${n}`,
          fingerprint: `earlier-${type}-${n}`,
          date: yesterday,
          at: `${yesterday}T03:00:00.000Z`,
          correct: true,
          confidence: "known",
          seconds: 30,
          mode: "daily",
        })),
        status: type === "적용" ? "secure" : "awaiting-check",
        lastAttemptId: first.id,
        lastAt: `${yesterday}T03:00:00.000Z`,
        firstSecuredAt: type === "적용" ? `${yesterday}T03:00:00.000Z` : "",
      };
      await ref.collection("skillProgress").doc(id).set(p);
    }
    const confirm = extra.questions.filter((q) => q.skillType === "기본 이해");
    assert.ok(confirm.length >= 2);
    const confirmed = await solve(extra, confirm[0].id, 2, "known");
    assert.equal(confirmed.reviewChange?.nextMastery, "secure");
    assert.equal(nextLearningUnit(book, await loadAdaptive(ref))?.id, "u2");
    await solve(extra, confirm[1].id, 0, "unknown");
    assert.equal(nextLearningUnit(book, await loadAdaptive(ref))?.id, "u2");
    const otherUnitChanged = await saveBook(
      uid,
      {
        ...book,
        units: book.units.map((u) =>
          u.id === "u2" ? { ...u, source: u.source + " 다른 단원 변경." } : u,
        ),
      },
      book.id,
    );
    assert.equal(otherUnitChanged.units[0].revision, 1);
    assert.equal(
      unitCoverage(
        otherUnitChanged,
        otherUnitChanged.units[0],
        await loadAdaptive(ref),
      ).complete,
      true,
    );
    assert.equal(
      (await saveBook(uid, { ...otherUnitChanged }, book.id)).revision,
      otherUnitChanged.revision,
    );
    const changed = await saveBook(
      uid,
      {
        ...otherUnitChanged,
        units: otherUnitChanged.units.map((u) => ({
          ...u,
          source: u.source + " 새 자료를 추가했다.",
        })),
      },
      book.id,
    );
    assert.equal(nextLearningUnit(changed, await loadAdaptive(ref))?.id, "u1");
    await assert.rejects(() =>
      createAssignment(uid, { mode: "daily", bookId: book.id }),
    );
    console.log(
      "PASS delayed new-variant evidence advances coverage; later weaknesses do not rewind curriculum; revised material requires fresh mapping",
    );
    if (process.argv.includes("--with-ai")) {
      const custom = await saveBook(uid, {
        ...book,
        id: undefined,
        title: "AI 학습지도 검증",
        units: [
          {
            id: "u1",
            title: "방정식 학습",
            concepts: ["등식의 성질", "일차방정식의 해"],
            source,
          },
        ],
        currentUnit: "u1",
        endUnit: "u1",
      });
      const job = await queueJob(uid, custom.id, "u1");
      await runJob(uid, job.studentId, job.id);
      const result = (await ref.collection("jobs").doc(job.id).get()).data()!;
      assert.equal(result.status, "completed", result.error);
      assert.ok(result.accepted > 0, "No validated questions");
      const adaptive = await loadAdaptive(ref),
        plan = adaptive.plans.find((p) => p.bookId === custom.id)!;
      assert.ok(plan.skills.length && plan.skills.length <= 24);
      const generated = (
        await ref.collection("questions").where("bookId", "==", custom.id).get()
      ).docs.map((d) => d.data());
      assert.ok(
        generated.every((q) =>
          plan.skills.some(
            (s) => s.concept === q.concept && s.type === q.skillType,
          ),
        ),
      );
      console.log(
        `PASS real AI source-based plan and targeted questions: ${plan.skills.length} skills, ${result.accepted} approved, ${result.rejected} pending`,
      );
    }
  } finally {
    await db.recursiveDelete(ref);
    await user.delete();
    await db.collection("users").doc(other).delete();
    for (const name of ["aiUsage", "aiQuotas"]) {
      const docs = await db.collection(name).where("uid", "==", uid).get();
      const batch = db.batch();
      docs.docs.forEach((d) => batch.delete(d.ref));
      if (docs.size) await batch.commit();
    }
    console.log(
      "Disposable adaptive fixtures cleaned; existing learner histories unchanged.",
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Adaptive check failed",
  );
  process.exitCode = 1;
});
