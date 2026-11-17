/**
 * What did the speaker just say? A small rule-based reader (EN + 中文).
 * --------------------------------------------------------------------------
 * The game uses this as its own evidence: the AI may describe an exchange
 * however it likes, but a big relationship change (help, a promise kept, a
 * betrayal, a threat…) is only accepted when what was actually said supports
 * it. It also finds sensitive questions, opinions and requests to act, so
 * boundaries are checked BEFORE any reply is written.
 */
import type { InteractionKind } from "./types";

type Pat = { kind: InteractionKind; re: RegExp };

const PATTERNS: Pat[] = [
  { kind: "apology", re: /\b(?:sorry|apologi[sz]e|my fault|forgive me|i was wrong)\b|对不起|抱歉|是我不好|是我的错|原谅我|不好意思/i },
  { kind: "thanks", re: /\b(?:thank(?:s| you)|grateful|appreciate it)\b|谢谢|多谢|感谢/i },
  { kind: "make_promise", re: /\b(?:i promise|i swear|you have my word|i will make sure)\b|我保证|我发誓|我答应你|一定会/i },
  { kind: "keep_promise", re: /\b(?:as (?:i )?promised|kept my (?:word|promise)|like i said i would)\b|说到做到|我做到了|答应你的事/i },
  { kind: "break_promise", re: /\b(?:can't keep (?:my|that) promise|broke my promise|i won't be able to (?:come|make it))\b|食言|做不到了|没能遵守/i },
  { kind: "help", re: /\b(?:let me help|i(?:'ll| will| can) help|i brought you|i fixed|i covered for you|i'll carry|lean on me)\b|我帮你|我来帮|我来吧|帮你(?:拿|修|做)|交给我/i },
  { kind: "share_secret", re: /\b(?:never told anyone|my secret|between us|i've been hiding|confess)\b|从没告诉过|我的秘密|只告诉你|一直瞒着|坦白/i },
  { kind: "threat", re: /\b(?:or else|you'll regret|i'll hurt|i will make you pay|watch your back|i'll ruin)\b|你等着|小心我|让你后悔|饶不了你|毁了你/i },
  { kind: "insult", re: /\b(?:stupid|idiot|useless|pathetic|shut up|loser|i hate you)\b|笨蛋|蠢|没用|闭嘴|废物|讨厌你|可笑/i },
  { kind: "criticize", re: /\b(?:you always|you never|you should have|that was (?:wrong|bad)|you messed up|your fault)\b|你总是|你从来不|都怪你|你搞砸|你不该/i },
  { kind: "betrayal", re: /\b(?:i told (?:everyone|them) your|i sold you out|i lied to you about|i used you)\b|我把你的秘密|出卖了你|我一直在骗你|利用了你/i },
  { kind: "compliment", re: /\b(?:you(?:'re| are) (?:so |really |very )?(?:great|amazing|smart|clever|beautiful|pretty|cool|kind|brave|talented|wonderful|the best)|well done|nice work|good job|i (?:love|like|admire) your|impressive)\b|厉害|真棒|好棒|好看|漂亮|聪明|了不起|佩服|你真好|最棒/i },
  { kind: "provoke", re: /\b(?:bet you can't|scared\??|coward|prove it|loser)\b|不敢|胆小鬼|你行吗|有本事/i },
  { kind: "tease", re: /\b(?:just kidding|gotcha|silly)\b|开玩笑|逗你/i },
];

/** Interaction kinds the message supports (most specific first). */
export function classifyMessage(text: string): InteractionKind[] {
  const out: InteractionKind[] = [];
  for (const p of PATTERNS) if (p.re.test(text) && !out.includes(p.kind)) out.push(p.kind);
  return out;
}

// ---------------------------------------------------------------- requests

export type SensitiveTopic = { key: string; tier: "casual" | "sensitive" | "private"; re: RegExp };

/** Built-in sensitive topics (boundaries written in the Studio are matched separately). */
export const SENSITIVE: SensitiveTopic[] = [
  { key: "secrets", tier: "private", re: /\b(?:secrets?|hiding|hide from|keeping from)\b|秘密|瞒着|隐瞒|藏着什么/i },
  { key: "romance", tier: "private", re: /\b(?:crush|in love|love (?:her|him|them|me)|like (?:her|him|them|me) like that|feelings for|have feelings)\b|暗恋|喜欢(?:她|他|我|谁)|爱(?:她|他|我)|对.{0,6}有感情|心上人/i },
  { key: "fears", tier: "sensitive", re: /\b(?:afraid of|scared of|fear|frighten|what scares)\b|害怕|怕什么|恐惧/i },
  { key: "past", tier: "sensitive", re: /\b(?:your past|childhood|grew up|your family|your parents|what happened to you)\b|过去|小时候|童年|家人|父母|你经历过/i },
  { key: "plans", tier: "casual", re: /\b(?:your plans?|your goals?|what do you want)\b|计划|目标|你想要什么/i },
];

const QUESTION = /[?？]|\b(?:tell me|show me|what|why|who|how|do you|did you|are you|will you|would you|can you|have you)\b|告诉我|给我看|什么|为什么|谁|怎么|是不是|有没有|吗|呢/i;
export const isQuestion = (text: string) => QUESTION.test(text);

const TRUST_Q = /\b(?:do you trust me|trust me (?:completely|fully)|you trust me|can i trust you)\b|你信任我吗|信不信我|完全信任我|你相信我吗/i;
export const isTrustQuestion = (text: string) => TRUST_Q.test(text);

/** Asking them to DO something (suggestion, request, order). */
const ACTION = /\b(?:you should|we should|let's|let us|why don't you|you have to|you must|come with me|help me|give me|do it|go and)\b|你应该|我们应该|咱们|我们去|你得|你必须|跟我来|帮我|给我|去做/i;
export const isActionRequest = (text: string) => ACTION.test(text);

/** Stating a view. */
const OPINION = /\b(?:i think|i believe|in my opinion|honestly,|the truth is|it's obvious|clearly)\b|我觉得|我认为|我相信|说实话|显然|明明/i;
export const isOpinion = (text: string) => OPINION.test(text);

/** Gives a reason (an argument rather than a bare claim or an order). */
const REASON = /\b(?:because|since|so that|that's why|which means|the reason|for example|look at)\b|因为|所以|既然|这样就|比如|原因是|你看/i;
export const hasReason = (text: string) => REASON.test(text);

/**
 * Value themes and what goes against them. A request or opinion that pushes
 * against a character's written values / principles is never simply agreed to,
 * however much they like or trust the person saying it.
 */
export const VALUE_THEMES: { id: string; value: RegExp; against: RegExp }[] = [
  { id: "fairness", value: /\bfair(?:ness|ly)?\b|公平|公正/i, against: /\b(?:cheat|sabotage|trick (?:them|her|him)|rig|unfair|cut (?:through|in)|steal (?:the|her|his) lane)\b|作弊|使坏|耍手段|动手脚|抢.{0,3}航道/i },
  { id: "honesty", value: /\bhonest(?:y)?\b|\btruth\b|never lies?|诚实|不说谎|真话/i, against: /\b(?:lie|lying|deceive|pretend|keep it from|cover (?:it )?up)\b|撒谎|说谎|骗|隐瞒|假装/i },
  { id: "patience", value: /\bpatien(?:ce|t)\b|properly|carefully|耐心|做好|认真/i, against: /\b(?:rush|hurry|skip|cut corners|half-finished|just guess|faster|quick and dirty)\b|赶紧|随便|凑合|偷工减料|快点/i },
  { id: "loyalty", value: /\bloyal(?:ty)?\b|friends? first|忠诚|义气|朋友第一/i, against: /\b(?:abandon|leave (?:her|him|them) behind|betray|ditch|sell out)\b|丢下|抛弃|背叛|出卖/i },
  { id: "kindness", value: /\bkind(?:ness)?\b|gentle|善良|温柔/i, against: /\b(?:hurt (?:her|him|them)|humiliate|mock|make fun of|bully)\b|欺负|嘲笑|羞辱|伤害/i },
  { id: "pride", value: /\bpride\b|proud|骄傲|自尊/i, against: /\b(?:beg|give up|surrender|grovel|admit (?:you|she|he) lost)\b|求饶|认输|放弃|低头/i },
];

/** Value themes this text pushes against, given what a character values. */
export function valueConflicts(text: string, valuesText: string): string[] {
  return VALUE_THEMES.filter((t) => t.value.test(valuesText) && t.against.test(text)).map((t) => t.id);
}
