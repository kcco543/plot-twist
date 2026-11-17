/**
 * Where to draw a speech bubble inside the game stage (pure, unit-tested).
 * All values are CSS pixels of the stage overlay. The bubble is kept fully
 * inside the stage; the tail keeps pointing at the speaker even when the
 * bubble body has to slide sideways near an edge.
 */
export type BubblePlacement = { left: number; top: number; tailX: number; flipped: boolean };

export const BUBBLE = { margin: 6, gap: 22, tail: 8, tailInset: 12 };

export function placeBubble({
  stageW,
  stageH,
  anchorX,
  anchorY,
  width,
  height,
}: {
  stageW: number;
  stageH: number;
  /** Speaker's head, in stage pixels. */
  anchorX: number;
  anchorY: number;
  /** Bubble body size (without tail). */
  width: number;
  height: number;
}): BubblePlacement {
  const m = BUBBLE.margin;
  const maxLeft = Math.max(m, stageW - width - m);
  const left = Math.min(maxLeft, Math.max(m, anchorX - width / 2));
  let top = anchorY - BUBBLE.gap - BUBBLE.tail - height;
  let flipped = false;
  // Not enough room above the head (tiny stage): drop below the top edge instead of clipping.
  if (top < m) {
    top = m;
    flipped = anchorY - BUBBLE.gap < top + height;
  }
  top = Math.min(top, Math.max(m, stageH - height - m));
  const tailX = Math.min(width - BUBBLE.tailInset, Math.max(BUBBLE.tailInset, anchorX - left));
  return { left: Math.round(left), top: Math.round(top), tailX: Math.round(tailX), flipped };
}

/** Bubble width limit for a given stage width. */
export function bubbleMaxWidth(stageW: number): number {
  if (stageW < 520) return Math.max(120, Math.min(stageW - 2 * BUBBLE.margin, 250));
  return Math.min(340, Math.round(stageW * 0.4));
}
