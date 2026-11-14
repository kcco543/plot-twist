/**
 * PATHFINDING on the room floor (pure, unit-tested).
 * A* over a 4 px grid of feet positions. A cell is walkable when the whole
 * footprint is on the floor, clear of furniture, and clear of every other
 * character's personal space. Paths are then smoothed to straight segments
 * wherever a straight walk is also clear, so characters don't zig-zag.
 */
import { FOOT, PERSONAL_SPACE, STAND_DEPTH, gap, hitsObstacle, insideWalk, type Point, type RoomLayout } from "./room";

export const CELL = 4;
/** While walking past someone, keep at least this much room (a bit less than standing space). */
export const PASSING_SPACE = PERSONAL_SPACE - 2;

/** Someone in the way. `depth` picks the distance rule (see PASS_DEPTH / STAND_DEPTH in room.ts). */
export type Blocker = Point & { space?: number; depth?: number };

export function isFree(room: RoomLayout, p: Point, blockers: Blocker[] = [], space = PASSING_SPACE): boolean {
  if (!insideWalk(room, p) || hitsObstacle(room, p)) return false;
  return blockers.every((b) => gap(p, b, b.depth) >= (b.space ?? space));
}

/** Straight segment a→b is clear (sampled every 2 px). */
export function clearLine(room: RoomLayout, a: Point, b: Point, blockers: Blocker[] = []): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 1; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (!isFree(room, p, blockers)) return false;
  }
  return true;
}

const snap = (v: number) => Math.round(v / CELL) * CELL;

/**
 * Nearest free spot to `p` (searching outward ring by ring), or null.
 * `prefer` breaks ties toward a direction (e.g. away from someone).
 */
export function nearestFree(room: RoomLayout, p: Point, blockers: Blocker[] = [], space = PERSONAL_SPACE, maxRadius = 80): Point | null {
  const sp = { x: snap(p.x), y: snap(p.y) };
  if (isFree(room, sp, blockers, space)) return sp;
  for (let rad = CELL; rad <= maxRadius; rad += CELL) {
    let best: Point | null = null;
    let bestD = Infinity;
    for (let dx = -rad; dx <= rad; dx += CELL)
      for (let dy = -rad; dy <= rad; dy += CELL) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const q = { x: sp.x + dx, y: sp.y + dy };
        if (!isFree(room, q, blockers, space)) continue;
        const d = Math.hypot(q.x - p.x, (q.y - p.y) * 2.5);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    if (best) return best;
  }
  return null;
}

/** A* path from `from` to `to` (both feet points). Returns waypoints after `from`, or null if unreachable. */
export function findPath(room: RoomLayout, from: Point, to: Point, blockers: Blocker[] = [], maxNodes = 6000): Point[] | null {
  const goal = { x: snap(to.x), y: snap(to.y) };
  if (!isFree(room, goal, blockers)) return null;
  const start = { x: snap(from.x), y: snap(from.y) };
  if (clearLine(room, from, to, blockers)) return [to];
  const key = (p: Point) => `${p.x},${p.y}`;
  const h = (p: Point) => Math.hypot(p.x - goal.x, p.y - goal.y);
  const open: { p: Point; f: number }[] = [{ p: start, f: h(start) }];
  const g = new Map<string, number>([[key(start), 0]]);
  const came = new Map<string, Point>();
  const closed = new Set<string>();
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  let expanded = 0;
  while (open.length && expanded < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { p } = open.splice(bi, 1)[0];
    const pk = key(p);
    if (closed.has(pk)) continue;
    closed.add(pk);
    expanded++;
    if (p.x === goal.x && p.y === goal.y) {
      const raw: Point[] = [p];
      let k = pk;
      while (came.has(k)) {
        const prev = came.get(k)!;
        raw.unshift(prev);
        k = key(prev);
      }
      raw.shift(); // drop the start cell
      raw[raw.length - 1] = to;
      return smooth(room, from, raw, blockers);
    }
    for (const [dx, dy] of dirs) {
      const q = { x: p.x + dx * CELL, y: p.y + dy * CELL };
      const qk = key(q);
      if (closed.has(qk) || !isFree(room, q, blockers)) continue;
      // No corner cutting past furniture.
      if (dx && dy && (!isFree(room, { x: p.x + dx * CELL, y: p.y }, blockers) || !isFree(room, { x: p.x, y: p.y + dy * CELL }, blockers))) continue;
      const ng = (g.get(pk) ?? 0) + Math.hypot(dx, dy) * CELL;
      if (ng < (g.get(qk) ?? Infinity)) {
        g.set(qk, ng);
        came.set(qk, p);
        open.push({ p: q, f: ng + h(q) });
      }
    }
  }
  return null;
}

/** Drop waypoints that a straight, clear walk can skip. */
function smooth(room: RoomLayout, from: Point, pts: Point[], blockers: Blocker[]): Point[] {
  const out: Point[] = [];
  let cur = from;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clearLine(room, cur, pts[j], blockers)) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return out;
}

/** Evenly spread starting spots along the floor (like Step 1's slots), moved off furniture if needed. */
export function spawnPoints(room: RoomLayout, count: number): Point[] {
  const left = 56;
  const right = 264;
  const y = Math.min(room.walk.y1 - FOOT.d / 2 - 2, 174);
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 160 : left + ((right - left) / (count - 1)) * i;
    pts.push(nearestFree(room, { x, y }, pts.map((q) => ({ ...q, depth: STAND_DEPTH })), PERSONAL_SPACE + 4, 120) ?? { x, y });
  }
  return pts;
}
