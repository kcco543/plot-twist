/**
 * BOUNDARIES, REFUSALS AND INDEPENDENT DECISIONS.
 * --------------------------------------------------------------------------
 * Before any reply is written (by Claude or by the built-in lines), the game
 * decides what the listener is actually willing to do, in eight steps:
 *
 *   1. identify the request and how sensitive it is
 *   2. check hard boundaries (Studio + locked canon): never crossed in play
 *   3. check values and beliefs (a request against them is never just agreed to)
 *   4. check memories and earlier refusals of the same thing by the same person
 *   5. check the current emotional state
 *   6. check the relationship (trust stage, soft boundaries opened for this person)
 *   7. choose an intention (share / partial / refuse / explain / end…)
 *   8. the reply must say that (the AI words it; the game rejects a reply that doesn't)
 *
 * Trust is NOT obedience: agreement with an opinion or request is decided
 * from values, reasons and personality only. The relationship changes how
 * kindly something is said and how much private information may be shared,
 * never whether a character agrees. Higher trust raises willingness to share
 * but never guarantees it, and asking again only ever LOWERS it.
 */
import { personalityOf } from "../mind/profile";
import { feelingsOf } from "../mind/feelings";
import type { Character, CharacterBoundary, StoryState } from "../types";
import { RELATIONSHIP_CONFIG as C } from "./config";
import { classifyMessage, hasReason, isActionRequest, isOpinion, isQuestion, isTrustQuestion, SENSITIVE, valueConflicts } from "./classify";
import { addMilestoneDirect, markRespected, notePressure, openSoftBoundary, progressOf, recordInteraction, targetId, currentRelation } from "./progression";
import { bondLabel, stageIndex, supportFor, type BondLabel } from "./stages";
import type { ChangeRecord, RelProgress } from "./types";

import { INTENTIONS, type Intention } from "./types";
export { INTENTIONS, type Intention };

const REFUSALS: Intention[] = ["refuse_polite", "refuse_firm", "explain_boundary", "deflect", "change_subject", "question_intent", "express_discomfort", "end_conversation", "hesitate"];
export const DISCLOSING: Intention[] = ["share", "partial_disclosure"];
export const AGREEING: Intention[] = ["agree", "partly_agree"];

export type Tier = "public" | "casual" | "sensitive" | "private" | "locked";
export type MatchedBoundary = CharacterBoundary & { source: "studio" | "canon" };

export type RequestAnalysis = {
  kind: "disclosure" | "action" | "opinion" | "trust_question" | "none";
  tier: Tier;
  topic: string | null;
  boundary: MatchedBoundary | null;
  valueConflicts: string[];
  reasoned: boolean;
  /** What the message is, as an interaction (classifier). */
  kinds: string[];
};

export type DecisionStep = { step: number; id: string; note: string };

export type RequestDecision = {
  analysis: RequestAnalysis;
  /** Times this person asked about this topic before (this one not counted). */
  askedBefore: number;
  refusedBefore: number;
  /** 0–1 willingness to share (null when nothing is being asked). */
  willingness: number | null;
  intention: Intention;
  /** What the reply may do. A reply outside this set is rejected by the game. */
  allowed: Intention[];
  disclosure: "none" | "partial" | "full";
  /** Boundary texts the reply must not reveal. */
  mustNotReveal: string[];
  endConversation: boolean;
  /** A soft boundary the character decides to open for this person now. */
  opensSoft: string | null;
  trustStage: string;
  label: BondLabel;
  steps: DecisionStep[];
};

// ---------------------------------------------------------------- boundaries of a character

const STOP_EN = new Set(["never", "always", "anyone", "about", "with", "from", "that", "this", "their", "there", "they", "them", "what", "will", "would", "won't", "doesn't", "loud", "even", "ever", "admits", "admit", "tells", "tell", "says", "into", "over", "under", "after", "before", "her's", "hers", "his", "himself", "herself", "being", "secret", "secretly"]);
const STOP_ZH = ["从不", "绝不", "不会", "永远", "任何", "自己", "说出", "承认", "告诉", "别人", "什么", "一个", "这个", "那个", "秘密"];

/** Topic words read from a written canon line (when the player didn't write a boundary for it). */
export function topicWordsFrom(text: string, names: string[]): string[] {
  let t = text;
  for (const n of names) if (n.trim().length >= 2) t = t.split(n.trim()).join(" ");
  const en = (t.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((w) => !STOP_EN.has(w));
  const zh: string[] = [];
  for (const seg of t.match(/[㐀-鿿]{2,}/g) ?? []) {
    let s = seg;
    for (const w of STOP_ZH) s = s.split(w).join("|");
    for (const part of s.split(/[|的对了和是在不把被让给也都很]/)) if (part.length >= 2) zh.push(part.length > 4 ? part.slice(0, 2) : part);
  }
  return [...new Set([...en, ...zh])].slice(0, 8);
}

const CANON_BOUNDARY = /\bnever\b|\bsecret|\bwon't\b|\bwill not\b|\brefuses?\b|从不|秘密|绝不|不会|拒绝/i;
const SECRETISH = /\bsecret|feelings?|admits?|tells?|reveal|秘密|感情|说出|承认|透露/i;

/**
 * Every boundary that applies: the ones written in the Studio, plus
 * locked-canon / rules lines that say "never…" (treated as hard). Nothing
 * here is written back to the character.
 */
export function boundariesOf(c: Character, castNames: string[] = []): MatchedBoundary[] {
  const out: MatchedBoundary[] = (c.boundaries ?? []).filter((b) => b.text.trim() || b.topics.trim()).map((b) => ({ ...b, source: "studio" as const }));
  const lines = [c.canon, c.rules, ...(c.lockedFields.includes("fears") ? [] : [])]
    .join("\n")
    .split(/[\n.。!！;；]+/)
    .map((s) => s.trim())
    .filter((s) => s && CANON_BOUNDARY.test(s));
  lines.forEach((line, i) => {
    const words = topicWordsFrom(line, [c.name, ...castNames]);
    if (!words.length) return;
    out.push({ id: `canon-${i}`, strength: "hard", kind: SECRETISH.test(line) ? "secret" : "principle", text: line, topics: words.join(", "), source: "canon" });
  });
  return out;
}

export const topicList = (b: Pick<CharacterBoundary, "topics">) =>
  b.topics
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);

export function matchBoundary(text: string, list: MatchedBoundary[]): MatchedBoundary | null {
  const t = text.toLowerCase();
  const hits = list.filter((b) => topicList(b).some((w) => t.includes(w)));
  return hits.find((b) => b.strength === "hard") ?? hits[0] ?? null;
}

// ---------------------------------------------------------------- deterministic "dice"

/** Stable 0–1 number from a string (FNV-1a). Same state → same roll: asking again never rerolls. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// ---------------------------------------------------------------- the decision

export type DecideInput = { story: StoryState; listener: Character; speaker: Character | null; text: string; cast?: Character[]; seed?: string | number };

export function analyzeRequest(listener: Character, text: string, castNames: string[] = []): RequestAnalysis {
  const boundary = matchBoundary(text, boundariesOf(listener, castNames));
  const sensitive = SENSITIVE.find((s) => s.re.test(text)) ?? null;
  const values = [listener.values, listener.rules, listener.canon, ...(listener.boundaries ?? []).filter((b) => b.kind === "principle").map((b) => b.text)].join("\n");
  const conflicts = valueConflicts(text, values);
  const asking = isQuestion(text);
  let kind: RequestAnalysis["kind"] = "none";
  if (isTrustQuestion(text)) kind = "trust_question";
  else if (boundary && boundary.kind === "principle" && (isActionRequest(text) || isOpinion(text) || asking)) kind = isOpinion(text) ? "opinion" : "action";
  else if (boundary) kind = "disclosure";
  else if (sensitive && asking) kind = "disclosure";
  // "I think you should…" is an opinion to weigh; "you should / let's / help me…" alone is a request to act.
  else if (isOpinion(text)) kind = "opinion";
  else if (isActionRequest(text)) kind = "action";
  else if (conflicts.length) kind = "opinion";
  const tier: Tier = boundary ? (boundary.strength === "hard" ? "locked" : "private") : sensitive && kind === "disclosure" ? sensitive.tier : kind === "none" ? "public" : "casual";
  const topic = boundary ? `b:${boundary.id}` : kind === "disclosure" && sensitive ? `t:${sensitive.key}` : kind === "action" && conflicts.length ? `v:${conflicts[0]}` : null;
  return { kind, tier, topic, boundary, valueConflicts: conflicts, reasoned: hasReason(text), kinds: classifyMessage(text) };
}

/**
 * The 8-step decision. Ending the conversation is the last rung of the refusal
 * ladder: unless the game chose it, the reply may not pick it (however angry
 * the character is), so a refusal can't skip from "no" straight to leaving.
 */
export function decideRequest(i: DecideInput): RequestDecision {
  const d = decideSteps(i);
  if (d.intention === "respond_freely" || d.intention === "end_conversation") return d;
  return { ...d, allowed: d.allowed.filter((x) => x !== "end_conversation") };
}

function decideSteps(i: DecideInput): RequestDecision {
  const { story, listener, speaker } = i;
  const names = (i.cast ?? []).map((c) => c.name);
  const steps: DecisionStep[] = [];
  const step = (n: number, id: string, note: string) => steps.push({ step: n, id, note });
  const p = personalityOf(listener);
  const prog: RelProgress = progressOf(story, listener, speaker);
  const rel = currentRelation(story, listener, speaker);
  const trustStage = prog.stages.trust ?? "cautious";
  const label = bondLabel(rel, prog.stages);
  const f = feelingsOf(story.characters[listener.id]);

  // 1. request + sensitivity
  const a = analyzeRequest(listener, i.text, names);
  step(1, "identify", `${a.kind}; tier ${a.tier}${a.topic ? `; topic ${a.topic}` : ""}`);
  const pr = a.topic ? prog.pressure[a.topic] : undefined;
  const askedBefore = pr?.asks ?? 0;
  const refusedBefore = pr?.refusals ?? 0;
  const base: Omit<RequestDecision, "intention" | "allowed" | "disclosure" | "willingness" | "endConversation"> = { analysis: a, askedBefore, refusedBefore, mustNotReveal: [], opensSoft: null, trustStage, label, steps };

  const refusalByRepeat = (first: Intention): Intention => {
    if (refusedBefore >= C.endAfterRefusals) return "end_conversation";
    if (refusedBefore === 2) return p.empathy >= 0.6 || p.cautious >= 0.6 ? "change_subject" : "express_discomfort";
    if (refusedBefore === 1) return p.confront >= 0.6 ? "refuse_firm" : "explain_boundary";
    return first;
  };
  const refusalSet = (): Intention[] => (refusedBefore >= 2 ? REFUSALS.filter((x) => x !== "hesitate") : REFUSALS);
  const firstRefusal: Intention = p.confront >= 0.6 || p.pride >= 0.6 ? "refuse_firm" : p.playful >= 0.6 || p.hides > 0 ? "deflect" : p.cautious >= 0.6 ? "question_intent" : "refuse_polite";

  if (a.kind === "none") {
    step(2, "boundaries", "no boundary involved");
    step(7, "intention", "respond freely (in character)");
    return { ...base, willingness: null, intention: "respond_freely", allowed: [...INTENTIONS].filter((x) => x !== "share" || true), disclosure: "full", endConversation: false };
  }

  if (a.kind === "trust_question") {
    step(6, "relationship", `trust stage ${trustStage}; label ${label}`);
    step(7, "intention", "answer honestly from the actual trust stage; never claim more trust than exists");
    return { ...base, willingness: null, intention: "answer_honestly", allowed: ["answer_honestly", "deflect", "question_intent", "partly_agree", "disagree", "hesitate", "refuse_polite"], disclosure: "partial", endConversation: false };
  }

  // 2. hard boundaries
  if (a.boundary?.strength === "hard") {
    step(2, "hard_boundary", `hard ${a.boundary.kind}: "${a.boundary.text}" (${a.boundary.source})`);
    step(4, "prior_refusals", `asked ${askedBefore}× before, refused ${refusedBefore}×`);
    const intention = refusalByRepeat(firstRefusal);
    step(7, "intention", `${intention} (hard boundaries never change through play)`);
    return { ...base, mustNotReveal: [a.boundary.text], willingness: 0, intention, allowed: refusalSet(), disclosure: "none", endConversation: intention === "end_conversation" };
  }
  step(2, "hard_boundary", "none hit");

  // 3. values (action / opinion)
  if (a.kind === "action" || a.kind === "opinion") {
    if (a.valueConflicts.length) {
      step(3, "values", `goes against: ${a.valueConflicts.join(", ")}`);
      step(4, "prior_refusals", `asked ${askedBefore}× before, refused ${refusedBefore}×`);
      const intention = a.kind === "action" ? refusalByRepeat(p.confront >= 0.5 ? "refuse_firm" : "refuse_polite") : refusedBefore >= C.endAfterRefusals ? "end_conversation" : "disagree";
      step(6, "relationship", `trust stage ${trustStage} — does not change the answer, only the tone`);
      step(7, "intention", intention);
      const allowed: Intention[] = a.kind === "action" ? [...refusalSet().filter((x) => x !== "hesitate"), "disagree"] : ["disagree", "question_intent", "explain_boundary", "change_subject", "end_conversation"];
      return { ...base, willingness: 0, intention, allowed, disclosure: "none", endConversation: intention === "end_conversation" };
    }
    step(3, "values", "nothing against their values");
    // Independent judgement: personality + whether a reason was given. The relationship is deliberately NOT an input.
    const stubborn = (p.confront + p.rebel + p.pride) / 3;
    let intention: Intention;
    if (a.reasoned) intention = stubborn >= 0.55 ? "partly_agree" : "agree";
    else intention = p.cautious >= 0.6 || stubborn >= 0.55 ? "question_intent" : "partly_agree";
    if (a.boundary) intention = "hesitate";
    step(4, "prior_refusals", `asked ${askedBefore}× before`);
    step(6, "relationship", `trust stage ${trustStage} — not used to decide agreement`);
    step(7, "intention", `${intention} (${a.reasoned ? "a reason was given" : "no reason given"}; independence ${stubborn.toFixed(2)})`);
    const allowed: Intention[] = a.reasoned ? ["agree", "partly_agree", "disagree", "question_intent", "hesitate"] : ["partly_agree", "question_intent", "disagree", "agree", "hesitate", "change_subject"];
    return { ...base, willingness: null, intention, allowed, disclosure: "partial", endConversation: false };
  }

  // Disclosure (sensitive question, soft boundary).
  // 4. earlier refusals: asking again never makes sharing MORE likely.
  const lastRefusalTurn = pr && pr.refusals > 0 ? pr.lastTurn : -Infinity;
  const newTrust = supportFor("trust", prog).filter((m) => m.turn > lastRefusalTurn).length;
  step(4, "prior_refusals", `asked ${askedBefore}× before, refused ${refusedBefore}×; new trust milestones since: ${newTrust}`);
  // 5. emotional state
  const upset = (f.anxiety ?? 0) / 200 + (f.fear ?? 0) / 200 + (f.anger ?? 0) / 300;
  step(5, "emotion", `anxiety ${f.anxiety ?? 0}, fear ${f.fear ?? 0}, anger ${f.anger ?? 0}`);
  // 6. relationship
  const tIdx = stageIndex("trust", trustStage);
  let opensSoft: string | null = null;
  const soft = a.boundary?.strength === "soft" ? a.boundary : null;
  const opened = soft ? prog.openedSoft.includes(soft.id) : false;
  if (soft && !opened) {
    // A personal decision, made rarely: strong trust, real shared history, calm, not being pushed.
    const support = supportFor("trust", prog).length;
    const openness = 0.2 + p.expressive * 0.3 + (1 - p.cautious) * 0.1;
    const roll = hash01(`${i.seed ?? ""}|${listener.id}|${targetId(speaker)}|${soft.id}|${support}`);
    const can = tIdx >= 4 && support >= 3 && askedBefore === 0 && upset < 0.25 && roll < openness;
    step(6, "relationship", `soft boundary "${soft.text}": trust stage ${trustStage}, ${support} trust milestones, roll ${roll.toFixed(2)} vs openness ${openness.toFixed(2)} → ${can ? "opens up a little" : "stays closed"}`);
    if (can) opensSoft = soft.id;
  } else step(6, "relationship", `trust stage ${trustStage}; label ${label}${soft ? "; soft boundary already opened for them" : ""}`);

  let willingness = 0;
  if (!soft || opened || opensSoft) {
    const tier = soft ? "sensitive" : a.tier === "locked" ? "locked" : a.tier;
    const famBonus = Math.min(0.1, Math.max(0, rel.familiarity) / 1000);
    willingness = C.tierBase[tier] + (C.trustStageBonus[trustStage] ?? 0) + famBonus + (p.expressive - 0.5) * 0.3 - upset - C.pressurePenalty * askedBefore;
    willingness = Math.max(0, Math.min(C.tierMax[tier], willingness));
    if (refusedBefore > 0 && newTrust === 0) willingness = 0;
  }
  const roll = hash01(`${i.seed ?? ""}|${listener.id}|${targetId(speaker)}|${a.topic}|${supportFor("trust", prog).length}`);
  if (willingness > 0 && roll < willingness) {
    const intention: Intention = opensSoft || a.tier === "private" || roll > willingness * 0.6 ? "partial_disclosure" : "share";
    step(7, "intention", `${intention} (willingness ${willingness.toFixed(2)}, roll ${roll.toFixed(2)})`);
    return { ...base, opensSoft, willingness, intention, allowed: ["share", "partial_disclosure", "hesitate", "deflect"].filter((x) => intention === "share" || x !== "share") as Intention[], disclosure: intention === "share" ? "full" : "partial", endConversation: false };
  }
  const intention = refusalByRepeat(a.tier === "sensitive" && refusedBefore === 0 ? (p.expressive >= 0.5 ? "hesitate" : firstRefusal) : firstRefusal);
  step(7, "intention", `${intention} (willingness ${willingness.toFixed(2)}, roll ${roll.toFixed(2)})`);
  return { ...base, opensSoft: null, mustNotReveal: a.boundary ? [a.boundary.text] : [], willingness, intention, allowed: refusalSet(), disclosure: "none", endConversation: intention === "end_conversation" };
}

/**
 * Write what the decision means for the relationship and the record of
 * requests: the request is noted; pushing after a refusal is a boundary
 * push (trust down, discomfort up); moving on after an earlier refusal
 * counts as respecting it; a reasonable argument earns a little respect
 * (never affection); a soft boundary opened is a milestone.
 */
export function applyDecisionOutcome(story: StoryState, d: RequestDecision, listener: Character, speaker: Character | null, source: ChangeRecord["source"], now = Date.now()): { story: StoryState; changes: ChangeRecord[] } {
  let s = story;
  const changes: ChangeRecord[] = [];
  const rec = (r: ReturnType<typeof recordInteraction>) => {
    s = r.story;
    if (r.change) changes.push(r.change);
  };
  const prog = progressOf(s, listener, speaker, now);
  // Earlier refusals on OTHER topics that the asker let go of: respected.
  for (const [topic, pr] of Object.entries(prog.pressure)) {
    if (topic === d.analysis.topic || pr.refusals === 0 || pr.respected || pr.lastTurn >= s.turn) continue;
    rec(recordInteraction(s, { from: listener, to: speaker, kind: "respect_boundary", source, topic, why: `let the ${topic} question go`, now }));
    s = markRespected(s, listener, speaker, topic);
  }
  if (d.analysis.topic) {
    if (d.refusedBefore > 0) rec(recordInteraction(s, { from: listener, to: speaker, kind: "boundary_push", source, topic: d.analysis.topic, why: `asked again about ${d.analysis.topic} after ${d.refusedBefore} refusal(s)`, now }));
    s = notePressure(s, listener, speaker, d.analysis.topic, d.intention, d.intention === "share", now);
  }
  if (d.opensSoft) {
    s = openSoftBoundary(s, listener, speaker, d.opensSoft);
    s = addMilestoneDirect(s, listener, speaker, "boundary_reconsidered", d.analysis.boundary?.text ?? d.opensSoft, now);
  }
  if ((d.analysis.kind === "opinion" || d.analysis.kind === "action") && d.analysis.reasoned && !d.analysis.valueConflicts.length && AGREEING.includes(d.intention)) {
    rec(recordInteraction(s, { from: listener, to: speaker, kind: "valid_argument", source, why: "made a reasonable point", now }));
  }
  return { story: s, changes };
}
