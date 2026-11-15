/**
 * AI PHOTO REACTIONS — the data contract between the game and /api/ai/photo.
 * --------------------------------------------------------------------------
 *   PhotoRequestSchema  what the browser sends (validated and size-capped on the server)
 *   PhotoReplySchema    what Claude must return (structured outputs), validated again
 *                       by the server (checks.ts) and by the game engine (apply.ts)
 *
 * A photo is sent only after the player confirms it in the Photo window. The
 * request carries the re-encoded JPEG (max 1280 px, no metadata) and only the
 * context this one reaction needs. Like conversations, the reply only
 * PROPOSES an emotion, a small movement and a memory; the game decides.
 */
import { z } from "zod";
import { CharacterBriefSchema } from "../ai/contracts";
import { EMOTIONS } from "../emotion/emotions";

/** Largest image accepted by the route, in bytes (decoded). The browser sends ~100–400 KB. */
export const PHOTO_AI_MAX_BYTES = 1_800_000;
/** Image types the route accepts (the browser always sends JPEG). Checked by magic bytes too. */
export const PHOTO_AI_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoAiType = (typeof PHOTO_AI_TYPES)[number];

/** Small movements a character may make when looking at a photo (the player isn't on the stage). */
export const PHOTO_MOVES = ["none", "lean_in", "step_back", "hop", "look_around", "fidget"] as const;
export type PhotoMove = (typeof PHOTO_MOVES)[number];

/** Kinds of reaction, so reactions vary (and so the next one can avoid repeating the last). */
export const PHOTO_REACTIONS = [
  "delighted",
  "curious",
  "nostalgic",
  "amused",
  "moved",
  "impressed",
  "unimpressed",
  "skeptical",
  "worried",
  "uneasy",
  "puzzled",
  "envious",
  "inspired",
  "teasing",
] as const;
export type PhotoReactionType = (typeof PHOTO_REACTIONS)[number];

export const PHOTO_DIALOGUE_MAX = 320;
export const PHOTO_QUESTION_MAX = 160;
export const PHOTO_DESCRIPTION_MAX = 300;
export const PHOTO_SUMMARY_MAX = 200;
export const PHOTO_SIGNIFICANCE_MAX = 140;

const text = (max: number) => z.string().max(max);

/** How this character feels about the player (photos and gifts only; −100…100, familiarity 0…100). */
export const PlayerBondSchema = z.object({
  trust: z.number().min(-100).max(100),
  affection: z.number().min(-100).max(100),
  familiarity: z.number().min(0).max(100),
});
export type PlayerBondView = z.infer<typeof PlayerBondSchema>;

export const PhotoRequestSchema = z.object({
  locale: z.enum(["en", "zh-CN"]),
  world: z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]),
  place: z.enum(["interior", "street", "wilderness", "ruins", "dreamscape"]),
  placeDescription: text(600),
  character: CharacterBriefSchema,
  state: z.object({
    emotion: z.enum(EMOTIONS),
    level: z.number().int().min(1).max(3),
    feelings: z.array(z.object({ feeling: text(20), value: z.number().min(0).max(100) })).max(4),
  }),
  player: PlayerBondSchema.extend({ photosShared: z.number().int().min(0).max(10000) }),
  /** The character's memories most worth knowing for this moment (summaries only). */
  memories: z.array(z.object({ summary: text(200), withName: text(80), importance: z.number().int().min(1).max(3), turnsAgo: z.number().int().min(0).max(100000) })).max(8),
  /** This character's last few photo reactions (so the next one is different). */
  recentReactions: z.array(z.object({ type: z.enum(PHOTO_REACTIONS), dialogue: text(PHOTO_DIALOGUE_MAX) })).max(4),
  /** The player's optional caption. */
  caption: text(200),
  image: z.object({
    mediaType: z.enum(PHOTO_AI_TYPES),
    /** Base64, no data: prefix. Size and type are checked again on the server. */
    data: z.string().min(16).max(Math.ceil((PHOTO_AI_MAX_BYTES * 4) / 3) + 8),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
  }),
});
export type PhotoRequest = z.infer<typeof PhotoRequestSchema>;

/**
 * The shape Claude must return. Ranges and lengths can't be expressed in a
 * structured-output schema, so they are enforced after parsing.
 */
export const PhotoReplySchema = z.object({
  /** What is visibly in the photo, plainly and neutrally (never who a person is). */
  observation: z.object({
    /** One or two factual sentences in the game language. */
    description: z.string(),
    /** 1–5 short tags in the game language (objects, animals, plants, places, colors, mood). */
    subjects: z.array(z.string()),
    clarity: z.enum(["clear", "partly_unclear", "unclear"]),
    /** People are visible in the photo (they are never identified or described beyond what is observable). */
    containsPeople: z.boolean(),
  }),
  reactionType: z.enum(PHOTO_REACTIONS),
  /** What the character says aloud, in their own voice. */
  dialogue: z.string(),
  emotion: z.enum(EMOTIONS),
  /** 0 (barely shows) to 1 (overwhelming). */
  intensity: z.number(),
  movementIntent: z.enum(PHOTO_MOVES),
  /** Proposed nudges to how the character feels about the player, roughly −3…3. */
  relationshipChanges: z.object({ trust: z.number(), affection: z.number() }),
  memory: z.object({
    /** Is this moment worth keeping as a memory? (the player decides) */
    suggestSave: z.boolean(),
    /** One sentence from the character's point of view: what they saw and what was said. */
    summary: z.string(),
    /** Why it matters to them, a few words ("reminded me of home"). */
    significance: z.string(),
    /** 1 minor, 2 notable, 3 unforgettable. */
    importance: z.number(),
  }),
  /** A question the character asks back, or "". */
  followUpQuestion: z.string(),
  /** The model's own check that the reply fits the character and the photo rules. */
  staysInCharacter: z.boolean(),
});
export type PhotoReply = z.infer<typeof PhotoReplySchema>;

/** What /api/ai/photo returns on success. */
export type PhotoResponse = { reply: PhotoReply; source: "ai" | "mock"; model: string; attempts: number };
