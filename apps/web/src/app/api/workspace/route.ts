import { apiError, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getWorkspace } from "@/lib/server/workspace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return json(await getWorkspace(await requireUser()));
  } catch (error) {
    return apiError(error);
  }
}
