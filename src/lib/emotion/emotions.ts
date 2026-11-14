/**
 * EMOTIONS — a character's CURRENT feeling.
 * --------------------------------------------------------------------------
 * Emotions are short-lived story state (StoryState.characters[id].emotion),
 * kept apart from personality, which is permanent (Character.traits and the
 * written profile). Personality only changes how LIKELY an emotion is and how
 * it is shown, so a calm character can still get angry and an introvert can
 * still get excited.
 *
 * The rules here are deterministic: the same beat + characters + bond always
 * give the same emotion. No AI is involved.
 */
import { traitVector } from "../behavior/tendencies";
import type { Bond, Character, CharacterState, Mood, Reaction } from "../types";

export const EMOTIONS = [
  "neutral",
  "happy",
  "excited",
  "affectionate",
  "embarrassed",
  "angry",
  "frustrated",
  "sad",
  "anxious",
  "surprised",
  "confused",
] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const isEmotion = (v: unknown): v is Emotion => typeof v === "string" && (EMOTIONS as readonly string[]).includes(v);

/** 1 mild · 2 clear · 3 strong. Controls effect size, never the kind of effect. */
export type EmotionLevel = 1 | 2 | 3;
export const clampLevel = (n: number): EmotionLevel => (n >= 3 ? 3 : n <= 1 ? 1 : 2);

export type EmotionReading = { emotion: Emotion; level: EmotionLevel; at: number };

/** Current emotion stored on a character's story state (older saves have none: neutral). */
export function emotionOf(state: CharacterState | undefined): EmotionReading {
  if (!state || !isEmotion(state.emotion) || state.emotion === "neutral" || !state.emotionLevel) return { emotion: "neutral", level: 1, at: state?.emotionAt ?? 0 };
  return { emotion: state.emotion, level: clampLevel(state.emotionLevel), at: state.emotionAt ?? 0 };
}

export function withEmotion(state: CharacterState, emotion: Emotion, level: number, at = Date.now()): CharacterState {
  return emotion === "neutral" ? { ...state, emotion: "neutral", emotionLevel: 0, emotionAt: at } : { ...state, emotion, emotionLevel: clampLevel(level), emotionAt: at };
}

/** One turn passes without this character being involved: the feeling fades a step. */
export function fadeEmotion(state: CharacterState): CharacterState {
  if (!state.emotion || state.emotion === "neutral" || !state.emotionLevel) return state;
  const level = state.emotionLevel - 1;
  return level <= 0 ? { ...state, emotion: "neutral", emotionLevel: 0 } : { ...state, emotionLevel: level };
}

const hi = (v: number) => v >= 60;
const lo = (v: number) => v <= 40;

/** Engine mood → the closest emotion, with personality deciding between near neighbours. */
export function emotionFromMood(mood: Mood, c: Character): Emotion {
  const t = traitVector(c);
  switch (mood) {
    case "calm":
      return "neutral";
    case "happy":
      return "happy";
    case "excited":
      return "excited";
    case "sad":
      return "sad";
    case "anxious":
      return "anxious";
    case "embarrassed":
      return "embarrassed";
    case "suspicious":
      return "confused";
    case "irritated":
      // Same mood, different people: the confrontational boil over, the rest stew.
      return hi(t.confrontation) || (hi(t.impulsiveness) && !lo(t.expressiveness)) ? "angry" : "frustrated";
  }
}

export type BeatLike = {
  kind: "talk" | "observe" | "wait" | "event";
  type: string;
  reaction: Reaction | null;
  moodAfter: Mood;
  importance: number;
};

/** What the ACTOR of a beat feels afterwards. */
export function actorEmotion(beat: BeatLike, actor: Character, bond: Bond | null): Emotion {
  const t = traitVector(actor);
  if (beat.kind !== "event") return emotionFromMood(beat.moodAfter, actor);
  const r = beat.reaction;
  // Event-specific shades first.
  if (beat.type === "misunderstanding" && (r === "investigate" || r === "deflect")) return "confused";
  if ((beat.type === "discovery" || beat.type === "worldQuirk") && (r === "investigate" || r === "act")) return hi(t.impulsiveness) || hi(t.playfulness) ? "excited" : "surprised";
  if (beat.type === "fearTrigger" && beat.importance >= 3 && r !== "confront" && r !== "joke") return lo(t.expressiveness) ? "anxious" : "surprised";
  if ((r === "comfort" || r === "cooperate") && bond && bond.affinity >= 15) return "affectionate";
  if (beat.type === "kindness" && (r === "deflect" || r === "withdraw")) return "embarrassed";
  if (beat.type === "rivalry" && r === "confront") return "angry";
  return emotionFromMood(beat.moodAfter, actor);
}

/**
 * What the OTHER character in a pair event feels, given how the actor reacted
 * to them. Their own personality and the bond decide the shade.
 */
export function otherEmotion(reaction: Reaction | null, other: Character, bond: Bond | null): Emotion {
  const t = traitVector(other);
  const warm = (bond?.affinity ?? 0) >= 15;
  switch (reaction) {
    case "confront":
      return hi(t.confrontation) ? "angry" : lo(t.expressiveness) || lo(t.extroversion) ? "anxious" : "sad";
    case "comfort":
      return lo(t.extroversion) && lo(t.expressiveness) ? "embarrassed" : warm || hi(t.empathy) ? "affectionate" : "happy";
    case "joke":
      return lo(t.playfulness) && lo(t.extroversion) ? "embarrassed" : "happy";
    case "withdraw":
      return hi(t.empathy) ? "sad" : "confused";
    case "investigate":
      return hi(t.confrontation) ? "frustrated" : "anxious";
    case "deflect":
      return hi(t.confrontation) ? "frustrated" : "confused";
    case "act":
      return "surprised";
    case "cooperate":
      return warm ? "affectionate" : "happy";
    default:
      return "neutral";
  }
}
