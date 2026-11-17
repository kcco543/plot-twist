/**
 * CHARACTER AUTONOMY — data shapes and tunables.
 * --------------------------------------------------------------------------
 * A character's own action is an INTENT: a small, structured, validated
 * request ("walk away from Tobi", "go to the window", "sit on the rug"),
 * never free text and never a direct position change. Intents come from:
 *
 *   rules     the deterministic planner (planner.ts): feelings, personality,
 *             relationships, what's nearby; run a few times a minute, never
 *             every frame and never calling an AI
 *   dialogue  something the character genuinely said they'd do (goals.ts)
 *   ai        a proposal attached to an AI-written reply (validated the same way)
 *   story     consequences the game decides (ending a conversation)
 *
 * Every intent goes through the same lifecycle (lifecycle.ts):
 *   proposed → validated → queued → executing → completed | interrupted | failed
 * and is executed only through the stage's validated actions (pathfinding,
 * collision, priorities), so nothing can teleport or walk through walls.
 *
 * Saved per world in StoryState.agency (plain JSON).
 */
import type { SavedSpot } from "../stage/sim";

export const INTENT_KINDS = [
  "approach",
  "move_away",
  "go_to_place",
  "inspect_object",
  "use_object",
  "sit",
  "stand",
  "turn_toward",
  "turn_away",
  "pause",
  "leave_conversation",
  "decline",
  "seek_privacy",
  "return_to_task",
  "stay_still",
  "observe",
  "avoid_object",
  "reflect",
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const INTENT_STATUSES = ["proposed", "validated", "queued", "executing", "completed", "interrupted", "failed"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export type IntentSource = "rules" | "dialogue" | "ai" | "story";

export type Intent = {
  id: string;
  actor: string;
  kind: IntentKind;
  /** Another character (approach, move_away, turn_toward/away, observe). */
  target?: string;
  /** An object in the room (inspect/use/sit/go_to_place/seek_privacy/return_to_task). */
  object?: string;
  /** For go_to_place: the place words it came from ("library", "窗边"). */
  place?: string;
  /** For avoid_object: where to step to (stage px). */
  at?: { x: number; y: number };
  /** Why (an i18n key under autonomy.reasons), shown in the debug view and log. */
  reason: string;
  source: IntentSource;
  /** Stage priority it runs at: "auto" (interruptible by anything) or "story". */
  priority: "auto" | "story";
  status: IntentStatus;
  createdAt: number;
  updatedAt: number;
  /** Why it failed / was interrupted, or why validation refused it. */
  note?: string;
};

/**
 * A conversation boundary: `who` ended a conversation with `other` (or refused one).
 * Not a timer: cooldown is only one of the conditions for talking again (see convoBoundary.ts).
 */
export type ConvoBoundary = {
  who: string;
  other: string;
  /** When it happened (ms) and on which story turn. */
  at: number;
  turn: number;
  /** 1 mild (annoyed), 2 upset, 3 deeply hurt / angry. */
  severity: 1 | 2 | 3;
  /** How many times `other` tried to talk again before `who` was ready. */
  pushes: number;
  lastPushAt: number;
  /** Set once `who` is willing to talk again (kept for history). */
  resolvedAt?: number;
};

/** A destination someone genuinely said they'd go to, waiting for the conversation to end. */
export type StatedGoal = {
  id: string;
  actor: string;
  /** Words for the place, as said. */
  place: string;
  /** The object it resolves to in this room, or null (no such place here). */
  object: string | null;
  text: string;
  at: number;
  status: "pending" | "started" | "done" | "unavailable" | "failed";
};

export type AgencyState = {
  intents: Intent[];
  /** Recently finished intents (most recent last), for the debug view, repetition control and "return to task". */
  log: Intent[];
  goals: StatedGoal[];
  /** Keyed "who>other". */
  boundaries: Record<string, ConvoBoundary>;
  /** Where everyone stands (in which place), so a reload puts them back. */
  spots?: { place: string; at: Record<string, SavedSpot> };
  /** Last time each character's planner ran / acted (ms). */
  lastThought?: Record<string, number>;
  lastActed?: Record<string, number>;
  /** Environment-aware behaviour (environment.ts): cooldowns and what each character has seen others enjoy. */
  env?: EnvMemory;
};

export type EnvMemory = {
  /** Last environmental reaction per character (ms). */
  lastAt: Record<string, number>;
  /** "actor>object" → ms. */
  seen: Record<string, number>;
  /** Last environmental reaction anywhere in the scene (ms). */
  globalAt: number;
  /** "inviter>invitee" → ms. */
  invites: Record<string, number>;
  /** What each character saw others enjoy: actor → ["otherId:concept"]. */
  witnessed: Record<string, string[]>;
};

export const emptyAgency = (): AgencyState => ({ intents: [], log: [], goals: [], boundaries: {} });

/** Every tunable number in one place. */
export const AUTONOMY = {
  /** How often the autonomy loop runs (real ms). The planner itself is per character, below. */
  tickMs: 1000,
  /** A character thinks about doing something at most this often (ms of unpaused play). */
  thinkMs: 9000,
  /** …and acts on their own at most this often. */
  actGapMs: 14000,
  /** At most this many characters on autonomous walks at once. */
  maxConcurrentWalks: 2,
  /** An executing intent that hasn't finished after this long is failed (ms). */
  executeTimeoutMs: 25000,
  /** Kept in the log. */
  logLimit: 30,
  /** A queued intent that never got to run is dropped after this long (ms). */
  queueTtlMs: 30000,
} as const;
