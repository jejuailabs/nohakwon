import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { saveBook, studentFor } from "@/lib/server/workspace";
import { CATALOG } from "@/lib/catalog";
import { id, object } from "@/lib/learning";
import { adminDb } from "@/lib/firebase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireUser();
    const extra = await adminDb()
      .collection("textbooks")
      .where("published", "==", true)
      .limit(100)
      .get();
    return json({ catalog: [...CATALOG, ...extra.docs.map((d) => d.data())] });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request, 600000));
    return json({
      book: await saveBook(
        user.uid,
        v.book,
        v.id ? id(v.id) : undefined,
        v.catalogId ? id(v.catalogId) : undefined,
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
