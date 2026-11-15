/**
 * FIRST-PASS CHECKS on an AI reply (run by the server route).
 * --------------------------------------------------------------------------
 * sanitizeReply()  tidies the text and clamps every number into range.
 * replyProblem()   finds replies that break the rules: out of character
 *                  ("as an AI…"), wrong language, a repeat of the
 *                  character's own recent line, or the model's own
 *                  staysInCharacter check failing. A reply with a problem
 *                  is retried once with the problem explained, then
 *                  rejected. It is never shown.
 *
 * The game engine validates the result again (apply.ts) before anything
 * changes in the game.
 */
import { isRepeat, similarity } from "../../story/similarity";
import { AI_RELATION_KEYS, DIALOGUE_MAX, type TalkReply, type TalkRequest, type TalkSuggestion } from "./contract";

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
const chars = (s: string) => Array.from(s);
/** Cut to `max` characters, preferring the end of a sentence. */
export function cutText(s: string, max: number): string {
  const c = chars(s);
  if (c.length <= max) return s;
  const head = c.slice(0, max).join("");
  const stop = Math.max(...[".", "!", "?", "。", "！", "？", "…"].map((p) => head.lastIndexOf(p)));
  return stop >= max * 0.5 ? head.slice(0, stop + 1) : head.replace(/\s+\S*$/, "") + "…";
}

/** Spoken words only: drop a "Name:" prefix, wrapping quotes and *stage directions*. */
export function cleanDialogue(raw: string, listenerName: string): string {
  let s = raw.replace(/\r\n?/g, "\n").trim();
  const name = listenerName.trim();
  if (name && (s.startsWith(`${name}:`) || s.startsWith(`${name}：`))) s = s.slice(name.length + 1).trim();
  s = s.replace(/\*[^*\n]{1,80}\*/g, " ").replace(/\s{2,}/g, " ").trim();
  const pairs: [string, string][] = [['"', '"'], ["“", "”"], ["「", "」"], ["『", "』"]];
  for (const [a, b] of pairs) if (s.startsWith(a) && s.endsWith(b) && s.length > 2 && !s.slice(1, -1).includes(b)) s = s.slice(1, -1).trim();
  return s;
}

const SUGGESTION_LABEL_MAX = 48;
const SUGGESTION_LINE_MAX = 160;

/** Tidy text, clamp numbers, keep 2–3 distinct suggestions that don't repeat what was already said. */
export function sanitizeReply(r: TalkReply, req: Pick<TalkRequest, "speaker" | "listener" | "history" | "usedTopics" | "message">): TalkReply {
  const listenerName = req.listener.fields.name ?? "";
  const dialogue = cutText(cleanDialogue(r.dialogue, listenerName), DIALOGUE_MAX);
  const relationshipChanges = Object.fromEntries(AI_RELATION_KEYS.map((k) => [k, Math.round(clamp(r.relationshipChanges[k], -10, 10))])) as TalkReply["relationshipChanges"];
  const said = [req.message.text, ...req.history.map((h) => h.text), ...req.usedTopics];
  const seen: TalkSuggestion[] = [];
  for (const s of r.conversationSuggestions) {
    const label = cutText(s.label.replace(/\s+/g, " ").trim(), SUGGESTION_LABEL_MAX);
    const line = cutText(cleanDialogue(s.line, req.speaker.fields.name ?? ""), SUGGESTION_LINE_MAX);
    if (!label || !line) continue;
    if (isRepeat(line, said, 0.55) || isRepeat(label, said, 0.7)) continue;
    if (seen.some((x) => similarity(x.line, line) >= 0.5 || x.label === label)) continue;
    seen.push({ label, line, intent: s.intent });
    if (seen.length === 3) break;
  }
  return {
    ...r,
    dialogue,
    reactionIntensity: clamp(r.reactionIntensity, 0, 1),
    relationshipChanges,
    memory: {
      ...r.memory,
      summary: cutText(r.memory.summary.replace(/\s+/g, " ").trim(), 160),
      importance: Math.round(clamp(r.memory.importance, 0, 3)),
      resolves: cutText(r.memory.resolves.trim(), 200),
    },
    conversationSuggestions: seen,
  };
}

// ---------------------------------------------------------------- rule checks

/** Assistant-speak and fourth-wall breaks, EN + 中文. */
const OUT_OF_CHARACTER = [
  /\bas an ai\b/i,
  /\b(?:i am|i'm) (?:an? )?(?:ai|artificial intelligence|language model|assistant|chatbot)\b/i,
  /\blanguage model\b/i,
  /\bhow (?:can|may) i (?:help|assist) you\b/i,
  /\bi (?:can(?:no|')t|am unable to) (?:role-?play|pretend)\b/i,
  /作为(?:一个)?(?:AI|人工智能|语言模型|助手)/i,
  /我(?:是|只是)(?:一个)?(?:AI|人工智能|语言模型|聊天机器人|助手)/i,
  /有什么(?:可以|能)帮(?:你|您)的/,
];
export const outOfCharacter = (s: string) => OUT_OF_CHARACTER.some((re) => re.test(s));

const CJK = /[㐀-鿿豈-﫿]/u;
const LATIN = /[A-Za-z]/;
/** Share of letters that are Chinese characters (names removed first, so "Tobi" doesn't count against Chinese). */
export function cjkShare(s: string, names: string[] = []): number {
  let t = s;
  for (const n of names) if (n.trim()) t = t.split(n.trim()).join(" ");
  let cjk = 0;
  let latin = 0;
  for (const ch of t) {
    if (CJK.test(ch)) cjk++;
    else if (LATIN.test(ch)) latin++;
  }
  // A Chinese character carries roughly a word; weigh Latin letters accordingly.
  const words = latin / 4.5;
  return cjk + words === 0 ? -1 : cjk / (cjk + words);
}

/** Is `s` written in the game language? (-1 share = no letters at all, e.g. "……!", which is fine.) */
export function inLanguage(s: string, locale: TalkRequest["locale"], names: string[]): boolean {
  const share = cjkShare(s, names);
  if (share < 0) return true;
  return locale === "zh-CN" ? share >= 0.5 : share < 0.25;
}

export type ReplyProblem = "empty" | "out_of_character" | "wrong_language" | "repeat" | "self_check" | "suggestion_language";

/** The first rule the reply breaks, or null. Run on a sanitized reply. */
export function replyProblem(r: TalkReply, req: TalkRequest): ReplyProblem | null {
  const names = [req.speaker.fields.name ?? "", req.listener.fields.name ?? ""];
  if (!r.dialogue.trim()) return "empty";
  if (outOfCharacter(r.dialogue) || r.conversationSuggestions.some((s) => outOfCharacter(s.line))) return "out_of_character";
  if (!r.staysInCharacter) return "self_check";
  if (!inLanguage(r.dialogue, req.locale, names)) return "wrong_language";
  if (r.conversationSuggestions.some((s) => !inLanguage(s.line, req.locale, names))) return "suggestion_language";
  const ownLines = req.history.filter((h) => h.who === "listener").map((h) => h.text);
  if (isRepeat(r.dialogue, ownLines, 0.6)) return "repeat";
  return null;
}

/** Feedback for the one retry. */
export const PROBLEM_FEEDBACK: Record<ReplyProblem, string> = {
  empty: "The dialogue was empty. The character must say something (even a few words or a pause like \"…\").",
  out_of_character: "The reply broke character (it sounded like an AI assistant). Answer only as the character, inside the game world.",
  self_check: "You marked the reply as not in character. Write one that respects the character's canon, boundaries and established relationships.",
  wrong_language: "The dialogue was not in the required language. Write it in the game language given.",
  suggestion_language: "A suggestion was not in the required language. Write every suggestion in the game language given.",
  repeat: "The dialogue repeated one of the character's own recent lines. Say something new, in fresh words.",
};
