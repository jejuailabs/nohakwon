import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { PUBLISHER_CATALOG } from "../apps/web/src/lib/catalog";
import inventory from "../apps/web/src/data/publisher-inventory.json";
import { parseBook } from "../apps/web/src/lib/learning";
loadEnvConfig(path.resolve("apps/web"));
async function main() {
  if (!process.argv.includes("--live"))
    throw Error("Use --live for disposable Firebase fixtures.");
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const { textbookCatalog } =
    await import("../apps/web/src/lib/server/textbook-catalog");
  const { saveBook } = await import("../apps/web/src/lib/server/workspace");
  const { identifyTextbook } = await import("../apps/web/src/lib/server/ai");
  const { matchTextbooks } = await import("../apps/web/src/lib/matching");
  const db = adminDb(),
    uid = `catalog-check-${randomUUID()}`,
    sid = `catalog-check-${randomUUID()}`;
  const student = db.collection("students").doc(sid),
    user = db.collection("users").doc(uid);
  try {
    const catalog = await textbookCatalog();
    assert.equal(new Set(catalog.map((b) => b.id)).size, catalog.length);
    const selected = catalog.find((b) => b.id === "miraen-2022-26")!;
    assert.ok(selected);
    assert.equal(selected.units[0].title, "헌법과 국가 기관");
    console.log(
      "PASS Firebase catalog read, deduplication, social volume separation",
    );
    const saved = await db.getAll(
      ...PUBLISHER_CATALOG.map((b) => db.collection("textbooks").doc(b.id)),
    );
    for (let i = 0; i < saved.length; i++) {
      const actual = saved[i].data(),
        expected = PUBLISHER_CATALOG[i];
      assert.ok(actual?.published, expected.id);
      assert.equal(actual.author, expected.author);
      assert.equal(actual.curriculum, expected.curriculum);
      assert.deepEqual(actual.units, parseBook(expected).units);
      assert.ok(actual.tocSourceUrls.length > 0);
    }
    for (const row of inventory) {
      const book = catalog.find((b) => b.id === row.catalogId)!;
      assert.ok(book, row.key);
      const matches = matchTextbooks(
        {
          title: book.title,
          publisher: row.publisher,
          author: row.author,
          curriculum: book.curriculum,
          volume: row.volume,
          schoolLevel: book.schoolLevel,
          subject: book.subject,
          grade: book.grade,
        },
        catalog,
      );
      assert.deepEqual(
        matches.map((m) => m.book.id),
        [book.id],
        row.key,
      );
    }
    console.log(
      `PASS ${saved.length} Firebase textbook documents and all ${inventory.length} current publisher matches`,
    );
    await student.set({
      guardianUid: uid,
      nickname: "Disposable catalog check",
      grade: 3,
      createdAt: new Date().toISOString(),
    });
    await user.set({ activeStudentId: sid, role: "guardian" });
    const book = await saveBook(
      uid,
      { title: "untrusted", units: [] },
      undefined,
      selected.id,
      { grade: 3, currentUnit: "unit-2", endUnit: "unit-4" },
    );
    assert.equal(book.catalogId, selected.id);
    assert.equal(book.grade, 3);
    assert.equal(book.units.length, 12);
    assert.equal(book.currentUnit, "unit-2");
    assert.equal(book.endUnit, "unit-4");
    assert.equal(book.title, selected.title);
    console.log(
      "PASS authoritative catalog registration and grade/range selection",
    );
    const edited = {
      ...book,
      units: book.units.map((u, i) =>
        i === 1
          ? { ...u, source: "Synthetic learning note for preservation test." }
          : u,
      ),
    };
    await saveBook(uid, edited, book.id);
    const repeated = await saveBook(uid, {}, undefined, selected.id);
    assert.equal(repeated.units[1].source, edited.units[1].source);
    assert.equal(repeated.currentUnit, "unit-2");
    await assert.rejects(() =>
      saveBook(uid, {}, undefined, "unknown-textbook"),
    );
    console.log(
      "PASS repeat registration preserves notes/progress and unknown catalog ID rejected",
    );
    for (const publisher of new Set(
      PUBLISHER_CATALOG.map((b) => b.publisher),
    )) {
      const sample =
        PUBLISHER_CATALOG.find(
          (b) => b.publisher === publisher && b.curriculum === "2022",
        ) ?? PUBLISHER_CATALOG.find((b) => b.publisher === publisher)!;
      const registered = await saveBook(uid, {}, undefined, sample.id, {
        currentUnit: sample.units[0].id,
        endUnit: sample.units.at(-1)!.id,
      });
      assert.equal(registered.author, sample.author);
      assert.deepEqual(registered.units, parseBook(sample).units);
      assert.equal(registered.endUnit, sample.units.at(-1)!.id);
      if (sample.id !== selected.id)
        await db.recursiveDelete(
          student.collection("books").doc(registered.id),
        );
    }
    console.log(
      "PASS registration and full unit-range selection for all 20 publishers/national imprint",
    );
    if (process.argv.includes("--with-ai")) {
      const identity = await identifyTextbook(
        uid,
        "중학교 수학 1 / 미래엔 / 대표 저자 황선욱 / 2022 개정 교육과정",
      );
      const matches = matchTextbooks(identity, catalog);
      assert.equal(matches[0]?.book.id, "miraen-2022-24");
      assert.ok(matches.every((m) => m.book.curriculum === "2022"));
      console.log(
        "PASS real AI identity extraction -> Firebase textbook matching",
      );
    }
  } finally {
    await db.recursiveDelete(student);
    await user.delete();
    for (const collection of ["aiUsage", "aiQuotas"]) {
      const docs = await db
        .collection(collection)
        .where("uid", "==", uid)
        .get();
      if (docs.size) {
        const batch = db.batch();
        docs.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    console.log("Disposable catalog test fixtures cleaned");
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
