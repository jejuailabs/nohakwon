import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { createHash } from "node:crypto";
import { PUBLISHER_CATALOG } from "../apps/web/src/lib/catalog";
import sourceData from "../apps/web/src/data/textbooks.json";
import elementaryData from "../apps/web/src/data/elementary-textbooks.json";
import publisherData from "../apps/web/src/data/publisher-textbooks.json";
import { parseBook } from "../apps/web/src/lib/learning";

loadEnvConfig(path.resolve("apps/web"));
async function main() {
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const expected = "barum-10aad";
  if (process.env.FIREBASE_ADMIN_PROJECT_ID !== expected)
    throw Error(`Refusing catalog sync outside ${expected}.`);
  const apply = process.argv.includes("--apply"),
    db = adminDb();
  const refs = PUBLISHER_CATALOG.map((b) =>
    db.collection("textbooks").doc(b.id),
  );
  const existing = await db.getAll(...refs);
  const pending: { index: number; data: Record<string, unknown> }[] = [];
  let unchanged = 0,
    manual = 0;
  for (let i = 0; i < PUBLISHER_CATALOG.length; i++) {
    const book = PUBLISHER_CATALOG[i],
      parsed = parseBook(book),
      old = existing[i].data();
    const source = [...sourceData, ...elementaryData, ...publisherData].find(
      (b) => b.id === book.id,
    );
    const managedBy = "publisher-catalog-v1";
    const catalogHash = createHash("sha256")
      .update(JSON.stringify(parsed))
      .digest("hex");
    if (old && old.managedBy !== managedBy) {
      manual++;
      continue;
    }
    if (old?.catalogHash === catalogHash) {
      unchanged++;
      continue;
    }
    pending.push({
      index: i,
      data: {
        ...parsed,
        id: book.id,
        origin: "catalog",
        published: old?.published ?? true,
        revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? book.createdAt,
        managedBy,
        catalogHash,
        tocLevel: "major",
        tocSourceUrls: source?.tocSourceUrls ?? [book.sourceUrl],
        checkedAt: source?.checkedAt ?? "2026-10-14",
        ...(source && "verificationNote" in source && source.verificationNote
          ? { verificationNote: source.verificationNote }
          : {}),
        updatedAt: new Date().toISOString(),
      },
    });
  }
  console.log(
    JSON.stringify({
      project: expected,
      apply,
      books: PUBLISHER_CATALOG.length,
      units: PUBLISHER_CATALOG.reduce((n, b) => n + b.units.length, 0),
      pending: pending.length,
      unchanged,
      preservedManual: manual,
    }),
  );
  if (apply && pending.length) {
    // Keep catalog growth below Firestore's 500-write batch limit.
    for (let offset = 0; offset < pending.length; offset += 450) {
      const batch = db.batch();
      pending
        .slice(offset, offset + 450)
        .forEach((p) => batch.set(refs[p.index], p.data));
      await batch.commit();
    }
    await db.collection("auditLogs").add({
      action: "sync-publisher-catalog",
      target: expected,
      details: { books: pending.length, version: "publisher-catalog-v1" },
      at: new Date().toISOString(),
    });
    const saved = await db.getAll(...refs);
    if (saved.some((s) => !s.exists))
      throw Error("Catalog verification failed.");
    console.log(`Verified ${saved.length} textbook documents in Firebase.`);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
