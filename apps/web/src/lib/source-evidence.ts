/** Every constrained evidence choice is an exact excerpt of the supplied source. */
export function sourceEvidenceOptions(source: string) {
  const parts = source.split(/(?<=[.!?。！？])\s+|[\r\n]+/u).flatMap((line) => {
    const value = line.trim();
    if (!value) return [];
    if (value.length <= 400) return [value];
    return Array.from({ length: Math.ceil(value.length / 350) }, (_, i) => value.slice(i * 350, (i + 1) * 350).trim()).filter(Boolean);
  });
  const unique = [...new Set(parts)].filter((value) => source.includes(value));
  if (unique.length <= 120) return unique;
  return Array.from({ length: 120 }, (_, i) => unique[Math.floor(i * (unique.length - 1) / 119)]);
}
