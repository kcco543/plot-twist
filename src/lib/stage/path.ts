/**
 * PATHFINDING on the room floor (pure, unit-tested).
 * A* over a 4 px grid of feet positions. A cell is walkable when the whole
 * footprint is on the floor, clear of furniture, and clear of every other
 * character's personal space. Paths are then smoothed to straight segments
 * wherever a straight walk is also clear, so characters don't zig-zag.
 */
import { FOOT, PERSONAL_SPACE, STAND_DEPTH, gap, hitsObstacle, insideWalk, roomSize, type Point, type RoomLayout } from "./room";

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
export function findPath(room: RoomLayout, from: Point, to: Point, blockers: Blocker[] = [], maxNodes = nodeBudget(room)): Point[] | null {
  const goal = { x: snap(to.x), y: snap(to.y) };
  if (!isFree(room, goal, blockers)) return null;
  const start = { x: snap(from.x), y: snap(from.y) };
  if (clearLine(room, from, to, blockers)) return [to];
  const key = (p: Point) => `${p.x},${p.y}`;
  const h = (p: Point) => Math.hypot(p.x - goal.x, p.y - goal.y);
  const open = new Heap();
  open.push({ p: start, f: h(start) });
  const g = new Map<string, number>([[key(start), 0]]);
  const came = new Map<string, Point>();
  const closed = new Set<string>();
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  let expanded = 0;
  while (open.size && expanded < maxNodes) {
    const { p } = open.pop()!;
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

/** Bigger stages (generated maps) get a bigger search budget: up to every cell of the floor. */
export function nodeBudget(room: RoomLayout): number {
  const { width, height } = roomSize(room);
  return Math.max(6000, Math.ceil((width / CELL) * (height / CELL)));
}

/** Min-heap on f, so A* stays fast on large floors. */
class Heap {
  private a: { p: Point; f: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(n: { p: Point; f: number }) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j].f <= a[i].f) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
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
  if (room.mask || room.spawns?.length) return spawnOnFloor(room, count);
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

/**
 * Starting spots on a free-form floor (generated maps): the hand-placed spawn
 * points first (moved off furniture if needed), then free spots gathered
 * around the middle of the floor, each outside everyone else's personal space.
 */
function spawnOnFloor(room: RoomLayout, count: number): Point[] {
  const pts: Point[] = [];
  const blockers = () => pts.map((q) => ({ ...q, depth: STAND_DEPTH }));
  for (const s of room.spawns ?? []) {
    if (pts.length >= count) break;
    const p = nearestFree(room, s, blockers(), PERSONAL_SPACE + 4, 60);
    if (p) pts.push(p);
  }
  if (pts.length >= count) return pts;
  // Free cells of the floor, nearest to its centre first.
  const free: Point[] = [];
  const { width, height } = roomSize(room);
  for (let y = CELL * 2; y < height; y += CELL * 2) for (let x = CELL * 2; x < width; x += CELL * 2) if (isFree(room, { x, y })) free.push({ x, y });
  if (!free.length) return [...pts, ...Array.from({ length: count - pts.length }, () => ({ x: (room.walk.x0 + room.walk.x1) / 2, y: (room.walk.y0 + room.walk.y1) / 2 }))];
  const cx = free.reduce((s, p) => s + p.x, 0) / free.length;
  const cy = free.reduce((s, p) => s + p.y, 0) / free.length;
  free.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  for (const p of free) {
    if (pts.length >= count) break;
    if (isFree(room, p, blockers(), PERSONAL_SPACE + 4)) pts.push(p);
  }
  while (pts.length < count) pts.push(free[pts.length % free.length]);
  return pts;
}
