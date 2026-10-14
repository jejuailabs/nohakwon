import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { AccountError, assertFreshGoogleSignIn } from "@/lib/account";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import {
  requireUser,
  SESSION_COOKIE,
  cookieOptions,
} from "@/lib/server/session";
import { object, text } from "@/lib/learning";
import { adminRole } from "@/lib/server/admin-service";
import { FieldValue } from "firebase-admin/firestore";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request)),
      token = text(v.idToken, 12000, "Google 인증"),
      verified = await adminAuth().verifyIdToken(token, true);
    assertFreshGoogleSignIn(verified);
    if (verified.uid !== user.uid || v.confirm !== "계정 삭제")
      throw new AccountError(403, "삭제할 계정을 다시 확인해 주세요.");
    if ((await adminRole(user.uid)) === "owner")
      throw new AccountError(
        409,
        "소유자 계정은 먼저 다른 운영자에게 소유자 역할을 이전해 주세요.",
      );
    const db = adminDb(),
      orders = await db
        .collection("orders")
        .where("uid", "==", user.uid)
        .limit(1)
        .get();
    if (orders.size) {
      await db.collection("deletionRequests").doc(user.uid).set({
        uid: user.uid,
        status: "pending",
        createdAt: new Date().toISOString(),
        reason: "billing-record-retention-review",
      });
      return json(
        {
          pending: true,
          message:
            "결제 기록의 보존 범위를 확인하기 위해 삭제 요청을 접수했어요. 운영자가 처리합니다.",
        },
        202,
      );
    }
    const students = await db
      .collection("students")
      .where("guardianUid", "==", user.uid)
      .get();
    for (const student of students.docs) {
      const linked = student.data().linkedUid;
      if (linked) {
        const linkedRef = db.collection("users").doc(linked);
        await db.runTransaction(async (tx) => {
          const u = (await tx.get(linkedRef)).data();
          if (u?.activeStudentId === student.id)
            tx.update(linkedRef, {
              activeStudentId: FieldValue.delete(),
              role: FieldValue.delete(),
            });
        });
      }
      const disputes = await db
        .collection("disputes")
        .where("studentId", "==", student.id)
        .get();
      for (const dispute of disputes.docs) await dispute.ref.delete();
      await db.recursiveDelete(student.ref);
    }
    const linkedProfiles = await db
      .collection("students")
      .where("linkedUid", "==", user.uid)
      .get();
    for (const linked of linkedProfiles.docs) {
      await linked.ref.update({
        linkedUid: FieldValue.delete(),
        inviteHash: FieldValue.delete(),
      });
      await linked.ref.collection("linkRequests").doc(user.uid).delete();
    }
    const invites = await db
      .collection("familyInvites")
      .where("guardianUid", "==", user.uid)
      .get();
    for (const invite of invites.docs) await invite.ref.delete();
    await db.collection("linkRateLimits").doc(user.uid).delete();
    for (const name of ["aiUsage", "aiQuotas", "billingStates"]) {
      const docs = await db.collection(name).where("uid", "==", user.uid).get();
      for (let i = 0; i < docs.size; i += 400) {
        const batch = db.batch();
        docs.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await db.collection("users").doc(user.uid).delete();
    await adminAuth().deleteUser(user.uid);
    const response = json({ deleted: true });
    response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
