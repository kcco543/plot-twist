/**
 * CAMERA — a fixed-size viewport onto a world that may be bigger than it
 * (pure, unit-tested; the play screen's WorldViewport drives it every frame).
 * --------------------------------------------------------------------------
 * Coordinate spaces (all conversions live here, nothing uses raw mouse px):
 *
 *   screen    CSS px of the browser window (pointer events' clientX/Y)
 *   viewport  CSS px inside the game viewport (0,0 = its top-left corner)
 *   world     art px of the stage: character feet, objects, the floor grid
 *   tile      cells of a scene's navigation grid (NavMask), or the A* grid
 *
 * The world is drawn at `scale` CSS px per art px. Scales are whole DEVICE
 * pixels per art pixel where possible (2×, 3× on a normal screen; 1.67×,
 * 2.33× on a 3× phone), so pixel art stays crisp. The camera's top-left
 * (`x`, `y`, world px) is rounded to whole device pixels when drawn, so
 * nothing shimmers while it glides.
 */
import type { NavMask, Point } from "../stage/room";

export type Size = { width: number; height: number };
export type Camera = {
  /** Top-left of the view, world px (negative = the world is centred in a bigger viewport). */
  x: number;
  y: number;
  /** CSS px per world px. */
  scale: number;
  /** Viewport size, CSS px. */
  viewW: number;
  viewH: number;
};

export const ZOOMS = ["wide", "normal", "close"] as const;
export type Zoom = (typeof ZOOMS)[number];
export const FOLLOW_SPEEDS = { gentle: 320, normal: 180, snappy: 90 } as const;
export type FollowSpeed = keyof typeof FOLLOW_SPEEDS;

/** Snap a scale to whole device pixels per art pixel (never below one device pixel). */
export function snapScale(s: number, dpr = 1): number {
  return Math.max(1, Math.round(s * dpr)) / dpr;
}

/**
 * The three zoom levels for this world in this viewport.
 *   normal  readable characters (≈3× on desktop, ≈1.75× on phones), or the
 *           whole map when that's even bigger (small built-in rooms fill the frame)
 *   close   1.5× normal, for small details
 *   wide    up to 1.5× further out, but never smaller than "the whole map"
 *           or a readable minimum: navigation, not a thumbnail
 */
export function zoomScales(world: Size, maxView: Size, phone: boolean, dpr = 1): Record<Zoom, number> {
  const readable = phone ? 1.75 : 3;
  const minimum = phone ? 1.25 : 1.75;
  const fit = Math.min(maxView.width / world.width, maxView.height / world.height);
  const normal = snapScale(Math.max(readable, Math.floor(fit * dpr) / dpr), dpr);
  const close = snapScale(normal * 1.5, dpr);
  const wide = snapScale(Math.max(minimum, Math.min(normal, Math.max(normal / 1.5, Math.floor(fit * dpr) / dpr))), dpr);
  return { wide: Math.min(wide, normal), normal, close: Math.max(close, normal) };
}

/** Viewport height: as tall as allowed, but never taller than the world at this scale (no empty bands). */
export function viewportHeight(world: Size, scale: number, maxH: number): number {
  return Math.max(120, Math.min(maxH, Math.round(world.height * scale)));
}

/** How much of the world fits in the view (world px). */
export const viewSize = (c: Pick<Camera, "viewW" | "viewH" | "scale">): Size => ({ width: c.viewW / c.scale, height: c.viewH / c.scale });

/**
 * Keep the view on the map: a world bigger than the view is clamped at its
 * edges (never showing empty space past them); a smaller one is centred.
 */
export function clampCamera(x: number, y: number, c: Pick<Camera, "viewW" | "viewH" | "scale">, world: Size): Point {
  const v = viewSize(c);
  const cx = world.width <= v.width ? -(v.width - world.width) / 2 : Math.min(world.width - v.width, Math.max(0, x));
  const cy = world.height <= v.height ? -(v.height - world.height) / 2 : Math.min(world.height - v.height, Math.max(0, y));
  return { x: cx, y: cy };
}

/** Camera position that puts `p` in the middle of the view (before clamping). */
export const centreOn = (p: Point, c: Pick<Camera, "viewW" | "viewH" | "scale">): Point => {
  const v = viewSize(c);
  return { x: p.x - v.width / 2, y: p.y - v.height / 2 };
};

/**
 * Dead zone: the camera only moves when the focus leaves a box in the middle
 * of the view (`frac` of the view on each side of centre), so small steps,
 * idle shuffles and sitting down don't make it drift.
 */
export function followTarget(cam: Point, focus: Point, c: Pick<Camera, "viewW" | "viewH" | "scale">, frac = 0.14): Point {
  const v = viewSize(c);
  const dzx = v.width * frac;
  const dzy = v.height * frac;
  const mid = { x: cam.x + v.width / 2, y: cam.y + v.height / 2 };
  let x = cam.x;
  let y = cam.y;
  if (focus.x > mid.x + dzx) x = focus.x - dzx - v.width / 2;
  else if (focus.x < mid.x - dzx) x = focus.x + dzx - v.width / 2;
  if (focus.y > mid.y + dzy) y = focus.y - dzy - v.height / 2;
  else if (focus.y < mid.y - dzy) y = focus.y + dzy - v.height / 2;
  return { x, y };
}

/** One smoothing step toward `target` (exponential ease, frame-rate independent). `tauMs` 0 = jump. */
export function ease(from: Point, target: Point, dtMs: number, tauMs: number): Point {
  if (tauMs <= 0) return target;
  const k = 1 - Math.exp(-Math.min(dtMs, 100) / tauMs);
  const x = from.x + (target.x - from.x) * k;
  const y = from.y + (target.y - from.y) * k;
  // Settle exactly once within a fraction of a pixel (no endless tiny moves).
  return { x: Math.abs(target.x - x) < 0.05 ? target.x : x, y: Math.abs(target.y - y) < 0.05 ? target.y : y };
}

/** The CSS translate for the camera, rounded to whole device pixels (no sub-pixel shimmer). */
export function translateFor(c: Camera, dpr = 1): Point {
  return { x: -Math.round(c.x * c.scale * dpr) / dpr, y: -Math.round(c.y * c.scale * dpr) / dpr };
}

// ---------------------------------------------------------------- conversions

/** Screen (clientX/Y) → viewport CSS px, given the viewport's on-screen box. */
export const screenToViewport = (p: Point, box: { left: number; top: number }): Point => ({ x: p.x - box.left, y: p.y - box.top });

/** Viewport CSS px → world px (uses the same rounded translate the screen shows). */
export function viewportToWorld(p: Point, c: Camera, dpr = 1): Point {
  const t = translateFor(c, dpr);
  return { x: (p.x - t.x) / c.scale, y: (p.y - t.y) / c.scale };
}

export function worldToViewport(p: Point, c: Camera, dpr = 1): Point {
  const t = translateFor(c, dpr);
  return { x: p.x * c.scale + t.x, y: p.y * c.scale + t.y };
}

export const screenToWorld = (p: Point, box: { left: number; top: number }, c: Camera, dpr = 1) => viewportToWorld(screenToViewport(p, box), c, dpr);

/** World px → a cell of a navigation grid. */
export function worldToTile(p: Point, m: Pick<NavMask, "cw" | "ch">): { col: number; row: number } {
  return { col: Math.floor(p.x / m.cw), row: Math.floor(p.y / m.ch) };
}

/** Is a world point inside the view (with a margin, world px)? */
export function inView(p: Point, c: Camera, margin = 0): boolean {
  const v = viewSize(c);
  return p.x >= c.x - margin && p.x <= c.x + v.width + margin && p.y >= c.y - margin && p.y <= c.y + v.height + margin;
}

/**
 * Edge scrolling while dragging a character: how fast (world px / s) to pan
 * when the pointer is within `edge` CSS px of a side of the viewport.
 */
export function edgePan(p: Point, c: Pick<Camera, "viewW" | "viewH" | "scale">, edge = 36, speed = 260): Point {
  const f = (v: number, size: number) => (v < edge ? -(1 - Math.max(0, v) / edge) : v > size - edge ? 1 - Math.max(0, size - v) / edge : 0);
  return { x: (f(p.x, c.viewW) * speed) / c.scale, y: (f(p.y, c.viewH) * speed) / c.scale };
}
