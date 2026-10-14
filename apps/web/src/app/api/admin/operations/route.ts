import { requireAdmin } from "@/lib/server/admin-service";
import {
  operationSnapshot,
  operationMutation,
  conceptList,
  saveConcept,
} from "@/lib/server/admin-operations";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { object } from "@/lib/learning";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const user = await requireAdmin(),
      q = new URL(request.url).searchParams;
    if (q.get("view") === "concepts")
      return json({ concepts: await conceptList() });
    return json(
      await operationSnapshot(
        user.uid,
        user.role,
        q.get("studentId") ?? undefined,
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireAdmin(),
      v = object(await bodyJson(request));
    return json(
      v.action === "concept"
        ? await saveConcept(user.uid, user.role, v.concept)
        : await operationMutation(user.uid, user.role, v),
    );
  } catch (e) {
    return apiError(e);
  }
}
