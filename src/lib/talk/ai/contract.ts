/**
 * AI CONVERSATIONS — the data contract between the game and the AI route.
 * --------------------------------------------------------------------------
 *   TalkRequestSchema  what the browser sends to /api/ai/talk (validated on the server)
 *   TalkReplySchema    what Claude must return (structured outputs, validated twice:
 *                      by the server route, then by the game engine in apply.ts)
 *
 * The reply only PROPOSES changes. It can name one of a few allowed emotions
 * and movements and suggest small relationship nudges; the game engine
 * decides what actually happens (src/lib/talk/ai/apply.ts). Nothing in a
 * reply is ever executed as code or used as a file path or command.
 */
import { z } from "zod";
import { CharacterBriefSchema } from "../../ai/contracts";
import { EMOTIONS } from "../../emotion/emotions";
import { MEMORY_KINDS, RELATION_LABELS } from "../../types";

/** Movement the AI may ask for. Executed only through the stage's validated actions. */
export const MOVEMENT_INTENTS = ["none", "approach", "retreat", "face_target", "idle_reaction"] as const;
export type MovementIntent = (typeof MOVEMENT_INTENTS)[number];

/** The tone of a suggested next line (shown as a small tag, and used to keep the options varied). */
export const SUGGESTION_INTENTS = ["warm", "curious", "playful", "serious", "challenging", "supportive", "apologetic", "honest"] as const;
export type SuggestionIntent = (typeof SUGGESTION_INTENTS)[number];

/** Unfinished business a memory can carry (shown in the memory inspector, sent back to the AI later). */
export const MEMORY_THREADS = ["none", "conflict", "promise", "discovery", "secret"] as const;
export type MemoryThread = Exclude<(typeof MEMORY_THREADS)[number], "none">;

/** Relationship numbers the AI may nudge. Familiarity, rivalry and fear stay with the game rules. */
export const AI_RELATION_KEYS = ["trust", "affection", "respect", "tension"] as const;
export type AiRelationKey = (typeof AI_RELATION_KEYS)[number];

// ---------------------------------------------------------------- limits

/** Longest typed message (characters). Matches the composer. */
export const MESSAGE_MAX = 200;
/** Longest spoken reply kept (characters; Chinese counts per character). */
export const DIALOGUE_MAX = 320;
/** Pair history lines sent per request (the rest lives on as memory summaries). */
export const HISTORY_MAX = 10;
/** Memories sent per request. */
export const MEMORY_MAX = 8;

const text = (max: number) => z.string().max(max);
const locale = z.enum(["en", "zh-CN"]);
const world = z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]);
const place = z.enum(["interior", "street", "wilderness", "ruins", "dreamscape"]);

const RelationSchema = z.object({
  trust: z.number().min(-100).max(100),
  affection: z.number().min(-100).max(100),
  respect: z.number().min(-100).max(100),
  familiarity: z.number().min(0).max(100),
  rivalry: z.number().min(0).max(100),
  tension: z.number().min(0).max(100),
  fear: z.number().min(0).max(100),
  label: z.enum(RELATION_LABELS).optional(),
});

export const TalkMemorySchema = z.object({
  summary: text(200),
  kind: text(30),
  withName: text(80),
  importance: z.number().int().min(1).max(3),
  thread: z.enum(MEMORY_THREADS),
  resolved: z.boolean(),
  turnsAgo: z.number().int().min(0).max(100000),
  /** Who keeps this memory: the one answering, or the one asking. */
  holder: z.enum(["listener", "speaker"]),
});
export type TalkMemory = z.infer<typeof TalkMemorySchema>;

export const TalkRequestSchema = z.object({
  locale,
  world,
  place,
  placeDescription: text(600),
  speaker: CharacterBriefSchema,
  listener: CharacterBriefSchema,
  /** How the listener feels about the speaker (directional), and the reverse. */
  listenerView: RelationSchema,
  speakerView: RelationSchema,
  listenerState: z.object({
    emotion: z.enum(EMOTIONS),
    level: z.number().int().min(1).max(3),
    /** Strongest inner feelings, 0–100. */
    feelings: z.array(z.object({ feeling: text(20), value: z.number().min(0).max(100) })).max(4),
  }),
  /** What the speaker just said. */
  message: z.object({
    text: z.string().min(1).max(MESSAGE_MAX * 2),
    /** typed = the player's own words; topic / suggestion = a line the game offered. */
    kind: z.enum(["typed", "topic", "suggestion"]),
    topic: text(40).nullable(),
  }),
  /** Recent lines between these two, oldest first. */
  history: z.array(z.object({ who: z.enum(["speaker", "listener"]), text: text(DIALOGUE_MAX + 40) })).max(HISTORY_MAX),
  memories: z.array(TalkMemorySchema).max(MEMORY_MAX),
  /** Recent relationship shifts between them, oldest first. */
  relationHistory: z.array(text(160)).max(4),
  /** Recent things that happened nearby (story log), oldest first. */
  recentEvents: z.array(text(240)).max(6),
  /** The behavior engine's read of how the listener would react (guidance only). */
  engineHint: z
    .object({
      intent: text(40),
      shows: text(20).nullable(),
      hides: text(20).nullable(),
      tone: text(20),
      length: text(10),
      directness: z.number().min(0).max(1),
      humor: z.number().min(0).max(1),
      disclosure: z.number().min(0).max(1),
    })
    .nullable(),
  /** Topics already discussed in this conversation (so new suggestions differ). */
  usedTopics: z.array(text(160)).max(12),
  /** Gifts from the visitor that matter to what was just said (only when relevant). */
  gifts: z
    .array(
      z.object({
        name: text(60),
        description: text(260),
        where: z.enum(["displayed", "carried", "private", "hidden", "stored", "refused"]),
        owner: z.enum(["listener", "speaker"]),
        speakerKnows: z.boolean(),
        interpretation: text(200),
      }),
    )
    .max(3)
    .optional(),
});
export type TalkRequest = z.infer<typeof TalkRequestSchema>;

// ---------------------------------------------------------------- AI reply

/**
 * The shape Claude must return. Structured-output schemas can't carry number
 * ranges or string lengths, so those are enforced after parsing (server:
 * sanitizeReply; game engine: validateReply).
 */
export const TalkReplySchema = z.object({
  /** What the listener says aloud, in their own voice. */
  dialogue: z.string(),
  emotion: z.enum(EMOTIONS),
  /** 0 (barely shows) to 1 (overwhelming). */
  reactionIntensity: z.number(),
  movementIntent: z.enum(MOVEMENT_INTENTS),
  /** Proposed nudges to how the LISTENER feels about the speaker, roughly −5…5 each. */
  relationshipChanges: z.object({ trust: z.number(), affection: z.number(), respect: z.number(), tension: z.number() }),
  memory: z.object({
    /** One short sentence the listener would remember, or "" if nothing notable happened. */
    summary: z.string(),
    /** 0 = forgettable (not saved), 1 minor, 2 notable, 3 unforgettable. */
    importance: z.number(),
    kind: z.enum([...MEMORY_KINDS, "none"]),
    thread: z.enum(MEMORY_THREADS),
    /** Did this exchange settle an earlier open thread? (its exact summary, or ""). */
    resolves: z.string(),
  }),
  /** 2–3 things the SPEAKER might say next, in the speaker's voice. */
  conversationSuggestions: z.array(z.object({ label: z.string(), line: z.string(), intent: z.enum(SUGGESTION_INTENTS) })),
  /** The model's own check that the reply respects the listener's canon and boundaries. */
  staysInCharacter: z.boolean(),
});
export type TalkReply = z.infer<typeof TalkReplySchema>;

export type TalkSuggestion = TalkReply["conversationSuggestions"][number];

/** What /api/ai/talk returns on success. `source` tells real AI apart from the developer test double. */
export type TalkResponse = { reply: TalkReply; source: "ai" | "mock"; model: string; attempts: number };
