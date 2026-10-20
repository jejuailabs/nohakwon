import "server-only";
import { send } from "@vercel/queue";
import { adminDb } from "@/lib/firebase/admin";
import {
  CATALOG_PREPARATION,
  poolCanRun,
  type CatalogPool,
} from "@/lib/catalog-preparation";

export const CATALOG_TOPIC = "nohakwon-catalog-preparation";
export type CatalogMessage = {
  poolId: string;
  sequence: number;
  cycle: number;
};
export const catalogQueueAvailable = () =>
  process.env.VERCEL === "1" || !!process.env.VERCEL_OIDC_TOKEN;

/** Transactional outbox. A failed publish remains visible for the recovery sweep. */
async function publish(poolId: string) {
  const ref = adminDb().collection("catalogPools").doc(poolId),
    now = Date.now();
  const state = await adminDb().runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data() as CatalogPool | undefined;
    if (
      !p ||
      !["queued", "running"].includes(p.status) ||
      p.publishingUntil! > now ||
      (p.status === "running" && p.leaseUntil > now) ||
      (p.publishedSequence === p.sequence &&
        p.publishedCycle === p.cycle &&
        now - (p.publishedAt ?? 0) < 900000)
    )
      return null;
    tx.update(ref, { publishingUntil: now + 30000 });
    return p;
  });
  if (!state) return false;
  try {
    await send(
      CATALOG_TOPIC,
      {
        poolId,
        sequence: state.sequence,
        cycle: state.cycle,
      } satisfies CatalogMessage,
      {
        region: "iad1",
        retentionSeconds: 604800,
        delaySeconds: Math.max(0, Math.ceil((state.retryAt - now) / 1000)),
        idempotencyKey: `${poolId}:${state.cycle}:${state.sequence}:${Math.floor(now / 900000)}`,
      },
    );
    await ref.update({
      publishedSequence: state.sequence,
      publishedCycle: state.cycle,
      publishedAt: Date.now(),
      publishingUntil: 0,
      dispatchError: "",
    });
    return true;
  } catch {
    await ref.update({
      publishingUntil: 0,
      dispatchError: "작업 큐 전송을 재시도해야 합니다.",
    });
    return false;
  }
}

/** Keep four pipelines active. A completed pool hands its slot to the next book. */
export async function dispatchCatalogPools(
  preferred: string[] = [],
  fill: number = CATALOG_PREPARATION.concurrency,
) {
  if (!catalogQueueAvailable()) return { sent: 0, local: true };
  let sent = 0;
  for (const key of [...new Set(preferred)].slice(0, 5))
    if (await publish(key)) sent++;
  if (fill > 0) {
    const rows = (
      await adminDb()
        .collection("catalogPools")
        .where("status", "in", ["queued", "running"])
        .get()
    ).docs
      .map((d) => d.data() as CatalogPool)
      .filter((p) => !preferred.includes(p.id) && poolCanRun(p, Date.now()))
      .sort(
        (a, b) =>
          b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
      );
    let filled = 0;
    for (const p of rows) {
      if (filled >= fill) break;
      if (await publish(p.id)) {
        sent++;
        filled++;
      }
    }
  }
  return { sent, local: false };
}
