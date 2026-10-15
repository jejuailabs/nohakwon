import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { CATALOG } from "@/lib/catalog";
import { mergeTextbookCatalog } from "@/lib/textbook-catalog";

export async function textbookCatalog(includeUnpublished = false) {
  const snapshot = await adminDb().collection("textbooks").limit(1000).get();
  return mergeTextbookCatalog(
    CATALOG,
    snapshot.docs.map((d) => ({ ...d.data(), id: d.id })),
    includeUnpublished,
  );
}

export async function catalogTextbook(id: string) {
  const saved = await adminDb().collection("textbooks").doc(id).get();
  if (saved.exists)
    return mergeTextbookCatalog([], [{ ...saved.data(), id }])[0];
  return CATALOG.find((b) => b.id === id);
}
