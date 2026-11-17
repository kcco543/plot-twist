/**
 * RELATIONSHIP DEVELOPMENT — data shapes.
 * --------------------------------------------------------------------------
 * Three layers, kept apart on purpose:
 *
 *   A. Long-term relationship   StoryState.relations["from>to"] (numbers) +
 *                               RelProgress.stages (named stages with hysteresis).
 *                               Changes slowly, only through recordInteraction().
 *   B. Current impression       RelProgress.impressions: what `from` has come to
 *                               believe about `to`, each backed by evidence.
 *   C. Immediate emotion        CharacterState.feelings / emotion (emotion system).
 *                               Can swing a lot in one moment; never writes A.
 *
 * Everything here is plain JSON, stored in the active world save only.
 */

export const INTERACTION_KINDS = [
  "small_talk",
  "compliment",
  "thanks",
  "gift",
  "photo",
  "help",
  "rescue",
  "cooperate",
  "shared_experience",
  "share_secret",
  "make_promise",
  "keep_promise",
  "break_promise",
  "apology",
  "agree",
  "disagree_respectfully",
  "valid_argument",
  "argument",
  "criticize",
  "insult",
  "tease",
  "provoke",
  "boundary_push",
  "respect_boundary",
  "betrayal",
  "threat",
  "reunion",
  "rejection",
] as const;
/** What `to` did, as `from` experienced it. */
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** What a character decides to do with a request (boundaries.ts). */
export const INTENTIONS = [
  "share",
  "partial_disclosure",
  "hesitate",
  "refuse_polite",
  "refuse_firm",
  "explain_boundary",
  "deflect",
  "change_subject",
  "question_intent",
  "express_discomfort",
  "end_conversation",
  "agree",
  "partly_agree",
  "disagree",
  "answer_honestly",
  "respond_freely",
] as const;
export type Intention = (typeof INTENTIONS)[number];

export const SIGNIFICANCE = ["trivial", "ordinary", "meaningful", "major"] as const;
export type Significance = (typeof SIGNIFICANCE)[number];

/** Relationship numbers (see Relation in ../types). */
export const NUM_KEYS = ["trust", "affection", "respect", "familiarity", "rivalry", "tension", "fear", "dependence"] as const;
export type NumKey = (typeof NUM_KEYS)[number];
export type Delta = Partial<Record<NumKey, number>>;

/** Dimensions with named stages. */
export const AXES = ["trust", "affection", "respect", "familiarity", "tension"] as const;
export type Axis = (typeof AXES)[number];

export const MILESTONE_KINDS = [
  "reliable_behavior",
  "promise_kept",
  "helped_in_difficulty",
  "voluntary_secret",
  "shared_experience",
  "resolved_disagreement",
  "respected_boundaries",
  "earned_respect",
  "boundary_reconsidered",
  "betrayed",
  "promise_broken",
  "threatened",
  "boundary_violated",
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export type Milestone = { id: string; kind: MilestoneKind; turn: number; at: number; positive: boolean; why: string };

/** Bipolar themes: +1 = the first word, −1 = the second. */
export const IMPRESSION_THEMES = ["reliable", "kind", "competent", "honest", "respectful", "sincere", "safe"] as const;
export type ImpressionTheme = (typeof IMPRESSION_THEMES)[number];
export type Impression = { theme: ImpressionTheme; score: number; evidence: number; since: number; last: number };

export type ConflictKind = "argument" | "betrayal" | "broken_promise" | "threat" | "boundary";
export type Conflict = {
  id: string;
  kind: ConflictKind;
  turn: number;
  severity: 1 | 2 | 3;
  /** Trust when it happened: trust can't climb back above this until the conflict is resolved. */
  trustAt: number;
  apologies: number;
  /** Reliable acts since (help, kept promises, respected boundaries…). */
  repair: number;
  repairNeeded: number;
  resolved: boolean;
  resolvedTurn?: number;
};

export type PromiseRecord = { id: string; turn: number; text: string; status: "open" | "kept" | "broken" };

/** A sensitive request `to` made of `from`, per topic. */
export type Pressure = { asks: number; refusals: number; lastTurn: number; disclosed: number; respected: boolean; lastIntention?: string };

export type InteractionRecord = { turn: number; at: number; kind: InteractionKind; significance: Significance; positive: boolean; key?: string };

export type ChangeSource = "talk-ai" | "talk-mock" | "talk-topic" | "talk-builtin" | "behavior" | "story" | "gift" | "photo" | "sim";

export type StageChange = { axis: Axis; from: string; to: string };
/** Why a stage didn't move although the value allows it. */
export type StagePending = { axis: Axis; next: string; needs: string[] };

/** One validated interaction, for the Relationship Inspector. */
export type ChangeRecord = {
  id: string;
  turn: number;
  at: number;
  source: ChangeSource;
  kind: InteractionKind;
  /** What was asked for (AI or rules) before validation. */
  proposedKind: InteractionKind;
  significance: { proposed: Significance; accepted: Significance };
  proposed: Delta;
  accepted: Delta;
  before: Delta;
  after: Delta;
  /** Codes, see REASON text in the inspector. */
  reasons: string[];
  milestones: MilestoneKind[];
  stageChanges: StageChange[];
  pending: StagePending[];
  /** The perceiver's strongest feelings before / after (immediate emotion layer). */
  feelings: { before: Record<string, number>; after: Record<string, number> };
  /** Memory notes that were relevant at the time. */
  memories: string[];
  why: string;
};

export type RelProgress = {
  /** Current named stage per axis (hysteresis: see stages.ts). */
  stages: Partial<Record<Axis, string>>;
  /** True when the stages were read from values that existed before this system (old saves, written canon). */
  grandfathered?: boolean;
  history: InteractionRecord[];
  /** Lifetime count per kind (diminishing returns). */
  counts: Partial<Record<InteractionKind, number>>;
  milestones: Milestone[];
  impressions: Impression[];
  conflicts: Conflict[];
  promises: PromiseRecord[];
  /** Sensitive requests by topic key. */
  pressure: Record<string, Pressure>;
  /** Soft boundaries `from` decided to open up about for `to` (boundary ids). */
  openedSoft: string[];
  log: ChangeRecord[];
  since: number;
};
