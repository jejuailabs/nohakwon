import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { saveBook, studentFor } from "@/lib/server/workspace";
import { id, object, text } from "@/lib/learning";
import { textbookCatalog } from "@/lib/server/textbook-catalog";
import { adminDb } from "@/lib/firebase/admin";
import { createHash } from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireUser();
    return json({ catalog: await textbookCatalog() });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request, 600000));
    if (v.action === "request") {
      const title = text(v.title, 200, "찾는 교재명"),
        key = createHash("sha256")
          .update(
            `${user.uid}:${title.normalize("NFKC").toLowerCase().replace(/\s/g, "")}`,
          )
          .digest("hex");
      const ref = adminDb().collection("textbookRequests").doc(key);
      await adminDb().runTransaction(async (tx) => {
        if (!(await tx.get(ref)).exists)
          tx.set(ref, {
            uid: user.uid,
            title,
            status: "pending",
            createdAt: new Date().toISOString(),
          });
      });
      return json({ ok: true });
    }
    return json({
      book: await saveBook(
        user.uid,
        v.book,
        v.id ? id(v.id) : undefined,
        v.catalogId ? id(v.catalogId) : undefined,
        v.selection,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request)),
      { ref } = await studentFor(user.uid);
    await ref.collection("books").doc(id(v.id)).update({ active: false });
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
