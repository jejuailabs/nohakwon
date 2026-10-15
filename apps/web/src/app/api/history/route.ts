import { apiError, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { studentFor } from "@/lib/server/workspace";
import { ensureExposureIndex, historyPage } from "@/lib/server/adaptive";
import { id } from "@/lib/learning";
import { AccountError } from "@/lib/account";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      { ref } = await studentFor(user.uid);
    await ensureExposureIndex(ref);
    const params = new URL(request.url).searchParams;
    if (params.get("attemptId")) {
      const event = await ref
        .collection("answerEvents")
        .doc(id(params.get("attemptId")))
        .get();
      if (!event.exists)
        throw new AccountError(404, "이전 풀이 기록을 찾지 못했어요.");
      return json({ attempt: event.data() });
    }
    return json(await historyPage(ref, params));
  } catch (error) {
    return apiError(error);
  }
}
