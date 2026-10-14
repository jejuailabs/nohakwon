import "server-only";
import { seoulDate, addDays } from "@nohakwon/core";
import { adminDb } from "@/lib/firebase/admin";
import {
  loadLearningState,
  makeReport,
  type LearningState,
  type Result,
} from "@/lib/learning";
import { studentFor, entitlement } from "./workspace";
export async function saveWeeklyReport(studentId: string) {
  const ref = adminDb().collection("students").doc(studentId),
    [student, stateSnap, attempts] = await Promise.all([
      ref.get(),
      ref.collection("state").doc("learning").get(),
      ref.collection("attempts").orderBy("at", "desc").limit(1500).get(),
    ]);
  if (!student.exists) return;
  const date = seoulDate(),
    state = loadLearningState(stateSnap.data()),
    results = attempts.docs.map((d) => d.data() as Result),
    report = makeReport(results, state.concepts);
  const id = `week-${date}`;
  await ref
    .collection("reports")
    .doc(id)
    .set({
      id,
      createdAt: new Date().toISOString(),
      from: addDays(date, -6),
      to: date,
      ...report,
    });
  await ref
    .collection("notifications")
    .doc(id)
    .set({
      id,
      title: "이번 주 배움이 도착했어요",
      body: `${report.count}문제 · 정답률 ${report.accuracy}% · ${report.days}일 학습`,
      href: "/b?view=reports",
      createdAt: new Date().toISOString(),
      read: false,
    });
  return id;
}
export async function reportsFor(uid: string) {
  const { ref, data } = await studentFor(uid),
    [reports, notifications] = await Promise.all([
      ref.collection("reports").orderBy("createdAt", "desc").limit(12).get(),
      ref
        .collection("notifications")
        .orderBy("createdAt", "desc")
        .limit(30)
        .get(),
    ]);
  return {
    reports: reports.docs.map((d) => d.data()),
    notifications: notifications.docs.map((d) => d.data()),
    assessmentRecommended:
      entitlement(data).status === "trial" && entitlement(data).daysLeft <= 1,
  };
}
