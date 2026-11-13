/**
 * STORY ENGINE — game rules
 * --------------------------------------------------------------------------
 * Decides what happens on each turn and applies every state change (mood,
 * bonds, memories, event history). It is deterministic given a random
 * source, so it is testable. Writers (built-in templates or the AI) only put
 * this outcome into words; they can't change state, names or written canon.
 *
 * Repetition controls:
 *  - each event type has a cooldown, and recent types are down-weighted
 *  - the same reaction / dialogue approach / talk topic is down-weighted per character
 *  - built-in templates never reuse the variant they used last time
 *  - the player's "event frequency" setting decides how often Wait becomes an event
 */
import { makeId } from "../id";
import { approvedBehavior } from "../character/model";
import { approachScores, reactionTendencies, traitVector } from "../behavior/tendencies";
import { EVENTS, MOOD_BIAS, REACTION_EFFECTS, type EventContext, type EventDef } from "./events";
import type {
  Approach,
  Bond,
  Character,
  CharacterState,
  EnvironmentTypeId,
  EventFrequency,
  EventRecord,
  Memory,
  Mood,
  Reaction,
  StoryState,
  WorldId,
} from "../types";
import { APPROACHES, REACTIONS } from "../types";

export type Action = "talk" | "observe" | "wait" | "twist";
export type Topic = "goals" | "fears" | "relationships" | "background" | "values";
export const TOPICS: Topic[] = ["goals", "fears", "relationships", "background", "values"];

export type Rng = () => number;

export const emptyStory = (): StoryState => ({ turn: 0, characters: {}, bonds: {}, events: [] });

export const bondKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const neutralBond = (): Bond => ({ affinity: 0, trust: 0 });
export const neutralState = (): CharacterState => ({ mood: "calm", intensity: 0, memories: [] });

export const FREQUENCY_CHANCE: Record<EventFrequency, number> = { calm: 0.25, normal: 0.5, chaotic: 0.8 };
const MAX_EVENTS = 60;
const MAX_MEMORIES = 24;
const BOND_STEP_CAP = 12;

export type Beat = {
  kind: "talk" | "observe" | "wait" | "event";
  /** Event type, or "talk.<topic>", "observe", "wait". */
  type: string;
  actorId: string;
  otherId: string | null;
  reaction: Reaction | null;
  approach: Approach;
  topic: Topic | null;
  outcome: "progress" | "setback" | null;
  moodBefore: Mood;
  moodAfter: Mood;
  bondBefore: Bond | null;
  bondAfter: Bond | null;
  importance: number;
  /** For memoryEcho: the memory being recalled. */
  recalled: Memory | null;
  /** The memory this beat created for the actor, if notable. */
  memoryId: string | null;
  variant: number;
  turn: number;
};

export type PlanInput = {
  story: StoryState;
  cast: Character[];
  actorId: string;
  action: Action;
  world: WorldId;
  place: EnvironmentTypeId;
  frequency: EventFrequency;
  rng?: Rng;
};

// ---------------------------------------------------------------- helpers

export function weightedPick<T>(items: T[], weights: number[], rng: Rng): T | null {
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0 || items.length === 0) return null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Reaction weights for a character: approved analysis if any, otherwise sliders + written hints. */
export function tendenciesFor(c: Character): Record<Reaction, number> {
  return approvedBehavior(c)?.profile.reactionTendencies ?? reactionTendencies(c);
}

function approachWeightsFor(c: Character): Record<Approach, number> {
  const approved = approvedBehavior(c)?.profile.dialogueApproaches;
  const scores = approachScores(c);
  return Object.fromEntries(
    APPROACHES.map((a) => [a, approved ? (approved.includes(a) ? 60 + scores[a] * 0.4 : scores[a] * 0.25) : scores[a] ** 1.5 / 10]),
  ) as Record<Approach, number>;
}

const MOOD_APPROACH: Record<Mood, Partial<Record<Approach, number>>> = {
  calm: {},
  happy: { warm: 1.4, teasing: 1.3, curt: 0.6 },
  anxious: { guarded: 1.5, rambling: 1.3, direct: 0.7 },
  irritated: { curt: 1.6, direct: 1.4, warm: 0.6 },
  sad: { guarded: 1.4, curt: 1.2, teasing: 0.5 },
  excited: { rambling: 1.6, direct: 1.2 },
  suspicious: { probing: 1.6, guarded: 1.3, warm: 0.7 },
  embarrassed: { rambling: 1.4, guarded: 1.3, teasing: 1.1 },
};

const recentFor = (events: EventRecord[], actorId: string, n: number) => events.filter((e) => e.actorId === actorId).slice(-n);

/** 0.4× per repeat among the character's last 3 uses. */
const repeatPenalty = (count: number) => Math.pow(0.4, count);

export function chooseApproach(c: Character, mood: Mood, events: EventRecord[], rng: Rng): Approach {
  const base = approachWeightsFor(c);
  const recent = recentFor(events, c.id, 3).map((e) => e.approach);
  const weights = APPROACHES.map((a) => base[a] * (MOOD_APPROACH[mood][a] ?? 1) * repeatPenalty(recent.filter((x) => x === a).length));
  return weightedPick([...APPROACHES], weights, rng) ?? "direct";
}

export function chooseReaction(def: EventDef, c: Character, state: CharacterState, bond: Bond | null, events: EventRecord[], rng: Rng): Reaction {
  const tend = tendenciesFor(c);
  const recent = recentFor(events, c.id, 3).map((e) => e.reaction);
  const weights = def.reactions.map((r) => {
    let w = tend[r] + (MOOD_BIAS[state.mood][r] ?? 0) * (state.intensity >= 2 ? 1.3 : 1);
    if (bond) {
      if (bond.affinity > 30) w += r === "comfort" ? 15 : r === "cooperate" ? 10 : r === "confront" ? -10 : 0;
      if (bond.affinity < -30) w += r === "confront" ? 15 : r === "comfort" ? -15 : 0;
      if (bond.trust < -30 && r === "investigate") w += 15;
    }
    // Same trait, different situation: keep every allowed reaction possible (floor), so nobody becomes a stereotype.
    return Math.max(6, w) * repeatPenalty(recent.filter((x) => x === r).length);
  });
  return weightedPick(def.reactions, weights, rng) ?? def.reactions[0];
}

/** Variant index for a template with `count` variants, never the one used last time for this key. */
export function pickVariant(count: number, lastUsed: number | undefined, rng: Rng): number {
  if (count <= 1) return 0;
  const options = Array.from({ length: count }, (_, i) => i).filter((i) => i !== lastUsed);
  return options[Math.floor(rng() * options.length) % options.length];
}

const clampBond = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));
const capStep = (v: number) => Math.max(-BOND_STEP_CAP, Math.min(BOND_STEP_CAP, v));

/** Moods fade back to calm over time for everyone not in this beat. */
function decayMoods(states: Record<string, CharacterState>, except: Set<string>): Record<string, CharacterState> {
  const out: Record<string, CharacterState> = {};
  for (const [id, s] of Object.entries(states)) {
    if (except.has(id) || s.mood === "calm") out[id] = s;
    else {
      const intensity = s.intensity - 1;
      out[id] = intensity <= 0 ? { ...s, mood: "calm", intensity: 0 } : { ...s, intensity };
    }
  }
  return out;
}

function addMemory(state: CharacterState, m: Memory): CharacterState {
  let memories = [...state.memories, m];
  if (memories.length > MAX_MEMORIES) {
    // Drop the least important, oldest first.
    const drop = [...memories].sort((a, b) => a.importance - b.importance || a.turn - b.turn)[0];
    memories = memories.filter((x) => x !== drop);
  }
  return { ...state, memories };
}

// ---------------------------------------------------------------- planning

export function candidateEvents(input: PlanInput, actor: Character, others: Character[]): { def: EventDef; other: Character | null; weight: number }[] {
  const { story } = input;
  const actorState = story.characters[actor.id] ?? neutralState();
  const traits = traitVector(actor);
  const last6 = story.events.slice(-6).map((e) => e.type);
  const lastType = story.events.at(-1)?.type;
  const out: { def: EventDef; other: Character | null; weight: number }[] = [];
  for (const def of EVENTS) {
    const lastSame = [...story.events].reverse().find((e) => e.type === def.type);
    if (lastSame && story.turn - lastSame.turn < def.cooldown) continue;
    if (def.type === lastType) continue;
    const pool = def.pair ? others : [null];
    for (const other of pool) {
      const bond = other ? (story.bonds[bondKey(actor.id, other.id)] ?? neutralBond()) : null;
      const ctx: EventContext = {
        actor,
        other,
        actorState,
        bond,
        traits,
        otherTraits: other ? traitVector(other) : null,
        world: input.world,
        place: input.place,
      };
      if (def.requires && !def.requires(ctx)) continue;
      const repeats = last6.filter((t) => t === def.type).length;
      const w = def.weight(ctx) * Math.pow(0.35, repeats) * (def.pair ? 1 / Math.max(1, others.length) : 1);
      if (w > 0) out.push({ def, other, weight: w });
    }
  }
  return out;
}

export type PlanResult = { beat: Beat; story: StoryState };

export function plan(input: PlanInput): PlanResult {
  const rng = input.rng ?? Math.random;
  const { story, cast, actorId } = input;
  const actor = cast.find((c) => c.id === actorId);
  if (!actor) throw new Error("Unknown actor");
  const others = cast.filter((c) => c.id !== actorId);
  const turn = story.turn + 1;
  const states: Record<string, CharacterState> = { ...story.characters };
  const actorState = states[actor.id] ?? neutralState();
  const lastVariant = (type: string) => [...story.events].reverse().find((e) => e.type === type)?.variant;

  const base = {
    actorId: actor.id,
    otherId: null,
    reaction: null,
    topic: null,
    outcome: null,
    moodBefore: actorState.mood,
    moodAfter: actorState.mood,
    bondBefore: null,
    bondAfter: null,
    importance: 0,
    recalled: null,
    memoryId: null,
    turn,
  } satisfies Partial<Beat>;

  const finish = (beat: Beat, nextStates: Record<string, CharacterState>, bonds = story.bonds): PlanResult => {
    const record: EventRecord = {
      id: makeId("evt"),
      turn,
      type: beat.type,
      actorId: beat.actorId,
      otherId: beat.otherId,
      reaction: beat.reaction,
      approach: beat.approach,
      variant: beat.variant,
      at: Date.now(),
    };
    const involved = new Set([beat.actorId, ...(beat.otherId ? [beat.otherId] : [])]);
    return {
      beat,
      story: { turn, characters: decayMoods(nextStates, involved), bonds, events: [...story.events, record].slice(-MAX_EVENTS) },
    };
  };

  let action = input.action;
  if (action === "wait" && rng() < FREQUENCY_CHANCE[input.frequency]) action = "twist";

  if (action === "talk") {
    const used = recentFor(story.events, actor.id, 4)
      .map((e) => e.type)
      .filter((t) => t.startsWith("talk."));
    const topics = TOPICS.filter((f) => actor[f].trim());
    const weights = topics.map((tp) => repeatPenalty(used.filter((u) => u === `talk.${tp}`).length) * (tp === "fears" && actorState.mood === "anxious" ? 2 : 1));
    const topic = weightedPick(topics, weights, rng);
    const approach = chooseApproach(actor, actorState.mood, story.events, rng);
    const type = topic ? `talk.${topic}` : "talk.none";
    return finish({ ...base, kind: "talk", type, topic, approach, variant: pickVariant(3, lastVariant(`talk.${approach}`), rng) }, states);
  }

  if (action === "observe") {
    const approach = chooseApproach(actor, actorState.mood, story.events, rng);
    return finish({ ...base, kind: "observe", type: "observe", approach, variant: pickVariant(2, lastVariant("observe"), rng) }, states);
  }

  if (action === "wait") {
    const approach = chooseApproach(actor, actorState.mood, story.events, rng);
    return finish({ ...base, kind: "wait", type: "wait", approach, variant: pickVariant(3, lastVariant("wait"), rng) }, states);
  }

  // ---- event ("twist", or a wait that turned into one)
  const candidates = candidateEvents(input, actor, others);
  const chosen = weightedPick(
    candidates,
    candidates.map((c) => c.weight),
    rng,
  );
  if (!chosen) {
    // Everything is cooling down: a quiet beat is better than repeating an event.
    const approach = chooseApproach(actor, actorState.mood, story.events, rng);
    return finish({ ...base, kind: "wait", type: "wait", approach, variant: pickVariant(3, lastVariant("wait"), rng) }, states);
  }
  const { def, other } = chosen;
  const key = other ? bondKey(actor.id, other.id) : null;
  const bondBefore = key ? (story.bonds[key] ?? neutralBond()) : null;
  const reaction = chooseReaction(def, actor, actorState, bondBefore, story.events, rng);
  const approach = chooseApproach(actor, actorState.mood, story.events, rng);
  const effect = REACTION_EFFECTS[reaction];
  const moodAfter: Mood = def.moods?.[reaction] ?? effect.mood;
  const outcome = def.type === "goalStep" ? (rng() < (reaction === "withdraw" ? 0.35 : 0.6) ? "progress" : "setback") : null;

  let bonds = story.bonds;
  let bondAfter: Bond | null = null;
  let importance = def.importance;
  if (key && bondBefore) {
    const scale = def.bondScale ?? 1;
    const da = capStep(effect.affinity * scale);
    const dt = capStep(effect.trust * scale);
    bondAfter = { affinity: clampBond(bondBefore.affinity + da), trust: clampBond(bondBefore.trust + dt) };
    bonds = { ...bonds, [key]: bondAfter };
    if (Math.abs(da) >= 7) importance = Math.min(3, importance + 1);
  }
  if (outcome === "progress") importance = Math.min(3, importance + 1);

  const recalled =
    def.type === "memoryEcho"
      ? (weightedPick(
          actorState.memories.filter((m) => m.importance >= 2),
          actorState.memories.filter((m) => m.importance >= 2).map((m) => m.importance * (1 + m.turn / Math.max(1, turn))),
          rng,
        ) ?? null)
      : null;

  const nextStates = { ...states };
  let actorNext: CharacterState = { ...actorState, mood: moodAfter, intensity: importance >= 3 ? 3 : 2 };
  let memoryId: string | null = null;
  if (importance >= 2) {
    memoryId = makeId("mem");
    actorNext = addMemory(actorNext, {
      id: memoryId,
      turn,
      eventType: def.type,
      reaction,
      withId: other?.id ?? null,
      withName: other?.name.trim() ?? "",
      mood: moodAfter,
      importance,
      note: null,
      at: Date.now(),
    });
  }
  nextStates[actor.id] = actorNext;
  if (other && importance >= 2) {
    // The other person remembers it too, from their side.
    const os = nextStates[other.id] ?? neutralState();
    nextStates[other.id] = addMemory(os, {
      id: makeId("mem"),
      turn,
      eventType: def.type,
      reaction: null,
      withId: actor.id,
      withName: actor.name.trim(),
      mood: os.mood,
      importance: importance - 1,
      note: null,
      at: Date.now(),
    });
  }

  const variant = pickVariant(3, lastVariant(def.type), rng);
  return finish(
    {
      ...base,
      kind: "event",
      type: def.type,
      otherId: other?.id ?? null,
      reaction,
      approach,
      outcome,
      moodAfter,
      bondBefore,
      bondAfter,
      importance,
      recalled,
      memoryId,
      variant,
    },
    nextStates,
    bonds,
  );
}

/** Attach an AI-written note to a memory (text only; never changes numbers). */
export function withMemoryNote(story: StoryState, actorId: string, memoryId: string, note: string): StoryState {
  const s = story.characters[actorId];
  if (!s) return story;
  return {
    ...story,
    characters: { ...story.characters, [actorId]: { ...s, memories: s.memories.map((m) => (m.id === memoryId ? { ...m, note: note.slice(0, 140) } : m)) } },
  };
}

export { REACTIONS };
