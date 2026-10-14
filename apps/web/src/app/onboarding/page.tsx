import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/account-screens";
import { sessionUser } from "@/lib/server/session";
import { readProfile } from "@/lib/server/profiles";

export const metadata = { title: "학습 프로필 · 노학원" };
export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  const user = await sessionUser();
  if (!user) redirect("/login");
  return <OnboardingScreen profile={await readProfile(user.uid)} />;
}
