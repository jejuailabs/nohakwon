import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import {
  openQuestion,
  answerQuestion,
  assessQuestion,
  updateNote,
  updateSettings,
  runJob,
} from "@/lib/server/workspace";
import { after } from "next/server";
import { AccountError } from "@/lib/account";
import { id, object } from "@/lib/learning";
import { startLearning } from "@/lib/server/learning-start";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      v = object(await bodyJson(request));
    switch (v.action) {
      case "start": {
        const result = await startLearning(user.uid, v);
        if (result.jobs.length)
          after(async () => {
            await Promise.allSettled(
              result.jobs.map((j) => runJob(user.uid, j.studentId, j.id)),
            );
          });
        return json(result.payload, result.status);
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
