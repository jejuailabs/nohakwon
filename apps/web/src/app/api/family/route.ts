import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { parseProfileInput, AccountError } from "@/lib/account";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { id, object } from "@/lib/learning";
export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await requireUser(),
      snap = await adminDb()
        .collection("students")
        .where("guardianUid", "==", user.uid)
        .limit(5)
        .get();
    return json({
      profiles: snap.docs.map((d) => ({
        id: d.id,
        nickname: d.data().nickname,
        grade: d.data().grade,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request)),
      db = adminDb(),
      userRef = db.doc(`users/${user.uid}`);
    if ((await userRef.get()).data()?.role === "student")
      throw new AccountError(403, "보호자 계정에서 관리해 주세요.");
    if (v.action === "switch") {
      const studentRef = db.collection("students").doc(id(v.id));
      await db.runTransaction(async (tx) => {
        const student = (await tx.get(studentRef)).data();
        if (student?.guardianUid !== user.uid)
          throw new AccountError(403, "프로필 접근 권한이 없어요.");
        tx.update(userRef, { activeStudentId: studentRef.id });
      });
    } else if (v.action === "create") {
      const p = parseProfileInput({
          nickname: v.nickname,
          grade: v.grade,
          calm: v.calm,
        }),
        studentRef = db.collection("students").doc(randomUUID());
      await db.runTransaction(async (tx) => {
        const siblings = await tx.get(
          db.collection("students").where("guardianUid", "==", user.uid),
        );
        if (siblings.size >= 5)
          throw new AccountError(
            409,
            "학습 프로필은 최대 5개까지 만들 수 있어요.",
          );
        tx.set(studentRef, {
          guardianUid: user.uid,
          nickname: p.nickname,
          grade: p.grade,
          ui: { lowStimulus: p.calm },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(userRef, { activeStudentId: studentRef.id }, { merge: true });
      });
    } else throw new AccountError(400, "요청을 확인해 주세요.");
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
