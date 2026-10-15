/** Names printed on covers and the equivalent publisher's legal/company name. */
export const PUBLISHERS: Record<string, readonly string[]> = {
  교육부: ["교육부"],
  미래엔: ["미래엔"],
  천재교과서: ["천재교과서"],
  천재교육: ["천재교육"],
  비상교육: ["비상교육", "비상"],
  동아출판: ["동아출판", "동아"],
  지학사: ["지학사"],
  YBM: ["YBM", "와이비엠"],
  NE능률: ["NE능률", "엔이능률", "능률교육", "능률"],
  아이스크림미디어: ["아이스크림미디어", "아이스크림"],
  디딤돌교육: ["디딤돌교육", "디딤돌"],
  금성출판사: ["금성출판사", "금성출판", "금성"],
  교학사: ["교학사"],
  해냄에듀: ["해냄에듀"],
  창비교육: ["창비교육"],
  창비: ["창비"],
  아침나라: ["아침나라"],
  박영사: ["박영사"],
  다락원: ["다락원"],
  좋은책신사고: ["좋은책신사고", "좋은책 신사고", "신사고"],
};

function compact(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/주식회사|\(주\)|㈜/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

export function canonicalPublisher(value: string): string {
  const key = compact(value.split(/[·ㆍ]/)[0]);
  return (
    Object.entries(PUBLISHERS).find(([, aliases]) =>
      aliases.some((alias) => compact(alias) === key),
    )?.[0] ?? key
  );
}

export function publisherInText(query: string): string | undefined {
  const text = compact(query);
  // Prefer full company names: 창비교육 and 창비 are separate imprints/editions.
  return Object.entries(PUBLISHERS)
    .flatMap(([publisher, aliases]) =>
      aliases.map((alias) => ({ publisher, alias })),
    )
    .sort((a, b) => compact(b.alias).length - compact(a.alias).length)
    .find(({ alias }) => text.includes(compact(alias)))?.publisher;
}
