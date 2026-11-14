/**
 * STAGE BEHAVIOR — deterministic rules that decide how characters move.
 * --------------------------------------------------------------------------
 * Inputs: personality (traits), current emotion, the bond between two
 * characters, and the context (greeting, conversation, event, idle...).
 * Output: StageActions, which the engine validates and executes.
 *
 * The same emotion does NOT always give the same movement: each option is
 * weighted by personality + bond, and the pick uses a seeded random number
 * (seeded by the turn and the character), so results vary between people and
 * moments but are repeatable for tests.
 */
import { traitVector } from "../behavior/tendencies";
import { bondKey, neutralBond, type Beat } from "../story/engine";
import { emotionOf, type Emotion, type EmotionLevel } from "../emotion/emotions";
import type { Bond, Character, StoryState, TraitId } from "../types";
import type { IdleKind, StageAction } from "./actions";
import { PERSONAL_SPACE } from "./room";

export type MoveContext = "greeting" | "conversation" | "event" | "solo" | "test";

/** Which kinds of movement make sense in each context. Talking never makes anyone storm off. */
const ALLOWED: Record<MoveContext, ("approach" | "retreat" | "face" | "idle")[]> = {
  greeting: ["approach", "face", "idle"],
  conversation: ["approach", "retreat", "face", "idle"],
  event: ["approach", "retreat", "face", "idle"],
  solo: ["retreat", "idle"],
  test: ["approach", "retreat", "face", "idle"],
};

export type Rng = () => number;

/** Small deterministic RNG from a string seed. */
export function rngFrom(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pick<T>(options: [T, number][], rng: Rng): T | null {
  const total = options.reduce((a, [, w]) => a + Math.max(0, w), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const [v, w] of options) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return options[options.length - 1][0];
}

const traitsOf = (c: Character): Record<TraitId, number> => traitVector(c);
const inv = (v: number) => 100 - v;

export const bondBetween = (story: StoryState, a: string, b: string): Bond => story.bonds[bondKey(a, b)] ?? neutralBond();

/** How close two people stand when they talk (feet to feet, art px). Warmer bond / feeling = closer. */
export function talkDistance(a: Character, bond: Bond, emotion: Emotion): number {
  const t = traitsOf(a);
  let d = 34 - bond.affinity / 8 - (t.extroversion - 50) / 10;
  if (emotion === "affectionate") d -= 6;
  if (emotion === "angry") d -= 3;
  if (emotion === "anxious" || emotion === "embarrassed") d += 6;
  return Math.round(Math.min(56, Math.max(PERSONAL_SPACE + 4, d)));
}

/** 0–100: how willing `a` is to walk up to `b` right now. */
export function approachWillingness(a: Character, bond: Bond, emotion: Emotion): number {
  const t = traitsOf(a);
  let w = t.extroversion * 0.45 + (bond.affinity + 100) * 0.2 + (bond.trust + 100) * 0.1 + t.impulsiveness * 0.1;
  if (emotion === "happy" || emotion === "excited" || emotion === "affectionate") w += 15;
  if (emotion === "anxious" || emotion === "embarrassed" || emotion === "sad") w -= 20;
  return Math.max(0, Math.min(100, w));
}

type Option = ["approach" | "retreat" | "face" | IdleKind | "none", number];

/**
 * How a character reacts physically to their own new emotion.
 * `target` is who the feeling is about (or null). Returns at most one action.
 */
export function reactionAction(
  c: Character,
  emotion: Emotion,
  level: EmotionLevel,
  target: Character | null,
  bond: Bond,
  context: MoveContext,
  rng: Rng,
): StageAction | null {
  const t = traitsOf(c);
  const aff = bond.affinity;
  const strong = level >= 2 ? 1.25 : 1;
  const opts: Option[] = [];
  switch (emotion) {
    case "neutral":
      opts.push(["face", 40], ["none", 60]);
      break;
    case "happy":
      opts.push(["approach", (t.extroversion * 0.5 + (aff + 100) * 0.2) * strong], ["hop", t.playfulness * 0.5 + 10], ["face", 25]);
      break;
    case "excited":
      opts.push(["approach", (t.impulsiveness * 0.5 + t.extroversion * 0.3) * strong], ["hop", 40 + t.playfulness * 0.3], ["shift", t.impulsiveness * 0.2]);
      break;
    case "affectionate":
      // Warm bond: step closer. Guarded people just turn toward them.
      opts.push(["approach", (aff + 40) * 0.6 + t.trust * 0.3 + t.expressiveness * 0.2], ["face", 25 + inv(t.expressiveness) * 0.3], ["sigh", 10]);
      break;
    case "embarrassed":
      // Shy people step back, outgoing ones shrug it off on the spot.
      opts.push(["retreat", (inv(t.extroversion) * 0.6 + inv(t.expressiveness) * 0.3) * strong], ["look_around", 20 + t.playfulness * 0.2], ["shiver", 15]);
      break;
    case "angry":
      // Confrontational tempers step in; avoidant ones back off; the rest stomp.
      opts.push(
        ["approach", (t.confrontation * 0.7 + t.impulsiveness * 0.3 + (aff < -20 ? 15 : 0)) * strong],
        ["retreat", inv(t.confrontation) * 0.5 + inv(t.extroversion) * 0.25 + (aff > 30 ? 10 : 0)],
        ["stomp", 25],
        ["face", 15],
      );
      break;
    case "frustrated":
      opts.push(["retreat", inv(t.confrontation) * 0.3 + 10], ["stomp", 20 + t.impulsiveness * 0.2], ["sigh", 30], ["look_around", 15]);
      break;
    case "sad":
      // Some seek comfort from someone they trust, most pull back.
      opts.push(["retreat", inv(t.dependence) * 0.4 + inv(t.extroversion) * 0.3], ["approach", t.dependence * 0.4 + Math.max(0, aff) * 0.4], ["sigh", 30]);
      break;
    case "anxious":
      opts.push(["retreat", inv(t.trust) * 0.4 + inv(t.confrontation) * 0.3], ["approach", t.dependence * 0.3 + Math.max(0, bond.trust) * 0.4], ["shiver", 35], ["look_around", 25]);
      break;
    case "surprised":
      opts.push(["retreat", 20 + inv(t.confrontation) * 0.2], ["hop", 35], ["face", 25]);
      break;
    case "confused":
      opts.push(["look_around", 45], ["face", 25], ["shift", 10]);
      break;
  }
  const allowed = new Set(ALLOWED[context]);
  const usable = opts.filter(([k]) => {
    if (k === "none") return true;
    if (k === "approach" || k === "retreat" || k === "face") return allowed.has(k) && (k === "retreat" || !!target);
    return allowed.has("idle");
  });
  // Nobody walks up to someone they're unwilling to approach.
  const willing = target ? approachWillingness(c, bond, emotion) : 0;
  const choice = pick(
    usable.map(([k, w]) => [k, k === "approach" && willing < 30 && emotion !== "angry" ? w * 0.2 : w] as Option),
    rng,
  );
  if (!choice || choice === "none") return null;
  if (choice === "approach") return target ? { type: "approach", actor: c.id, target: target.id, distance: talkDistance(c, bond, emotion) } : null;
  if (choice === "retreat") return { type: "retreat", actor: c.id, from: target?.id, distance: Math.round(14 + level * 6 + inv(t.extroversion) / 10) };
  if (choice === "face") return target ? { type: "face_target", actor: c.id, target: target.id } : null;
  return { type: "idle_reaction", actor: c.id, kind: choice };
}

/** What an idle character does next (look around, shift weight, a little hop...). */
export function idleChoice(c: Character, emotion: Emotion, rng: Rng, allowShift: boolean): IdleKind {
  const t = traitsOf(c);
  const opts: [IdleKind, number][] = [
    ["look_around", 30 + inv(t.trust) * 0.2],
    ["shift", allowShift ? 15 + t.impulsiveness * 0.25 : 0],
    ["hop", t.playfulness * 0.25 + (emotion === "happy" || emotion === "excited" ? 25 : 0)],
    ["stretch", 10 + inv(t.impulsiveness) * 0.1],
    ["sigh", emotion === "sad" || emotion === "frustrated" ? 30 : 4],
    ["shiver", emotion === "anxious" ? 30 : 0],
  ];
  return pick(opts, rng) ?? "look_around";
}

/** Milliseconds until a character's next idle animation. Fidgety people fidget more often. */
export function idleDelay(c: Character, rng: Rng): number {
  const t = traitsOf(c);
  const base = 9000 - t.extroversion * 25 - t.impulsiveness * 25;
  return Math.round(base * (0.7 + rng() * 0.6));
}

/** Movement speed in art px per second. */
export function walkSpeed(c: Character, emotion: Emotion): number {
  const t = traitsOf(c);
  let s = 34 + (t.impulsiveness - 50) / 5;
  if (emotion === "excited" || emotion === "angry") s *= 1.3;
  if (emotion === "anxious" || emotion === "embarrassed") s *= 1.15;
  if (emotion === "sad") s *= 0.7;
  return Math.round(s);
}

export type BeatChoreography = {
  /** Characters taking part (they face each other and stay "interacting" until the lines end). */
  participants: string[];
  /** Actions in order. */
  actions: StageAction[];
};

/**
 * Turn a story beat into stage actions. `story` is the state AFTER the beat
 * (so emotions are the new ones). `nearestTo` gives the closest other
 * character on stage (for talk beats, which have no named listener).
 */
export function choreographBeat(beat: Beat, cast: Character[], story: StoryState, nearestTo: (id: string) => string | null): BeatChoreography {
  const actor = cast.find((c) => c.id === beat.actorId);
  if (!actor) return { participants: [], actions: [] };
  const rng = rngFrom(`${beat.turn}:${beat.type}:${actor.id}`);
  const actions: StageAction[] = [];
  const actorFeel = emotionOf(story.characters[actor.id]);

  if (beat.kind === "talk") {
    const listenerId = nearestTo(actor.id);
    const listener = listenerId ? (cast.find((c) => c.id === listenerId) ?? null) : null;
    if (!listener) return { participants: [actor.id], actions };
    const bond = bondBetween(story, actor.id, listener.id);
    // A greeting if these two haven't shared a beat lately.
    const recent = story.events.slice(-6, -1).some((e) => (e.actorId === actor.id && e.otherId === listener.id) || (e.actorId === listener.id && e.otherId === actor.id) || (e.type.startsWith("talk.") && e.actorId === actor.id));
    const greeting = !recent;
    actions.push({ type: "face_target", actor: actor.id, target: listener.id });
    if (greeting && approachWillingness(actor, bond, actorFeel.emotion) >= 45 + rng() * 20) {
      actions.push({ type: "approach", actor: actor.id, target: listener.id, distance: talkDistance(actor, bond, actorFeel.emotion) });
    }
    actions.push({ type: "face_target", actor: listener.id, target: actor.id });
    return { participants: [actor.id, listener.id], actions };
  }

  if (beat.kind === "observe" || beat.kind === "wait") return { participants: [], actions };

  // Events: show the new feelings, then let each person react in their own way.
  const other = beat.otherId ? (cast.find((c) => c.id === beat.otherId) ?? null) : null;
  const bond = other ? bondBetween(story, actor.id, other.id) : neutralBond();
  if (other) {
    actions.push({ type: "face_target", actor: actor.id, target: other.id }, { type: "face_target", actor: other.id, target: actor.id });
  }
  if (actorFeel.emotion !== "neutral") actions.push({ type: "show_emotion", actor: actor.id, emotion: actorFeel.emotion, level: actorFeel.level });
  const move = reactionAction(actor, actorFeel.emotion, actorFeel.level, other, bond, other ? "event" : "solo", rng);
  if (move) actions.push(move);
  if (other) {
    const otherFeel = emotionOf(story.characters[other.id]);
    if (otherFeel.emotion !== "neutral") actions.push({ type: "show_emotion", actor: other.id, emotion: otherFeel.emotion, level: otherFeel.level });
    // Only one of the two walks at a time, so they don't both charge at each other.
    const movedTowardOther = move?.type === "approach";
    const otherMove = reactionAction(other, otherFeel.emotion, otherFeel.level, actor, bond, "conversation", rng);
    if (otherMove && !(movedTowardOther && otherMove.type === "approach")) actions.push(otherMove);
  }
  return { participants: other ? [actor.id, other.id] : [actor.id], actions };
}
