import { apiError, bodyJson, json, mutationGuard } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { studentFor, entitlement } from "@/lib/server/workspace";
import { extractMaterial } from "@/lib/server/ai";
import { object, text } from "@/lib/learning";
import { AccountError } from "@/lib/account";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  try {
    mutationGuard(request);
    const user = await requireUser(),
      { data } = await studentFor(user.uid);
    if (entitlement(data).status === "expired")
      throw new AccountError(
        402,
        "체험 기간이 끝났어요. 구독 후 AI 인식을 사용할 수 있어요.",
      );
    let input = "",
      kind: "toc" | "content" = "toc",
      media: { mime: string; data: Buffer } | undefined;
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const v = object(await bodyJson(request, 150000));
      input = text(v.text, 30000, "학습 자료");
      kind = v.kind === "content" ? "content" : "toc";
    } else {
      const reader = request.body?.getReader();
      if (!reader) throw new AccountError(400, "파일이 없어요.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 6 * 1024 * 1024) {
          await reader.cancel();
          throw new AccountError(
            413,
            "파일은 5MB 이내, PDF는 한 단원씩 올려 주세요.",
          );
        }
        chunks.push(value);
      }
      const form = await new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
        body: Buffer.concat(chunks),
      }).formData();
      const file = form.get("file");
      kind = form.get("kind") === "content" ? "content" : "toc";
      if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || !file.size)
        throw new AccountError(400, "5MB 이하의 파일을 선택해 주세요.");
      const bytes = Buffer.from(await file.arrayBuffer());
      if (
        file.type === "text/plain" ||
        file.name.toLowerCase().endsWith(".txt")
      )
        input = text(bytes.toString("utf8"), 30000, "학습 자료");
      else {
        const mime =
          bytes.subarray(0, 5).toString() === "%PDF-"
            ? "application/pdf"
            : bytes
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? "image/png"
              : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
                ? "image/jpeg"
                : bytes.subarray(0, 4).toString() === "RIFF" &&
                    bytes.subarray(8, 12).toString() === "WEBP"
                  ? "image/webp"
                  : "";
        if (!mime)
          throw new AccountError(
            415,
            "PDF, PNG, JPEG, WebP, TXT 파일을 올려 주세요.",
          );
        media = { mime, data: bytes };
      }
    }
    return json(await extractMaterial(user.uid, input, kind, media));
  } catch (error) {
    return apiError(error);
  }
}
