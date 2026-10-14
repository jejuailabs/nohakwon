import { apiError, bodyJson, json } from "@/lib/server/http";
import { paymentWebhook } from "@/lib/server/billing-service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await paymentWebhook(await bodyJson(request));
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
