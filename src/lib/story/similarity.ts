/** Character-trigram similarity (0–1). Works for English and Chinese alike. */
function grams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim();
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  if (out.size === 0 && t) out.add(t);
  return out;
}

export function similarity(a: string, b: string): number {
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** True when `line` is basically one of the `recent` lines again. */
export const isRepeat = (line: string, recent: string[], threshold = 0.6) => recent.some((r) => similarity(line, r) >= threshold);
