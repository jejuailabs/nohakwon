import { cronAuthorized } from "@/lib/server/billing-service";
import { runMaintenance } from "@/lib/server/maintenance";
import { json, apiError } from "@/lib/server/http";
import { AccountError } from "@/lib/account";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    if (!cronAuthorized(request.headers.get("authorization")))
      throw new AccountError(401, "인증이 필요합니다.");
    return json(await runMaintenance());
  } catch (error) {
    return apiError(error);
  }
}
