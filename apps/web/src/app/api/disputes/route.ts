import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { studentFor } from "@/lib/server/workspace";
import { id, object, text } from "@/lib/learning";
import { AccountError } from "@/lib/account";
import { adminDb } from "@/lib/firebase/admin";
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request)),
      { ref } = await studentFor(user.uid),
      attempt = (
        await ref.collection("attempts").doc(id(v.attemptId)).get()
      ).data();
    if (!attempt) throw new AccountError(404, "학습 기록이 없어요.");
    await adminDb()
      .collection("disputes")
      .doc(`${ref.id}_${attempt.id}`)
      .set({
        studentId: ref.id,
        questionId: attempt.questionId,
        reason: text(v.reason, 500, "신고 사유"),
        status: "open",
        createdAt: new Date().toISOString(),
      });
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
