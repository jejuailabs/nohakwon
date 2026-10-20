import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
loadEnvConfig(path.resolve("apps/web"));
async function main() {
  if (process.env.FIREBASE_ADMIN_PROJECT_ID !== "barum-10aad")
    throw Error("Unexpected Firebase project");
  const {
    bootstrapCatalogPreparation,
    catalogPreparationSnapshot,
    runCatalogPoolStep,
  } = await import("../apps/web/src/lib/server/catalog-preparation");
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const { poolCanRun, CATALOG_PREPARATION } = await import(
    "../apps/web/src/lib/catalog-preparation"
  );
  if (process.argv.includes("--apply"))
    console.log(
      "Bootstrap",
      JSON.stringify(await bootstrapCatalogPreparation()),
    );
  if (process.argv.includes("--work")) {
    if (!process.argv.includes("--apply"))
      throw Error(
        "Use --apply --work for paid source verification and generation",
      );
    const maxSteps = Number(
      process.argv.find((s) => s.startsWith("--max-steps="))?.split("=")[1] ??
        10000,
    );
    for (let step = 0; step < maxSteps; ) {
      const queued = (
        await adminDb()
          .collection("catalogPools")
          .where("status", "in", ["queued", "running"])
          .get()
      ).docs
        .map(
          (d) =>
            d.data() as import("../apps/web/src/lib/catalog-preparation").CatalogPool,
        )
        .filter((p) => poolCanRun(p, Date.now()))
        .sort(
          (a, b) =>
            b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
        )
        .slice(0, Math.min(CATALOG_PREPARATION.concurrency, maxSteps - step));
      if (!queued.length) break;
      await Promise.all(
        queued.map(async (p) => {
          const outcome = await runCatalogPoolStep(p.id);
          console.log(
            `${++step}: ${p.bookTitle} [${p.grade}] ${p.unitTitle} ${p.phase}: ${outcome}`,
          );
        }),
      );
    }
  }
  const snapshot = await catalogPreparationSnapshot();
  console.log(
    JSON.stringify({
      total: snapshot.total,
      counts: snapshot.counts,
      approved: snapshot.approved,
    }),
  );
  await mkdir(".local", { recursive: true });
  await writeFile(
    ".local/catalog-preparation-status.json",
    JSON.stringify(snapshot, null, 2),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
