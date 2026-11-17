/**
 * DIALOGUE INTEGRATION — the decided behavior, put into words.
 * --------------------------------------------------------------------------
 * The engine has already chosen WHAT the character does (decide.ts). Here:
 *  - built-in lines (translated, behave.* in the locale files) picked by the
 *    action, the trigger and the dialogue style (length, hesitation, using
 *    the listener's name), plus a narrator line for silent actions and a
 *    small "tell" when a strong feeling is being hidden;
 *  - a compact brief for the AI writer, which must voice this intention and
 *    may not invent movements or state changes.
 */
import type { Character, StoryLine } from "../types";
import { ACTION_DEFS, type TriggerId } from "./catalog";
import type { Decision } from "./decide";
import { ranked } from "./feelings";

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/** Praise-type triggers get their own wording for some actions (defensive / acknowledging a compliment ≠ a criticism). */
export const triggerGroup = (t: TriggerId) => (t === "complimented" || t === "helped" ? "praise" : t === "approached" || t === "spoken_to" ? "social" : "pressure");

/** Story lines for one decision, in the order they should appear. */
export function decisionLines(d: Decision, cast: Character[], variant: number): StoryLine[] {
  const me = cast.find((c) => c.id === d.event.reactorId);
  if (!me) return [];
  const other = d.event.otherId ? (cast.find((c) => c.id === d.event.otherId) ?? null) : null;
  const name = clean(me.name);
  const otherName = other ? clean(other.name) : "";
  const lines: StoryLine[] = [];
  const def = ACTION_DEFS[d.action];
  const narr = (tpl: string): StoryLine => ({ speaker: { kind: "narrator" }, key: "tpl", tpl, index: variant, params: { name, other: otherName }, source: "builtin" });

  if (!def.speaks || d.style.length === "silent") {
    if (["approach", "retreat", "stay_still", "face_target", "stay_silent"].includes(d.action)) lines.push(narr(`behave.narr.${d.action}`));
  } else {
    lines.push({
      speaker: { kind: "character", name, id: me.id },
      key: "behave",
      tpl: `behave.say.${d.action}`,
      index: variant,
      params: {
        name,
        other: otherName,
        len: d.style.length === "full" ? "full" : d.style.length === "short" ? "short" : "terse",
        group: triggerGroup(d.event.trigger),
        pre: d.style.hesitant ? "1" : "",
        addr: d.style.useName && otherName ? "1" : "",
      },
      source: "builtin",
    });
  }
  // A strong feeling held back shows as a small tell (not as the effect).
  const hidden = hiddenFeeling(d);
  if (hidden) lines.push(narr(`behave.hidden.${hidden}`));
  return lines;
}

/** A strongly felt affection / fear / sadness that the expression step kept hidden (or shrank to a blush). */
export function hiddenFeeling(d: Decision): "affection" | "fear" | "sadness" | null {
  for (const k of ["affection", "fear", "sadness"] as const) {
    const felt = d.feelings[k] ?? 0;
    if (felt < 45) continue;
    const shownAs = d.expression?.feeling === k && !d.expression.masked;
    if (!shownAs && (d.personality.hides > 0 || d.personality.reserved >= 0.6 || d.canonRules.length > 0 || d.expression?.masked)) return k;
  }
  return null;
}

// ---------------------------------------------------------------- AI brief

export type BehaviorBrief = {
  characterId: string;
  trigger: TriggerId;
  causedBy: string | null;
  intent: string;
  style: Decision["style"];
  shows: { emotion: string; level: number } | null;
  hiddenFeeling: string | null;
  feelings: { feeling: string; value: number }[];
  movement: string;
  speaks: boolean;
};

export function behaviorBrief(d: Decision): BehaviorBrief {
  return {
    characterId: d.event.reactorId,
    trigger: d.event.trigger,
    causedBy: d.event.otherId,
    intent: d.action,
    style: d.style,
    shows: d.expression ? { emotion: d.expression.emotion, level: d.expression.level } : null,
    hiddenFeeling: hiddenFeeling(d),
    feelings: ranked(d.feelings)
      .slice(0, 3)
      .map(([feeling, value]) => ({ feeling, value })),
    movement: ACTION_DEFS[d.action].move,
    speaks: ACTION_DEFS[d.action].speaks,
  };
}
