import { LoginScreen } from "@/components/account-screens";
import { firebaseConfigured } from "@/lib/firebase/admin";
import { sessionUser } from "@/lib/server/session";
import { readProfile } from "@/lib/server/profiles";

export const metadata = { title: "모험의 시작 · 노학원" };
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const configured = firebaseConfigured();
  let next: string | null = null;
  // A failed or expired session must never prevent a fresh sign-in.
  try { const user = configured ? await sessionUser() : null; if (user) next = await readProfile(user.uid) ? "/b" : "/onboarding"; } catch { /* Login stays available. */ }
  return <LoginScreen configured={configured} next={next} />;
}
