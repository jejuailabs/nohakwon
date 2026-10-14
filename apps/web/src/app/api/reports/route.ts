import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { saveWeeklyReport, reportsFor } from "@/lib/server/reports";
import { studentFor } from "@/lib/server/workspace";
import { object, id } from "@/lib/learning";
export async function GET() {
  try {
    return json(await reportsFor((await requireUser()).uid));
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request)),
      { ref } = await studentFor(user.uid);
    if (v.read)
      await ref
        .collection("notifications")
        .doc(id(v.read))
        .update({ read: true });
    else await saveWeeklyReport(ref.id);
    return json(await reportsFor(user.uid));
  } catch (error) {
    return apiError(error);
  }
}
