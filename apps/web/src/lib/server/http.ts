import "server-only";
import { NextResponse } from "next/server";
import { AccountError, assertSameOrigin } from "@/lib/account";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}
export function mutationGuard(request: Request) {
  // Next's internal URL can normalize 127.0.0.1 to localhost. The browser's
  // actual Host remains authoritative; browser scripts cannot override it.
  const url = new URL(request.url);
  const expected = process.env.APP_ORIGIN || `${url.protocol}//${request.headers.get("host") || url.host}`;
  assertSameOrigin(request.headers.get("origin"), expected, request.headers.get("x-nohakwon-client"));
}
export async function bodyJson(request: Request, maximum = 16_384): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AccountError(415, "JSON 요청이 필요합니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, "요청 내용이 없습니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new AccountError(413, "요청 내용이 너무 큽니다."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AccountError(400, "요청 형식을 확인해 주세요."); }
}
export function apiError(error: unknown) {
  if (error instanceof AccountError) return json({ error: error.message }, error.status);
  const code = (error as { code?: string })?.code;
  if (["auth/id-token-expired", "auth/id-token-revoked", "auth/invalid-id-token", "auth/argument-error", "auth/user-disabled", "auth/user-not-found"].includes(code ?? "")) return json({ error: "로그인 시간이 만료되었어요. 다시 로그인해 주세요." }, 401);
  // Never log tokens, credential material, request bodies, or SDK error objects.
  console.error("Account service failed", typeof code === "string" || typeof code === "number" ? code : "unavailable");
  return json({ error: "계정 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
}
