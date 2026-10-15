"use client";
import {
  SCHOOL_GRADES,
  SCHOOL_NAMES,
  type Grade,
  type SchoolLevel,
} from "@/lib/education";

export function SchoolGradeFields({
  value,
  onChange,
  disabled = false,
  levelDisabled = false,
  gradeDisabled = false,
  prefix = "",
}: {
  value: { schoolLevel: SchoolLevel; grade: Grade };
  onChange: (value: { schoolLevel: SchoolLevel; grade: Grade }) => void;
  disabled?: boolean;
  levelDisabled?: boolean;
  gradeDisabled?: boolean;
  prefix?: string;
}) {
  return (
    <div className="school-grade-fields">
      <label>
        학교급
        <select
          aria-label={`${prefix}학교급`}
          value={value.schoolLevel}
          disabled={disabled || levelDisabled}
          onChange={(e) => {
            const schoolLevel = e.target.value as SchoolLevel;
            onChange({ schoolLevel, grade: SCHOOL_GRADES[schoolLevel][0] });
          }}
        >
          <option value="elementary">초등학교 4~6학년</option>
          <option value="middle">중학교 1~3학년</option>
        </select>
      </label>
      <label>
        학년
        <select
          aria-label={`${prefix}학년`}
          value={value.grade}
          disabled={disabled || gradeDisabled}
          onChange={(e) =>
            onChange({ ...value, grade: Number(e.target.value) as Grade })
          }
        >
          {SCHOOL_GRADES[value.schoolLevel].map((g) => (
            <option key={g} value={g}>
              {SCHOOL_NAMES[value.schoolLevel]} {g}학년
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
