import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import {
  billingStatus,
  prepareBilling,
  completeBilling,
  cancelSubscription,
  reconcileOrder,
} from "@/lib/server/billing-service";
import { object, id } from "@/lib/learning";
import { AccountError } from "@/lib/account";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET() {
  try {
    return json(await billingStatus((await requireUser()).uid));
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request));
    if (v.action === "prepare")
      return json(await prepareBilling(user.uid, v.consent === true));
    if (v.action === "complete")
      return json(await completeBilling(user.uid, v));
    if (v.action === "cancel") {
      await cancelSubscription(user.uid);
      return json({ ok: true });
    }
    if (v.action === "reconcile") {
      await reconcileOrder(user.uid, id(v.orderId));
      return json({ ok: true });
    }
    throw new AccountError(400, "결제 요청을 확인해 주세요.");
  } catch (error) {
    return apiError(error);
  }
}
