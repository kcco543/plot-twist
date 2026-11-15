/**
 * AI GIFT REACTIONS — the data contract between the game and /api/ai/gift-reaction.
 * --------------------------------------------------------------------------
 * The player gives a gift they made (name, description, optional 32×32
 * picture) to one character. Claude voices the character's reaction and
 * PROPOSES what they do with it: accept / refuse / shrug, where they keep it,
 * an emotion, a small movement, a memory. The game engine decides (apply.ts):
 * canon ("never accepts gifts"), personality (reserved characters don't put
 * things on show), free display spots and inventory space.
 */
import { z } from "zod";
import { CharacterBriefSchema } from "../ai/contracts";
import { EMOTIONS } from "../emotion/emotions";
import { PlayerBondSchema, PHOTO_MOVES } from "../photo/contract";

export const GIFT_DECISIONS = ["accept", "refuse", "indifferent"] as const;
export type GiftDecision = (typeof GIFT_DECISIONS)[number];
/** Where the AI may propose to keep it ("refused" follows from the decision). */
export const GIFT_KEEP = ["displayed", "carried", "private", "hidden", "stored"] as const;
export type GiftKeep = (typeof GIFT_KEEP)[number];

/** Largest gift picture accepted (a 32×32 PNG is ~1–3 KB). */
export const GIFT_IMAGE_MAX_BYTES = 40_000;
export const GIFT_DIALOGUE_MAX = 320;

const text = (max: number) => z.string().max(max);

export const GiftReactionRequestSchema = z.object({
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
  player: PlayerBondSchema.extend({ photosShared: z.number().int().min(0).max(10000), giftsGiven: z.number().int().min(0).max(10000) }),
  memories: z.array(z.object({ summary: text(200), withName: text(80), importance: z.number().int().min(1).max(3), turnsAgo: z.number().int().min(0).max(100000) })).max(8),
  /** Earlier gifts from the player to this character and where they ended up. */
  earlierGifts: z.array(z.object({ name: text(60), display: text(20), interpretation: text(200) })).max(4),
  gift: z.object({
    name: z.string().min(1).max(60),
    description: text(260),
    /** The player's 32×32 pixel drawing (PNG base64, no data: prefix), or null. */
    image: z.string().max(Math.ceil((GIFT_IMAGE_MAX_BYTES * 4) / 3) + 8).nullable(),
    /** The same gift was given to this character before. */
    repeat: z.boolean(),
  }),
  /** Display spots still free in the scene (0 = nowhere to put it on show). */
  freeDisplaySpots: z.number().int().min(0).max(10),
});
export type GiftReactionRequest = z.infer<typeof GiftReactionRequestSchema>;

export const GiftReactionReplySchema = z.object({
  decision: z.enum(GIFT_DECISIONS),
  /** What the character thinks the gift is / means, in their words. */
  interpretation: z.string(),
  dialogue: z.string(),
  emotion: z.enum(EMOTIONS),
  intensity: z.number(),
  movementIntent: z.enum(PHOTO_MOVES),
  /** Where they would keep it (ignored when refused). */
  keep: z.enum(GIFT_KEEP),
  /** A few words on why they keep it there. */
  keepReason: z.string(),
  relationshipChanges: z.object({ trust: z.number(), affection: z.number() }),
  memory: z.object({ summary: z.string(), significance: z.string(), importance: z.number() }),
  followUpQuestion: z.string(),
  staysInCharacter: z.boolean(),
});
export type GiftReactionReply = z.infer<typeof GiftReactionReplySchema>;

export type GiftReactionResponse = { reply: GiftReactionReply; source: "ai" | "mock"; model: string; attempts: number };
