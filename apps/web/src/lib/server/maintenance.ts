import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { chargeSubscription } from "./billing-service";
import { saveWeeklyReport } from "./reports";
import { runJob } from "./workspace";
// A bounded, resumable sweep. No emails or external notifications are sent.
export async function runMaintenance() {
  const db = adminDb(),
    lock = db.doc("operations/maintenance"),
    now = Date.now();
  const state = await db.runTransaction(async (tx) => {
    const old = (await tx.get(lock)).data() ?? {};
    if (old.lockedUntil > now) return null;
    tx.set(lock, { ...old, lockedUntil: now + 300000 });
    return old;
  });
  if (!state) return { busy: true };
  let reports = 0,
    recovered = 0,
    payments = 0,
    failed = 0;
  try {
    let query = db.collection("students").orderBy("__name__").limit(30);
    if (state.cursor) query = query.startAfter(state.cursor);
    let students = await query.get();
    if (students.empty && state.cursor)
      students = await db
        .collection("students")
        .orderBy("__name__")
        .limit(30)
        .get();
    const work: { uid: string; sid: string; jid: string }[] = [],
      renew: string[] = [];
    await Promise.all(
      students.docs.map(async (student) => {
        try {
          const [last, jobs, sub] = await Promise.all([
            student.ref
              .collection("reports")
              .orderBy("createdAt", "desc")
              .limit(1)
              .get(),
            student.ref
              .collection("jobs")
              .orderBy("createdAt", "desc")
              .limit(10)
              .get(),
            db.collection("subscriptions").doc(student.id).get(),
          ]);
          const previous = last.docs[0]?.data().createdAt;
          if (!previous || now - Date.parse(previous) >= 7 * 86400000) {
            const activity = await student.ref
              .collection("attempts")
              .limit(1)
              .get();
            if (activity.size) {
              await saveWeeklyReport(student.id);
              reports++;
            }
          }
          for (const job of jobs.docs) {
            const j = job.data();
            if (
              work.length < 3 &&
              (j.attempts ?? 0) < 3 &&
              (j.status === "queued" ||
                (j.status === "running" &&
                  Date.parse(j.startedAt) < now - 300000))
            )
              work.push({
                uid: student.data().guardianUid,
                sid: student.id,
                jid: job.id,
              });
          }
          const s = sub.data();
          if (
            s &&
            !s.cancelAtPeriodEnd &&
            s.paidUntil &&
            Date.parse(s.paidUntil) <= now
          )
            renew.push(student.id);
        } catch {
          failed++;
        }
      }),
    );
    await Promise.all([
      ...work.map(async (j) => {
        await runJob(j.uid, j.sid, j.jid);
        recovered++;
      }),
      ...renew.slice(0, 3).map(async (sid) => {
        try {
          await chargeSubscription(sid);
          payments++;
        } catch {
          failed++;
        }
      }),
    ]);
    await lock.set({
      cursor: students.size === 30 ? students.docs.at(-1)!.id : "",
      lockedUntil: 0,
      lastRun: new Date().toISOString(),
      reports,
      recovered,
      payments,
      failed,
    });
    return { students: students.size, reports, recovered, payments, failed };
  } catch (error) {
    await lock.update({ lockedUntil: 0 });
    throw error;
  }
}
