import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import {
  requireAdmin,
  adminSnapshot,
  adminMutation,
} from "@/lib/server/admin-service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    return json(
      await adminSnapshot(
        user.uid,
        user.role,
        new URL(request.url).searchParams.get("studentId") ?? undefined,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireAdmin();
    await adminMutation(user.uid, user.role, await bodyJson(request, 600000));
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
