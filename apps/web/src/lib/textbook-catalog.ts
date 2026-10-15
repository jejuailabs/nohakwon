import { parseBook, type Book, object, id } from "./learning";
import { schoolLevelOf } from "./education";

/** Database revisions and unpublishing take precedence over bundled seed data. */
export function mergeTextbookCatalog(
  base: Book[],
  saved: unknown[],
  includeUnpublished = false,
): Book[] {
  const rows = new Map(base.map((b) => [b.id, b]));
  for (const value of saved) {
    const raw = object(value),
      key = id(raw.id);
    rows.delete(key);
    if (!includeUnpublished && raw.published !== true) continue;
    const parsed = parseBook(raw);
    rows.set(key, {
      ...parsed,
      id: key,
      origin: "catalog",
      revision: Number(raw.revision) || 1,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    });
  }
  return [...rows.values()];
}

export function catalogSelection(
  book: Book,
  selection: unknown,
): ReturnType<typeof parseBook> {
  const v = selection ? object(selection) : {};
  return parseBook({
    ...book,
    schoolLevel: schoolLevelOf(book),
    grade: book.flexibleGrade && v.grade !== undefined ? v.grade : book.grade,
    currentUnit: v.currentUnit ?? book.currentUnit,
    endUnit: v.endUnit ?? v.currentUnit ?? book.endUnit,
    active: true,
  });
}
