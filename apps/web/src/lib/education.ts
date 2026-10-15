export type SchoolLevel = "elementary" | "middle";
export type Grade = 1 | 2 | 3 | 4 | 5 | 6;
export const SCHOOL_NAMES: Record<SchoolLevel, string> = {
  elementary: "초등학교",
  middle: "중학교",
};
export const SCHOOL_GRADES: Record<SchoolLevel, readonly Grade[]> = {
  elementary: [4, 5, 6],
  middle: [1, 2, 3],
};
// Records created before elementary support belong to the middle-school workspace.
export function schoolLevelOf(
  value?: { schoolLevel?: unknown } | null,
): SchoolLevel {
  return value?.schoolLevel === "elementary" ? "elementary" : "middle";
}
export function validSchoolGrade(
  level: unknown,
  grade: unknown,
): grade is Grade {
  return (
    (level === "elementary" || level === "middle") &&
    Number.isInteger(grade) &&
    SCHOOL_GRADES[level].includes(grade as Grade)
  );
}
export function gradeLabel(
  value: { schoolLevel?: unknown; grade: number },
  short = false,
) {
  const level = schoolLevelOf(value);
  return short
    ? `${level === "elementary" ? "초" : "중"}${value.grade}`
    : `${SCHOOL_NAMES[level]} ${value.grade}학년`;
}
