import { after } from "next/server";
import { requireAdmin, audit } from "@/lib/server/admin-service";
import {
  bootstrapCatalogPreparation,
  catalogPreparationSnapshot,
  retryCatalogPool,
} from "@/lib/server/catalog-preparation";
import { dispatchCatalogPools } from "@/lib/server/catalog-queue";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { id, object } from "@/lib/learning";
import { AccountError } from "@/lib/account";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET() {
  try {
    await requireAdmin(["owner", "admin"]);
    return json(await catalogPreparationSnapshot());
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireAdmin(["owner", "admin"]),
      input = object(await bodyJson(request));
    let keys: string[] = [];
    if (input.action === "bootstrap") await bootstrapCatalogPreparation();
    else if (input.action === "retry")
      keys = [await retryCatalogPool(id(input.id))];
    else if (input.action !== "resume")
      throw new AccountError(400, "준비 작업을 확인해 주세요.");
    await audit(user.uid, "catalog-preparation", String(input.action), {
      pools: keys,
    });
    after(async () => {
      await dispatchCatalogPools(keys);
    });
    return json({ ok: true }, 202);
  } catch (error) {
    return apiError(error);
  }
}
