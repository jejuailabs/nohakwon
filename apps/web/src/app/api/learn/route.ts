import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import {
  createAssignment,
  openQuestion,
  answerQuestion,
  assessQuestion,
  updateNote,
  updateSettings,
  replenishQuestions,
  runJob,
} from "@/lib/server/workspace";
import { after } from "next/server";
import { AccountError } from "@/lib/account";
import { id, object } from "@/lib/learning";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request));
    switch (v.action) {
      case "start": {
        let jobs: { id: string; studentId: string }[] = [];
        if (!v.mode || v.mode === "daily") {
          jobs = await replenishQuestions(
            user.uid,
            v.bookId ? id(v.bookId) : undefined,
          );
          if (jobs.length)
            after(async () => {
              await Promise.allSettled(
                jobs.map((j) => runJob(user.uid, j.studentId, j.id)),
              );
            });
        }
        try {
          return json(await createAssignment(user.uid, v));
        } catch (e) {
          if (jobs.length && e instanceof AccountError && e.status === 409)
            throw new AccountError(
              409,
              "단원 문제를 준비하고 있어요. 나의 교재에서 출제 상태를 확인한 뒤 다시 시작해 주세요.",
            );
          throw e;
        }
      }
      case "open":
        return json(
          await openQuestion(user.uid, id(v.assignmentId), id(v.questionId)),
        );
      case "answer":
        return json(await answerQuestion(user.uid, v));
      case "assess":
        return json(await assessQuestion(user.uid, v));
      case "note":
        return json(await updateNote(user.uid, v));
      case "settings":
        return json(await updateSettings(user.uid, v));
      default:
        throw new AccountError(400, "요청 동작을 확인해 주세요.");
    }
  } catch (error) {
    return apiError(error);
  }
}
