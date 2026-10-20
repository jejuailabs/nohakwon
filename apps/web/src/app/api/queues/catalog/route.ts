import { handleCallback } from "@vercel/queue";
import { runCatalogPoolStep } from "@/lib/server/catalog-preparation";
import {
  dispatchCatalogPools,
  type CatalogMessage,
} from "@/lib/server/catalog-queue";

export const runtime = "nodejs";
export const maxDuration = 300;
// Vercel's queue trigger makes this a private consumer, without a public URL.
export const POST = handleCallback<CatalogMessage>(
  async (message) => {
    if (
      !/^[a-f0-9]{64}$/.test(message.poolId) ||
      !Number.isInteger(message.sequence)
    )
      return;
    const result = await runCatalogPoolStep(message.poolId, message.sequence);
    if (result === "busy") throw new Error("Catalog worker lease is active");
    await dispatchCatalogPools([message.poolId], result === "done" ? 1 : 0);
  },
  {
    visibilityTimeoutSeconds: 360,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(
        300,
        15 * 2 ** Math.min(metadata.deliveryCount, 4),
      ),
    }),
  },
);
