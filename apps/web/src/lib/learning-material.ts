import type { Book, MaterialReference, Unit } from "./learning";

export function canPrepareCurriculum(book: Book) {
  return (
    book.origin === "catalog" &&
    !!book.catalogId &&
    !book.id.startsWith("foundation-")
  );
}

export function materialDomains(book: Book) {
  const domains = [
    "ncic.re.kr",
    "moe.go.kr",
    "kice.re.kr",
    "ebs.co.kr",
    "kpipa.or.kr",
  ];
  // Publisher teaching portals use a different domain from their older showroom.
  if (book.publisher === "비상교육") domains.push("vivasam.com");
  if (book.sourceUrl) {
    try {
      const host = new URL(book.sourceUrl).hostname.replace(/^www\./, "");
      // Called only with the canonical server catalog, never a learner-supplied URL.
      domains.push(host);
      const labels = host.split(".");
      domains.push(
        labels.slice(/\.(co|re|or|go|ac)\.kr$/.test(host) ? -3 : -2).join("."),
      );
    } catch {
      /* An invalid catalog URL cannot broaden source access. */
    }
  }
  return [...new Set(domains)];
}

export function verifiedReferences(
  requested: MaterialReference[],
  observed: MaterialReference[],
  domains: string[],
) {
  const normalize = (url: string) => {
    try {
      const u = new URL(url);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        !domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))
      )
        return "";
      u.hash = "";
      u.searchParams.delete("utm_source");
      return u.href.replace(/\/$/, "");
    } catch {
      return "";
    }
  };
  const seen = new Set(observed.map((s) => normalize(s.url)).filter(Boolean));
  const unique = new Map<string, MaterialReference>();
  for (const ref of requested) {
    const url = normalize(ref.url);
    if (url && seen.has(url)) unique.set(url, { title: ref.title, url });
  }
  return [...unique.values()].slice(0, 8);
}

export function materialIdentity(book: Book, unit: Unit) {
  return JSON.stringify([
    "curriculum-v1",
    book.catalogId ?? book.id,
    book.schoolLevel ?? "middle",
    book.grade,
    book.subject,
    book.curriculum,
    book.volume,
    unit.id,
    unit.title,
  ]);
}
