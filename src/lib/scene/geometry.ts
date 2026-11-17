/**
 * SCENE GEOMETRY (pure, unit-tested) — polygons for object regions and the
 * editor's undo history.
 * --------------------------------------------------------------------------
 * Object regions can be drawn as polygons with the pen tool (Play area
 * editor). They are stored in IMAGE FRACTIONS like everything else in a
 * SceneLayout, and turned into stage art px by buildScene(). The same polygon
 * drives what the player sees (selection outline, the part of the picture
 * drawn over characters) and what the game uses (hit testing, the footprint
 * that blocks walking), so the visual region and the gameplay region agree.
 */
import type { Point, Rect } from "../stage/room";

export const MIN_VERTICES = 3;
export const MAX_VERTICES = 48;

/** Axis-aligned bounding box of a polygon. */
export function polygonBounds(poly: readonly Point[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from `p` to segment a–b. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the polygon's outline (0 when inside). */
export function distToPolygon(p: Point, poly: readonly Point[]): number {
  if (poly.length >= 3 && pointInPolygon(p, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/** Twice the signed area (positive = counter-clockwise in a y-down space reads clockwise; only |area| matters). */
export function polygonArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}

/** A usable polygon: enough vertices, finite, not collapsed to a line. */
export function validPolygon(poly: unknown, minArea = 1e-5): poly is Point[] {
  if (!Array.isArray(poly) || poly.length < MIN_VERTICES || poly.length > MAX_VERTICES) return false;
  if (!poly.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
  return polygonArea(poly as Point[]) > minArea;
}

/** The rectangle as a 4-point polygon (clockwise from top-left), to start editing a rectangle's corners. */
export const rectToPolygon = (r: Rect): Point[] => [
  { x: r.x0, y: r.y0 },
  { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 },
  { x: r.x0, y: r.y1 },
];

export const clampPoint = (p: Point, max: Point = { x: 1, y: 1 }): Point => ({ x: Math.min(max.x, Math.max(0, p.x)), y: Math.min(max.y, Math.max(0, p.y)) });

export function moveVertex(poly: readonly Point[], i: number, to: Point): Point[] {
  return poly.map((p, k) => (k === i ? clampPoint(to) : p));
}

/** Insert a vertex after index `i` (on the edge i → i+1). */
export function insertVertex(poly: readonly Point[], i: number, at: Point): Point[] {
  if (poly.length >= MAX_VERTICES) return [...poly];
  return [...poly.slice(0, i + 1), clampPoint(at), ...poly.slice(i + 1)];
}

/** Remove a vertex (never below three). */
export function removeVertex(poly: readonly Point[], i: number): Point[] {
  if (poly.length <= MIN_VERTICES) return [...poly];
  return poly.filter((_, k) => k !== i);
}

/** Move the whole polygon, kept inside the picture. */
export function translatePolygon(poly: readonly Point[], dx: number, dy: number): Point[] {
  const b = polygonBounds(poly);
  const ox = Math.min(1 - b.x1, Math.max(-b.x0, dx));
  const oy = Math.min(1 - b.y1, Math.max(-b.y0, dy));
  return poly.map((p) => ({ x: p.x + ox, y: p.y + oy }));
}

/** Midpoints of each edge (the editor's "add a point here" handles). */
export const edgeMidpoints = (poly: readonly Point[]): Point[] => poly.map((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
});

/**
 * Clip a polygon to the half-plane y ≥ `minY` (Sutherland–Hodgman). Used for
 * the footprint of a solid object: the lower part of its outline is what
 * stands on the floor.
 */
export function clipBelow(poly: readonly Point[], minY: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ain = a.y >= minY;
    const bin = b.y >= minY;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (minY - a.y) / (b.y - a.y);
      out.push({ x: a.x + t * (b.x - a.x), y: minY });
    }
  }
  return out;
}

/** Does a rectangle touch a polygon? (Samples the rectangle and checks the polygon's vertices and edges.) */
export function rectHitsPolygon(r: Rect, poly: readonly Point[]): boolean {
  if (poly.length < 3) return false;
  const e = 0.01;
  const xs = [r.x0 + e, (r.x0 + r.x1) / 2, r.x1 - e];
  const ys = [r.y0 + e, (r.y0 + r.y1) / 2, r.y1 - e];
  for (const x of xs) for (const y of ys) if (pointInPolygon({ x, y }, poly)) return true;
  for (const p of poly) if (p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1) return true;
  // Edges crossing the rectangle (thin slivers).
  const corners = rectToPolygon(r);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let k = 0; k < 4; k++) if (segmentsCross(a, b, corners[k], corners[(k + 1) % 4])) return true;
  }
  return false;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** CSS clip-path for a polygon given in fractions of a box. */
export const clipPathOf = (poly: readonly Point[], box: Rect): string => {
  const w = Math.max(1e-9, box.x1 - box.x0);
  const h = Math.max(1e-9, box.y1 - box.y0);
  return `polygon(${poly.map((p) => `${(((p.x - box.x0) / w) * 100).toFixed(2)}% ${(((p.y - box.y0) / h) * 100).toFixed(2)}%`).join(", ")})`;
};

// ---------------------------------------------------------------- undo / redo

export type History<T> = { past: T[]; present: T; future: T[] };
export const HISTORY_LIMIT = 60;

export const historyOf = <T,>(present: T): History<T> => ({ past: [], present, future: [] });

/** Record a new state (a finished stroke, a moved vertex…). No-op when nothing changed. */
export function commit<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

/** Replace the present without a new undo step (live preview while dragging). */
export const preview = <T,>(h: History<T>, next: T): History<T> => ({ ...h, present: next });

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
