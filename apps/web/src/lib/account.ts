export type LearnerProfile = { id: string; nickname: string; grade: 1 | 2 | 3; calm: boolean };
export type AccountUser = { uid: string; email: string | null; displayName: string | null };
export type AccountSession = { configured: boolean; user: AccountUser | null; profile: LearnerProfile | null };
export type ProfileInput = Omit<LearnerProfile, "id">;

export class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function parseProfileInput(value: unknown): ProfileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountError(400, "프로필 정보를 확인해 주세요.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !["nickname", "grade", "calm"].includes(key))) throw new AccountError(400, "허용되지 않은 프로필 항목입니다.");
  const nickname = typeof data.nickname === "string" ? data.nickname.trim().normalize("NFC") : "";
  if (!nickname || Array.from(nickname).length > 20 || /[\p{Cc}\p{Cf}]/u.test(nickname)) throw new AccountError(400, "닉네임은 1~20자의 일반 문자로 입력해 주세요.");
  if (![1, 2, 3].includes(data.grade as number) || typeof data.calm !== "boolean") throw new AccountError(400, "학년과 학습 모드를 확인해 주세요.");
  return { nickname, grade: data.grade as 1 | 2 | 3, calm: data.calm };
}

export function assertSameOrigin(origin: string | null, expected: string, client: string | null) {
  if (!origin || origin !== new URL(expected).origin || client !== "web") throw new AccountError(403, "요청 출처를 확인할 수 없습니다. 이 화면에서 다시 시도해 주세요.");
}

export function assertFreshGoogleSignIn(token: { auth_time: number; firebase: { sign_in_provider: string }; email_verified?: boolean }, now = Date.now()) {
  const age = now / 1000 - token.auth_time;
  if (token.firebase.sign_in_provider !== "google.com" || token.email_verified !== true || !Number.isFinite(age) || age < -60 || age > 300) {
    throw new AccountError(401, "Google 계정을 다시 선택해 로그인해 주세요.");
  }
}

export function progressStorageKey(user: AccountUser | null, profile: LearnerProfile | null) {
  return user ? `nohakwon:learning:v1:account:${encodeURIComponent(user.uid)}:${encodeURIComponent(profile?.id ?? "pending")}` : "nohakwon:learning:v1";
}
