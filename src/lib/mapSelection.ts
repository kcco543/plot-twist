/**
 * REGION SELECTION GEOMETRY
 * --------------------------------------------------------------------------
 * A selection is a rectangle in fractions of the map (0..1 on each side), so
 * it means the same thing at any screen size and on the full-size image.
 * Used by the selection overlay (browser) and the edit route (server).
 */
export type Region = { x: number; y: number; w: number; h: number };
export type Corner = "nw" | "ne" | "sw" | "se";

/** Smallest selection the image service can do something useful with (share of each side). */
export const MIN_REGION = 0.03;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Rectangle spanned by two points (any order), kept inside the map. */
export function regionFromPoints(ax: number, ay: number, bx: number, by: number): Region {
  const x1 = clamp01(Math.min(ax, bx));
  const y1 = clamp01(Math.min(ay, by));
  const x2 = clamp01(Math.max(ax, bx));
  const y2 = clamp01(Math.max(ay, by));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Slide a selection without changing its size; it stops at the map's edges. */
export function moveRegion(r: Region, dx: number, dy: number): Region {
  return { ...r, x: Math.min(1 - r.w, Math.max(0, r.x + dx)), y: Math.min(1 - r.h, Math.max(0, r.y + dy)) };
}

/** The corner that stays put while `corner` is dragged (resizing = drawing from it). */
export function oppositeCorner(r: Region, corner: Corner) {
  return { x: corner === "nw" || corner === "sw" ? r.x + r.w : r.x, y: corner === "nw" || corner === "ne" ? r.y + r.h : r.y };
}

/** Grow or shrink from the bottom-right corner (keyboard), never below the minimum. */
export function growRegion(r: Region, dw: number, dh: number): Region {
  return { ...r, w: Math.min(1 - r.x, Math.max(MIN_REGION, r.w + dw)), h: Math.min(1 - r.y, Math.max(MIN_REGION, r.h + dh)) };
}

export const regionIsUsable = (r: Region | null): r is Region => r !== null && r.w >= MIN_REGION && r.h >= MIN_REGION;

/** Selection in whole pixels of a width×height image. */
export function regionPixels(r: Region, width: number, height: number) {
  const left = Math.max(0, Math.floor(r.x * width));
  const top = Math.max(0, Math.floor(r.y * height));
  const right = Math.min(width, Math.ceil((r.x + r.w) * width));
  const bottom = Math.min(height, Math.ceil((r.y + r.h) * height));
  return { left, top, width: right - left, height: bottom - top };
}

/** How wide the soft blend inside the selection's border is, in image pixels. */
export function featherFor(widthPx: number, heightPx: number) {
  return Math.max(2, Math.min(16, Math.round(Math.min(widthPx, heightPx) * 0.08)));
}
