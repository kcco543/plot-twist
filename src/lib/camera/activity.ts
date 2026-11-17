/**
 * WHAT IS SOMEONE DOING RIGHT NOW? (quick focus labels, pure + unit-tested)
 * --------------------------------------------------------------------------
 * Read only from real game state: the stage (walks, conversation phase,
 * pose, the object in use) and which scene a character is in. Nothing is
 * guessed or invented, and a character in another scene only shows where
 * they were last seen (no teleporting, no peeking at what they're up to).
 */
import type { ConversationPhase } from "../stage/sim";

export type ActivityPort = {
  conversationPhase: (id: string) => ConversationPhase;
  conversationPartners: (id: string) => string[];
  stateOf: (id: string) => string | null;
  walkOf: (id: string) => { kind: string; targetId: string | null; objectId: string | null } | null;
  poseOf: (id: string) => "sit" | null;
  usingObjectOf: (id: string) => string | null;
};

export type Activity =
  | { key: "elsewhere"; scene: string }
  | { key: "speaking" | "talking" | "approaching"; name: string }
  | { key: "goingTo" | "sittingOn" | "using"; object: string }
  | { key: "steppingAway" | "walking" | "sitting" | "leaving" | "idle" };

export function activityOf(
  id: string,
  port: ActivityPort,
  names: { person: (id: string) => string; object: (id: string) => string },
  elsewhere: string | null,
): Activity {
  if (elsewhere !== null) return { key: "elsewhere", scene: elsewhere };
  const phase = port.conversationPhase(id);
  const state = port.stateOf(id);
  const partner = port.conversationPartners(id)[0] ?? null;
  if (state === "speaking") return partner ? { key: "talking", name: names.person(partner) } : { key: "speaking", name: "" };
  if (phase === "in_conversation" && partner) return { key: "talking", name: names.person(partner) };
  const w = port.walkOf(id);
  if (w) {
    if (w.kind === "approach" && w.targetId) return { key: "approaching", name: names.person(w.targetId) };
    if (w.kind === "object" && w.objectId) return { key: "goingTo", object: names.object(w.objectId) };
    if (w.kind === "retreat") return { key: phase === "intentional" ? "leaving" : "steppingAway" };
    if (w.kind === "goto") return { key: "walking" };
  }
  const using = port.usingObjectOf(id);
  if (port.poseOf(id) === "sit") return using ? { key: "sittingOn", object: names.object(using) } : { key: "sitting" };
  if (using && state === "interacting") return { key: "using", object: names.object(using) };
  return { key: "idle" };
}
