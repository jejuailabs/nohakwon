import { apiError, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { adminDb } from "@/lib/firebase/admin";
import { studentFor } from "@/lib/server/workspace";
import { schoolLevelOf } from "@/lib/education";
export async function GET() {
  try {
    const user = await requireUser(),
      db = adminDb(),
      owned = await db
        .collection("students")
        .where("guardianUid", "==", user.uid)
        .get();
    const students = owned.docs.length
      ? owned.docs
      : [await (await studentFor(user.uid)).ref.get()];
    const profiles = [];
    for (const student of students) {
      const s = student.data()!,
        content: Record<string, unknown> = {
          id: student.id,
          profile: {
            nickname: s.nickname,
            schoolLevel: schoolLevelOf(s),
            grade: s.grade,
            ui: s.ui,
            createdAt: s.createdAt,
          },
        };
      for (const name of ["books", "state", "attempts", "ledger"]) {
        const rows = await student.ref.collection(name).get();
        content[name] = rows.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      profiles.push(content);
    }
    return json({
      exportedAt: new Date().toISOString(),
      user: { email: user.email },
      profiles,
    });
  } catch (error) {
    return apiError(error);
  }
}
