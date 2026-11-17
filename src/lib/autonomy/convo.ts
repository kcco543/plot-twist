/**
 * AUTONOMOUS CONVERSATIONS — data, state machine and the local rules.
 * --------------------------------------------------------------------------
 * One conversation between two characters, started by one of them while the
 * player watches, is ONE shared session (never one per character):
 *
 *   proposed → approaching → awaiting → active → ending → completed
 *        \           \           \         \        \
 *         interrupted  interrupted  declined  interrupted  interrupted
 *
 *   proposed     A wants to talk to B (scheduler or A's own planner)
 *   approaching  A walks over; B holds still (B's routine walks are held)
 *   awaiting     A is there; B decides whether to talk (local rules, no AI)
 *   declined     B said no: recorded, both are freed, A takes it in stride
 *   active       both are LOCKED in place (stage locks), facing each other;
 *                the lines play one by one
 *   ending       the last line was said; a short still beat
 *   completed    lock released, consequences committed, record saved
 *   interrupted  cut short (the player stepped in, scene change, AI error,
 *                reload, timeout): lock released, nothing more is committed
 *
 * Everything here is plain functions (no React, no timers, no AI). The
 * director (convoDirector.ts) runs them against the stage and the save.
 */
import { checkEmotion } from "../talk/ai/apply";
import { level } from "../mind/feelings";
import { personalityOf } from "../mind/profile";
import { currentRelation } from "../relationships/progression";
import type { Emotion } from "../emotion/emotions";
import type { WorldObject } from "../stage/objects";
import type { Point } from "../stage/room";
import type { Character, StoryState } from "../types";
import { keepsApart } from "./planner";
import { willingToTalk } from "./convoBoundary";
import { interestsOf, objectTopics } from "./environment";
import type { AgencyState } from "./types";

// ---------------------------------------------------------------- tunables

export const AUTO_CONVO = {
  /** Autonomous conversations running at once in the active world. */
  maxActive: 1,
  /** A walk over that takes longer than this is given up (ms of unpaused time). */
  approachTimeoutMs: 16_000,
  /** Close enough to talk: talk distance plus this slack (stage px, feet to feet). */
  talkSlack: 14,
  /** Don't walk across the whole map for a chat: pairs farther apart than this aren't considered. */
  maxStartGap: 260,
  /** B's beat of consideration before answering. */
  awaitMs: 900,
  /** Pause after the lock and before the first line. */
  openMs: 500,
  /** Waiting for the conversation to be written: give up after this long. */
  writeTimeoutMs: 30_000,
  /** The still beat after the last line. */
  endingMs: 1_600,
  /** Hold after release before anyone walks (sim ENDING_HOLD_MS is the default). */
  releaseHoldMs: 1_500,
  /** No conversation runs longer than this, however it is going (ms of unpaused time). */
  maxDurationMs: 180_000,
  /** Line timing: base + per character, clamped (ms). Scaled by the text-speed setting. */
  lineBaseMs: 1_100,
  lineMsPerChar: 48,
  lineMsPerCjk: 140,
  lineMinMs: 2_200,
  lineMaxMs: 7_500,
  /** Gap between two lines. */
  lineGapMs: 450,
  /** Hard cap on turns, whatever the plan says. */
  maxTurns: 12,
  /** Longest single line kept (characters). */
  lineMax: 240,
  /** Records kept per world (most recent last). */
  historyLimit: 30,
  /** Lowest score at which someone starts a conversation (after the frequency's initiative). */
  startBar: 0.3,
  /** B accepts at or above this. */
  acceptBar: 0.3,
} as const;

export const LENGTHS = {
  brief: [2, 4],
  ordinary: [4, 8],
  meaningful: [6, 12],
} as const;
export type ConvoLength = keyof typeof LENGTHS;

// ---------------------------------------------------------------- data

export const CONVO_STATES = ["proposed", "approaching", "awaiting", "active", "ending", "completed", "interrupted", "declined"] as const;
export type ConvoState = (typeof CONVO_STATES)[number];
export const FINAL_STATES: readonly ConvoState[] = ["completed", "interrupted", "declined"];
export const isFinalState = (s: ConvoState) => FINAL_STATES.includes(s);
/** States in which both characters belong to the session (nothing else may own them). */
export const OWNING_STATES: readonly ConvoState[] = ["proposed", "approaching", "awaiting", "active", "ending"];

export const CONVO_TRANSITIONS: Record<ConvoState, readonly ConvoState[]> = {
  proposed: ["approaching", "awaiting", "interrupted"],
  approaching: ["awaiting", "interrupted"],
  awaiting: ["active", "declined", "interrupted"],
  active: ["ending", "interrupted"],
  ending: ["completed", "interrupted"],
  completed: [],
  interrupted: [],
  declined: [],
};
export const canMove = (from: ConvoState, to: ConvoState) => CONVO_TRANSITIONS[from].includes(to);

export const TOPIC_KINDS = ["introduce", "smallTalk", "sharedInterest", "checkOn", "news", "unfinished", "confront"] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];
export type ConvoTopic = { kind: TopicKind; /** An object in the room it's about (sharedInterest). */ object?: string; /** What it's about, in plain words (prompt / record). */ about: string };

/** One spoken turn, committed (shown, logged, in history). Built-in lines keep their template so they re-render per language. */
export type ConvoTurn = { speaker: string; text?: string; tpl?: string; params?: Record<string, string>; emotion: Emotion; level: 0 | 1 | 2 | 3; at: number };
/** A turn the plan says comes next; not committed (nothing in the game has changed because of it yet). */
export type PlannedTurn = { speaker: string; text?: string; tpl?: string; params?: Record<string, string>; emotion: Emotion; intensity: number };

/** What one participant takes away (from the plan; validated and committed at completion). */
export type ConvoView = {
  /** What the OTHER one did, as this one experienced it. */
  interaction: string;
  significance: "trivial" | "ordinary" | "meaningful" | "major";
  delta: { trust: number; affection: number; respect: number; tension: number };
  memory: { summary: string; importance: number; kind: string; thread: string } | null;
};
export type ConvoOutcome = {
  /** Who brought it to a close, and how. */
  endedBy: string | null;
  how: "natural" | "walks_off";
  /** Keyed by participant id. */
  views: Record<string, ConvoView>;
  /** What it turned out to be about (short). */
  topic: string;
};

export type ConvoSource = "ai" | "mock" | "builtin";

export type AutoConvo = {
  id: string;
  worldId: string | null;
  sceneId: string;
  /** The room key it started in ("place" of the stage). A different room = interrupted. */
  roomKey: string;
  participants: [string, string];
  initiator: string;
  state: ConvoState;
  /** Who is speaking right now (active), else null. */
  speaker: string | null;
  turns: ConvoTurn[];
  pending: PlannedTurn[];
  topic: ConvoTopic;
  /** Why the initiator wanted to talk (i18n key under autoTalk.reasons). */
  reason: string;
  length: ConvoLength;
  minTurns: number;
  maxTurns: number;
  /** How B felt about it when accepting: glad / willing / reluctant. */
  willingness: "glad" | "willing" | "reluctant" | null;
  source: ConvoSource | null;
  /** Writing the lines (AI request) is under way. */
  writing: boolean;
  outcome: ConvoOutcome | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  updatedAt: number;
  /** Game time of the next step (approach deadline, answer, next line, end). */
  nextAt: number;
  /** Deadline for the current phase (approach / writing). */
  deadline: number;
  /** Game time after which it's over however it's going (AUTO_CONVO.maxDurationMs from the start). */
  hardStop: number;
  /** Why it ended (declined / interrupted / completed); i18n key under autoTalk.ends. */
  endReason: string | null;
  /** Who walked off afterwards, if anyone. */
  leaver: string | null;
};

/** What is kept in the world's history (Story Log → Conversations). */
export type ConvoRecord = {
  id: string;
  participants: [string, string];
  names: [string, string];
  initiator: string;
  sceneId: string;
  place: string;
  status: "completed" | "interrupted" | "declined";
  endReason: string | null;
  reason: string;
  topic: string;
  source: ConvoSource | null;
  startedAt: number;
  endedAt: number;
  turns: ConvoTurn[];
  /** What changed (accepted by the game, not just proposed). */
  changes: { from: string; to: string; delta: Partial<Record<"trust" | "affection" | "respect" | "familiarity" | "tension", number>>; kind: string }[];
  /** Memories that were saved (long-term), separate from the transcript. */
  memories: { holder: string; note: string; importance: number }[];
  leaver: string | null;
};

/** Saved per world in AgencyState.convos. */
export type ConvoBook = {
  /** Running sessions (at most AUTO_CONVO.maxActive). Saved so a reload can close them honestly. */
  active: AutoConvo[];
  history: ConvoRecord[];
  /** When the last one started (ms). */
  lastStartAt: number;
  /** Per character: when they were last in (or turned one down). */
  lastAt: Record<string, number>;
  /** Per pair (sorted ids joined by "|"): last attempt. */
  pairAt: Record<string, number>;
  /** AI-written conversations in the current hour window, and a pause after a billing/budget error. */
  ai: { windowStart: number; count: number; offUntil: number; offReason: string | null };
};

export const emptyBook = (): ConvoBook => ({ active: [], history: [], lastStartAt: 0, lastAt: {}, pairAt: {}, ai: { windowStart: 0, count: 0, offUntil: 0, offReason: null } });
export const bookOf = (a: AgencyState | undefined): ConvoBook => {
  const b = a?.convos;
  if (!b || typeof b !== "object") return emptyBook();
  const e = emptyBook();
  return { ...e, ...b, active: Array.isArray(b.active) ? b.active : [], history: Array.isArray(b.history) ? b.history : [], ai: { ...e.ai, ...(b.ai ?? {}) } };
};
export const pairOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Move a session to another state (invalid moves are refused: the same object comes back). */
export function moveConvo(c: AutoConvo, to: ConvoState, now: number, patch: Partial<AutoConvo> = {}): AutoConvo {
  if (c.state === to || !canMove(c.state, to)) return c;
  const final = isFinalState(to);
  return { ...c, ...patch, state: to, updatedAt: now, ...(to === "active" ? { startedAt: now } : {}), ...(final ? { endedAt: now, speaker: null, pending: [], writing: false } : {}) };
}

// ---------------------------------------------------------------- who starts one, with whom, about what

const n100 = (v: number) => Math.max(-1, Math.min(1, v / 100));

/** How readily `c` starts a conversation right now (roughly 0…0.6), from personality and mood only. */
export function initiativeOf(c: Character, story: StoryState): number {
  const p = personalityOf(c);
  const f = story.characters[c.id]?.feelings ?? {};
  const bright = Math.max(level(f, "happiness"), level(f, "excitement")) / 100;
  const upset = Math.max(level(f, "anger"), level(f, "frustration")) / 100;
  const low = Math.max(level(f, "sadness"), level(f, "anxiety")) / 100;
  return 0.12 + 0.22 * p.extro + 0.1 * p.expressive + 0.06 * p.playful + 0.05 * p.impulsive - 0.06 * p.reserved - 0.05 * p.avoidant + 0.12 * bright - 0.08 * upset + low * (0.1 * p.dependent - 0.06 * p.intro);
}

export type StartContext = {
  story: StoryState;
  agency: AgencyState;
  objects: WorldObject[];
  position: (id: string) => Point | null;
  now: number;
  rng: () => number;
};

/** What A would bring up with B. */
export function pickTopic(a: Character, b: Character, ctx: StartContext): ConvoTopic {
  const { story } = ctx;
  const ab = currentRelation(story, a, b);
  const pa = personalityOf(a);
  const fb = story.characters[b.id]?.feelings ?? {};
  const fa = story.characters[a.id]?.feelings ?? {};
  const open = (story.characters[a.id]?.memories ?? []).find((m) => m.withId === b.id && m.thread && !m.resolved && m.note);
  if (open && ab.familiarity >= 15) return { kind: "unfinished", about: open.note!.slice(0, 160) };
  if (ab.tension >= 45 && pa.confront > 0.6) return { kind: "confront", about: "the tension between them" };
  const bLow = Math.max(level(fb, "sadness"), level(fb, "anxiety"), level(fb, "frustration"));
  if (bLow >= 45 && pa.empathy > 0.5 && ab.affection >= 10) return { kind: "checkOn", about: "how they're doing" };
  if (ab.familiarity < 12) return { kind: "introduce", about: "getting to know each other" };
  // Something in the room both of them like (or A likes and B is near).
  const pa0 = ctx.position(a.id);
  const pb0 = ctx.position(b.id);
  if (pa0 && pb0) {
    const mid = { x: (pa0.x + pb0.x) / 2, y: (pa0.y + pb0.y) / 2 };
    const near = ctx.objects.filter((o) => !o.hidden && !o.marker && !o.exit && (!o.giftId || o.ownerId === a.id) && Math.hypot((o.bounds.x0 + o.bounds.x1) / 2 - mid.x, o.bounds.y1 - mid.y) < 140);
    const ia = interestsOf(a, story, near.flatMap(objectTopics));
    const ib = interestsOf(b, story, near.flatMap(objectTopics));
    const hits = near
      .map((o) => ({ o, s: objectTopics(o).reduce((acc, t) => acc + (ia.likes[t] ?? 0) + 0.5 * (ib.likes[t] ?? 0), 0) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s);
    if (hits.length && ctx.rng() < 0.75) {
      const o = hits[0].o;
      return { kind: "sharedInterest", object: o.id, about: o.label ?? o.name };
    }
  }
  if (Math.max(level(fa, "happiness"), level(fa, "excitement")) >= 50) return { kind: "news", about: "what's put them in a good mood" };
  return { kind: "smallTalk", about: "the place and the day" };
}

/** How long it should run, as a range the writer stays inside (a character may still end it early). */
export function pickLength(a: Character, b: Character, topic: ConvoTopic, story: StoryState, rng: () => number): { length: ConvoLength; min: number; max: number } {
  const pa = personalityOf(a);
  const pb = personalityOf(b);
  const fam = Math.min(currentRelation(story, a, b).familiarity, currentRelation(story, b, a).familiarity);
  const talky = (pa.extro + pa.expressive + pb.extro + pb.expressive) / 4;
  let length: ConvoLength = "ordinary";
  if (topic.kind === "introduce" || topic.kind === "smallTalk") length = talky < 0.45 || rng() < 0.4 ? "brief" : "ordinary";
  else if ((topic.kind === "unfinished" || topic.kind === "checkOn" || topic.kind === "confront") && fam >= 25) length = "meaningful";
  else if (talky < 0.3) length = "brief";
  const [min, max] = LENGTHS[length];
  return { length, min, max: Math.min(max, AUTO_CONVO.maxTurns) };
}

export type StartCandidate = { initiator: Character; target: Character; score: number; reason: string; topic: ConvoTopic };

/**
 * Score A starting a conversation with B right now, or null if it can't
 * happen at all (boundaries, someone keeping away, too far).
 */
export function scorePair(a: Character, b: Character, ctx: StartContext): StartCandidate | null {
  const { story, agency } = ctx;
  if (keepsApart(agency, a.id, b.id)) return null;
  if (!willingToTalk(story, agency, b, a, ctx.now).willing || !willingToTalk(story, agency, a, b, ctx.now).willing) return null;
  const pa = ctx.position(a.id);
  const pb = ctx.position(b.id);
  if (!pa || !pb) return null;
  const gap = Math.hypot(pa.x - pb.x, pa.y - pb.y);
  if (gap > AUTO_CONVO.maxStartGap) return null;
  const rel = currentRelation(story, a, b);
  const p = personalityOf(a);
  const topic = pickTopic(a, b, ctx);
  // Who they are + how they feel about this person + what there is to say.
  let score = initiativeOf(a, story);
  score += 0.18 * n100(rel.affection) + 0.1 * n100(rel.trust) + 0.08 * (rel.familiarity / 100) - 0.18 * (rel.fear / 100);
  score -= rel.tension >= 45 ? (topic.kind === "confront" ? -0.05 : 0.15) : 0;
  // Meeting someone new: shy and wary people hang back, open ones say hello.
  if (topic.kind === "introduce") score += 0.08 * p.extro - 0.12 * p.strangerWary - 0.06 * p.intro;
  // Something to talk about pulls even a quiet person in (introverts aren't universally passive).
  const pull: Record<TopicKind, number> = { introduce: 0.04, smallTalk: 0, sharedInterest: 0.14, checkOn: 0.16, news: 0.08, unfinished: 0.18, confront: 0.12 };
  score += pull[topic.kind];
  score -= gap > 160 ? 0.08 : 0;
  score += (ctx.rng() - 0.5) * 0.16;
  const reason = topic.kind === "checkOn" ? "checksOn" : topic.kind === "sharedInterest" ? "sharesInterest" : topic.kind === "unfinished" ? "unfinished" : topic.kind === "confront" ? "confronts" : topic.kind === "introduce" ? "saysHello" : topic.kind === "news" ? "sharesNews" : "chats";
  return { initiator: a, target: b, score, reason, topic };
}

export type Availability = (id: string) => boolean;

/** The best conversation to start now, if any clears the bar. Local rules only: never calls an AI. */
export function chooseStart(cast: Character[], available: Availability, ctx: StartContext & { book: ConvoBook; charGapMs: number; pairGapMs: number; initiative: number }): StartCandidate | null {
  const free = cast.filter((c) => available(c.id) && ctx.now - (ctx.book.lastAt[c.id] ?? -Infinity) >= ctx.charGapMs);
  let best: StartCandidate | null = null;
  for (const a of free)
    for (const b of free) {
      if (a.id === b.id) continue;
      if (ctx.now - (ctx.book.pairAt[pairOf(a.id, b.id)] ?? -Infinity) < ctx.pairGapMs) continue;
      const s = scorePair(a, b, ctx);
      if (s && (!best || s.score > best.score)) best = s;
    }
  return best && best.score + ctx.initiative >= AUTO_CONVO.startBar ? best : null;
}

// ---------------------------------------------------------------- B's answer

export type ConvoAnswer = { accept: boolean; willingness: "glad" | "willing" | "reluctant" | null; why: "boundary" | "notWithYou" | "notNow" | "busy" | "shy" | "fine" };

/** B decides whether to talk with A (local rules, deterministic for a given rng). Trust is not obedience. */
export function answerConversation(story: StoryState, agency: AgencyState, b: Character, a: Character, ctx: { busyWith: string | null; topic: ConvoTopic; rng: () => number; now: number }): ConvoAnswer {
  if (!willingToTalk(story, agency, b, a, ctx.now).willing) return { accept: false, willingness: null, why: "boundary" };
  const rel = currentRelation(story, b, a);
  const p = personalityOf(b);
  const f = story.characters[b.id]?.feelings ?? {};
  const upset = Math.max(level(f, "anger"), level(f, "frustration")) / 100;
  const low = Math.max(level(f, "sadness"), level(f, "anxiety")) / 100;
  const bright = Math.max(level(f, "happiness"), level(f, "excitement")) / 100;
  // Someone they fear or can't stand: no — unless it's a confrontation and they're the type to have it out.
  if (rel.fear >= 60 || (rel.tension >= 60 && !(ctx.topic.kind === "confront" && p.confront > 0.55))) return { accept: false, willingness: null, why: "notWithYou" };
  const bond = (rel.affection + rel.trust) / 200;
  let s = 0.36 + 0.28 * bond + 0.12 * p.extro + 0.06 * p.playful + 0.1 * bright + 0.1 * (rel.familiarity / 100) - 0.22 * upset - 0.12 * low * (0.5 + p.reserved) - 0.08 * p.reserved;
  if (ctx.topic.kind === "checkOn") s += 0.08 * p.dependent + 0.06 * bond;
  if (ctx.topic.kind === "introduce") s -= 0.12 * p.strangerWary;
  // Absorbed in something: quieter people would rather keep at it.
  if (ctx.busyWith) s -= 0.1 + 0.12 * p.intro;
  s += (ctx.rng() - 0.5) * 0.18;
  if (s >= AUTO_CONVO.acceptBar) return { accept: true, willingness: s >= 0.62 ? "glad" : s >= 0.42 ? "willing" : "reluctant", why: "fine" };
  const why = ctx.busyWith ? "busy" : upset + low > 0.5 ? "notNow" : ctx.topic.kind === "introduce" && p.strangerWary + p.intro > 1 ? "shy" : "notNow";
  return { accept: false, willingness: null, why };
}

// ---------------------------------------------------------------- built-in (offline) lines

/**
 * Lines for when no AI writer is available: short, clearly labelled
 * "built-in", never presented as AI. A few templates per topic; the
 * listener's temperament picks between a fuller and a terser reply.
 */
export function builtinPlan(a: Character, b: Character, topic: ConvoTopic, objectName: string, rng: () => number): PlannedTurn[] {
  const pb = personalityOf(b);
  const pa = personalityOf(a);
  const terse = pb.reserved > 0.6 || pb.intro > 0.7;
  const v = Math.floor(rng() * 3) % 3;
  const k = (s: string) => `autoTalk.builtin.${s}`;
  const t = (speaker: Character, key: string, emotion: Emotion = "neutral", intensity = 0.3): PlannedTurn => ({ speaker: speaker.id, tpl: k(key), params: { a: a.name.trim(), b: b.name.trim(), object: objectName }, emotion, intensity });
  switch (topic.kind) {
    case "introduce":
      return [t(a, `introduce.a1.${v}`, pa.extro > 0.5 ? "happy" : "neutral"), t(b, terse ? "introduce.b1Terse" : `introduce.b1.${v}`), t(a, `introduce.a2.${v}`), ...(terse ? [] : [t(b, "introduce.b2", "happy", 0.25)])];
    case "sharedInterest":
      return [t(a, `interest.a1.${v}`, "happy", 0.3), t(b, terse ? "interest.b1Terse" : `interest.b1.${v}`), t(a, "interest.a2", "happy", 0.25), t(b, terse ? "interest.b2Terse" : "interest.b2")];
    case "checkOn":
      return [t(a, `checkOn.a1.${v}`), t(b, terse ? "checkOn.b1Terse" : "checkOn.b1", "sad", 0.3), t(a, "checkOn.a2"), t(b, "checkOn.b2", "neutral", 0.2)];
    case "news":
      return [t(a, `news.a1.${v}`, "excited", 0.4), t(b, terse ? "news.b1Terse" : "news.b1"), t(a, "news.a2", "happy", 0.3)];
    case "unfinished":
    case "confront":
      return [t(a, "unfinished.a1"), t(b, terse ? "unfinished.b1Terse" : "unfinished.b1", "frustrated", 0.3), t(a, "unfinished.a2"), t(b, "unfinished.b2")];
    default:
      return [t(a, `smallTalk.a1.${v}`), t(b, terse ? "smallTalk.b1Terse" : `smallTalk.b1.${v}`), ...(terse ? [] : [t(a, "smallTalk.a2")])];
  }
}

/** Built-in outcome: an ordinary bit of small talk both ways (the progression rules keep it small). */
export function builtinOutcome(a: Character, b: Character, topic: ConvoTopic): ConvoOutcome {
  const view = (): ConvoView => ({ interaction: "small_talk", significance: "ordinary", delta: { trust: 0, affection: 0, respect: 0, tension: 0 }, memory: null });
  return { endedBy: a.id, how: "natural", views: { [a.id]: view(), [b.id]: view() }, topic: topic.about };
}

// ---------------------------------------------------------------- pacing

/** How long a line stays up (ms), from its length and the text-speed setting. */
export function lineMs(text: string, speed: "slow" | "normal" | "fast" | "instant" = "normal"): number {
  const chars = Array.from(text);
  const cjk = chars.filter((ch) => /[　-鿿＀-￯]/.test(ch)).length;
  const raw = AUTO_CONVO.lineBaseMs + (chars.length - cjk) * AUTO_CONVO.lineMsPerChar + cjk * AUTO_CONVO.lineMsPerCjk;
  const scale = speed === "slow" ? 1.35 : speed === "fast" ? 0.8 : speed === "instant" ? 0.65 : 1;
  return Math.round(Math.min(AUTO_CONVO.lineMaxMs, Math.max(AUTO_CONVO.lineMinMs, raw * scale)));
}

// ---------------------------------------------------------------- committing a turn's emotion

/** The emotion a turn may show (same rules as AI conversation replies: canon masks, reserved caps, no sudden flips). */
export function turnEmotion(c: Character, story: StoryState, t: PlannedTurn): { emotion: Emotion; level: 0 | 1 | 2 | 3 } {
  return checkEmotion(c, story, t.emotion, t.intensity, []);
}
