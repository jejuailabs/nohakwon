import { familyLinks, changeFamilyLink } from "@/lib/server/family-links";
import { requireUser } from "@/lib/server/session";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    return json(await familyLinks((await requireUser()).uid));
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser();
    return json(
      await changeFamilyLink(user.uid, user.email, await bodyJson(request)),
    );
  } catch (e) {
    return apiError(e);
  }
}
