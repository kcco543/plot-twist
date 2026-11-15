/**
 * Where the character interaction menu goes: above the character's head if it
 * fits, otherwise below their feet, horizontally centred on them, and always
 * kept inside the visible part of the game view (and the window).
 */
export type Rect = { left: number; top: number; right: number; bottom: number };

/** Space kept between the menu and the edge of the view, px. */
export const MENU_MARGIN = 6;
/** Gap between the character and the menu, px. */
export const MENU_GAP = 6;

export function intersect(a: Rect, b: Rect): Rect {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}

export function placeMenu(
  anchor: Rect,
  menu: { width: number; height: number },
  bounds: Rect,
): { left: number; top: number; side: "above" | "below"; arrowX: number } {
  const minL = bounds.left + MENU_MARGIN;
  const maxL = Math.max(minL, bounds.right - MENU_MARGIN - menu.width);
  const cx = (anchor.left + anchor.right) / 2;
  const left = Math.min(maxL, Math.max(minL, cx - menu.width / 2));

  const aboveTop = anchor.top - MENU_GAP - menu.height;
  const belowTop = anchor.bottom + MENU_GAP;
  const fitsAbove = aboveTop >= bounds.top + MENU_MARGIN;
  const fitsBelow = belowTop + menu.height <= bounds.bottom - MENU_MARGIN;
  // Prefer above (the menu points down at the character); fall back to whichever side has more room.
  const side = fitsAbove || (!fitsBelow && anchor.top - bounds.top >= bounds.bottom - anchor.bottom) ? "above" : "below";
  const rawTop = side === "above" ? aboveTop : belowTop;
  const minT = bounds.top + MENU_MARGIN;
  const maxT = Math.max(minT, bounds.bottom - MENU_MARGIN - menu.height);
  const top = Math.min(maxT, Math.max(minT, rawTop));
  // Little pointer under / over the menu, kept away from the rounded corners.
  const arrowX = Math.min(menu.width - 12, Math.max(12, cx - left));
  return { left: Math.round(left), top: Math.round(top), side, arrowX: Math.round(arrowX) };
}
