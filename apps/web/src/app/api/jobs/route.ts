import { after } from "next/server";
import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { queueJob, runJob, studentFor } from "@/lib/server/workspace";
import { id, object } from "@/lib/learning";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request));
    const job = v.retry
      ? { id: id(v.retry), studentId: (await studentFor(user.uid)).ref.id }
      : await queueJob(user.uid, id(v.bookId), id(v.unitId));
    after(async () => {
      await runJob(user.uid, job.studentId, job.id).catch(() => {});
    });
    return json({ id: job.id }, 202);
  } catch (error) {
    return apiError(error);
  }
}
