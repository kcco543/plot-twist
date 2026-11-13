/**
 * EVENT LIBRARY
 * --------------------------------------------------------------------------
 * Every event is a situation for one character (the "actor"), sometimes with
 * a second character. The rules here decide WHICH event happens and which
 * reactions are allowed; personality decides which reaction is likely.
 * Text comes from the writer (built-in templates or the AI), never from here.
 */
import type { Bond, Character, CharacterState, EnvironmentTypeId, Mood, Reaction, TraitId, WorldId } from "../types";

export type EventContext = {
  actor: Character;
  other: Character | null;
  actorState: CharacterState;
  bond: Bond | null;
  traits: Record<TraitId, number>;
  otherTraits: Record<TraitId, number> | null;
  world: WorldId;
  place: EnvironmentTypeId;
};

export type EventDef = {
  type: string;
  /** Needs a second character. */
  pair: boolean;
  /** Turns before the same event can happen again. */
  cooldown: number;
  /** 1 minor · 2 notable · 3 major. Notable+ events become memories. */
  importance: number;
  /** Reactions that make sense here. Boundaries are respected by design: no reaction "breaks a rule". */
  reactions: Reaction[];
  requires?: (c: EventContext) => boolean;
  /** Relative likelihood (around 0–2). */
  weight: (c: EventContext) => number;
  /** How strongly reactions move the bond (pair events). */
  bondScale?: number;
  /** Event-specific mood for a reaction (otherwise the reaction's default). */
  moods?: Partial<Record<Reaction, Mood>>;
};

const has = (s: string) => s.trim().length > 0;
const p = (v: number) => v / 100;
const bondTrust = (c: EventContext) => (c.bond ? (c.bond.trust + 100) / 200 : 0.5);
const bondAffinity = (c: EventContext) => (c.bond ? (c.bond.affinity + 100) / 200 : 0.5);

export const EVENTS: EventDef[] = [
  {
    type: "confide",
    pair: true,
    cooldown: 5,
    importance: 2,
    reactions: ["comfort", "deflect", "joke", "withdraw", "investigate"],
    requires: (c) => !!c.other && (has(c.other.fears) || has(c.other.background)),
    weight: (c) => 0.3 + bondTrust(c) * 1.2 + p(c.traits.empathy) * 0.4,
    bondScale: 1.2,
    moods: { comfort: "calm", withdraw: "embarrassed" },
  },
  {
    type: "argument",
    pair: true,
    cooldown: 4,
    importance: 2,
    reactions: ["confront", "deflect", "withdraw", "cooperate", "joke"],
    requires: (c) => has(c.actor.goals) || has(c.actor.values) || has(c.actor.personality),
    weight: (c) => 0.2 + p(c.traits.confrontation) * 0.9 + (1 - bondAffinity(c)) * 0.8 + (c.actorState.mood === "irritated" ? 0.6 : 0),
    bondScale: 1.4,
    moods: { cooperate: "calm", withdraw: "sad" },
  },
  {
    type: "misunderstanding",
    pair: true,
    cooldown: 5,
    importance: 2,
    reactions: ["investigate", "confront", "withdraw", "deflect", "act"],
    weight: (c) => 0.2 + (1 - p(c.traits.trust)) * 0.9 + (1 - bondTrust(c)) * 0.5 + (c.actorState.mood === "suspicious" ? 0.6 : 0),
    bondScale: 1.2,
    moods: { investigate: "suspicious", withdraw: "anxious" },
  },
  {
    type: "kindness",
    pair: true,
    cooldown: 4,
    importance: 1,
    reactions: ["comfort", "deflect", "joke", "withdraw", "cooperate"],
    weight: (c) => 0.4 + (c.otherTraits ? p(c.otherTraits.empathy) * 0.8 : 0.4) + bondAffinity(c) * 0.4,
    moods: { deflect: "embarrassed", withdraw: "embarrassed" },
  },
  {
    type: "tease",
    pair: true,
    cooldown: 3,
    importance: 1,
    reactions: ["joke", "confront", "withdraw", "deflect"],
    weight: (c) => 0.2 + (c.otherTraits ? p(c.otherTraits.playfulness) * 1.1 : 0.5),
    moods: { withdraw: "embarrassed", confront: "irritated", joke: "happy" },
  },
  {
    type: "askHelp",
    pair: true,
    cooldown: 5,
    importance: 2,
    reactions: ["cooperate", "act", "withdraw", "confront"],
    requires: (c) => has(c.actor.goals),
    weight: (c) => 0.3 + p(c.traits.dependence) * 1.0 + bondTrust(c) * 0.4,
    moods: { act: "excited", withdraw: "sad" },
  },
  {
    type: "rivalry",
    pair: true,
    cooldown: 6,
    importance: 2,
    reactions: ["confront", "act", "cooperate", "joke", "deflect"],
    weight: (c) => 0.2 + p(c.traits.confrontation) * 0.6 + (1 - p(c.traits.dependence)) * 0.4 + (c.otherTraits ? p(c.otherTraits.confrontation) * 0.3 : 0),
    bondScale: 1.2,
    moods: { act: "excited", cooperate: "happy" },
  },
  {
    type: "rumor",
    pair: true,
    cooldown: 6,
    importance: 2,
    reactions: ["investigate", "confront", "deflect", "comfort", "act"],
    weight: (c) => 0.2 + (1 - p(c.traits.trust)) * 0.5 + p(c.traits.expressiveness) * 0.3,
    moods: { comfort: "calm", confront: "irritated" },
  },
  {
    type: "temptation",
    pair: false,
    cooldown: 6,
    importance: 2,
    reactions: ["withdraw", "deflect", "investigate", "act"],
    requires: (c) => has(c.actor.rules) || has(c.actor.values),
    weight: (c) => 0.2 + p(c.traits.rebelliousness) * 0.8 + p(c.traits.impulsiveness) * 0.3,
    moods: { withdraw: "calm", act: "excited", investigate: "suspicious" },
  },
  {
    type: "goalStep",
    pair: false,
    cooldown: 4,
    importance: 2,
    reactions: ["act", "investigate", "cooperate", "withdraw"],
    requires: (c) => has(c.actor.goals),
    weight: (c) => 0.6 + p(c.traits.idealism) * 0.4,
    moods: { act: "excited", withdraw: "sad", investigate: "calm" },
  },
  {
    type: "fearTrigger",
    pair: false,
    cooldown: 6,
    importance: 3,
    reactions: ["withdraw", "confront", "joke", "act", "deflect"],
    requires: (c) => has(c.actor.fears),
    weight: () => 0.6,
    moods: { withdraw: "anxious", confront: "excited", joke: "embarrassed", act: "anxious", deflect: "anxious" },
  },
  {
    type: "memoryEcho",
    pair: false,
    cooldown: 5,
    importance: 1,
    reactions: ["withdraw", "comfort", "act", "joke"],
    requires: (c) => c.actorState.memories.some((m) => m.importance >= 2),
    weight: () => 0.7,
    moods: { withdraw: "sad", comfort: "calm", act: "excited", joke: "happy" },
  },
  {
    type: "worldQuirk",
    pair: false,
    cooldown: 3,
    importance: 1,
    reactions: ["investigate", "joke", "act", "withdraw"],
    weight: () => 0.7,
    moods: { investigate: "excited", withdraw: "anxious" },
  },
  {
    type: "discovery",
    pair: false,
    cooldown: 3,
    importance: 1,
    reactions: ["investigate", "act", "cooperate", "withdraw"],
    weight: (c) => 0.5 + (1 - p(c.traits.impulsiveness)) * 0.2 + p(c.traits.impulsiveness) * 0.2,
    moods: { investigate: "excited", act: "excited", withdraw: "calm" },
  },
  {
    type: "quietMoment",
    pair: false,
    cooldown: 3,
    importance: 1,
    reactions: ["withdraw", "joke", "investigate", "comfort"],
    weight: (c) => 0.4 + (1 - p(c.traits.extroversion)) * 0.4,
    moods: { withdraw: "calm", joke: "happy", investigate: "calm", comfort: "calm" },
  },
];

export const EVENT_TYPES = EVENTS.map((e) => e.type);
export const getEvent = (type: string) => EVENTS.find((e) => e.type === type) ?? null;

/** Default mood + bond change for each reaction. Event `moods` and `bondScale` adjust these. */
export const REACTION_EFFECTS: Record<Reaction, { mood: Mood; affinity: number; trust: number }> = {
  confront: { mood: "irritated", affinity: -6, trust: -2 },
  deflect: { mood: "calm", affinity: -1, trust: -2 },
  withdraw: { mood: "anxious", affinity: -2, trust: -1 },
  comfort: { mood: "happy", affinity: 6, trust: 5 },
  joke: { mood: "happy", affinity: 3, trust: 1 },
  investigate: { mood: "suspicious", affinity: -1, trust: -3 },
  act: { mood: "excited", affinity: 0, trust: 0 },
  cooperate: { mood: "calm", affinity: 4, trust: 4 },
};

/** How a current mood tilts the next reaction. */
export const MOOD_BIAS: Record<Mood, Partial<Record<Reaction, number>>> = {
  calm: {},
  happy: { joke: 15, comfort: 10, confront: -15 },
  anxious: { withdraw: 25, act: -10, joke: -10 },
  irritated: { confront: 25, joke: -15, comfort: -10 },
  sad: { withdraw: 20, joke: -15 },
  excited: { act: 20, joke: 10, withdraw: -10 },
  suspicious: { investigate: 25, comfort: -10, cooperate: -10 },
  embarrassed: { deflect: 25, joke: 10 },
};
