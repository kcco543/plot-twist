/**
 * AUTONOMOUS INTERACTION FREQUENCY (observation setting, per world save)
 * --------------------------------------------------------------------------
 * How often characters CONSIDER interacting on their own while the player
 * watches: starting a conversation with someone, or reacting to the room.
 * It never forces anyone to interact: every opportunity still has to pass
 * the character's own rules (personality, mood, boundaries, relationship,
 * what they're doing). High means more chances, not nonstop talk.
 *
 * Separate from Settings → Event frequency (how often pressing Wait turns
 * into a plot twist), which is the offline storytelling setting.
 *
 * Every number lives here; nothing else hardcodes a frequency.
 */

export const FREQUENCIES = ["low", "medium", "high"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const DEFAULT_FREQUENCY: Frequency = "medium";
export const isFrequency = (v: unknown): v is Frequency => typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);

export type FrequencySpec = {
  /** How often the scheduler looks for a conversation opportunity (ms of unpaused observation). */
  considerMs: number;
  /** Two autonomous conversations in this world never START closer together than this. */
  convoGapMs: number;
  /** A character who just finished (or declined) one won't start or be asked again for this long. */
  charGapMs: number;
  /** The same two characters: at most one conversation attempt per this long. */
  pairGapMs: number;
  /** Added to the initiator's score before it is compared with the bar (higher = more readily). */
  initiative: number;
  /** Multiplies how long a character waits between solo decisions (AUTONOMY.thinkMs / actGapMs). >1 = calmer. */
  thinkScale: number;
  /** Multiplies the environmental reaction cooldowns (environment.ts ENV). >1 = rarer. */
  envScale: number;
  /** At most this many AI-written autonomous conversations per hour of observation. */
  aiPerHour: number;
};

export const FREQUENCY: Record<Frequency, FrequencySpec> = {
  // More time on their own things; a conversation now and then, with room to develop.
  low: { considerMs: 9_000, convoGapMs: 150_000, charGapMs: 240_000, pairGapMs: 600_000, initiative: -0.03, thinkScale: 1.35, envScale: 1.6, aiPerHour: 4 },
  // Balanced: occasional conversations and reactions to the room. The default.
  medium: { considerMs: 6_000, convoGapMs: 70_000, charGapMs: 140_000, pairGapMs: 360_000, initiative: 0, thinkScale: 1, envScale: 1, aiPerHour: 8 },
  // More opportunities, still filtered by who they are and what they're doing.
  high: { considerMs: 4_000, convoGapMs: 32_000, charGapMs: 80_000, pairGapMs: 200_000, initiative: 0.03, thinkScale: 0.75, envScale: 0.65, aiPerHour: 14 },
};

export const frequencySpec = (f: Frequency | undefined | null): FrequencySpec => FREQUENCY[isFrequency(f) ? f : DEFAULT_FREQUENCY];
