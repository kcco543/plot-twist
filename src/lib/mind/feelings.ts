/**
 * EMOTION STATE MANAGER — temporary feelings.
 * --------------------------------------------------------------------------
 * A character holds several feelings at once (0–100 each). Events raise
 * them; they fade a little every story turn unless something reinforces
 * them. Feelings never touch personality.
 *
 * The single "emotion" the pixel effects show (CharacterState.emotion) is
 * chosen separately by the expression step in decide.ts, because what a
 * character shows is not always what they feel.
 */
import type { Emotion } from "../emotion/emotions";
import { FEELINGS, type CharacterState, type Feeling, type Feelings } from "../types";

export { FEELINGS };

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** How much of a feeling is left after one turn. Surprise and confusion pass quickly; affection and sadness linger. */
export const DECAY: Record<Feeling, number> = {
  happiness: 0.75,
  anger: 0.72,
  sadness: 0.85,
  fear: 0.7,
  anxiety: 0.78,
  excitement: 0.65,
  embarrassment: 0.6,
  affection: 0.9,
  frustration: 0.75,
  surprise: 0.4,
  confusion: 0.5,
};
/** Below this a feeling counts as gone. */
export const FEELING_FLOOR = 5;

export const feelingsOf = (s: CharacterState | undefined): Feelings => s?.feelings ?? {};
export const level = (f: Feelings, k: Feeling) => f[k] ?? 0;

/** Add deltas (−100…100 each). Result clamped to 0–100; zeros dropped. */
export function addFeelings(f: Feelings, delta: Feelings): Feelings {
  const out: Feelings = { ...f };
  for (const k of FEELINGS) {
    const d = delta[k];
    if (!d) continue;
    const v = clamp((out[k] ?? 0) + d);
    if (v < FEELING_FLOOR) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** One turn passes. `involved` characters fade more slowly (the moment is still going on). */
export function decayFeelings(f: Feelings | undefined, involved = false): Feelings | undefined {
  if (!f) return f;
  const out: Feelings = {};
  for (const k of FEELINGS) {
    const v = f[k];
    if (!v) continue;
    const next = Math.round(v * (involved ? Math.min(0.95, DECAY[k] + 0.15) : DECAY[k]));
    if (next >= FEELING_FLOOR) out[k] = next;
  }
  return out;
}

/** The display emotion closest to a feeling (fear has no effect of its own; it looks anxious). */
export const FEELING_TO_EMOTION: Record<Feeling, Emotion> = {
  happiness: "happy",
  anger: "angry",
  sadness: "sad",
  fear: "anxious",
  anxiety: "anxious",
  excitement: "excited",
  embarrassment: "embarrassed",
  affection: "affectionate",
  frustration: "frustrated",
  surprise: "surprised",
  confusion: "confused",
};

/** The reverse, for the test panel / older story code that sets a display emotion directly. */
export const EMOTION_TO_FEELING: Partial<Record<Emotion, Feeling>> = {
  happy: "happiness",
  excited: "excitement",
  affectionate: "affection",
  embarrassed: "embarrassment",
  angry: "anger",
  frustrated: "frustration",
  sad: "sadness",
  anxious: "anxiety",
  surprised: "surprise",
  confused: "confusion",
};

/** Feelings sorted strongest first (only those above the floor). */
export function ranked(f: Feelings): [Feeling, number][] {
  return FEELINGS.map((k) => [k, f[k] ?? 0] as [Feeling, number]).filter(([, v]) => v >= FEELING_FLOOR).sort((a, b) => b[1] - a[1]);
}
