/**
 * DRAG DETECTION — telling a click from a drag, and finding who is under the finger.
 * --------------------------------------------------------------------------
 * Pure functions (no DOM), so the rules are testable:
 *
 *  Mouse / pen: pressing a character and moving less than `mouseSlop` CSS px
 *  is a click (select them). Moving further starts a drag.
 *
 *  Touch: a quick tap selects. To drag, touch and HOLD for `holdMs` without
 *  moving more than `touchSlop`; then the character "lifts" and follows the
 *  finger. Moving before the hold is up cancels the press (it was a swipe),
 *  so a stray finger never starts a conversation.
 */
import type { Point } from "../stage/room";

export const DRAG = {
  /** CSS px a mouse must travel (while pressed) before it counts as a drag. */
  mouseSlop: 6,
  /** CSS px a finger may wobble during the hold. */
  touchSlop: 10,
  /** Touch-and-hold time before a drag starts, ms. */
  holdMs: 260,
  /** How far around a sprite still counts as "on" it, art px (fingers get more). */
  hitPad: { mouse: 2, touch: 6 },
} as const;

export type PointerKind = "mouse" | "touch" | "pen";

/**
 * What a press has turned into so far.
 *  pending — still could be a click / tap
 *  drag    — dragging a character
 *  cancel  — a touch that moved before the hold finished (a swipe): ignore it
 */
export type PressState = "pending" | "drag" | "cancel";

export function pressState(kind: PointerKind, dx: number, dy: number, heldMs: number, current: PressState = "pending"): PressState {
  if (current !== "pending") return current;
  const dist = Math.hypot(dx, dy);
  if (kind === "touch") {
    if (heldMs < DRAG.holdMs) return dist > DRAG.touchSlop ? "cancel" : "pending";
    return dist > DRAG.touchSlop ? "cancel" : "drag";
  }
  return dist >= DRAG.mouseSlop ? "drag" : "pending";
}

/** Sprite box around a character's feet, art px (32×32 sprite, body ~18 wide). */
const BODY = { halfW: 10, top: 30, bottom: 3 };

/**
 * The character under `p` (art px), excluding `excludeId`. When boxes overlap
 * the nearer one (lower on screen) wins, like the drawing order.
 */
export function hitCharacter(actors: { id: string; x: number; y: number }[], p: Point, excludeId: string | null, kind: PointerKind = "mouse"): string | null {
  const pad = kind === "touch" ? DRAG.hitPad.touch : DRAG.hitPad.mouse;
  let best: { id: string; y: number } | null = null;
  for (const a of actors) {
    if (a.id === excludeId) continue;
    const inside = p.x >= a.x - BODY.halfW - pad && p.x <= a.x + BODY.halfW + pad && p.y >= a.y - BODY.top - pad && p.y <= a.y + BODY.bottom + pad;
    if (inside && (!best || a.y > best.y)) best = { id: a.id, y: a.y };
  }
  return best?.id ?? null;
}

/** Client (CSS px) → stage art px, given the scaled stage's on-screen box. */
export function toStagePoint(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, stage = { width: 320, height: 192 }): Point {
  return { x: ((clientX - box.left) / box.width) * stage.width, y: ((clientY - box.top) / box.height) * stage.height };
}
