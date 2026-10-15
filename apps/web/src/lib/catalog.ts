import type { SubjectId } from "@nohakwon/core";
import { SUBJECT_NAMES, type Book, type BankQuestion } from "./learning";
import { QUESTIONS } from "./questions";
import textbookData from "../data/textbooks.json";

// Original starter material, not a publisher's textbook or official curriculum match.
const FOUNDATION: Book[] = (Object.keys(SUBJECT_NAMES) as SubjectId[]).map(
  (subject) => ({
    id: `foundation-${subject}`,
    title: `${SUBJECT_NAMES[subject]} 기초 점검`,
    publisher: "노학원 자체 제작 · 교과서 아님",
    grade: 1,
    subject,
    units: [
      {
        id: "basics",
        title:
          subject === "math"
            ? "일차방정식"
            : subject === "english"
              ? "문장의 기본 구조"
              : subject === "korean"
                ? "말과 글의 기초"
                : subject === "social"
                  ? "우리가 사는 세계"
                  : "물질과 자연",
        concepts: [
          subject === "math" ? "일차방정식" : `${SUBJECT_NAMES[subject]} 기초`,
        ],
        source: "",
      },
    ],
    currentUnit: "basics",
    endUnit: "basics",
    active: true,
    createdAt: "",
    revision: 1,
    origin: "catalog",
  }),
);
const verified: {
  code: string;
  subject: SubjectId;
  title: string;
  author: string;
  units: string[];
}[] = [
  {
    code: "B0323",
    subject: "korean",
    title: "중학교 국어 1-1",
    author: "박현숙",
    units: [
      "문학과 삶에서 만나는 의미",
      "정보를 판단하는 힘",
      "세상을 담는 언어, 우리를 잇는 매체",
      "갈등을 푸는 지혜",
    ],
  },
  {
    code: "B0319",
    subject: "english",
    title: "중학교 영어 1",
    author: "황종배",
    units: [
      "Ready for a New Start",
      "Happy with My Family",
      "Love All Life",
      "Everyday Art",
      "Meet the New World",
      "Walk Around the World",
      "Greener, Greater",
      "For a Better Tomorrow",
    ],
  },
  {
    code: "B0318",
    subject: "math",
    title: "중학교 수학 1",
    author: "이진호",
    units: [
      "수와 연산",
      "문자와 식",
      "좌표평면과 그래프",
      "기본 도형",
      "평면도형과 입체도형",
      "통계",
    ],
  },
  {
    code: "B0317",
    subject: "social",
    title: "중학교 사회 ① · 학교 편성에 따라 학년 선택",
    author: "강창숙",
    units: [
      "세계화 시대, 지리의 힘",
      "아시아",
      "유럽",
      "아프리카",
      "아메리카",
      "오세아니아와 극지방",
      "인간과 사회생활",
      "다양한 문화의 이해",
      "민주주의와 시민",
      "정치과정과 시민 참여",
      "일상생활과 법",
      "인권과 기본권",
    ],
  },
  {
    code: "B0309",
    subject: "science",
    title: "중학교 과학 1",
    author: "임태훈",
    units: [
      "과학과 인류의 지속가능한 삶",
      "생물의 구성과 다양성",
      "열",
      "물질의 상태 변화",
      "힘의 작용",
      "기체의 성질",
      "태양계",
    ],
  },
];
// Verified against the publisher's public TOC images on 2026-10-14.
// Only major-unit names are copied; textbook passages are never collected.
export const OFFICIAL_CATALOG: Book[] = verified.map((b) => ({
  id: `visang-2022-${b.code}`,
  title: b.title,
  publisher: "비상교육",
  author: b.author,
  curriculum: "2022",
  volume: b.subject === "korean" ? "1-1" : b.subject === "social" ? "1" : "",
  flexibleGrade: b.subject === "social",
  edition: "2022 개정 · 대단원 목차",
  sourceUrl: `https://textbook.visang.com/textbook/bookdetail?gtt=M&ac=${b.code}`,
  grade: 1,
  subject: b.subject,
  units: b.units.map((title, i) => ({
    id: `unit-${i + 1}`,
    title,
    concepts: [title],
    source: "",
  })),
  currentUnit: "unit-1",
  endUnit: "unit-1",
  active: true,
  createdAt: "2026-10-14",
  revision: 1,
  origin: "catalog",
}));
export const PUBLISHER_CATALOG: Book[] = [
  ...OFFICIAL_CATALOG,
  ...textbookData.map((b): Book => ({
    id: b.id,
    title: b.title,
    publisher: b.publisher,
    author: b.author,
    curriculum: b.curriculum as "2022",
    volume: b.volume,
    flexibleGrade: b.flexibleGrade,
    edition: `${b.curriculum} 개정 · 대단원 목차`,
    sourceUrl: b.sourceUrl,
    subject: b.subject as SubjectId,
    grade: b.grade as Book["grade"],
    units: b.units.map((title, i) => ({
      id: `unit-${i + 1}`,
      title,
      concepts: [title],
      source: "",
    })),
    currentUnit: "unit-1",
    endUnit: "unit-1",
    active: true,
    createdAt: b.checkedAt,
    revision: 1,
    origin: "catalog",
  })),
];
export const CATALOG = [...FOUNDATION, ...PUBLISHER_CATALOG];
export function starterQuestions(book: Book): BankQuestion[] {
  const catalog = CATALOG.find((c) => c.id === book.id);
  if (!catalog || !book.id.startsWith("foundation-")) return [];
  const qs: BankQuestion[] = QUESTIONS.filter(
    (q) => q.subject === book.subject,
  ).map((q) => ({
    id: `original-${q.id}`,
    bookId: book.id,
    unitId: "basics",
    concept: book.units[0].concepts[0],
    subject: book.subject,
    grade: 1,
    prompt: [q.prompt, q.expression].filter(Boolean).join("\n"),
    choices: q.choices,
    answer: q.answer,
    explanation: q.explanation,
    evidence: "노학원 자체 기초 문항",
    difficulty: 2,
    variant: q.id,
    expectedSeconds: 60,
    status: "approved",
    origin: "original",
  }));
  if (book.subject === "math")
    for (let a = 2; a <= 11; a++)
      for (let x = -9; x <= 10; x++) {
        const b = ((a * 3 + x + 31) % 17) - 8,
          c = a * x + b,
          index = (a + x + 20) % 4;
        const choices = [
          String(x + 1),
          String(x - 2),
          String(x + 3),
          String(x - 1),
        ];
        choices[index] = String(x);
        qs.push({
          id: `linear-${a}-${x < 0 ? `n${-x}` : x}`,
          bookId: book.id,
          unitId: "basics",
          concept: "일차방정식",
          subject: "math",
          grade: 1,
          prompt: `다음 방정식의 해는?\n${a}x ${b < 0 ? "−" : "+"} ${Math.abs(b)} = ${c}`,
          choices,
          answer: index,
          explanation: `양변에서 ${b}을 빼면 ${a}x = ${c - b}입니다. 양변을 ${a}로 나누면 x = ${x}입니다.`,
          evidence: "정수 계수 일차방정식 공식으로 생성·검산",
          difficulty: 2,
          variant: `linear-${a}-${x}`,
          expectedSeconds: 60,
          status: "approved",
          origin: "original",
        });
      }
  return qs;
}
