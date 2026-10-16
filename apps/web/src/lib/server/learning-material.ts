import "server-only";
import type { DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { AccountError } from "@/lib/account";
import {
  object,
  text,
  SUBJECT_NAMES,
  type Book,
  type Unit,
  type MaterialReference,
  type MaterialProvenance,
} from "@/lib/learning";
import { gradeLabel, schoolLevelOf } from "@/lib/education";
import {
  canPrepareCurriculum,
  materialDomains,
  materialIdentity,
  verifiedReferences,
} from "@/lib/learning-material";
import { identityHash } from "./adaptive";
import { catalogTextbook } from "./textbook-catalog";
import { aiJson } from "./ai";
import { reviewedMaterial, reviewedScope } from "@/lib/reviewed-material";

type Material = {
  id: string;
  source: string;
  concepts: string[];
  references: MaterialReference[];
  createdAt: string;
};
const string = { type: "string" };
const schema = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Public curriculum practice is kept separate from a publisher's textbook body. */
export async function resolveLearningMaterial(
  uid: string,
  student: DocumentReference,
  book: Book,
  unit: Unit,
  stage: (message: string) => Promise<unknown> = async () => {},
): Promise<{ unit: Unit; provenance: MaterialProvenance }> {
  if (unit.source.trim())
    return { unit, provenance: { sourceKind: "uploaded", references: [] } };
  if (!canPrepareCurriculum(book))
    throw new AccountError(
      422,
      "목차만 등록된 자료예요. 이 단원의 본문 사진·PDF·학습 내용을 추가하면 맞춤 문제를 만들 수 있어요.",
    );
  const canonical = await catalogTextbook(book.catalogId!);
  const original = canonical?.units.find(
    (u) => u.id === unit.id && u.title === unit.title,
  );
  if (
    !canonical ||
    !original ||
    canonical.subject !== book.subject ||
    schoolLevelOf(canonical) !== schoolLevelOf(book) ||
    (!canonical.flexibleGrade && canonical.grade !== book.grade)
  )
    throw new AccountError(
      422,
      "편집한 단원의 교육과정 범위를 확인하려면 본문이나 학습 내용을 추가해 주세요.",
    );
  const context = { ...canonical, grade: book.grade };
  const key = identityHash(materialIdentity(context, original));
  const ownRef = student.collection("learningMaterials").doc(key);
  let material = (await ownRef.get()).data() as Material | undefined;
  if (!material) {
    const shared = adminDb().collection("curriculumMaterials").doc(key);
    material = (await shared.get()).data() as Material | undefined;
    const reviewed = reviewedMaterial(context, original);
    if (!material && reviewed)
      material = { id: key, ...reviewed, createdAt: new Date().toISOString() };
    if (!material) {
      await stage("공개 자료에서 단원의 학습 범위를 확인하고 있어요.");
      const domains = materialDomains(context);
      const scope = reviewedScope(context, original);
      const prompt = `공개된 출판사 교과서 소개·세부 목차와 국가교육과정·EBS 자료를 검색하여 다음 단원의 공통 개념 연습 자료를 준비하라.\n교재: ${context.publisher}, ${context.title}, 대표저자 ${context.author ?? ""}, ${context.curriculum ?? "2022"} 개정, ${gradeLabel(context)}, ${SUBJECT_NAMES[context.subject]}.\n단원: ${original.title}. 교재 공식 안내: ${context.sourceUrl ?? ""}. 전체 목차: ${context.units.map((u) => u.title).join(" / ")}.\n반드시 실제 검색 결과로 이 단원의 세부 학습 주제와 학년 범위를 확인하라. 제목이나 영어 Lesson 이름만 보고 문법·소단원을 추측하지 말라. 확인이 부족하면 matched=false, content와 concepts를 비우고 reason에 본문 추가가 필요한 이유를 작성하라.\n확인되면 matched=true로, 실제 확인된 2~5개 핵심개념만 concepts에 적고, 이를 설명하는 짧은 한국어 학습 자료를 content에 1200~4500자로 새로 작성하라. 개념마다 명확한 정의·판별 기준·적용 방법·직접 만든 예시를 포함하라. 영어는 영어 예문과 한국어 설명, 수학은 계산 검산을 포함한다. 문학은 저작권 작품의 내용을 복원·인용하지 말고 새로운 짧은 예문을 직접 만들어 운율·비유·상징 등의 확인된 개념만 설명하라. 교과서 작품의 줄거리·표현을 알고 있다고 주장하지 말라. 정확한 성취기준 코드는 확인하지 못하면 쓰지 말라. 지리·과학 사실을 검증하고 학년 밖 개념을 넣지 말라. content는 교과서 원문이 아닌 자체 제작 개념 자료임을 첫 줄에 명시하라. 출처의 문장을 길게 복사하지 말라. references에는 실제 검색으로 확인한 자료 중 단원 주제나 개념을 직접 뒷받침하는 제목과 정확한 URL만 1~5개 반환하라.`;
      const generationPrompt = scope
        ? `제공된 공식 소단원 범위로 자체 제작 개념 학습 자료를 작성하라. 교재 ${context.publisher} ${context.title}, ${context.curriculum} 개정, ${gradeLabel(context)} ${SUBJECT_NAMES[context.subject]}, 단원 ${original.title}.\n운영자가 공식 자료에서 미리 확인한 범위: ${JSON.stringify(scope)}. 이 범위의 매칭은 이미 검토를 마쳤으며 별도 웹 검색은 필요 없다. matched는 true이고 reason은 빈 문자열이다. concepts에는 제공한 목록을 정확히 모두 넣어라. content는 1200~4500자의 새로운 한국어 설명으로 만들고, 첫 줄에 교과서 원문이 아닌 노학원 자체 제작 개념 자료임을 명시하라. 개념마다 정의·판별 기준·적용 방법·직접 만든 사례를 포함하라. 영어는 영어 예문과 한국어 설명, 다른 과목은 한국어 설명과 사례를 사용하라. 출처의 원문을 복사하지 말고, 제공되지 않은 성취기준 코드나 교과서 지문·인물·작품 내용을 추측하지 말라. references에는 제공한 공식 출처의 제목과 URL을 반환하라.`
        : prompt;
      const response = await aiJson(
        uid,
        "curriculum-material",
        generationPrompt,
        schema({
          matched: scope
            ? { type: "boolean", enum: [true] }
            : { type: "boolean" },
          reason: string,
          content: string,
          concepts: {
            type: "array",
            maxItems: 5,
            items: scope ? { type: "string", enum: scope.concepts } : string,
          },
          references: {
            type: "array",
            maxItems: 5,
            items: schema({ title: string, url: string }),
          },
        }),
        undefined,
        false,
        "medium",
        scope ? undefined : { domains },
      );
      const raw = object(response.value);
      if (raw.matched !== true)
        throw new AccountError(
          422,
          "이 단원의 세부 학습 범위를 공개 자료에서 확인하지 못했어요. 본문 사진이나 학습 내용을 추가하면 이어서 출제할 수 있어요.",
        );
      const source = text(raw.content, 10000, "개념 학습 자료");
      const concepts =
        scope?.concepts ??
        (Array.isArray(raw.concepts)
          ? raw.concepts.map((c) => text(c, 80, "핵심개념"))
          : []);
      if (!concepts.length || concepts.length > 5 || source.length < 200)
        throw new AccountError(
          502,
          "단원 개념 자료가 충분하지 않아요. 다시 준비하거나 본문을 추가해 주세요.",
        );
      const requested = Array.isArray(raw.references)
        ? raw.references.map((r) => {
            const v = object(r);
            return {
              title: text(v.title, 200, "출처명"),
              url: text(v.url, 2000, "출처 주소"),
            };
          })
        : [];
      const references = verifiedReferences(
        scope?.references ?? requested,
        scope?.references ?? response.sources,
        domains,
      );
      if (!references.length)
        throw new AccountError(
          502,
          "실제로 확인한 출처가 없는 개념 자료는 사용하지 않아요. 다시 준비하거나 본문을 추가해 주세요.",
        );
      await stage("확인한 범위와 개념 설명의 정확성을 검토하고 있어요.");
      const verificationTask = scope
        ? `단원 소단원 범위는 운영자가 공식 페이지에서 직접 확인하여 코드에 등록한 목록 ${JSON.stringify(scope.concepts)}이다. 이 검토에는 브라우징 도구가 없으며 URL 재열람은 필요하지 않다. 목록에 대한 매칭은 이미 확인됐으므로, 제공된 학습 설명이 그 범위 안에 있는지와 정의·사실·계산·영어 표현·예시의 정확성을 독립적으로 검토하라. 잘못된 설명이나 학년 밖 개념, 교과서 원문을 지어낸 내용, 문제를 만들기에 부족한 설명이 있으면 valid=false. URL을 새로 열지 못한다는 이유로 이 사전 확인 범위를 미확인으로 취급하지 말라.`
        : "검색으로 교재의 세부 목차·학습 범위를 다시 확인하고 자료의 모든 핵심개념이 이 단원·학년에 해당하는지, 사실·계산·예시가 맞는지, 교과서의 실제 작품·본문을 지어내지 않았는지 검토하라. 출처로 단원 범위를 확인할 수 없거나 다른 학년·단원의 내용이면 valid=false. 내용이 부족하여 개념 문제를 만들 수 없으면 false.";
      const check = await aiJson(
        uid,
        "verify-curriculum-material",
        `아래 자료를 독립적으로 검토하라. 교재 ${context.publisher} ${context.title}, ${context.curriculum} 개정, ${gradeLabel(context)} ${SUBJECT_NAMES[context.subject]}, 단원 ${original.title}. 근거 출처 ${JSON.stringify(references)}.\n${verificationTask}\n<concepts>${JSON.stringify(concepts)}</concepts><material>${source}</material>`,
        schema({ valid: { type: "boolean" }, reason: string }),
        undefined,
        true,
        "medium",
        scope ? undefined : { domains },
      );
      if (object(check.value).valid !== true)
        throw new AccountError(
          422,
          `단원 개념 자료의 검증을 통과하지 못했어요. ${String(object(check.value).reason ?? "본문을 추가하거나 다시 준비해 주세요.").slice(0, 800)}`,
        );
      material = {
        id: key,
        source,
        concepts,
        references,
        createdAt: new Date().toISOString(),
      };
      await adminDb().runTransaction(async (tx) => {
        const prior = await tx.get(shared);
        if (prior.exists) material = prior.data() as Material;
        else tx.create(shared, material!);
      });
    }
    await ownRef.set(material);
  }
  return {
    unit: { ...unit, source: material.source, concepts: material.concepts },
    provenance: { sourceKind: "curriculum", references: material.references },
  };
}
