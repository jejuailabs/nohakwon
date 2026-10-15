import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { CATALOG } from "@/lib/catalog";
import { mergeTextbookCatalog } from "@/lib/textbook-catalog";
import { FieldPath } from "firebase-admin/firestore";

export async function textbookCatalog(includeUnpublished = false) {
  const collection = adminDb().collection("textbooks");
  const saved: Record<string, unknown>[] = [];
  let query = collection.orderBy(FieldPath.documentId()).limit(500);
  while (true) {
    const snapshot = await query.get();
    saved.push(...snapshot.docs.map((d) => ({ ...d.data(), id: d.id })));
    if (snapshot.size < 500) break;
    query = collection
      .orderBy(FieldPath.documentId())
      .startAfter(snapshot.docs.at(-1)!)
      .limit(500);
  }
  return mergeTextbookCatalog(CATALOG, saved, includeUnpublished);
}

export async function catalogTextbook(id: string) {
  const saved = await adminDb().collection("textbooks").doc(id).get();
  if (saved.exists)
    return mergeTextbookCatalog([], [{ ...saved.data(), id }])[0];
  return CATALOG.find((b) => b.id === id);
}
