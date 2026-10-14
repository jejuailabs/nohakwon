import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import { id, object, text } from "@/lib/learning";
import { studentFor } from "./workspace";
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
export async function familyLinks(uid: string) {
  const { ref, data } = await studentFor(uid, true),
    requests = await ref
      .collection("linkRequests")
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
  return {
    linked: !!data.linkedUid,
    requests: requests.docs.map((d) => ({
      id: d.id,
      email: d.data().email,
      status: d.data().status,
      createdAt: d.data().createdAt,
    })),
  };
}
export async function changeFamilyLink(
  uid: string,
  email: string | undefined,
  raw: unknown,
) {
  const v = object(raw),
    db = adminDb();
  if (v.action === "redeem") {
    const code = text(v.code, 100, "초대 코드"),
      inviteRef = db.collection("familyInvites").doc(hash(code)),
      userRef = db.collection("users").doc(uid),
      rateRef = db.collection("linkRateLimits").doc(uid);
    await db.runTransaction(async (tx) => {
      const old = (await tx.get(rateRef)).data(),
        minute = Math.floor(Date.now() / 60000);
      if (old?.minute === minute && old.count >= 5)
        throw new AccountError(429, "잠시 후 초대 코드를 다시 확인해 주세요.");
      tx.set(rateRef, {
        minute,
        count: old?.minute === minute ? old.count + 1 : 1,
      });
    });
    await db.runTransaction(async (tx) => {
      const [inv, user] = await Promise.all([
          tx.get(inviteRef),
          tx.get(userRef),
        ]),
        i = inv.data(),
        u = user.data();
      if (
        !i ||
        i.used ||
        i.expiresAt < Date.now() ||
        !email ||
        i.email !== email.toLowerCase() ||
        i.guardianUid === uid
      )
        throw new AccountError(
          403,
          "초대 코드와 초대받은 Google 계정을 확인해 주세요.",
        );
      if (u?.activeStudentId || u?.role === "guardian")
        throw new AccountError(409, "이미 학습 프로필이 연결된 계정입니다.");
      const studentRef = db.collection("students").doc(i.studentId),
        s = (await tx.get(studentRef)).data();
      if (
        !s ||
        s.guardianUid !== i.guardianUid ||
        s.linkedUid ||
        s.inviteHash !== inviteRef.id
      )
        throw new AccountError(409, "이 초대는 더 이상 사용할 수 없어요.");
      tx.set(studentRef.collection("linkRequests").doc(uid), {
        uid,
        email,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      tx.update(inviteRef, { used: true });
    });
    return {
      message:
        "보호자에게 연결 요청을 보냈어요. 보호자가 승인한 후 이어서 시작해 주세요.",
    };
  }
  const { ref, data } = await studentFor(uid, true);
  if (v.action === "invite") {
    if (data.linkedUid)
      throw new AccountError(409, "이미 학생 계정이 연결되어 있어요.");
    const email = text(v.email, 254, "학생 Google 이메일").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AccountError(400, "학생 Google 이메일을 확인해 주세요.");
    const code = randomBytes(18).toString("base64url"),
      key = hash(code),
      batch = db.batch();
    batch.set(db.collection("familyInvites").doc(key), {
      guardianUid: uid,
      studentId: ref.id,
      email,
      expiresAt: Date.now() + 86400000,
      used: false,
    });
    batch.update(ref, { inviteHash: key });
    await batch.commit();
    return { code };
  }
  if (v.action === "approve" || v.action === "reject") {
    const target = id(v.id),
      reqRef = ref.collection("linkRequests").doc(target),
      userRef = db.collection("users").doc(target);
    await db.runTransaction(async (tx) => {
      const [r, u, s] = await Promise.all([
        tx.get(reqRef),
        tx.get(userRef),
        tx.get(ref),
      ]);
      if (r.data()?.status !== "pending")
        throw new AccountError(409, "대기 중인 연결 요청이 없어요.");
      if (v.action === "approve") {
        if (u.data()?.activeStudentId || s.data()?.linkedUid)
          throw new AccountError(409, "이미 연결된 계정입니다.");
        tx.set(
          userRef,
          { uid: target, role: "student", activeStudentId: ref.id },
          { merge: true },
        );
        tx.update(ref, { linkedUid: target });
      }
      tx.update(reqRef, {
        status: v.action === "approve" ? "approved" : "rejected",
        resolvedAt: new Date().toISOString(),
      });
    });
    return { ok: true };
  }
  if (v.action === "unlink") {
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s?.linkedUid) return;
      const uRef = db.collection("users").doc(s.linkedUid),
        u = (await tx.get(uRef)).data();
      if (u?.activeStudentId === ref.id)
        tx.update(uRef, {
          activeStudentId: FieldValue.delete(),
          role: FieldValue.delete(),
        });
      tx.update(ref, {
        linkedUid: FieldValue.delete(),
        inviteHash: FieldValue.delete(),
      });
    });
    return { ok: true };
  }
  throw new AccountError(400, "연결 작업을 확인해 주세요.");
}
