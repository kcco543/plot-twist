/**
 * Every tunable number of relationship development, in one place.
 * Tests import this object, so changing a value here changes what the tests
 * expect only where they read it from here.
 */
import type { Axis, InteractionKind, MilestoneKind, Significance } from "./types";

export type StageDef = {
  id: string;
  /** Value at or above which the stage can be ENTERED from below. */
  enter: number;
  /** Value below which the stage is LEFT (lower than `enter`: hysteresis). */
  exit: number;
  /** Positive milestones (of this axis' kinds) needed to enter. */
  need: number;
  /** Of which at least this many different kinds. */
  distinct?: number;
  /** Extra: total interactions with this person (familiarity). */
  interactions?: number;
};

export const RELATIONSHIP_CONFIG = {
  /** Size of one change by significance (multiplies the kind's base effect). */
  significanceScale: { trivial: 0.5, ordinary: 1, meaningful: 1.8, major: 3 } satisfies Record<Significance, number>,
  /** Largest change per dimension, and in total, from one interaction. */
  perAxisCap: { trivial: 1, ordinary: 2, meaningful: 5, major: 15 } satisfies Record<Significance, number>,
  totalCap: { trivial: 1.5, ordinary: 3, meaningful: 8, major: 25 } satisfies Record<Significance, number>,
  /** Same kind with the same person within this many turns counts as a repeat. */
  repeatWindowTurns: 10,
  /** Positive effects × this per repeat in the window (0.5 → 1, ½, ¼ …). Kinds below override it. */
  repeatDecay: 0.5,
  repeatDecayByKind: { small_talk: 0.85, cooperate: 0.8, help: 0.75, keep_promise: 0.9, respect_boundary: 0.85, valid_argument: 0.75, shared_experience: 0.8, share_secret: 0.7, reunion: 0.7 } as Partial<Record<InteractionKind, number>>,
  /** Positive effects × 1 / (1 + this × lifetime count of the kind): easy gestures wear out fastest. */
  lifetimeDecay: 0.04,
  lifetimeDecayByKind: { compliment: 0.15, thanks: 0.1, gift: 0.12, photo: 0.1, agree: 0.12, small_talk: 0.03, tease: 0.08 } as Partial<Record<InteractionKind, number>>,
  /** Familiarity grows with time spent together: only this lifetime decay applies to it. */
  familiarityLifetimeDecay: 0.015,
  /** The same gift / photo again: × this per earlier time (on top of the kind's own repeat decay). */
  sameItemDecay: 0.25,
  /** Different items of the same kind in the window: × this per earlier one. */
  otherItemDecay: 0.75,
  /** Higher values are harder to raise: × max(floor, 1 − value / span). */
  levelSpan: 130,
  levelFloor: 0.15,
  /** While a serious conflict is open: trust gains × this, affection gains × the other. */
  openConflictTrust: 0.3,
  openConflictAffection: 0.5,
  /** Positive values may run this far past a stage they lack the milestones for. */
  ceilingSlack: 2,
  /** Compliments: this many in the last `flatteryWindow` interactions, making up this share, reads as flattery. */
  flatteryCount: 4,
  flatteryShare: 0.6,
  flatteryWindow: 8,
  /** Boundary pushes hurt more each time: × (1 + this × earlier pushes on the topic). */
  pushEscalation: 0.5,
  /** Kept per direction. */
  historyKeep: 40,
  logKeep: 30,
  milestoneKeep: 40,
  /** Interactions in distinct turns that count as "several instances of reliable behavior". */
  reliableActs: 3,
  /** Boundary respected this many times = a milestone. */
  respectedTimes: 2,
  /** Reasonable arguments / shows of competence = earned respect. */
  respectActs: 2,
  /** Shared experiences at least this many turns apart to count again. */
  sharedGap: 5,
  /** Repair acts needed to resolve a conflict, by kind (after at least one apology, except arguments). */
  repairNeeded: { argument: 1, broken_promise: 2, boundary: 2, threat: 4, betrayal: 4 },
  stages: {
    trust: [
      { id: "distrustful", enter: -Infinity, exit: -Infinity, need: 0 },
      { id: "guarded", enter: -30, exit: -40, need: 0 },
      { id: "cautious", enter: 10, exit: 0, need: 0 },
      { id: "developing", enter: 35, exit: 25, need: 1 },
      { id: "strong", enter: 65, exit: 55, need: 3, distinct: 2 },
      { id: "deep", enter: 85, exit: 75, need: 5, distinct: 3 },
    ],
    affection: [
      { id: "hostile", enter: -Infinity, exit: -Infinity, need: 0 },
      { id: "cold", enter: -40, exit: -50, need: 0 },
      { id: "neutral", enter: -10, exit: -20, need: 0 },
      { id: "warm", enter: 25, exit: 15, need: 1 },
      { id: "fond", enter: 55, exit: 45, need: 2, distinct: 2 },
      { id: "devoted", enter: 80, exit: 70, need: 4, distinct: 3 },
    ],
    respect: [
      { id: "contempt", enter: -Infinity, exit: -Infinity, need: 0 },
      { id: "doubtful", enter: -30, exit: -40, need: 0 },
      { id: "neutral", enter: -5, exit: -15, need: 0 },
      { id: "respect", enter: 30, exit: 20, need: 1 },
      { id: "admiration", enter: 65, exit: 55, need: 2, distinct: 2 },
    ],
    familiarity: [
      { id: "stranger", enter: -Infinity, exit: -Infinity, need: 0 },
      { id: "acquaintance", enter: 15, exit: 10, need: 0 },
      { id: "familiar", enter: 40, exit: 32, need: 0, interactions: 10 },
      { id: "close", enter: 70, exit: 62, need: 2, interactions: 25 },
    ],
    tension: [
      { id: "calm", enter: -Infinity, exit: -Infinity, need: 0 },
      { id: "strained", enter: 30, exit: 20, need: 0 },
      { id: "hostile", enter: 60, exit: 48, need: 0 },
    ],
  } satisfies Record<Axis, StageDef[]>,
  /** Which positive milestones support which axis. */
  milestoneAxes: {
    reliable_behavior: ["trust", "affection"],
    promise_kept: ["trust"],
    helped_in_difficulty: ["trust", "affection", "respect"],
    voluntary_secret: ["trust", "affection", "familiarity"],
    shared_experience: ["affection", "familiarity"],
    resolved_disagreement: ["trust", "affection", "respect"],
    respected_boundaries: ["trust", "respect"],
    earned_respect: ["respect"],
    boundary_reconsidered: ["trust", "familiarity"],
    betrayed: [],
    promise_broken: [],
    threatened: [],
    boundary_violated: [],
  } satisfies Record<MilestoneKind, Axis[]>,
  /** Disclosure: how willing to share each tier is, before anything else. */
  tierBase: { public: 1, casual: 0.85, sensitive: 0.45, private: 0.15, locked: 0 },
  /** …and the most it can ever reach. High trust never guarantees disclosure. */
  tierMax: { public: 1, casual: 0.95, sensitive: 0.8, private: 0.55, locked: 0 },
  /** Willingness bonus from the trust stage (never enough on its own for private things). */
  trustStageBonus: { distrustful: -0.4, guarded: -0.2, cautious: 0, developing: 0.08, strong: 0.16, deep: 0.24 } as Record<string, number>,
  /** Each earlier ask on the same topic lowers willingness by this much. Never raises it. */
  pressurePenalty: 0.2,
  /** Asks after a refusal: 1 = repeat / explain, 2 = discomfort, change subject, 3+ = end the conversation. */
  endAfterRefusals: 3,
};

/** Kinds that can be scored as major story events. */
export const MAJOR_OK: InteractionKind[] = ["rescue", "betrayal", "threat", "share_secret", "keep_promise", "break_promise", "help", "shared_experience"];
/** Kinds that never rise above ordinary (no matter what the AI says). */
export const ORDINARY_MAX: InteractionKind[] = ["small_talk", "compliment", "thanks", "agree", "tease", "photo", "reunion", "make_promise"];
/** Kinds whose negative side counts as a serious event (larger caps). */
export const SERIOUS_NEGATIVE: InteractionKind[] = ["betrayal", "threat", "break_promise"];
/** "Reliable acts" (count toward reliable_behavior and conflict repair). */
export const RELIABLE_ACTS: InteractionKind[] = ["help", "rescue", "keep_promise", "cooperate", "respect_boundary"];
