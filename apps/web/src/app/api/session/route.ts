import { firebaseConfigured, adminAuth } from "@/lib/firebase/admin";
import { AccountError, assertFreshGoogleSignIn } from "@/lib/account";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { cookieOptions, SESSION_COOKIE, SESSION_SECONDS, sessionUser } from "@/lib/server/session";
import { readProfile } from "@/lib/server/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!firebaseConfigured()) return json({ configured: false, user: null, profile: null });
    const user = await sessionUser();
    return json({ configured: true, user: user ? { uid: user.uid, email: user.email ?? null, displayName: user.name ?? null } : null, profile: user ? await readProfile(user.uid) : null });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const body = await bodyJson(request) as { idToken?: unknown } | null;
    if (!body || typeof body.idToken !== "string" || !body.idToken || body.idToken.length > 12_000) throw new AccountError(400, "Google 로그인 정보를 확인해 주세요.");
    const auth = adminAuth();
    const user = await auth.verifyIdToken(body.idToken, true);
    assertFreshGoogleSignIn(user);
    const profile = await readProfile(user.uid);
    const cookie = await auth.createSessionCookie(body.idToken, { expiresIn: SESSION_SECONDS * 1000 });
    const response = json({ next: profile ? "/b" : "/onboarding" });
    response.cookies.set(SESSION_COOKIE, cookie, { ...cookieOptions, maxAge: SESSION_SECONDS });
    return response;
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    mutationGuard(request);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) { return apiError(error); }
}
