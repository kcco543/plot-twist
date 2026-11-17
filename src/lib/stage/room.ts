/**
 * ROOMS — where characters can stand.
 * --------------------------------------------------------------------------
 * Positions are a character's FEET, in art pixels of the 320×192 stage.
 * `walk` is the floor area; `obstacles` are furniture / props measured from
 * the background art (their footprint on the floor). Characters are boxes of
 * FOOT.w × FOOT.d around their feet and may never overlap an obstacle, the
 * room edge, or another character.
 *
 * Layouts are per environment type, with Otherworld's art (which is laid out
 * differently) getting its own. If you replace a background, update its
 * obstacles here.
 */
import { rectHitsPolygon } from "../scene/geometry";
import type { EnvironmentTypeId, WorldId } from "../types";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
/** Furniture that blocks walking. `poly` (stage px) narrows it to a drawn outline inside the rectangle. */
export type Obstacle = Rect & { id: string; poly?: Point[] };
export type Point = { x: number; y: number };
/**
 * Optional walkable-floor grid for rooms whose floor isn't a rectangle (an
 * angled / isometric generated map). `cells[row * cols + col]` is 1 where
 * characters may stand. Each cell is `cw` × `ch` art px.
 */
export type NavMask = { cols: number; rows: number; cw: number; ch: number; cells: Uint8Array };
export type RoomLayout = {
  /** Bounding box of the floor (the whole floor for built-in rooms). */
  walk: Rect;
  obstacles: Obstacle[];
  /** Stage size in art px. Missing = the built-in 320×192. */
  size?: { width: number; height: number };
  /** Floor shape, when it isn't the plain `walk` rectangle. */
  mask?: NavMask;
  /** Hand-placed starting spots (feet). */
  spawns?: Point[];
};

/** Built-in scenes are 320×192 art px. */
export const BUILTIN_SIZE = { width: 320, height: 192 };
export const roomSize = (room: RoomLayout) => room.size ?? BUILTIN_SIZE;

/** A character's footprint around its feet (art px). Sprites are 32 px wide, the drawn body ~18. */
export const FOOT = { w: 16, d: 6 };
/** Never closer than this (feet to feet) when standing side by side. */
export const PERSONAL_SPACE = 20;

const r = (id: string, x0: number, y0: number, x1: number, y1: number): Obstacle => ({ id, x0, y0, x1, y1 });

const DEFAULT: Record<EnvironmentTypeId, RoomLayout> = {
  interior: {
    walk: { x0: 10, y0: 140, x1: 310, y1: 182 },
    obstacles: [r("table", 136, 128, 184, 146), r("plant", 14, 122, 40, 144)],
  },
  street: {
    walk: { x0: 8, y0: 146, x1: 312, y1: 182 },
    obstacles: [r("lamp-l", 66, 138, 76, 150), r("lamp-r", 246, 138, 256, 150)],
  },
  wilderness: {
    walk: { x0: 8, y0: 140, x1: 312, y1: 182 },
    obstacles: [r("mushroom-l", 50, 164, 70, 175), r("mushroom-s", 72, 170, 84, 178), r("mushroom-r", 258, 158, 278, 169), r("bush-l", 0, 176, 38, 192), r("bush-r", 216, 172, 264, 192)],
  },
  ruins: {
    walk: { x0: 8, y0: 140, x1: 312, y1: 182 },
    obstacles: [r("cone-l", 21, 160, 31, 171), r("cone-r", 287, 152, 299, 163), r("cone-s", 205, 172, 215, 181)],
  },
  dreamscape: {
    walk: { x0: 8, y0: 146, x1: 312, y1: 182 },
    obstacles: [r("mushroom-pink", 28, 152, 50, 165), r("mushroom-teal", 278, 158, 300, 171), r("mushroom-tiny", 92, 166, 108, 175)],
  },
};

const OTHERWORLD: Record<EnvironmentTypeId, RoomLayout> = {
  interior: {
    walk: { x0: 10, y0: 146, x1: 310, y1: 182 },
    obstacles: [r("lantern", 22, 154, 40, 167), r("table", 140, 136, 182, 153), r("cushion", 76, 160, 108, 177), r("plant", 214, 150, 248, 167)],
  },
  street: {
    walk: { x0: 8, y0: 152, x1: 312, y1: 182 },
    obstacles: [r("crystals-l", 2, 140, 24, 156), r("crystals-r", 296, 142, 318, 156), r("slime", 216, 178, 232, 190)],
  },
  wilderness: {
    walk: { x0: 8, y0: 150, x1: 312, y1: 182 },
    obstacles: [r("house", 14, 148, 46, 161), r("pond", 46, 161, 116, 179), r("crystals", 140, 174, 160, 185), r("crystals-r", 270, 160, 304, 173)],
  },
  ruins: {
    walk: { x0: 8, y0: 150, x1: 312, y1: 182 },
    obstacles: [r("steps", 98, 134, 222, 151), r("crystals-l", 10, 170, 34, 181), r("crystals-r", 286, 166, 312, 177)],
  },
  dreamscape: {
    walk: { x0: 8, y0: 150, x1: 312, y1: 182 },
    obstacles: [r("mushroom", 12, 164, 42, 177), r("potion", 108, 170, 126, 181), r("flask", 186, 162, 202, 173), r("crystals", 266, 162, 302, 175)],
  },
};

export function roomFor(world: WorldId, place: EnvironmentTypeId): RoomLayout {
  return (world === "otherworld" ? OTHERWORLD : DEFAULT)[place] ?? DEFAULT.interior;
}

export const footRect = (p: Point, pad = 0): Rect => ({
  x0: p.x - FOOT.w / 2 - pad,
  y0: p.y - FOOT.d / 2 - pad,
  x1: p.x + FOOT.w / 2 + pad,
  y1: p.y + FOOT.d / 2 + pad,
});

export const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Feet position inside the floor (the whole footprint, not just the centre). */
export function insideWalk(room: RoomLayout, p: Point): boolean {
  const f = footRect(p);
  if (!(f.x0 >= room.walk.x0 && f.x1 <= room.walk.x1 && f.y0 >= room.walk.y0 && f.y1 <= room.walk.y1)) return false;
  return !room.mask || footOnMask(room.mask, f);
}

/** Every part of the footprint (corners, edge midpoints, centre) is on a floor cell. */
function footOnMask(m: NavMask, f: Rect): boolean {
  const e = 0.01;
  const xs = [f.x0 + e, (f.x0 + f.x1) / 2, f.x1 - e];
  const ys = [f.y0 + e, (f.y0 + f.y1) / 2, f.y1 - e];
  for (const x of xs) for (const y of ys) if (!maskAt(m, x, y)) return false;
  return true;
}

export function maskAt(m: NavMask, x: number, y: number): boolean {
  const c = Math.floor(x / m.cw);
  const r = Math.floor(y / m.ch);
  if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return false;
  return m.cells[r * m.cols + c] === 1;
}

export function hitsObstacle(room: RoomLayout, p: Point): Obstacle | null {
  const f = footRect(p);
  return room.obstacles.find((o) => overlaps(f, o) && (!o.poly || rectHitsPolygon(f, o.poly))) ?? null;
}

/**
 * How much depth (y) counts when measuring the distance between two people.
 * WALKING past: depth counts 2.5× (the floor is foreshortened, so walking
 * behind someone is fine). STANDING: depth counts only 0.8×, so nobody
 * parks right in front of / behind someone else and hides them.
 */
export const PASS_DEPTH = 2.5;
export const STAND_DEPTH = 0.8;

export const gap = (a: Point, b: Point, depth = PASS_DEPTH) => Math.hypot(a.x - b.x, (a.y - b.y) * depth);
/** Distance for where people stand (talking distance, personal space). */
export const standGap = (a: Point, b: Point) => gap(a, b, STAND_DEPTH);

/** Two characters stand too close if they are inside each other's personal space. */
export const tooClose = (a: Point, b: Point, space = PERSONAL_SPACE) => standGap(a, b) < space;

export function clampToWalk(room: RoomLayout, p: Point): Point {
  return {
    x: Math.min(room.walk.x1 - FOOT.w / 2, Math.max(room.walk.x0 + FOOT.w / 2, p.x)),
    y: Math.min(room.walk.y1 - FOOT.d / 2, Math.max(room.walk.y0 + FOOT.d / 2, p.y)),
  };
}
