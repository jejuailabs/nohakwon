import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";

export const SESSION_COOKIE = "nohakwon_session";
export const SESSION_SECONDS = 5 * 24 * 60 * 60;
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function sessionUser() {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try { return await adminAuth().verifySessionCookie(cookie, true); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (["auth/session-cookie-expired", "auth/session-cookie-revoked", "auth/invalid-session-cookie", "auth/argument-error", "auth/user-disabled", "auth/user-not-found"].includes(code ?? "")) return null;
    throw error;
  }
}

export async function requireUser() {
  const user = await sessionUser();
  if (!user) throw new AccountError(401, "로그인이 필요해요. 다시 로그인해 주세요.");
  return user;
}
