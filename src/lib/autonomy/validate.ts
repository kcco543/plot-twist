/**
 * INTENT VALIDATION + TRANSLATION — an intent only runs if the game says it
 * can, and it runs only as one of the stage's own validated actions
 * (pathfinding, collision, priorities). Nothing here moves anyone directly.
 */
import { makeId } from "../id";
import { actionAllowed, defaultAction, type ObjectAction, type WorldObject } from "../stage/objects";
import type { StageAction } from "../stage/actions";
import { keepsApart } from "./planner";
import { AUTONOMY, INTENT_KINDS, type AgencyState, type Intent, type IntentKind, type IntentSource } from "./types";

export type ValidateContext = {
  onStage: (id: string) => boolean;
  objects: WorldObject[];
  /** In a conversation right now (only leave_conversation / decline / turning may happen). */
  inConversation: (id: string) => boolean;
  /** The player is steering them (a drag / walk the player asked for): autonomy waits. */
  commanded: (id: string) => boolean;
  /** Walking with a priority (null = not walking). */
  walking: (id: string) => "auto" | "story" | "player" | null;
  agency: AgencyState;
  /** How many characters are on an autonomous walk now. */
  autonomousWalks: number;
};

/** Kinds that make the character walk. */
export const WALKING_KINDS: IntentKind[] = ["approach", "move_away", "go_to_place", "inspect_object", "use_object", "sit", "seek_privacy", "return_to_task"];
const OBJECT_KINDS: IntentKind[] = ["go_to_place", "inspect_object", "use_object", "sit", "seek_privacy", "return_to_task"];
const TARGET_KINDS: IntentKind[] = ["approach", "move_away", "turn_toward", "turn_away", "observe"];
const IN_CONVERSATION_OK: IntentKind[] = ["leave_conversation", "decline", "turn_away", "turn_toward", "pause", "stay_still"];

export type Validation = { ok: true } | { ok: false; note: string };

export function validateIntent(i: Intent, ctx: ValidateContext): Validation {
  if (!INTENT_KINDS.includes(i.kind)) return { ok: false, note: "unknown_kind" };
  if (!ctx.onStage(i.actor)) return { ok: false, note: "unknown_actor" };
  if (TARGET_KINDS.includes(i.kind) && i.kind !== "observe") {
    if (!i.target || !ctx.onStage(i.target)) return { ok: false, note: "unknown_target" };
    if (i.target === i.actor) return { ok: false, note: "self_target" };
  }
  if (OBJECT_KINDS.includes(i.kind)) {
    const o = ctx.objects.find((x) => x.id === i.object);
    if (!o) return { ok: false, note: "unknown_object" };
    const act = objectActionFor(i.kind, o, i.actor);
    if (!act || !actionAllowed(o, act, i.actor)) return { ok: false, note: "not_allowed" };
  }
  if (ctx.inConversation(i.actor) && !IN_CONVERSATION_OK.includes(i.kind)) return { ok: false, note: "in_conversation" };
  const walks = WALKING_KINDS.includes(i.kind);
  if (walks && ctx.commanded(i.actor)) return { ok: false, note: "player_command" };
  const w = ctx.walking(i.actor);
  if (walks && w && (w === "player" || (w === "story" && i.priority === "auto"))) return { ok: false, note: "busy" };
  // A boundary can't be walked through: nobody approaches someone they (or who) are keeping apart from.
  if ((i.kind === "approach" || i.kind === "turn_toward") && i.target && keepsApart(ctx.agency, i.actor, i.target)) return { ok: false, note: "boundary" };
  if (walks && i.priority === "auto" && ctx.autonomousWalks >= AUTONOMY.maxConcurrentWalks) return { ok: false, note: "too_many_walks" };
  return { ok: true };
}

/** Actions that change something or go somewhere: never picked just to "look at" an object. */
const NOT_JUST_LOOKING: ObjectAction[] = ["sit", "pick_up", "open", "close", "leave", "enter", "climb", "knock", "unlock", "place", "talk", "order", "search", "rest"];

/** Which object action an object intent means (inspect a book = read it, sit = sit…). */
export function objectActionFor(kind: IntentKind, o: WorldObject, actor: string): ObjectAction | null {
  if (kind === "sit") return o.actions.includes("sit") ? "sit" : null;
  // Looking at something never opens, leaves, climbs or takes anything (those need a reason or the player).
  if (kind === "inspect_object") return (o.actions.find((a) => !NOT_JUST_LOOKING.includes(a)) ?? (o.exit ? null : defaultAction(o, actor))) || null;
  if (kind === "seek_privacy") return o.actions.includes("sit") ? "sit" : (o.actions.find((a) => !NOT_JUST_LOOKING.includes(a)) ?? null);
  return defaultAction(o, actor) || null;
}

/** The stage action that carries an intent out, or null for intents that are complete as soon as they're accepted. */
export function toStageAction(i: Intent, objects: WorldObject[]): StageAction | null {
  switch (i.kind) {
    case "approach":
      return { type: "approach", actor: i.actor, target: i.target!, distance: 34 };
    case "move_away":
      return { type: "retreat", actor: i.actor, from: i.target, distance: 60 };
    case "turn_toward":
      return { type: "face_target", actor: i.actor, target: i.target! };
    case "turn_away":
      return { type: "turn_away", actor: i.actor, from: i.target! };
    case "stand":
      return { type: "stand_up", actor: i.actor };
    case "observe":
      return { type: "idle_reaction", actor: i.actor, kind: "look_around" };
    case "pause":
    case "stay_still":
    case "decline":
    case "leave_conversation":
      return null;
    default: {
      const o = objects.find((x) => x.id === i.object);
      const action = o ? objectActionFor(i.kind, o, i.actor) : null;
      return o && action ? { type: "use_object", actor: i.actor, object: o.id, action } : null;
    }
  }
}

export function newIntent(p: { actor: string; kind: IntentKind; target?: string; object?: string; place?: string; reason: string; source: IntentSource; priority?: "auto" | "story" }, now = Date.now()): Intent {
  return {
    id: makeId("int"),
    actor: p.actor,
    kind: p.kind,
    ...(p.target ? { target: p.target } : {}),
    ...(p.object ? { object: p.object } : {}),
    ...(p.place ? { place: p.place } : {}),
    reason: p.reason,
    source: p.source,
    priority: p.priority ?? (p.source === "rules" ? "auto" : "story"),
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  };
}
