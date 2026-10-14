import { parseProfileInput } from "@/lib/account";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { readProfile, saveProfile } from "@/lib/server/profiles";
import { requireUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { const user = await requireUser(); return json({ profile: await readProfile(user.uid) }); }
  catch (error) { return apiError(error); }
}
export async function PUT(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser();
    const profile = await saveProfile(user, parseProfileInput(await bodyJson(request)));
    return json({ profile });
  } catch (error) { return apiError(error); }
}
