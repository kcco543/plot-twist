/**
 * STATED GOALS — "I'm going to the library" → a destination, but only when it
 * is a genuine intention right now. Deterministic (no AI), EN + 中文.
 *
 *   intention     "I'm heading to the window." / "我去书架那边看看。"
 *   hypothetical  "If it rains I'll go to the library." / "要是下雨我就去图书馆。"
 *   past          "I went to the library yesterday." / "我昨天去过图书馆。"
 *   joke          "I'm going to the moon, lol." / "我去月球了，开玩笑的。"
 *   question      "Should I go to the window?" / "我要不要去窗边？"
 *   none          no movement intention at all
 *
 * Only an "intention" becomes a goal. Its place is then looked up among the
 * annotated objects of the current room by their tags. If there's no such
 * place here, the goal is "unavailable": the game says so instead of
 * pretending the character arrived somewhere that doesn't exist.
 */
import type { WorldObject } from "../stage/objects";

export type StatementKind = "intention" | "hypothetical" | "past" | "joke" | "question" | "none";
export type Classified = { kind: StatementKind; place: string | null };

const QUESTION_EN = /\?\s*$|^\s*(should|shall|could|can|do|would|will)\s+(i|we)\b/i;
const QUESTION_ZH = /[?？]\s*$|要不要|该不该|好不好|行不行|可以吗|吗[。.!！]?\s*$/;
const JOKE_EN = /\b(jk|j\/k|lol|lmao|just kidding|kidding|haha+|not really)\b|😜|😂|🤪/i;
const JOKE_ZH = /开玩笑|逗你|哈哈|骗你的|说着玩/;
const PAST_EN = /\b(went|was going|were going|had gone|have been|used to|yesterday|last (night|week|time|year)|earlier today|this morning)\b/i;
const PAST_ZH = /去过|昨天|前天|上次|以前|曾经|刚才去|刚去了|之前去|回来了/;
const HYPO_EN = /\b(if|unless|maybe|might|could|would|someday|one day|wish|imagine|in case|probably|perhaps)\b/i;
const HYPO_ZH = /如果|要是|假如|万一|也许|可能|说不定|哪天|有一天|改天|但愿|想象|真想/;
const NEG_EN = /\b(not|never|n't|won't|can't)\b/i;
const NEG_ZH = /不去|不想去|别去|没去|不会去|不打算/;

/** "I'm heading to the X", "I'll go to the X", "let me go look at the X", "off to the X"… */
const INTENT_EN =
  /\b(?:i'?m|i am|i'?ll|i will|let me|lemme|gonna|i'?m gonna|time (?:for me )?to|i need to|i have to|i'?d better)\s+(?:just\s+|going to\s+|gonna\s+)?(?:go(?:ing)?|head(?:ing)?|walk(?:ing)?|wander(?:ing)?|pop(?:ping)?|run(?:ning)?|off|step(?:ping)?|check(?:ing)?\s+(?:out|on)|look(?:ing)?\s+at|sit(?:ting)?)\s*(?:over|back|out|down|up)?\s*(?:to|towards?|into|by|at|on)?\s+(?:the\s+|my\s+|that\s+|this\s+|those\s+|a\s+)?([a-z][a-z' -]{1,30}?)(?=[.,!;:]|\s+(?:for|to|and|now|then|a|for a|real|quick)\b|$)/i;
/** "我去X", "我先去X看看", "我到X那边", "我回X了" */
const INTENT_ZH = /我(?:先|这就|就|现在|得|要|该|想)?(?:去|到|回|过去)(?:一下|一趟)?([^，。！!,.？?\s]{1,8}?)(?:那边|那儿|那里|旁边)?(?:看看|坐坐|待会儿|待一会儿|一下|一趟|了|吧|啦|[，。！!,.]|$)/;

/** Any mention of going somewhere (said, asked, remembered or imagined): where the place words come from when it isn't an intention. */
const MOVE_EN = /\b(?:go|goes|going|gone|went|head(?:ing|ed)?|walk(?:ing|ed)?|off)\b[^.?!]*?\b(?:to|into|towards?)\s+(?:the\s+|my\s+|that\s+|a\s+)?([a-z][a-z' -]{1,30}?)(?=[.,!?;:]|$|\s+(?:yesterday|tomorrow|later|now|lol|if|when|again|today|tonight|once)\b)/i;
const MOVE_ZH = /(?:去|到|回)(?:过|了)?([^，。！!,.？?\s]{1,8}?)(?:那边|那儿|那里|旁边|看看|一下|一趟|了|吧|啦|吗|呢|[，。！!,.？?]|$)/;

/** First words that make "going to X" a plan to DO something, not to go somewhere. */
const NOT_A_PLACE = /^(be|do|say|tell|think|try|make|get|see|have|cry|sleep|help|need|want|like|talk|ask|go|it|you|him|her|them|this|that|work|bed|stop|keep|find|let|miss|win|lose|leave|start|call)\b/i;

/** Classify one line the character said. */
export function classifyStatement(text: string): Classified {
  const t = text.trim();
  if (!t) return { kind: "none", place: null };
  const zh = /[㐀-鿿]/.test(t);
  const m = zh ? INTENT_ZH.exec(t) : INTENT_EN.exec(t);
  const loose = zh ? MOVE_ZH.exec(t) : MOVE_EN.exec(t);
  const raw = (m ?? loose)?.[1].trim().replace(/['’]s$/, "") ?? null;
  const place = raw && !(!zh && NOT_A_PLACE.test(raw)) ? raw : null;
  if (!place) return { kind: "none", place: null };
  if (zh ? QUESTION_ZH.test(t) : QUESTION_EN.test(t)) return { kind: "question", place };
  if (zh ? JOKE_ZH.test(t) : JOKE_EN.test(t)) return { kind: "joke", place };
  if (zh ? PAST_ZH.test(t) : PAST_EN.test(t)) return { kind: "past", place };
  if (zh ? HYPO_ZH.test(t) : HYPO_EN.test(t)) return { kind: "hypothetical", place };
  if (!m || (zh ? NEG_ZH.test(t) : NEG_EN.test(m[0]))) return { kind: "none", place: null };
  return { kind: "intention", place };
}

/** Place words that are clearly a location even when this room has nothing like it (so "no such place" is said, not silence). */
const PLACE_NOUNS =
  /\b(library|kitchen|garden|park|market|shop|store|café|cafe|bar|tavern|inn|station|school|office|room|bedroom|hall|roof|rooftop|balcony|beach|river|lake|forest|temple|tower|castle|bakery|museum|church|square|home|house|window|door|shelf|bookshelf|table|rug|plant|lamp|bench|fountain|well|bridge|gate)\b|图书馆|厨房|花园|公园|市场|商店|咖啡|酒馆|客栈|车站|学校|办公室|房间|卧室|大厅|屋顶|阳台|海边|河边|湖边|森林|寺|塔|城堡|面包店|博物馆|广场|家|窗|门|书架|桌|地毯|植物|灯|长椅|喷泉|井|桥/i;

export const looksLikePlace = (place: string) => PLACE_NOUNS.test(place);

/**
 * Which object in this room the place words mean, by its tags (longest tag
 * wins). Null when there is nothing like it here.
 */
export function resolvePlace(place: string, objects: WorldObject[]): WorldObject | null {
  const p = place.toLowerCase().trim();
  if (!p) return null;
  let best: { o: WorldObject; len: number } | null = null;
  for (const o of objects) {
    for (const tag of o.tags) {
      const t = tag.toLowerCase();
      const cjk = /[㐀-鿿]/.test(t);
      // A one-character Chinese tag (书, 门, 窗) only counts on its own or at the start of a short phrase (窗边), so 图书馆 isn't 书.
      const hit = cjk ? (t.length === 1 ? p === t || (p.startsWith(t) && p.length <= 2) : p.includes(t) || t.includes(p)) : new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?($|[^a-z])`).test(p);
      if (hit && (!best || t.length > best.len)) best = { o, len: t.length };
    }
  }
  return best?.o ?? null;
}

/**
 * The goal a line creates, if any: { object } when the place exists here,
 * { object: null } when it clearly names a place that isn't here, null when
 * the line isn't a genuine intention to go somewhere.
 */
export function goalFromLine(text: string, objects: WorldObject[]): { place: string; object: WorldObject | null } | null {
  const c = classifyStatement(text);
  if (c.kind !== "intention" || !c.place) return null;
  const o = resolvePlace(c.place, objects);
  if (o) return { place: c.place, object: o };
  return looksLikePlace(c.place) ? { place: c.place, object: null } : null;
}
