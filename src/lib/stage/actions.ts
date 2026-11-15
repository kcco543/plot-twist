/**
 * STAGE ACTIONS — the only things that can make a character move or emote.
 * --------------------------------------------------------------------------
 * Game rules (src/lib/stage/behavior.ts), the test panel and, later, an AI
 * all ask for the SAME small set of actions. Requests are plain JSON so a
 * future AI event can send them as-is; the engine validates every request
 * (schema, who exists, what state they're in) and then executes it with the
 * movement + collision rules. Nothing can teleport a character.
 */
import { z } from "zod";
import { EMOTIONS } from "../emotion/emotions";

export const STAGE_ACTION_TYPES = ["approach", "retreat", "face_target", "idle_reaction", "show_emotion"] as const;
export type StageActionType = (typeof STAGE_ACTION_TYPES)[number];

/** Short idle animations (no travel except "shift", a step or two). */
export const IDLE_KINDS = ["look_around", "shift", "hop", "stretch", "shiver", "stomp", "sigh"] as const;
export type IdleKind = (typeof IDLE_KINDS)[number];

const charId = z.string().min(1).max(80);

export const StageActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approach"), actor: charId, target: charId, distance: z.number().min(18).max(80).optional() }),
  z.object({ type: z.literal("retreat"), actor: charId, from: charId.optional(), distance: z.number().min(8).max(80).optional() }),
  z.object({ type: z.literal("face_target"), actor: charId, target: charId }),
  z.object({ type: z.literal("idle_reaction"), actor: charId, kind: z.enum(IDLE_KINDS) }),
  z.object({
    type: z.literal("show_emotion"),
    actor: charId,
    emotion: z.enum(EMOTIONS),
    level: z.number().int().min(1).max(3).optional(),
    /** Also let the character react with movement (chosen by the game rules, not the requester). */
    react: z.boolean().optional(),
    /** Who the feeling is about, if anyone (affects the reaction). */
    target: charId.optional(),
  }),
]);
export type StageAction = z.infer<typeof StageActionSchema>;

/** Why a request was refused. Shown (translated) in the test panel. */
export const REFUSALS = [
  "invalid",
  "unknown_actor",
  "unknown_target",
  "self_target",
  "busy",
  "no_room",
  "no_path",
  "cornered",
  "paused",
  "player_command",
  "outranked",
] as const;
export type Refusal = (typeof REFUSALS)[number];

/**
 * Who asked. A request can't interrupt a walk started by a higher priority,
 * and for a moment after the player directly moves someone, autonomous
 * behavior leaves that character's position alone.
 *   player — the player's direct command (test panel buttons)
 *   story  — the story the player just triggered (Talk, Twist…)
 *   auto   — the character's own autonomous reaction (behavior engine)
 */
export const PRIORITIES = { auto: 1, story: 2, player: 3 } as const;
export type Priority = keyof typeof PRIORITIES;

/** Extra detail on an accepted request. */
export const NOTES = ["moving", "already_close", "facing", "emoting", "idle", "shortened"] as const;
export type ActionNote = (typeof NOTES)[number];

export type ActionResult = { ok: true; action: StageAction; note: ActionNote } | { ok: false; reason: Refusal; action?: StageAction };

/** What the validator needs to know about the stage. */
export type StageFacts = {
  onStage: (id: string) => boolean;
  stateOf: (id: string) => "idle" | "moving" | "interacting" | "speaking" | "reacting" | null;
};

/** Schema + who-exists checks. Room/space checks happen when the engine plans the move. */
export function validateStageAction(raw: unknown, facts: StageFacts): ActionResult {
  const parsed = StageActionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const a = parsed.data;
  if (!facts.onStage(a.actor)) return { ok: false, reason: "unknown_actor", action: a };
  const target = a.type === "approach" || a.type === "face_target" ? a.target : a.type === "retreat" ? a.from : a.type === "show_emotion" ? a.target : undefined;
  if (target !== undefined) {
    if (target === a.actor) return { ok: false, reason: "self_target", action: a };
    if (!facts.onStage(target)) return { ok: false, reason: "unknown_target", action: a };
  }
  const state = facts.stateOf(a.actor);
  // Someone mid-line finishes their sentence before walking off or doing an idle bit.
  if (state === "speaking" && (a.type === "approach" || a.type === "retreat" || a.type === "idle_reaction")) return { ok: false, reason: "busy", action: a };
  if (a.type === "idle_reaction" && state === "moving") return { ok: false, reason: "busy", action: a };
  return { ok: true, action: a, note: "moving" };
}
