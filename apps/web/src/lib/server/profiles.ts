import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  AccountError,
  type LearnerProfile,
  type ProfileInput,
} from "@/lib/account";
import { adminDb } from "@/lib/firebase/admin";
import { schoolLevelOf } from "@/lib/education";

export async function readProfile(uid: string): Promise<LearnerProfile | null> {
  const db = adminDb();
  const user = (await db.collection("users").doc(uid).get()).data();
  if (!user?.activeStudentId) return null;
  const student = await db
    .collection("students")
    .doc(user.activeStudentId)
    .get();
  const data = student.data();
  if (!data || (data.guardianUid !== uid && data.linkedUid !== uid))
    throw new AccountError(403, "프로필 접근 권한을 확인해 주세요.");
  return {
    id: student.id,
    nickname: data.nickname,
    schoolLevel: schoolLevelOf(data),
    grade: data.grade,
    calm: data.ui?.lowStimulus === true,
  };
}

export async function saveProfile(
  user: DecodedIdToken,
  input: ProfileInput,
): Promise<LearnerProfile> {
  const db = adminDb();
  const userRef = db.collection("users").doc(user.uid);
  const newStudentRef = db.collection("students").doc();
  return db.runTransaction(async (transaction) => {
    const savedUser = (await transaction.get(userRef)).data();
    if (savedUser?.role && savedUser.role !== "guardian")
      throw new AccountError(403, "보호자 계정에서 프로필을 설정해 주세요.");
    const studentRef = savedUser?.activeStudentId
      ? db.collection("students").doc(savedUser.activeStudentId)
      : newStudentRef;
    const savedStudent = (await transaction.get(studentRef)).data();
    if (
      savedUser?.activeStudentId &&
      (!savedStudent || savedStudent.guardianUid !== user.uid)
    )
      throw new AccountError(403, "프로필 접근 권한을 확인해 주세요.");
    const now = FieldValue.serverTimestamp();
    transaction.set(
      userRef,
      {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.name ?? null,
        role: "guardian",
        activeStudentId: studentRef.id,
        updatedAt: now,
        ...(!savedUser ? { createdAt: now } : {}),
      },
      { merge: true },
    );
    transaction.set(
      studentRef,
      {
        guardianUid: user.uid,
        nickname: input.nickname,
        schoolLevel: schoolLevelOf(input),
        grade: input.grade,
        ui: { lowStimulus: input.calm },
        updatedAt: now,
        ...(!savedStudent ? { createdAt: now } : {}),
      },
      { merge: true },
    );
    return { id: studentRef.id, ...input };
  });
}
