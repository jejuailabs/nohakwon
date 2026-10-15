import { AccountError } from "./account";
import { object, text, SUBJECT_NAMES, type Book } from "./learning";
import {
  identityFromText,
  matchTextbooks,
  type TextbookIdentity,
  type TextbookMatch,
} from "./matching";
import { canonicalPublisher } from "./publishers";

export type TextbookRecognition = {
  identities: TextbookIdentity[];
  warning: string;
};
export type RecognizedTextbook = {
  id: string;
  identity: TextbookIdentity;
  matches: TextbookMatch[];
  requiresReview: boolean;
};
export type TextbookPhotoResult = {
  groups: RecognizedTextbook[];
  warning: string;
};

/** Treat the model's output as untrusted data, including empty/unreadable rows. */
export function parseTextbookRecognition(value: unknown): TextbookRecognition {
  const raw = object(value);
  if (!Array.isArray(raw.identities) || raw.identities.length > 20)
    throw new AccountError(
      422,
      "교과서 인식 결과를 확인할 수 없어요. 사진을 나누어 다시 올려 주세요.",
    );
  const identities: TextbookIdentity[] = [];
  const seen = new Set<string>();
  for (const item of raw.identities) {
    const v = object(item);
    const identity: TextbookIdentity = {
      title: text(v.title, 120, "교재명", true),
      publisher: text(v.publisher, 80, "출판사", true),
      author: text(v.author, 80, "대표 저자", true),
      ...(typeof v.subject === "string" &&
      Object.hasOwn(SUBJECT_NAMES, v.subject)
        ? { subject: v.subject as Book["subject"] }
        : {}),
      ...(v.schoolLevel === "elementary" || v.schoolLevel === "middle"
        ? { schoolLevel: v.schoolLevel }
        : {}),
      ...([1, 2, 3, 4, 5, 6].includes(v.grade as number)
        ? { grade: v.grade as Book["grade"] }
        : {}),
      ...(v.curriculum === "2015" || v.curriculum === "2022"
        ? { curriculum: v.curriculum }
        : {}),
      volume: text(v.volume, 20, "권·학기", true),
      isbn: text(v.isbn, 20, "ISBN", true),
      warning: text(v.warning, 1000, "인식 안내", true),
    };
    if (
      !identity.title &&
      !identity.subject &&
      !identity.publisher &&
      !identity.isbn
    )
      continue;
    const key = [
      identity.title,
      canonicalPublisher(identity.publisher || ""),
      identity.author,
      identity.subject,
      identity.schoolLevel,
      identity.grade,
      identity.curriculum,
      identity.volume,
      identity.isbn,
    ]
      .join("|")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s/g, "");
    if (!seen.has(key)) {
      seen.add(key);
      identities.push(identity);
    }
  }
  return { identities, warning: text(raw.warning, 2000, "인식 안내", true) };
}

export function matchRecognizedTextbooks(
  recognition: TextbookRecognition,
  catalog: Book[],
): TextbookPhotoResult {
  return {
    warning: recognition.warning,
    groups: recognition.identities.map((identity, i) => {
      const inferred = identityFromText(identity.title);
      // Grade/curriculum alone must never surface unrelated books as image matches.
      const identifiable = Boolean(
        identity.isbn ||
        ((identity.subject || inferred.subject) &&
          (identity.publisher ||
            inferred.publisher ||
            identity.author ||
            inferred.author ||
            identity.title)),
      );
      let matches = identifiable ? matchTextbooks(identity, catalog) : [];
      let requiresReview = false;
      // OCR can misread a name. Keep that mismatch visible and require a manual
      // choice; never silently equate different authors in the exact matcher.
      if (
        !matches.length &&
        identity.author &&
        (identity.publisher || inferred.publisher) &&
        (identity.subject || inferred.subject) &&
        (identity.grade || inferred.grade)
      ) {
        matches = matchTextbooks(
          {
            ...identity,
            title: identity.title.replace(/\([^)]*\)|（[^）]*）/g, ""),
            author: "",
          },
          catalog,
        );
        requiresReview = matches.length > 0;
      }
      return {
        id: `detected-${i + 1}`,
        identity,
        matches,
        requiresReview,
      };
    }),
  };
}

export type CatalogAddition = { catalogId: string; selection?: unknown };
export function parseCatalogAdditions(value: unknown): CatalogAddition[] {
  if (!Array.isArray(value) || !value.length || value.length > 20)
    throw new AccountError(400, "추가할 교과서를 1~20권 선택해 주세요.");
  const seen = new Set<string>();
  return value.map((item) => {
    const v = object(item);
    const catalogId = text(v.catalogId, 120, "교과서 ID");
    if (!/^[a-zA-Z0-9_-]+$/.test(catalogId) || seen.has(catalogId))
      throw new AccountError(
        400,
        "중복되거나 잘못된 교과서가 있어요. 선택을 확인해 주세요.",
      );
    seen.add(catalogId);
    return { catalogId, selection: v.selection };
  });
}
