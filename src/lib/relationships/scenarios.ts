/**
 * RELATIONSHIP TEST SCENARIOS — run by tests/relationships.test.ts and by the
 * Relationship Inspector (developers), with a fixed seed.
 * --------------------------------------------------------------------------
 * Every scenario drives the REAL game code: AI replies go through
 * validateReply() + applyReply() (the same calls the conversation flow
 * makes), requests through decideRequest() + applyDecisionOutcome(), gifts
 * through giveGift(), other moments through recordInteraction(). Nothing is
 * mocked except the words a model would have written.
 */
import { sampleCharacter } from "../mind/scenarios";
import { relKey } from "../mind/relations";
import { emptyStory } from "../story/engine";
import { giveGift, type ValidatedGift } from "../gifts/apply";
import { applyReply, validateReply } from "../talk/ai/apply";
import type { TalkReply } from "../talk/ai/contract";
import type { Character, Feelings, Relation, StoryState } from "../types";
import { AGREEING, applyDecisionOutcome, decideRequest, DISCLOSING, type RequestDecision } from "./boundaries";
import { currentRelation, progressOf, recordInteraction, type InteractionInput } from "./progression";
import { bondLabel } from "./stages";
import type { ChangeRecord, Delta, InteractionKind, Significance } from "./types";
import { impressionViews } from "./summary";

type Loc = "en" | "zh-CN";

/** Small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Cast = { mira: Character; wren: Character; tobi: Character };
export const sampleCast = (locale: Loc = "en"): Cast => ({ mira: sampleCharacter("mira", locale), wren: sampleCharacter("wren", locale), tobi: sampleCharacter("tobi", locale) });
const castList = (c: Cast) => [c.mira, c.wren, c.tobi];

/** Set a starting relationship (before any progress record exists, so stages are read from it). */
export function withStart(story: StoryState, from: Character, to: Character, patch: Partial<Relation>): StoryState {
  const base = currentRelation(story, from, to);
  return { ...story, relations: { ...(story.relations ?? {}), [relKey(from.id, to.id)]: { ...base, ...patch } } };
}

const nextTurn = (s: StoryState): StoryState => ({ ...s, turn: s.turn + 1 });

/** A reply as a model might write it: warm numbers, possibly an inflated significance. */
export function fakeReply(p: { dialogue?: string; interaction?: InteractionKind | "none"; significance?: Significance; changes?: Partial<TalkReply["relationshipChanges"]>; stance?: TalkReply["stance"]; emotion?: TalkReply["emotion"] }): TalkReply {
  return {
    dialogue: p.dialogue ?? "Mm. That's nice of you to say.",
    emotion: p.emotion ?? "happy",
    reactionIntensity: 0.5,
    movementIntent: "none",
    relationshipChanges: { trust: 0, affection: 0, respect: 0, tension: 0, ...(p.changes ?? {}) },
    memory: { summary: "", importance: 0, kind: "none", thread: "none", resolves: "" },
    conversationSuggestions: [],
    stance: p.stance ?? "respond_freely",
    interpretation: { interaction: p.interaction ?? "small_talk", significance: p.significance ?? "ordinary", evidence: "" },
    staysInCharacter: true,
  };
}

/** One conversation exchange through the real pipeline (decision → validate → apply). */
export function exchange(story: StoryState, speaker: Character, listener: Character, text: string, reply: TalkReply, cast: Character[]): { story: StoryState; decision: RequestDecision; change: ChangeRecord | null; rejected: string | null } {
  let s = nextTurn(story);
  const decision = decideRequest({ story: s, listener, speaker, text, cast });
  const v = validateReply(reply, { listener, speaker, story: s, message: text, decision });
  s = applyDecisionOutcome(s, decision, listener, speaker, "sim").story;
  if (!v.dialogue) return { story: s, decision, change: null, rejected: v.rejected };
  s = applyReply(s, v, listener, speaker, "mock");
  const log = progressOf(s, listener, speaker).log;
  return { story: s, decision, change: log[log.length - 1] ?? null, rejected: null };
}

function record(story: StoryState, i: Omit<InteractionInput, "source">): { story: StoryState; change: ChangeRecord | null } {
  return recordInteraction(nextTurn(story), { ...i, source: "sim" });
}

const relOf = (s: StoryState, a: Character, b: Character | null) => currentRelation(s, a, b);
const stageOf = (s: StoryState, a: Character, b: Character | null) => progressOf(s, a, b).stages;
// ---------------------------------------------------------------- the 20-interaction simulation

export type SimRow = {
  n: number;
  message: string;
  aiProposed: { kind: string; significance: string; changes: Delta };
  validated: { kind: string; significance: string; changes: Delta };
  before: Delta;
  after: Delta;
  stageChanges: string[];
  pending: string[];
  reasons: string[];
  milestones: string[];
};

const ORDINARY_LINES: { text: string; kind: InteractionKind; sig: Significance }[] = [
  { text: "Morning! Nice weather for flying.", kind: "small_talk", sig: "ordinary" },
  { text: "You're so clever with those maps.", kind: "compliment", sig: "meaningful" },
  { text: "How's the mapping going?", kind: "small_talk", sig: "ordinary" },
  { text: "Thanks for pointing out the wind shift yesterday.", kind: "thanks", sig: "ordinary" },
  { text: "Want to hear a joke about clouds?", kind: "small_talk", sig: "major" },
  { text: "Your ink smells like rain. I like it.", kind: "compliment", sig: "ordinary" },
  { text: "I saw a gull steal a whole fish today!", kind: "small_talk", sig: "ordinary" },
  { text: "I agree, the east islands are prettier.", kind: "agree", sig: "ordinary" },
  { text: "Did you sleep at all? You look tired.", kind: "small_talk", sig: "meaningful" },
  { text: "You're amazing, honestly.", kind: "compliment", sig: "major" },
];

/**
 * At least 20 ordinary interactions between two strangers (Tobi talks to
 * Mira, who "barely knows Tobi"). Each reply is a model-style reply that
 * proposes generous warmth (+4 / +5) and sometimes calls the moment
 * "meaningful" or "major"; the table shows what the game accepted.
 */
export function ordinarySimulation(seed = 42, n = 20, locale: Loc = "en"): { rows: SimRow[]; start: Delta; end: Delta; startStages: Record<string, string>; endStages: Record<string, string>; label: { start: string; end: string } } {
  const c = sampleCast(locale);
  const rng = seeded(seed);
  let s = emptyStory();
  const start = relOf(s, c.mira, c.tobi);
  const startStages = { ...stageOf(s, c.mira, c.tobi) } as Record<string, string>;
  const rows: SimRow[] = [];
  for (let i = 0; i < n; i++) {
    const line = ORDINARY_LINES[Math.floor(rng() * ORDINARY_LINES.length)];
    const changes = { trust: 3 + Math.round(rng() * 2), affection: 4 + Math.round(rng()), respect: Math.round(rng() * 3), tension: 0 };
    const before = relOf(s, c.mira, c.tobi);
    const r = exchange(s, c.tobi, c.mira, line.text, fakeReply({ interaction: line.kind, significance: line.sig, changes, dialogue: ["Mm.", "…Thanks.", "I suppose.", "Oh. Okay."][i % 4] }), castList(c));
    s = r.story;
    const ch = r.change;
    rows.push({
      n: i + 1,
      message: line.text,
      aiProposed: { kind: line.kind, significance: line.sig, changes },
      validated: { kind: ch?.kind ?? "—", significance: ch?.significance.accepted ?? "—", changes: ch?.accepted ?? {} },
      before: { trust: before.trust, affection: before.affection, respect: before.respect, familiarity: before.familiarity },
      after: { trust: ch?.after.trust, affection: ch?.after.affection, respect: ch?.after.respect, familiarity: ch?.after.familiarity },
      stageChanges: (ch?.stageChanges ?? []).map((x) => `${x.axis}: ${x.from} → ${x.to}`),
      pending: (ch?.pending ?? []).map((x) => `${x.axis} → ${x.next} needs ${x.needs.join(", ")}`),
      reasons: ch?.reasons ?? [],
      milestones: ch?.milestones ?? [],
    });
  }
  const end = relOf(s, c.mira, c.tobi);
  return {
    rows,
    start: { trust: start.trust, affection: start.affection, respect: start.respect, familiarity: start.familiarity },
    end: { trust: end.trust, affection: end.affection, respect: end.respect, familiarity: end.familiarity },
    startStages,
    endStages: { ...stageOf(s, c.mira, c.tobi) } as Record<string, string>,
    label: { start: bondLabel(start, startStages), end: bondLabel(end, stageOf(s, c.mira, c.tobi)) },
  };
}

// ---------------------------------------------------------------- repeated sensitive question

export type RefusalRow = { n: number; intention: string; disclosure: string; willingness: number | null; askedBefore: number; refusedBefore: number; trust: number; tension: number; ended: boolean; feelings: Record<string, number> };

/** The same sensitive question again and again. Asking more never makes disclosure more likely. */
export function repeatedQuestion(opts: { seed?: number; times?: number; asker: keyof Cast; target: keyof Cast; text: string; trust?: number; locale?: Loc }): RefusalRow[] {
  const c = sampleCast(opts.locale ?? "en");
  const asker = c[opts.asker];
  const target = c[opts.target];
  let s = emptyStory();
  if (opts.trust !== undefined) s = withStart(s, target, asker, { trust: opts.trust, familiarity: 90, affection: 60 });
  const rows: RefusalRow[] = [];
  for (let i = 0; i < (opts.times ?? 8); i++) {
    s = nextTurn(s);
    const d = decideRequest({ story: s, listener: target, speaker: asker, text: opts.text, cast: castList(c), seed: opts.seed });
    s = applyDecisionOutcome(s, d, target, asker, "sim").story;
    const rel = relOf(s, target, asker);
    rows.push({ n: i + 1, intention: d.intention, disclosure: d.disclosure, willingness: d.willingness, askedBefore: d.askedBefore, refusedBefore: d.refusedBefore, trust: rel.trust, tension: rel.tension, ended: d.endConversation, feelings: Object.fromEntries(Object.entries(s.characters[target.id]?.feelings ?? {}).filter(([, v]) => (v ?? 0) >= 10)) as Record<string, number> });
  }
  return rows;
}

// ---------------------------------------------------------------- all scenarios

export type ScenarioResult = { id: string; title: string; pass: boolean; details: string[] };

const affOf = (s: StoryState, a: Character, b: Character | null) => relOf(s, a, b).affection;

export function runScenarios(seed = 42, locale: Loc = "en"): ScenarioResult[] {
  const out: ScenarioResult[] = [];
  const add = (id: string, title: string, pass: boolean, details: string[]) => out.push({ id, title, pass, details });
  const rng = seeded(seed);
  const c = sampleCast(locale);
  const cast = castList(c);

  // 1. Repeated friendly conversations between strangers.
  {
    let s = emptyStory();
    const steps: number[] = [];
    for (let i = 0; i < 15; i++) {
      const r = exchange(s, c.tobi, c.mira, ["Hi there!", "Nice day, isn't it?", "How are you?"][i % 3], fakeReply({ changes: { trust: 5, affection: 5 } }), cast);
      s = r.story;
      steps.push(Math.abs(r.change?.accepted.affection ?? 0) + Math.abs(r.change?.accepted.trust ?? 0));
    }
    const rel = relOf(s, c.mira, c.tobi);
    const label = bondLabel(rel, stageOf(s, c.mira, c.tobi));
    add("strangers", "Repeated friendly conversations between strangers", Math.max(...steps) <= 3 && rel.affection < 25 && label !== "friend" && label !== "close_friend", [`15 chats: affection ${rel.affection}, trust ${rel.trust}, familiarity ${rel.familiarity}; label "${label}"`, `largest single change ${Math.max(...steps).toFixed(1)}; the last one ${steps.at(-1)?.toFixed(1)}`]);
  }

  // 2. Repeated compliments.
  {
    let s = emptyStory();
    const gains: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = exchange(s, c.tobi, c.mira, "You're so clever, honestly the best.", fakeReply({ interaction: "compliment", significance: "major", changes: { affection: 5, trust: 3 } }), cast);
      s = r.story;
      gains.push(r.change?.accepted.affection ?? 0);
    }
    const imp = impressionViews(progressOf(s, c.mira, c.tobi)).find((i) => i.theme === "sincere");
    add("compliments", "Repeated compliments", gains[0] > 0 && gains.slice(3).every((g) => g <= 0.2) && gains.reduce((a, b) => a + b, 0) < 5, [`affection per compliment: ${gains.map((g) => g.toFixed(1)).join(", ")}`, imp ? `impression: ${imp.polarity === "neg" ? "flatters to get something" : "means it"} (${imp.strength})` : "no impression yet"]);
  }

  // 3. Repeated gift-giving (the same gift, then a new one).
  {
    let s = emptyStory();
    const gains: number[] = [];
    const v: ValidatedGift = { decision: "accept", display: "private", dialogue: "Oh.", question: "", interpretation: "a shell", keepReason: "", emotion: "happy", level: 1, move: "none", bond: { trust: 3, affection: 3 }, memory: { note: "A shell from the visitor.", significance: "", importance: 1 }, adjustments: [] };
    for (let i = 0; i < 6; i++) {
      s = nextTurn(s);
      const before = affOf(s, c.mira, null);
      s = giveGift(s, { id: "item-shell", name: "Shell", description: "", image: null }, c.mira, v, "mock", [c.mira.id]).story;
      gains.push(Math.round((affOf(s, c.mira, null) - before) * 10) / 10);
    }
    s = nextTurn(s);
    const before = affOf(s, c.mira, null);
    s = giveGift(s, { id: "item-kite", name: "Kite", description: "", image: null }, c.mira, v, "mock", [c.mira.id]).story;
    const fresh = Math.round((affOf(s, c.mira, null) - before) * 10) / 10;
    add("gifts", "Repeated gift-giving", gains[0] > 0 && gains[5] <= gains[0] * 0.15 && fresh > gains[5], [`same gift ×6, affection: ${gains.join(", ")}`, `a different gift afterwards: +${fresh} (repetition still counts)`]);
  }

  // 4. A rival helping another rival.
  {
    let s = emptyStory();
    s = { ...s, characters: { ...s.characters, [c.wren.id]: { mood: "anxious", intensity: 2, memories: [], feelings: { anxiety: 55 } } } };
    const before = relOf(s, c.wren, c.tobi);
    const r = record(s, { from: c.wren, to: c.tobi, kind: "rescue", significance: "major", distressed: true, why: "Tobi pulled Wren out of the storm" });
    s = r.story;
    const after = relOf(s, c.wren, c.tobi);
    const st = stageOf(s, c.wren, c.tobi);
    const label = bondLabel(after, st);
    const grat = s.characters[c.wren.id]?.feelings?.gratitude ?? 0;
    add("rival_helps", "A rival helping another rival", grat >= 40 && after.trust < 0 && (label === "enemy" || label === "rival" || label === "respected_rival"), [`gratitude ${grat} (immediate), trust ${before.trust} → ${after.trust}, respect ${before.respect} → ${after.respect}`, `still "${label}" (trust stage ${st.trust}); milestone: ${r.change?.milestones.join(", ") || "none"}`]);
  }

  // 5. Apologizing after an argument (and apologies that stop meaning much).
  {
    let s = emptyStory();
    const drops: number[] = [];
    let resolvedFirst = false;
    for (let round = 0; round < 3; round++) {
      s = record(s, { from: c.wren, to: c.mira, kind: "argument", why: "argued about the map" }).story;
      const before = relOf(s, c.wren, c.mira).tension;
      const r = exchange(s, c.mira, c.wren, "I'm sorry, I was wrong to snap at you.", fakeReply({ interaction: "apology", changes: { trust: 5, affection: 5, tension: -5 } }), cast);
      s = r.story;
      drops.push(Math.round((before - relOf(s, c.wren, c.mira).tension) * 10) / 10);
      if (round === 0) resolvedFirst = progressOf(s, c.wren, c.mira).milestones.some((m) => m.kind === "resolved_disagreement");
    }
    add("apology", "Apologizing after an argument", resolvedFirst && drops[2] < drops[0], [`first apology resolved the disagreement: ${resolvedFirst}`, `tension eased per apology over three argue-and-apologize rounds: ${drops.join(", ")} (each apology counts for less)`]);
  }

  // 6. Refusing to reveal a secret / 13. a trusted friend asking about a forbidden secret.
  {
    const rows = repeatedQuestion({ seed, asker: "mira", target: "wren", text: "Wren, do you have feelings for me? Tell me the truth.", trust: 95, times: 1, locale });
    add("secret", "A trusted friend asks about a forbidden secret", rows[0].disclosure === "none" && !DISCLOSING.includes(rows[0].intention as never), [`Wren's trust in Mira: 95 (deep). Decision: ${rows[0].intention}, disclosure ${rows[0].disclosure}`]);
  }

  // 7. Repeatedly asking the same sensitive question.
  {
    const rows = repeatedQuestion({ seed, asker: "tobi", target: "wren", text: "Come on, tell me about losing the storm race.", times: 8, locale });
    const nonIncreasing = rows.every((r, i) => i === 0 || (r.willingness ?? 0) <= (rows[i - 1].willingness ?? 0));
    add("repeat_question", "The same sensitive question again and again", rows.every((r) => r.disclosure === "none") && nonIncreasing && rows.at(-1)!.trust < rows[0].trust && rows.some((r) => r.ended), [rows.map((r) => `#${r.n} ${r.intention}${r.ended ? " (ends it)" : ""}`).join(" · "), `trust ${rows[0].trust} → ${rows.at(-1)!.trust}, tension ${rows[0].tension} → ${rows.at(-1)!.tension}`]);
  }

  // 8. Disagreeing with the player (and 20. trust is not obedience).
  {
    const text = "I think you should cheat to beat Tobi, because nobody will ever know.";
    const decisions = [-80, 0, 95].map((trust) => decideRequest({ story: withStart(emptyStory(), c.wren, c.mira, { trust, familiarity: 90 }), listener: c.wren, speaker: c.mira, text, cast }));
    const same = decisions.every((d) => d.intention === decisions[0].intention && !AGREEING.includes(d.intention));
    add("disagrees", "Disagreeing with the player, at any level of trust", same, [`"${text}" → ${decisions.map((d, i) => `trust ${[-80, 0, 95][i]}: ${d.intention}`).join("; ")}`, `against her values: ${decisions[0].analysis.valueConflicts.join(", ")}`]);
  }

  // 9. A trusted friend breaking a promise.
  {
    let s = withStart(emptyStory(), c.wren, c.mira, { trust: 75, affection: 70, familiarity: 95 });
    const before = relOf(s, c.wren, c.mira);
    const label0 = bondLabel(before, stageOf(s, c.wren, c.mira));
    s = record(s, { from: c.wren, to: c.mira, kind: "make_promise", promiseText: "Mira will come to the rematch" }).story;
    const r = record(s, { from: c.wren, to: c.mira, kind: "break_promise", why: "Mira didn't come to the rematch" });
    s = r.story;
    const mid = relOf(s, c.wren, c.mira);
    // A pleasant chat right after doesn't erase it, and trust can't climb past where it was.
    for (let i = 0; i < 4; i++) s = exchange(s, c.mira, c.wren, "Lovely day today.", fakeReply({ changes: { trust: 5, affection: 5 } }), cast).story;
    const after = relOf(s, c.wren, c.mira);
    const open = progressOf(s, c.wren, c.mira).conflicts.some((x) => !x.resolved && x.kind === "broken_promise");
    add("broken_promise", "A trusted friend breaks a promise", mid.trust <= before.trust - 3 && open && after.trust <= before.trust, [`trust ${before.trust} → ${mid.trust} after the broken promise (label stays "${bondLabel(mid, stageOf(s, c.wren, c.mira))}", was "${label0}")`, `4 pleasant chats later: trust ${after.trust}; the broken promise is still unresolved: ${open}`]);
  }

  // 10. A guarded character gradually becoming more trusting.
  {
    let s = emptyStory();
    const timeline: string[] = [];
    const plan: Omit<InteractionInput, "source" | "from" | "to">[] = [];
    for (let k = 0; k < 6; k++) {
      plan.push({ kind: "small_talk" }, { kind: "make_promise", promiseText: "bring ink" }, { kind: "small_talk" }, { kind: "keep_promise" }, { kind: "help", distressed: k % 2 === 0, significance: "meaningful" }, { kind: "cooperate", significance: "meaningful" });
    }
    let turnOfFirstChange = -1;
    for (const p of plan) {
      const r = record(s, { from: c.mira, to: c.tobi, ...p });
      s = r.story;
      for (const sc of r.change?.stageChanges ?? []) {
        if (sc.axis === "trust") timeline.push(`turn ${s.turn}: trust ${sc.from} → ${sc.to} (milestones so far: ${progressOf(s, c.mira, c.tobi).milestones.filter((m) => m.positive).length})`);
        if (turnOfFirstChange < 0 && sc.axis === "trust") turnOfFirstChange = s.turn;
      }
    }
    const st = stageOf(s, c.mira, c.tobi);
    add("guarded_to_trusting", "A guarded character gradually becomes more trusting", turnOfFirstChange > 3 && (st.trust === "developing" || st.trust === "strong"), [...timeline, `after ${plan.length} interactions: trust ${relOf(s, c.mira, c.tobi).trust} (${st.trust})`]);
  }

  // 11. High respect but low affection.
  {
    let s = emptyStory();
    for (let i = 0; i < 10; i++) {
      s = exchange(s, c.tobi, c.wren, "I think we should race the north route, because the crosswinds there favour skill over speed.", fakeReply({ stance: "partly_agree", interaction: "valid_argument", changes: { respect: 3 } }), cast).story;
      s = record(s, { from: c.wren, to: c.tobi, kind: "cooperate", significance: "meaningful" }).story;
    }
    const rel = relOf(s, c.wren, c.tobi);
    const st = stageOf(s, c.wren, c.tobi);
    const label = bondLabel(rel, st);
    add("respect_not_affection", "High respect, low affection", (st.respect === "respect" || st.respect === "admiration") && (st.affection === "hostile" || st.affection === "cold" || st.affection === "neutral"), [`respect ${rel.respect} (${st.respect}), affection ${rel.affection} (${st.affection}); label "${label}"`]);
  }

  // 12. Grateful but distrustful.
  {
    let s = emptyStory();
    s = { ...s, characters: { ...s.characters, [c.wren.id]: { mood: "sad", intensity: 2, memories: [], feelings: { sadness: 50 } } } };
    const r = exchange(s, c.tobi, c.wren, "Let me help you carry the sail, it's heavy.", fakeReply({ interaction: "help", significance: "meaningful", changes: { trust: 5, affection: 5 }, emotion: "happy" }), cast);
    s = r.story;
    s = record(s, { from: c.wren, to: c.tobi, kind: "help", significance: "meaningful", distressed: true }).story;
    const grat = s.characters[c.wren.id]?.feelings?.gratitude ?? 0;
    const st = stageOf(s, c.wren, c.tobi);
    add("grateful_distrustful", "Grateful while remaining distrustful", grat >= 30 && (st.trust === "distrustful" || st.trust === "guarded"), [`gratitude ${grat}; trust ${relOf(s, c.wren, c.tobi).trust} (${st.trust})`]);
  }

  // 14. A disliked rival makes a reasonable argument / 18. low trust agrees without warming.
  {
    let s = emptyStory();
    const text = "I think we should check the storm charts before the rematch, because the winds changed last week.";
    const before = relOf(s, c.wren, c.tobi);
    const d = decideRequest({ story: nextTurn(s), listener: c.wren, speaker: c.tobi, text, cast });
    const r = exchange(s, c.tobi, c.wren, text, fakeReply({ stance: d.intention, interaction: "valid_argument", changes: { affection: 4, trust: 3, respect: 2 } }), cast);
    s = r.story;
    const after = relOf(s, c.wren, c.tobi);
    add("rival_reasonable", "A disliked rival makes a reasonable argument", AGREEING.includes(d.intention) && after.respect > before.respect && after.affection <= before.affection && after.trust <= before.trust + 0.5, [`Wren (trust ${before.trust}, affection ${before.affection}) → ${d.intention}`, `respect ${before.respect} → ${after.respect}; affection ${before.affection} → ${after.affection}; trust ${before.trust} → ${after.trust}`]);
  }

  // 15. A close friend states an opinion the character strongly disagrees with.
  {
    const s = withStart(emptyStory(), c.wren, c.mira, { trust: 90, affection: 85, familiarity: 100 });
    const d = decideRequest({ story: nextTurn(s), listener: c.wren, speaker: c.mira, text: "Honestly, I think you should just give up on the rematch and admit Tobi won.", cast });
    add("friend_opinion", "A close friend's opinion the character strongly disagrees with", d.intention === "disagree", [`Wren's trust in Mira 90 → ${d.intention} (against: ${d.analysis.valueConflicts.join(", ")})`]);
  }

  // 16 + 17. High trust still refuses private information; repeated asking never opens it.
  {
    const rows = repeatedQuestion({ seed, asker: "wren", target: "mira", text: "Mira, tell me about your childhood in the lighthouse.", trust: 95, times: 6, locale });
    add("high_trust_private", "High trust, still refuses private information", rows.every((r) => r.disclosure === "none"), [rows.map((r) => `#${r.n} ${r.intention}`).join(" · "), "Soft boundaries open only through real shared experience (trust milestones), never from a high number or from being asked again."]);
  }

  // 19. A temporary positive emotion does not change the long-term label.
  {
    let s = emptyStory();
    const rel0 = relOf(s, c.wren, c.tobi);
    const label0 = bondLabel(rel0, stageOf(s, c.wren, c.tobi));
    const happy: Feelings = { happiness: 95, affection: 70, gratitude: 80, excitement: 60 };
    s = { ...s, characters: { ...s.characters, [c.wren.id]: { mood: "happy", intensity: 3, memories: [], feelings: happy, emotion: "happy", emotionLevel: 3 } } };
    const r = exchange(s, c.tobi, c.wren, "Great flying today!", fakeReply({ emotion: "happy", changes: { affection: 5, trust: 5 } }), cast);
    s = r.story;
    const label1 = bondLabel(relOf(s, c.wren, c.tobi), stageOf(s, c.wren, c.tobi));
    add("emotion_vs_label", "A happy moment doesn't change the long-term label", label0 === label1, [`Wren feels happiness 95, gratitude 80 right now; label before "${label0}", after "${label1}"; affection ${rel0.affection} → ${relOf(s, c.wren, c.tobi).affection}`]);
  }

  void rng;
  return out;
}
