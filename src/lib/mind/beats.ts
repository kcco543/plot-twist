/**
 * Story beats → behavior-engine events. The story engine (src/lib/story)
 * decides what happens to the ACTOR; this tells the behavior engine what
 * that means for the OTHER character, who then decides how to respond.
 */
import type { Beat } from "../story/engine";
import type { TriggerId } from "./catalog";

export function triggerForBeat(beat: Pick<Beat, "kind" | "type" | "reaction">, walkedUp = false): TriggerId {
  if (beat.kind !== "event") return walkedUp ? "approached" : "spoken_to";
  switch (beat.reaction) {
    case "confront":
      return beat.type === "argument" || beat.type === "rivalry" || beat.type === "rumor" ? "provoked" : "criticized";
    case "comfort":
      return beat.type === "kindness" ? "complimented" : "helped";
    case "cooperate":
      return beat.type === "rivalry" || beat.type === "argument" ? "forced_cooperation" : beat.type === "kindness" ? "complimented" : "helped";
    case "joke":
      return beat.type === "kindness" ? "complimented" : "teased";
    case "withdraw":
    case "deflect":
      return "brushed_off";
    default:
      return "spoken_to";
  }
}
