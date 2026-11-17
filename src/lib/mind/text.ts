/** Keyword matching for written profiles (EN word boundaries + negation; 中文 substring, skipping 不/没/非 right before). */
const isCjk = (s: string) => /[㐀-鿿]/.test(s);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function textHas(text: string, word: string): boolean {
  const lower = text.toLowerCase();
  if (isCjk(word)) {
    const i = lower.indexOf(word);
    return i !== -1 && !/[不没非]/.test(lower.slice(Math.max(0, i - 1), i));
  }
  const re = new RegExp(`(^|[^a-z-])${esc(word)}(?![a-z-])`, "i");
  const m = re.exec(lower);
  if (!m) return false;
  return !/\b(not|never|isn't|no longer|hardly)\s+(?:\w+\s+)?$/i.test(lower.slice(0, m.index + m[1].length));
}

