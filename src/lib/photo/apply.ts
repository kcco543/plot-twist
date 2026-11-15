/**
 * GAME-ENGINE VALIDATION of photo reactions — the AI proposes, the game decides.
 * --------------------------------------------------------------------------
 * validatePhotoReply() turns a reply from /api/ai/photo into what the game is
 * willing to do, with the player's character definition as the source of truth:
 *
 *   emotion    the same rules as conversations (checkEmotion): allowed values,
 *              reserved characters capped, canon masks, no instant flip from anger.
 *   movement   only a few small, untargeted moves, each run as a normal stage
 *              action (stage.request → validateStageAction → collision rules).
 *              Canon bans (never backs down) and contradictions are dropped.
 *   bond       how the character feels about the player: trust / affection
 *              only, ±PHOTO_STEP each; strong feelings barely move against
 *              their direction; familiarity grows a little by game rule.
 *   memory     only offered: the player decides whether to keep it.
 *
 * applyPhotoReaction() writes the emotion and bond to story state. A memory is
 * written only by addPhotoMemory(), when the player presses "Save as memory".
 */
import { withEmotion, type Emotion, type EmotionLevel } from "../emotion/emotions";
import { canonLimits } from "../mind/profile";
import { neutralState } from "../story/engine";
import { checkEmotion } from "../talk/ai/apply";
import { PLAYER_ID, type Character, type Memory, type PlayerBond, type StoryState } from "../types";
import type { PhotoMove, PhotoReactionType, PhotoReply } from "./contract";

/** Largest change to trust or affection from one photo. */
export const PHOTO_STEP = 3;
/** Familiarity gained per photo shown (game rule, not the AI's). */
export const PHOTO_FAMILIARITY = 2;
/** Above this (or below minus this), feelings barely move against their direction. */
export const STRONG_BOND = 40;
/** Photo reactions remembered for variety. */
export const RECENT_KEEP = 4;
/** Memories kept per character (same cap as conversations). */
export const MEMORY_KEEP = 24;

const WARM: Emotion[] = ["happy", "excited", "affectionate"];
const UNEASY: Emotion[] = ["anxious", "sad", "angry", "frustrated"];

export type ValidatedPhoto = {
  dialogue: string;
  question: string;
  emotion: Emotion;
  level: 0 | EmotionLevel;
  move: PhotoMove;
  bond: { trust: number; affection: number };
  reactionType: PhotoReactionType;
  /** What would be kept if the player saves this as a memory. */
  memory: { note: string; description: string; significance: string; importance: number; suggested: boolean };
  clarity: PhotoReply["observation"]["clarity"];
  adjustments: string[];
};

export const neutralBond = (): PlayerBond => ({ trust: 0, affection: 0, familiarity: 0, photos: 0, recent: [] });
export const bondWithPlayer = (story: StoryState, id: string): PlayerBond => story.player?.[id] ?? neutralBond();

export function validatePhotoReply(reply: PhotoReply, character: Character, story: StoryState): ValidatedPhoto {
  const adjustments: string[] = [];
  const canon = canonLimits(character);
  const bond = bondWithPlayer(story, character.id);
  const { emotion, level } = checkEmotion(character, story, reply.emotion, reply.intensity, adjustments);

  // ---- bond with the player
  const nudge = (key: "trust" | "affection") => {
    const raw = reply.relationshipChanges[key];
    let d = Math.round(Number.isFinite(raw) ? raw : 0);
    if (Math.abs(d) > PHOTO_STEP) {
      d = Math.sign(d) * PHOTO_STEP;
      adjustments.push(`bond:${key}_step_cap`);
    }
    if ((bond[key] >= STRONG_BOND && d < -1) || (bond[key] <= -STRONG_BOND && d > 1)) {
      d = Math.sign(d);
      adjustments.push(`bond:${key}_reversal_guard`);
    }
    return d;
  };

  // ---- movement
  let move: PhotoMove = reply.movementIntent;
  if (move === "step_back" && canon.banned.has("retreat")) {
    move = "none";
    adjustments.push("movement:canon_no_retreat");
  }
  if (move === "hop" && !WARM.includes(emotion)) {
    move = UNEASY.includes(emotion) ? "fidget" : "none";
    adjustments.push("movement:hop_without_joy");
  }
  if (move === "lean_in" && UNEASY.includes(emotion) && emotion !== "angry" && level >= 2) {
    move = "step_back";
    if (canon.banned.has("retreat")) move = "none";
    adjustments.push("movement:lean_in_while_uneasy");
  }

  const importance = Math.max(1, Math.min(3, Math.round(reply.memory.importance) || 1));
  return {
    dialogue: reply.dialogue.trim(),
    question: reply.followUpQuestion.trim(),
    emotion,
    level,
    move,
    bond: { trust: nudge("trust"), affection: nudge("affection") },
    reactionType: reply.reactionType,
    memory: {
      note: reply.memory.summary.trim() || reply.observation.description.trim(),
      description: reply.observation.description.trim(),
      significance: reply.memory.significance.trim(),
      importance,
      suggested: reply.memory.suggestSave,
    },
    clarity: reply.observation.clarity,
    adjustments,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The reaction's emotion and how the character now feels about the player. No memory yet. */
export function applyPhotoReaction(story: StoryState, v: ValidatedPhoto, character: Character, now = Date.now()): StoryState {
  const st = story.characters[character.id] ?? neutralState();
  const nextState = v.level === 0 ? withEmotion(st, "neutral", 0, now) : withEmotion(st, v.emotion, v.level, now);
  const b = bondWithPlayer(story, character.id);
  const bond: PlayerBond = {
    trust: clamp(b.trust + v.bond.trust, -100, 100),
    affection: clamp(b.affection + v.bond.affection, -100, 100),
    familiarity: clamp(b.familiarity + PHOTO_FAMILIARITY, 0, 100),
    photos: b.photos + 1,
    recent: [...b.recent, { type: v.reactionType, dialogue: v.dialogue, at: now }].slice(-RECENT_KEEP),
  };
  return { ...story, characters: { ...story.characters, [character.id]: nextState }, player: { ...(story.player ?? {}), [character.id]: bond } };
}

/** Keep the photo moment as one of the character's memories (the photo file is stored separately, by id). */
export function addPhotoMemory(
  story: StoryState,
  character: Character,
  v: ValidatedPhoto,
  photo: { photoId: string | null; caption: string },
  source: "ai" | "mock",
  now = Date.now(),
): { story: StoryState; memoryId: string } {
  const st = story.characters[character.id] ?? neutralState();
  const id = `mem-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const mem: Memory = {
    id,
    turn: story.turn,
    eventType: "photo.shared",
    count: 1,
    reaction: null,
    withId: PLAYER_ID,
    withName: "",
    mood: st.mood,
    importance: v.memory.importance,
    note: v.memory.note,
    at: now,
    source,
    photo: { photoId: photo.photoId, description: v.memory.description, significance: v.memory.significance, caption: photo.caption, said: v.dialogue },
  };
  const memories = [...st.memories, mem].slice(-MEMORY_KEEP);
  return { story: { ...story, characters: { ...story.characters, [character.id]: { ...st, memories } } }, memoryId: id };
}

/** The photo file was deleted: the character still remembers, but the link to the picture goes. */
export function unlinkPhoto(story: StoryState, photoId: string): StoryState {
  let changed = false;
  const characters = Object.fromEntries(
    Object.entries(story.characters).map(([id, st]) => {
      if (!st.memories.some((m) => m.photo?.photoId === photoId)) return [id, st];
      changed = true;
      return [id, { ...st, memories: st.memories.map((m) => (m.photo?.photoId === photoId ? { ...m, photo: { ...m.photo, photoId: null } } : m)) }];
    }),
  );
  return changed ? { ...story, characters } : story;
}

/** Every photo id still linked from a memory in this story (the rest can be cleaned up). */
export function linkedPhotoIds(story: StoryState): Set<string> {
  const ids = new Set<string>();
  for (const st of Object.values(story.characters)) for (const m of st.memories) if (m.photo?.photoId) ids.add(m.photo.photoId);
  return ids;
}

