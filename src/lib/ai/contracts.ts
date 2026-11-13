/**
 * Request bodies the browser sends to the AI routes, validated on the server.
 * Only the data a request needs is sent; API keys never leave the server.
 */
import { z } from "zod";
import { APPROACHES, CHARACTER_TEXT_FIELDS, MOODS, REACTIONS, TRAIT_IDS } from "../types";

const text = (max: number) => z.string().max(max);
const locale = z.enum(["en", "zh-CN"]);
const world = z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]);
const place = z.enum(["interior", "street", "wilderness", "ruins", "dreamscape"]);

export const CharacterBriefSchema = z.object({
  id: text(64),
  fields: z.partialRecord(z.enum(CHARACTER_TEXT_FIELDS), text(800)),
  traits: z.partialRecord(z.enum(TRAIT_IDS), z.number().min(0).max(100)),
  lockedFields: z.array(z.enum(CHARACTER_TEXT_FIELDS)).max(CHARACTER_TEXT_FIELDS.length),
  /** Approved behavioral profile (summary + speech), if any. */
  profile: z
    .object({
      summary: text(800),
      speech: z.object({ register: text(300), length: z.enum(["terse", "measured", "chatty"]), tics: z.array(text(120)).max(6), avoids: z.array(text(120)).max(6), sample: text(300) }),
      boundaries: z.array(text(240)).max(10),
      emotionalPatterns: z.array(z.object({ trigger: text(200), reaction: text(200), variation: text(240) })).max(8),
    })
    .nullable(),
});
export type CharacterBrief = z.infer<typeof CharacterBriefSchema>;

const MemoryBrief = z.object({ eventType: text(40), withName: text(80), note: text(200).nullable(), importance: z.number().int().min(1).max(3) });

export const AnalyzeRequestSchema = z.object({
  locale,
  world: world.nullable(),
  character: CharacterBriefSchema,
  /** Other cast members, for relationship context. */
  cast: z.array(z.object({ name: text(80), relationships: text(800) })).max(12),
  mood: z.enum(MOODS),
  memories: z.array(MemoryBrief).max(12),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const TurnRequestSchema = z.object({
  locale,
  world,
  place,
  placeDescription: text(1200),
  beat: z.object({
    kind: z.enum(["talk", "observe", "wait", "event"]),
    type: text(40),
    reaction: z.enum(REACTIONS).nullable(),
    approach: z.enum(APPROACHES),
    topic: text(40).nullable(),
    outcome: z.enum(["progress", "setback"]).nullable(),
    moodBefore: z.enum(MOODS),
    moodAfter: z.enum(MOODS),
    bondChange: z.enum(["closer", "further", "same"]).nullable(),
    recalled: MemoryBrief.nullable(),
  }),
  actor: CharacterBriefSchema,
  other: CharacterBriefSchema.nullable(),
  bond: z.object({ affinity: z.number(), trust: z.number() }).nullable(),
  memories: z.array(MemoryBrief).max(8),
  /** The last lines shown, so the AI doesn't repeat itself. */
  recentLines: z.array(text(400)).max(12),
});
export type TurnRequest = z.infer<typeof TurnRequestSchema>;
