/**
 * CONVERSATION TOPICS — a rule-based library of things to say (no AI yet).
 * --------------------------------------------------------------------------
 * Each topic has a RULE that reads the situation and either rules the topic
 * out (null) or gives it a weight and a short reason the player can see:
 *
 *   speaker personality · listener personality · both moods · the speaker's
 *   view of the relationship · memories they share · recent story events ·
 *   the world and place
 *
 * suggestTopics() keeps the eligible ones, adds a little randomness, lowers
 * topics used recently with the same person and topics already offered in
 * this conversation, keeps at most one per group, and returns 2–3.
 *
 * Choosing a topic: the SPEAKER's line comes from talk.say.<topic>.<tone>
 * (both languages), applyTopic() writes the speaker's side to story state,
 * and the LISTENER answers through the existing behavior engine with the
 * topic's trigger (src/lib/mind), which moves them, shows their feeling and
 * words their reply.
 *
 * To add a topic: add it to TOPIC_DEFS, then its label + lines under
 * talk.topics / talk.say in both locale files (tests check both exist).
 */
import { makeId } from "../id";
import type { Character, EnvironmentTypeId, EventRecord, MemoryKind, Relation, StoryState, WorldId } from "../types";
import { emotionOf, type Emotion, type EmotionLevel } from "../emotion/emotions";
import { bondKey, neutralBond, neutralState } from "../story/engine";
import type { TriggerId } from "../mind/catalog";
import { memoryPull, remember } from "../mind/memory";
import { goalMentions, personalityOf, type PersonalityFactors } from "../mind/profile";
import { relationOf, type RelationDelta } from "../mind/relations";
import { recordInteraction } from "../relationships/progression";
import { TOPIC_KIND } from "../relationships/interactions";
import type { InteractionKind } from "../relationships/types";

export const TOPIC_IDS = [
  "howFeeling",
  "cheerUp",
  "worries",
  "recentDisagreement",
  "apologize",
  "betrayal",
  "challenge",
  "sharedMemory",
  "compliment",
  "tease",
  "confide",
  "askHelp",
  "theirGoal",
  "introduce",
  "place",
  "rumor",
] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

/** Why a topic is suggested (shown under the button). talk.reasons.<id> */
export const REASONS = ["looks", "argued", "tension", "betrayed", "rivals", "memory", "close", "playful", "trust", "yourGoal", "theirGoal", "stranger", "place", "world", "smallTalk"] as const;
export type ReasonId = (typeof REASONS)[number];

/** Shared memories a topic can bring up (talk.memory.<kind>). */
export const GOOD_MEMORIES: MemoryKind[] = ["helped", "cooperated", "reunion", "promise", "secret", "complimented", "teased", "met"];
const SORE_MEMORIES: MemoryKind[] = ["argument", "provoked", "criticized", "rejected"];
const UNSETTLING: EnvironmentTypeId[] = ["ruins", "dreamscape"];
const LOW: Emotion[] = ["sad", "anxious", "frustrated", "embarrassed"];
const HOT: Emotion[] = ["angry", "frustrated"];

export type TalkContext = {
  actor: Character;
  target: Character;
  p: PersonalityFactors;
  q: PersonalityFactors;
  /** How the speaker feels about the listener (directional). */
  rel: Relation;
  /** What the listener's face shows (what the speaker can see). */
  targetEmotion: Emotion;
  targetLevel: EmotionLevel;
  actorEmotion: Emotion;
  /** 0–1 pull of each kind of memory between them (both sides' memories combined). */
  shared: Partial<Record<MemoryKind, number>>;
  /** Story event types between these two, most recent last. */
  recentEvents: string[];
  /** Topics used between this pair lately (either direction), most recent last. */
  recentTopics: TopicId[];
  world: WorldId;
  place: EnvironmentTypeId;
  turn: number;
};

export function talkContext(story: StoryState, actor: Character, target: Character, world: WorldId, place: EnvironmentTypeId): TalkContext {
  const bond = story.bonds[bondKey(actor.id, target.id)] ?? neutralBond();
  const shared: Partial<Record<MemoryKind, number>> = {};
  const add = (m: Partial<Record<MemoryKind, number>>) => {
    for (const [k, v] of Object.entries(m) as [MemoryKind, number][]) shared[k] = Math.min(1, (shared[k] ?? 0) + v);
  };
  add(memoryPull(story.characters[actor.id], target.id, story.turn));
  add(memoryPull(story.characters[target.id], actor.id, story.turn));
  // Betrayal is one-sided: only the speaker's own memory counts ("why did you…").
  const mine = memoryPull(story.characters[actor.id], target.id, story.turn);
  shared.betrayed = mine.betrayed ?? 0;
  const pair = (e: EventRecord) => (e.actorId === actor.id && e.otherId === target.id) || (e.actorId === target.id && e.otherId === actor.id);
  const between = story.events.filter(pair).slice(-8);
  const te = emotionOf(story.characters[target.id]);
  return {
    actor,
    target,
    p: personalityOf(actor),
    q: personalityOf(target),
    rel: relationOf(story, actor, target, bond),
    targetEmotion: te.emotion,
    targetLevel: te.level,
    actorEmotion: emotionOf(story.characters[actor.id]).emotion,
    shared,
    recentEvents: between.map((e) => e.type),
    recentTopics: between.filter((e) => e.type.startsWith("chat.")).map((e) => e.type.slice(5) as TopicId),
    world,
    place,
    turn: story.turn,
  };
}

type Offer = { w: number; reason: ReasonId; vars?: Record<string, string> } | null;

export type TopicDef = {
  id: TopicId;
  /** At most one topic per group is offered at a time. */
  group: "feelings" | "conflict" | "bond" | "task" | "know" | "world";
  rule: (c: TalkContext) => Offer;
  /** How the listener experiences it (behavior-engine trigger). */
  trigger: (c: TalkContext) => TriggerId;
  /** Speaker's view of the listener shifts a little. */
  rel?: RelationDelta;
  /** Memories written for the speaker / listener (merged if repeated). */
  actorMemory?: { kind: MemoryKind; importance: number };
  targetMemory?: { kind: MemoryKind; importance: number };
};

const pos = (v: number) => Math.max(0, v) / 100;
const sore = (c: TalkContext) => Math.max(...SORE_MEMORIES.map((k) => c.shared[k] ?? 0));
const recentClash = (c: TalkContext) => c.recentEvents.some((t) => t === "argument" || t === "rivalry" || t === "misunderstanding" || t === "rumor");
const looks = (c: TalkContext): Offer => (c.targetEmotion === "neutral" ? null : { w: 0, reason: "looks", vars: { emotionKey: `emotions.${c.targetEmotion}` } });
/** Strongest good memory they share, if any. */
export function bestMemory(c: TalkContext): MemoryKind | null {
  let best: MemoryKind | null = null;
  let v = 0.1;
  for (const k of GOOD_MEMORIES) if ((c.shared[k] ?? 0) > v) [best, v] = [k, c.shared[k]!];
  return best;
}

export const TOPIC_DEFS: Record<TopicId, TopicDef> = {
  howFeeling: {
    id: "howFeeling",
    group: "feelings",
    // Always possible: the fallback that keeps at least two options on screen.
    rule: (c) => {
      const shows = c.targetEmotion !== "neutral";
      const w = 1 + (shows ? 1 + c.targetLevel * 0.6 : 0) + c.p.empathy * 1.2 + pos(c.rel.affection);
      return { ...(looks(c) ?? { reason: pos(c.rel.affection) > 0.3 ? "close" : "smallTalk" }), w };
    },
    trigger: () => "spoken_to",
    rel: { familiarity: 2 },
  },
  cheerUp: {
    id: "cheerUp",
    group: "feelings",
    rule: (c) => (LOW.includes(c.targetEmotion) && c.rel.affection >= -10 && c.rel.tension < 60 ? { ...looks(c)!, w: 2.4 + c.p.empathy * 2 + pos(c.rel.affection) } : null),
    trigger: () => "helped",
    rel: { affection: 3 },
    targetMemory: { kind: "helped", importance: 1 },
  },
  worries: {
    id: "worries",
    group: "feelings",
    rule: (c) => {
      if (c.targetEmotion === "anxious" || c.targetEmotion === "sad") return { ...looks(c)!, w: 1.6 + c.p.empathy };
      if (c.target.fears.trim() && c.rel.trust >= 30) return { reason: "trust", w: 1 + c.p.empathy + pos(c.rel.trust) };
      return null;
    },
    trigger: () => "spoken_to",
    rel: { familiarity: 3 },
  },
  recentDisagreement: {
    id: "recentDisagreement",
    group: "conflict",
    rule: (c) => {
      const s = sore(c);
      if (s > 0.12 || recentClash(c)) return { reason: "argued", w: 2.4 + s * 2 + c.rel.tension / 50 + c.p.confront * 0.6 };
      if (c.rel.tension >= 45) return { reason: "tension", w: 1.8 + c.rel.tension / 50 };
      return null;
    },
    // A blunt person "brings it up"; a gentle one asks about it.
    trigger: (c) => (c.p.confront >= 0.6 && c.p.empathy < 0.6 ? "criticized" : "spoken_to"),
    rel: { familiarity: 2 },
  },
  apologize: {
    id: "apologize",
    group: "conflict",
    rule: (c) => {
      if (c.p.empathy < 0.4 || c.p.pride >= 0.8) return null;
      const s = sore(c);
      if (s > 0.12 || recentClash(c)) return { reason: "argued", w: 1.6 + c.p.empathy * 1.5 - c.p.pride };
      if (c.rel.tension >= 35) return { reason: "tension", w: 1.2 + c.p.empathy };
      return null;
    },
    trigger: () => "complimented",
    rel: { tension: -6 },
  },
  betrayal: {
    id: "betrayal",
    group: "conflict",
    rule: (c) => ((c.shared.betrayed ?? 0) > 0.1 ? { reason: "betrayed", w: 3.5 + c.p.confront } : null),
    trigger: () => "criticized",
    rel: { familiarity: 2 },
  },
  challenge: {
    id: "challenge",
    group: "conflict",
    rule: (c) => (c.rel.rivalry >= 35 && c.p.confront >= 0.45 && !LOW.includes(c.targetEmotion) ? { reason: "rivals", w: 1.5 + c.rel.rivalry / 40 + c.p.confront } : null),
    trigger: () => "provoked",
    rel: { rivalry: 3, tension: 3 },
  },
  sharedMemory: {
    id: "sharedMemory",
    group: "bond",
    rule: (c) => {
      const m = bestMemory(c);
      if (!m || c.rel.tension >= 70) return null;
      return { reason: "memory", w: 2 + (c.shared[m] ?? 0) * 2 + pos(c.rel.affection), vars: { memoryKey: `talk.memory.${m}` } };
    },
    trigger: (c) => (c.rel.affection >= 0 ? "complimented" : "spoken_to"),
    rel: { affection: 3 },
  },
  compliment: {
    id: "compliment",
    group: "bond",
    rule: (c) => (c.rel.affection >= -30 && !HOT.includes(c.targetEmotion) ? { reason: pos(c.rel.affection) > 0.3 ? "close" : "smallTalk", w: 0.9 + c.p.expressive + c.p.empathy * 0.6 + pos(c.rel.affection) - c.p.hides * 0.8 } : null),
    trigger: () => "complimented",
    rel: { affection: 2 },
  },
  tease: {
    id: "tease",
    group: "bond",
    rule: (c) =>
      c.p.playful >= 0.55 && c.rel.familiarity >= 35 && c.rel.affection >= 0 && c.rel.tension < 50 && !LOW.includes(c.targetEmotion) && !HOT.includes(c.targetEmotion)
        ? { reason: "playful", w: 1.4 + c.p.playful * 2, vars: { nameOf: c.actor.name.trim() } }
        : null,
    trigger: () => "teased",
    targetMemory: { kind: "teased", importance: 1 },
  },
  confide: {
    id: "confide",
    group: "bond",
    rule: (c) => (c.rel.trust >= 40 && c.rel.affection >= 20 && (c.p.expressive >= 0.3 || c.p.loyal > 0) ? { reason: "trust", w: 1.4 + pos(c.rel.trust) * 1.5 } : null),
    trigger: () => "spoken_to",
    rel: { trust: 3, affection: 2 },
    actorMemory: { kind: "secret", importance: 2 },
    targetMemory: { kind: "secret", importance: 2 },
  },
  askHelp: {
    id: "askHelp",
    group: "task",
    rule: (c) =>
      c.actor.goals.trim() && c.rel.trust >= -20 && !HOT.includes(c.targetEmotion)
        ? { reason: "yourGoal", w: 1.3 + c.p.dependent * 1.4 + pos(c.rel.trust) + (goalMentions(c.actor, c.target) ? 2 : 0) }
        : null,
    trigger: (c) => (c.rel.rivalry >= 40 ? "forced_cooperation" : "spoken_to"),
    rel: { familiarity: 3 },
    actorMemory: { kind: "cooperated", importance: 1 },
  },
  theirGoal: {
    id: "theirGoal",
    group: "know",
    rule: (c) => {
      if (c.target.goals.trim()) return { reason: "theirGoal", w: 1.2 + c.p.empathy + c.p.extro * 0.4 };
      if (c.rel.familiarity < 60) return { reason: "stranger", w: 1 + c.p.extro * 0.6 };
      return null;
    },
    trigger: () => "spoken_to",
    rel: { familiarity: 4 },
  },
  introduce: {
    id: "introduce",
    group: "know",
    rule: (c) => (c.rel.familiarity < 25 ? { reason: "stranger", w: 3 + c.p.extro } : null),
    trigger: () => "spoken_to",
    rel: { familiarity: 8 },
    actorMemory: { kind: "met", importance: 1 },
    targetMemory: { kind: "met", importance: 1 },
  },
  place: {
    id: "place",
    group: "world",
    rule: (c) => ({ reason: "place", w: 0.9 + (UNSETTLING.includes(c.place) ? 0.6 : 0) + c.p.cautious * 0.3, vars: { place: c.place } }),
    trigger: () => "spoken_to",
    rel: { familiarity: 1 },
  },
  rumor: {
    id: "rumor",
    group: "world",
    rule: (c) => (c.p.extro >= 0.45 || c.p.playful >= 0.5 ? { reason: "world", w: 0.8 + c.p.extro * 0.8, vars: { worldKey: `worlds.list.${c.world}.name` } } : null),
    trigger: () => "spoken_to",
    rel: { familiarity: 2 },
  },
};

/** What the LISTENER experiences when a topic is said to them (what the speaker did). */
export const TOPIC_LISTENER_KIND: Partial<Record<TopicId, InteractionKind>> = {
  apologize: "apology",
  confide: "share_secret",
  cheerUp: "help",
  compliment: "compliment",
  challenge: "provoke",
  tease: "tease",
  betrayal: "argument",
  recentDisagreement: "small_talk",
  introduce: "small_talk",
};

export type TopicChoice = {
  id: TopicId;
  reason: ReasonId;
  /** Params for the label / reason / line (rendered by renderLine-style "<x>Key" params). */
  vars: Record<string, string>;
  /** The listener's trigger, decided now so the label and the outcome agree. */
  trigger: TriggerId;
  weight: number;
};

/** Every topic the rules allow right now, with weights (for tests and the debug view). */
export function eligibleTopics(c: TalkContext): TopicChoice[] {
  const out: TopicChoice[] = [];
  for (const id of TOPIC_IDS) {
    const def = TOPIC_DEFS[id];
    const r = def.rule(c);
    if (!r || r.w <= 0) continue;
    out.push({ id, reason: r.reason, vars: { other: c.target.name.trim(), name: c.actor.name.trim(), ...(r.vars ?? {}) }, trigger: def.trigger(c), weight: r.w });
  }
  return out;
}

/** Penalties: the same topic with the same person lately, and topics already offered in this conversation. */
export const RECENT_TOPIC_PENALTY = 0.35;
export const OFFERED_PENALTY = 0.25;

/** 2–3 topics for this moment. Different groups, randomized, never all the same as last time. */
export function suggestTopics(c: TalkContext, rng: () => number, offered: readonly string[] = [], count = 3): TopicChoice[] {
  const scored = eligibleTopics(c).map((t) => {
    const recent = c.recentTopics.slice(-6).filter((x) => x === t.id).length;
    const score = t.weight * (0.7 + rng() * 0.6) * Math.pow(RECENT_TOPIC_PENALTY, recent) * (offered.includes(t.id) ? OFFERED_PENALTY : 1);
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked: TopicChoice[] = [];
  const groups = new Set<string>();
  for (const { t } of scored) {
    if (picked.length >= count) break;
    if (groups.has(TOPIC_DEFS[t.id].group)) continue;
    picked.push(t);
    groups.add(TOPIC_DEFS[t.id].group);
  }
  // Fewer groups than slots: fill with what's left (still no duplicates).
  for (const { t } of scored) {
    if (picked.length >= Math.min(2, count)) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
}

/** Bold speakers (outgoing, confrontational, impulsive) phrase things differently from soft ones. */
export const toneOf = (p: PersonalityFactors): "bold" | "soft" => ((p.extro + p.confront + p.impulsive) / 3 >= 0.55 ? "bold" : "soft");

/**
 * Write the speaker's side of a topic to story state: one story turn passes,
 * the speaker's view of the listener shifts a little, memories are added
 * (merged if repeated), and the topic is recorded as a story event so later
 * suggestions know it was used. The listener's side is the behavior engine's
 * applyDecision().
 */
export function applyTopic(story: StoryState, actor: Character, target: Character, choice: TopicChoice, variant: number, now = Date.now()): StoryState {
  const def = TOPIC_DEFS[choice.id];
  const turn = story.turn + 1;
  let s: StoryState = { ...story, turn };
  if (def.rel) {
    // The speaker's own view shifts a little (validated by the relationship progression rules).
    s = recordInteraction(s, { from: actor, to: target, kind: TOPIC_KIND[choice.id] ?? "small_talk", proposed: def.rel, source: "talk-topic", why: `said: ${choice.id}`, feelings: false, now }).story;
  }
  const mem = (who: Character, other: Character, m: { kind: MemoryKind; importance: number }) => {
    const st = s.characters[who.id] ?? neutralState();
    s = { ...s, characters: { ...s.characters, [who.id]: remember(st, { kind: m.kind, withId: other.id, withName: other.name.trim(), turn, importance: m.importance, eventType: `chat.${choice.id}` }, now).state } };
  };
  if (def.actorMemory) mem(actor, target, def.actorMemory);
  if (def.targetMemory) mem(target, actor, def.targetMemory);
  const record: EventRecord = { id: makeId("chat"), turn, type: `chat.${choice.id}`, actorId: actor.id, otherId: target.id, reaction: null, approach: "direct", variant, at: now };
  return { ...s, events: [...s.events, record].slice(-60) };
}

/** Record a typed message (no state change beyond the turn + history: there is no reply yet). */
export function applyCustom(story: StoryState, actor: Character, target: Character, now = Date.now()): StoryState {
  const turn = story.turn + 1;
  const record: EventRecord = { id: makeId("chat"), turn, type: "chat.custom", actorId: actor.id, otherId: target.id, reaction: null, approach: "direct", variant: 0, at: now };
  return { ...story, turn, events: [...story.events, record].slice(-60) };
}

/** Translation key of the speaker's line list (place / rumor lines depend on where you are). */
export function sayKey(choice: Pick<TopicChoice, "id">, tone: "bold" | "soft", world: WorldId, place: EnvironmentTypeId): string {
  if (choice.id === "place") return `talk.say.place.${place}`;
  if (choice.id === "rumor") return `talk.say.rumor.${world}`;
  return `talk.say.${choice.id}.${tone}`;
}
