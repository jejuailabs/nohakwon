import { apiError, json, bodyJson, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { studentFor } from "@/lib/server/workspace";
import { identityHash } from "@/lib/server/adaptive";
import { id, object, text, type Book } from "@/lib/learning";
import { unitRevision, type UnitPlan } from "@/lib/adaptive-learning";
import { AccountError } from "@/lib/account";
import { adminDb } from "@/lib/firebase/admin";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      input = object(await bodyJson(request)),
      { ref } = await studentFor(user.uid);
    const bid = id(input.bookId),
      unitId = id(input.unitId);
    if (
      !Array.isArray(input.skills) ||
      !input.skills.length ||
      input.skills.length > 24
    )
      throw new AccountError(400, "개념·유형은 1~24개까지 입력해 주세요.");
    const skills = input.skills.map((r) => {
      const v = object(r);
      return {
        concept: text(v.concept, 80, "개념"),
        type: text(v.type, 80, "유형"),
      };
    });
    if (new Set(skills.map((s) => JSON.stringify(s))).size !== skills.length)
      throw new AccountError(400, "중복된 개념·유형이 있어요.");
    const plan = await adminDb().runTransaction(async (tx) => {
      const book = (await tx.get(ref.collection("books").doc(bid))).data() as
        Book | undefined;
      const unit = book?.units.find((u) => u.id === unitId);
      if (!book || !unit)
        throw new AccountError(404, "등록한 교재와 단원을 확인해 주세요.");
      if (input.revision !== book.revision)
        throw new AccountError(
          409,
          "교재가 변경됐어요. 화면을 새로고침한 뒤 학습지도를 수정해 주세요.",
        );
      if (!unit.source && !book.id.startsWith("foundation-"))
        throw new AccountError(
          422,
          "학습지도의 범위가 될 본문을 먼저 등록해 주세요.",
        );
      const plan: UnitPlan = {
        id: identityHash(`${bid}:${unitId}:${unitRevision(book, unit)}`),
        bookId: bid,
        unitId,
        revision: unitRevision(book, unit),
        skills,
        origin: "editor",
        createdAt: new Date().toISOString(),
      };
      tx.set(ref.collection("unitPlans").doc(plan.id), plan);
      return plan;
    });
    return json({ plan });
  } catch (error) {
    return apiError(error);
  }
}
