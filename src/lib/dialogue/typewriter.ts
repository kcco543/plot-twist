/**
 * Pure helpers for the dialogue typewriter (no React, unit-tested).
 *
 * Text is revealed one *grapheme cluster* at a time (what a reader sees as one
 * character): "é", "👩‍🚀", "🇨🇳" and "字" are each a single step, never split
 * into broken UTF-16 halves.
 */

type Segmenter = { segment: (s: string) => Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

function getSegmenter(): Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  const Ctor = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => Segmenter }).Segmenter;
  segmenter = Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
  return segmenter;
}

/** Split text into grapheme clusters. Falls back to code points on old browsers. */
export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  const seg = getSegmenter();
  if (!seg) return Array.from(text);
  const out: string[] = [];
  for (const s of seg.segment(text)) out.push(s.segment);
  return out;
}

const SENTENCE_END = new Set([".", "!", "?", "…", "。", "！", "？", "‼", "⁉"]);
const CLAUSE_END = new Set([",", ";", ":", "，", "、", "；", "：", "—", "～"]);
/** Closing marks that belong to the punctuation before them ("Hi!" / 「好。」). */
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "」", "』", "）", "》", "〉", "】"]);
const isCjkPunct = (g: string) => /[　-〿＀-￯…—]/.test(g);
const isSpace = (g: string | undefined) => g === undefined || /^\s+$/.test(g);

/** Small rest after punctuation, like classic RPG text. Multiplier on the base speed. */
export function pauseAfter(prev: string | undefined, next: string | undefined): number {
  if (!prev) return 1;
  // Wait until the whole run of punctuation/closers is out ("?!", "...", "。」").
  if (next !== undefined && (SENTENCE_END.has(next) || CLAUSE_END.has(next) || CLOSERS.has(next))) return 1;
  const p = prev;
  const base = (g: string) => (SENTENCE_END.has(g) ? 6 : CLAUSE_END.has(g) ? 3 : 1);
  let m = base(p);
  if (m === 1 && CLOSERS.has(p)) return 1;
  // ASCII "." inside "3.14" or "e.g" is not a pause: only before a space or the end.
  if (m > 1 && !isCjkPunct(p) && !isSpace(next)) m = 1;
  return m;
}

/** Milliseconds to wait before showing grapheme `index` (0 = start immediately). */
export function delayBefore(graphemes: readonly string[], index: number, msPerChar: number): number {
  if (msPerChar <= 0 || index <= 0) return 0;
  return Math.round(msPerChar * pauseAfter(graphemes[index - 1], graphemes[index]));
}

/** Total time a line takes to type out at a given speed (for tests and pacing). */
export function typingDuration(text: string, msPerChar: number): number {
  const g = splitGraphemes(text);
  let total = 0;
  for (let i = 1; i < g.length; i++) total += delayBefore(g, i, msPerChar);
  return total;
}

/**
 * Display cleanup for a dialogue line: no leading / trailing blank lines, no
 * runs of empty lines, no spaces before a line break. Keeps single line breaks.
 */
export function tidyLine(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** Split off trailing whitespace so the caret sits after the last word, not alone on the next line. */
export function splitTrailingSpace(shown: string): [string, string] {
  const m = /\s+$/.exec(shown);
  return m ? [shown.slice(0, m.index), m[0]] : [shown, ""];
}
