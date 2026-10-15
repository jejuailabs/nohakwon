import { loadEnvConfig } from "@next/env";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { matchRecognizedTextbooks } from "../apps/web/src/lib/textbook-recognition";
import { parseBook } from "../apps/web/src/lib/learning";
loadEnvConfig(path.resolve("apps/web"));
async function main() {
  if (!process.argv.includes("--live"))
    throw Error("Use --live for disposable Firebase fixtures.");
  if (process.env.FIREBASE_ADMIN_PROJECT_ID !== "barum-10aad")
    throw Error("Unexpected Firebase project.");
  const { adminDb } = await import("../apps/web/src/lib/firebase/admin");
  const { identifyTextbooks } = await import("../apps/web/src/lib/server/ai");
  const { textbookCatalog } =
    await import("../apps/web/src/lib/server/textbook-catalog");
  const { addCatalogBooks, saveBook } =
    await import("../apps/web/src/lib/server/workspace");
  const db = adminDb(),
    uid = `photo-check-${randomUUID()}`,
    sid = `photo-check-${randomUUID()}`;
  const student = db.collection("students").doc(sid),
    user = db.collection("users").doc(uid);
  try {
    const catalog = await textbookCatalog();
    const samples = [
      catalog.find((b) => b.id === "miraen-2022-19")!,
      catalog.find(
        (b) =>
          b.subject === "english" &&
          b.publisher === "동아출판" &&
          b.author === "윤정미" &&
          b.grade === 1 &&
          b.curriculum === "2022",
      )!,
      catalog.find(
        (b) =>
          b.subject === "math" &&
          b.publisher === "천재교과서" &&
          b.author === "김화경" &&
          b.grade === 1 &&
          b.curriculum === "2022",
      )!,
      catalog.find((b) => b.id === "visang-2022-B0317")!,
      catalog.find(
        (b) =>
          b.subject === "science" &&
          b.publisher === "지학사" &&
          b.grade === 1 &&
          b.curriculum === "2022",
      )!,
    ];
    assert.ok(samples.every(Boolean));
    const expected = new Set(samples.map((b) => b.id));
    if (process.argv.includes("--with-ai")) {
      const cases = [
        [
          "actual-single-cover",
          ".local/catalog-research/math1-cover.jpg",
          "image/jpeg",
          1,
        ],
        [
          "single-subject-table",
          ".local/cover-verification/middle1-single-subject.png",
          "image/png",
          1,
        ],
        [
          "five-subject-table",
          ".local/cover-verification/middle1-five-subjects.png",
          "image/png",
          5,
        ],
      ] as const;
      for (const [name, file, mime, count] of cases) {
        if (
          name === "actual-single-cover" &&
          !(await fs.access(file).then(
            () => true,
            () => false,
          ))
        ) {
          console.log(
            "SKIP optional publisher cover; synthetic image cases still required",
          );
          continue;
        }
        const recognition = await identifyTextbooks(uid, "", {
          mime,
          data: await fs.readFile(file),
        });
        const result = matchRecognizedTextbooks(recognition, catalog);
        await fs.mkdir(".local/cover-verification", { recursive: true });
        await fs.writeFile(
          `.local/cover-verification/${name}-new.json`,
          JSON.stringify(result, null, 2),
        );
        assert.equal(
          result.groups.length,
          count,
          `${name}: ${JSON.stringify(recognition)}`,
        );
        assert.ok(
          result.groups.every((group) => group.matches.length === 1),
          `${name}: ${JSON.stringify(recognition)}`,
        );
        if (count === 5)
          assert.deepEqual(
            new Set(result.groups.map((g) => g.matches[0].book.id)),
            expected,
          );
        if (name === "actual-single-cover")
          assert.equal(result.groups[0].matches[0].book.id, "miraen-2022-24");
        if (name === "single-subject-table")
          assert.equal(result.groups[0].matches[0].book.id, samples[2].id);
        console.log(
          `PASS real AI ${name}: ${count} separately matched textbook(s)`,
        );
      }
    }
    await student.set({
      guardianUid: uid,
      nickname: "Disposable photo check",
      schoolLevel: "middle",
      grade: 1,
      createdAt: new Date().toISOString(),
    });
    await user.set({ activeStudentId: sid, role: "guardian" });
    assert.equal((await student.collection("books").get()).size, 0);
    const choices = samples.map((book) => ({
      catalogId: book.id,
      selection: {
        grade: 1,
        currentUnit: book.units[0].id,
        endUnit: book.units.at(-1)!.id,
      },
    }));
    await assert.rejects(() =>
      addCatalogBooks(uid, [
        ...choices.slice(0, 4),
        { catalogId: "unknown-textbook" },
      ]),
    );
    await assert.rejects(() =>
      addCatalogBooks(uid, [
        ...choices.slice(0, 4),
        { catalogId: samples[4].id, selection: { currentUnit: "fake" } },
      ]),
    );
    assert.equal((await student.collection("books").get()).size, 0);
    console.log(
      "PASS invalid ID/range prevents every write; recognition alone stores no books",
    );
    const added = await addCatalogBooks(uid, choices);
    assert.equal(added.added, 5);
    assert.equal(added.existing, 0);
    assert.equal((await student.collection("books").get()).size, 5);
    for (const [i, book] of added.books.entries()) {
      assert.deepEqual(book.units, parseBook(samples[i]).units);
      assert.equal(book.endUnit, choices[i].selection.endUnit);
    }
    console.log(
      "PASS final confirmation adds all five canonical textbooks and selected unit ranges",
    );
    const first = added.books[0];
    const edited = {
      ...first,
      currentUnit: first.units[1].id,
      units: first.units.map((u, i) =>
        i === 1 ? { ...u, source: "Synthetic preservation note" } : u,
      ),
    };
    await saveBook(uid, edited, first.id);
    const repeat = await addCatalogBooks(uid, choices);
    assert.equal(repeat.added, 0);
    assert.equal(repeat.existing, 5);
    assert.equal(repeat.books[0].currentUnit, edited.currentUnit);
    assert.equal(
      repeat.books[0].units[1].source,
      "Synthetic preservation note",
    );
    console.log(
      "PASS retry preserves notes/progress and cannot duplicate the confirmed list",
    );
    const padding = catalog.filter((b) => !expected.has(b.id)).slice(0, 14);
    const batch = db.batch();
    padding.forEach((b) =>
      batch.set(student.collection("books").doc(b.id), {
        ...parseBook(b),
        id: b.id,
      }),
    );
    await batch.commit();
    const next = catalog
      .filter((b) => !expected.has(b.id) && !padding.some((p) => p.id === b.id))
      .slice(0, 2);
    await assert.rejects(() =>
      addCatalogBooks(
        uid,
        next.map((b) => ({ catalogId: b.id })),
      ),
    );
    assert.equal((await student.collection("books").get()).size, 19);
    const race = await Promise.allSettled(
      next.map((b) => addCatalogBooks(uid, [{ catalogId: b.id }])),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await student.collection("books").get()).size, 20);
    console.log(
      "PASS atomic capacity check and concurrent confirmations cannot exceed 20 books",
    );
  } finally {
    await db.recursiveDelete(student);
    await user.delete();
    for (const name of ["aiUsage", "aiQuotas"]) {
      const docs = await db.collection(name).where("uid", "==", uid).get();
      if (docs.size) {
        const batch = db.batch();
        docs.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    console.log(
      "Disposable photo fixtures cleaned; existing learners unchanged.",
    );
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
