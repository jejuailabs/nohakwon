import type { Book, Unit } from "./learning";
import { schoolLevelOf } from "./education";
export function reviewedScope(book: Book, unit: Unit) {
  if (schoolLevelOf(book) === "middle" && book.curriculum === "2022") {
    const title = unit.title.replace(/\s/g, "");
    if (
      book.subject === "social" &&
      book.volume === "1" &&
      title === "세계화시대,지리의힘"
    )
      return {
        concepts: [
          "위치와 위도·경도",
          "자연환경과 인문환경",
          "공간적 상호 작용",
          "세계화와 지역화",
        ],
        references: [
          {
            title: "EBS 2022 개정 사회① 세계화 시대, 지리의 힘 학습 범위",
            url: "https://mid.ebs.co.kr/course/view?courseId=100006173&left=",
          },
        ],
      };
    if (
      book.subject === "science" &&
      book.grade === 1 &&
      title === "과학과인류의지속가능한삶"
    )
      return {
        concepts: [
          "과학적 탐구 방법",
          "과학기술과 인류 문명",
          "과학기술과 지속가능한 삶",
        ],
        references: [
          {
            title: "EBS 2022 개정 과학1 단원별 개념 학습 범위",
            url: "https://mid.ebs.co.kr/course/view?courseId=100006176&left=grade",
          },
        ],
      };
  }
  if (
    schoolLevelOf(book) !== "middle" ||
    book.grade !== 1 ||
    book.subject !== "english" ||
    book.curriculum !== "2022" ||
    book.publisher !== "비상교육" ||
    book.author !== "황종배"
  )
    return;
  const scopes: Record<string, string[]> = {
    "Ready for a New Start": ["be동사", "일반동사"],
    "Happy with My Family": ["There is/are", "현재진행형"],
    "Love All Life": ["be동사 과거형", "일반동사 과거형"],
    "Everyday Art": ["목적어가 두 개인 동사", "조동사 will과 can"],
    "Meet the New World": ["동명사", "감각동사와 형용사"],
    "Walk Around the World": ["접속사 when", "비교급"],
    "Greener, Greater": ["명사처럼 쓰이는 to부정사", "감탄문"],
    "For a Better Tomorrow": ["부사처럼 쓰이는 to부정사", "접속사 that"],
  };
  const concepts = scopes[unit.title.trim()];
  return concepts
    ? {
        concepts,
        references: [
          {
            title: "비상교육 비바샘 영어1(황종배) 공식 단원별 문법 안내",
            url: "https://v.vivasam.com/themeplace/engactivity/supplement.do?level=M1",
          },
        ],
      }
    : undefined;
}

// Original explanations and examples. Scope checked against EBS's public middle-1
// course outline; these are not passages or questions from a publisher's textbook.
const factors = {
  concepts: [
    "소수와 합성수",
    "거듭제곱과 소인수분해",
    "최대공약수와 최소공배수",
  ],
  source: `소수와 합성수: 1보다 큰 자연수 중 양의 약수가 1과 자기 자신뿐인 수를 소수라고 한다. 2, 3, 5, 7은 소수이다. 2는 유일한 짝수 소수이다. 1보다 큰 자연수 중 소수가 아닌 수를 합성수라고 한다. 1은 소수도 합성수도 아니다. 소수의 뜻에서 말하는 소수는 소수점이 있는 수를 뜻하지 않는다.
거듭제곱과 소인수분해: 같은 수를 반복해서 곱한 것을 거듭제곱으로 나타낸다. 3×3×3×3=3^4이며 밑은 3, 지수는 4이다. 3^4는 3×4가 아니다. 소인수는 소수인 인수이다. 1보다 큰 자연수를 소수들의 곱으로 나타내는 것을 소인수분해라고 한다. 작은 소수로 나누어 가거나 인수의 곱으로 나눈 뒤 모두 소수가 될 때까지 분해한다. 48=2×2×2×2×3=2^4×3이다. 분해한 소인수들을 다시 곱해 원래 수가 되는지 확인한다. 곱하는 순서만 다른 소인수분해는 같은 결과이다.
최대공약수와 최소공배수: 두 자연수의 공통인 약수 중 가장 큰 수가 최대공약수이고, 공통인 양의 배수 중 가장 작은 수가 최소공배수이다. 소인수분해한 뒤 최대공약수는 공통 소인수의 작은 지수를, 최소공배수는 나타나는 모든 소인수의 큰 지수를 사용한다. 18=2×3^2, 24=2^3×3이므로 최대공약수는 2×3=6, 최소공배수는 2^3×3^2=72이다. 공통인 소인수가 없으면 두 수의 최대공약수는 1이며 서로소라고 한다. 서로소인 두 자연수의 최소공배수는 두 수의 곱이다.`,
};
const rational = {
  concepts: ["정수와 유리수", "수직선과 절댓값", "유리수의 사칙연산"],
  source: `정수와 유리수: 정수는 양의 정수, 0, 음의 정수로 이루어진다. 유리수는 정수 a와 0이 아닌 정수 b에 대하여 a/b로 나타낼 수 있는 수이다. 모든 정수는 분모를 1로 나타낼 수 있으므로 유리수이다. 유리수에는 정수가 아닌 분수도 있다. 0은 양수도 음수도 아니다.
수직선과 절댓값: 수직선에서 오른쪽에 있는 수가 왼쪽에 있는 수보다 크다. -2는 -5보다 오른쪽에 있으므로 -2>-5이다. 어떤 수를 나타내는 점과 원점 사이의 거리를 그 수의 절댓값이라고 한다. |-4|=4이고 |4|=4이며 |0|=0이다. 절댓값은 음수가 될 수 없다. 음수끼리는 절댓값이 큰 수가 더 작다. 절댓값이 같고 0이 아닌 두 수는 서로 부호가 반대일 수 있다.
유리수의 사칙연산: 같은 부호의 두 수를 더할 때에는 절댓값을 더하고 공통인 부호를 붙인다. 서로 다른 부호는 절댓값의 차에 절댓값이 큰 수의 부호를 붙인다. -5+8=3이고 -7+(-2)=-9이다. 뺄셈은 빼는 수의 부호를 바꾸어 더한다. -7-(-2)=-7+2=-5이다. 곱셈과 나눗셈에서 같은 부호끼리는 양수, 다른 부호끼리는 음수가 된다. (-3)×(-4)=12이다. 0이 아닌 수로 나누는 것은 그 수의 역수를 곱하는 것과 같다. 2/3÷(-4/5)=2/3×(-5/4)=-5/6이다. 0으로 나눌 수 없다. 괄호, 거듭제곱, 곱셈·나눗셈, 덧셈·뺄셈의 순서로 계산하고 같은 우선순위는 왼쪽부터 계산한다.`,
};
export function reviewedMaterial(book: Book, unit: Unit) {
  if (
    schoolLevelOf(book) !== "middle" ||
    book.grade !== 1 ||
    book.subject !== "math"
  )
    return;
  const title = unit.title.replace(/[\s.ⅠⅡⅢⅣⅤⅥ0-9]/g, "");
  const sections =
    title === "수와연산"
      ? [factors, rational]
      : title === "소인수분해"
        ? [factors]
        : title === "정수와유리수"
          ? [rational]
          : [];
  if (!sections.length) return;
  return {
    concepts: sections.flatMap((s) => s.concepts),
    source:
      "노학원 자체 제작 개념 자료입니다. 교과서 원문이 아닌 중학교 1학년 공통 개념과 새로운 예시로 연습합니다.\n" +
      sections.map((s) => s.source).join("\n"),
    references: [
      {
        title: "EBS 중학1 수학 학습 범위 안내",
        url: "https://mid.ebs.co.kr/premium/product/view?productId=445146",
      },
      {
        title: "EBS 소인수분해·정수와 유리수 세부 학습 주제",
        url: "https://mid.ebs.co.kr/course/view?courseId=100005120&left=",
      },
    ],
  };
}
