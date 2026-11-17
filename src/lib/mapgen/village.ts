/**
 * VILLAGE KIT — Western Fantasy test world (layout first, then pixels).
 * --------------------------------------------------------------------------
 * A map is planned before anything is drawn:
 *
 *   1. BLUEPRINT  big terrain regions (a green, a stone plaza, one wide road,
 *                 maybe a pond), obstacles only along the top and the sides,
 *                 2–4 props on open ground, decoration in a few small groups.
 *   2. PIXELS     the blueprint painted on the 480×320 native grid, one art
 *                 pixel at a time (sprites.ts, palette.ts).
 *   3. PLAY AREA  the walkable floor, objects and start spots come from the
 *                 SAME blueprint (layoutFromBlueprint), so what you see is
 *                 exactly where characters can walk.
 *
 * The player's description picks features (pond, well, a second house, more
 * trees, flowers) in English or Chinese; the seed picks the variation. The
 * plan is checked (open ground share, one connected walking area, road width)
 * before it is drawn.
 */
import { Canvas, Sprite, hashSeed, rng, stamp, valueNoise, type RGB, type Rng } from "./canvas";
import { WESTERN_FANTASY, shadeFor, type Palette } from "./palette";
import * as art from "./sprites";

export const MAP_W = 480;
export const MAP_H = 320;

/** Ground materials (per pixel). */
export const M = { VOID: 0, GRASS: 1, DIRT: 2, STONE: 3, WATER: 4, HIGH: 5, FACE: 6, BACK: 7 } as const;
export type Material = (typeof M)[keyof typeof M];
export const WALKABLE_MATERIALS: readonly number[] = [M.GRASS, M.DIRT, M.STONE];

export type PropKind = "tree" | "bush" | "cottage" | "well" | "bench" | "sign" | "barrel" | "crate" | "rock" | "door" | "exit";

/** Something placed on the map. x/base = where it touches the ground (art px). */
export type Placed = {
  id: string;
  kind: PropKind;
  x: number;
  base: number;
  /** Drawn box on the map (art px), filled in when painted. */
  box?: { x0: number; y0: number; x1: number; y1: number };
  /** Size hint for the builder (trees, bushes, rocks, cottages). */
  size?: number;
  /** Becomes an object in the play area (interactive or needs occlusion). */
  object?: { type: "feature" | "seat" | "sign" | "plant" | "door" | "exit" | "item"; solid: boolean; front: boolean; label: LabelKey };
  /** Background scenery: drawn darker, never an object. */
  deep?: boolean;
};

export type Features = { pond: boolean; well: boolean; houses: 1 | 2; trees: "few" | "some" | "many"; flowers: boolean };

export type Blueprint = {
  w: number;
  h: number;
  seed: number;
  /** Mirror the composition left↔right (light still comes from the upper left). */
  flip: boolean;
  features: Features;
  mat: Uint8Array;
  /** Extra non-walkable pixels on walkable materials (house walls, tree masses at the edges). */
  blocked: Uint8Array;
  props: Placed[];
  /** Small non-solid details: flower groups, tufts, pebbles, reeds, lily pads. */
  decor: { kind: "flowers" | "tufts" | "pebbles" | "reeds" | "lilies"; x: number; y: number; n: number }[];
  spawns: { x: number; y: number }[];
};

// ---------------------------------------------------------------- features from words

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

export function featuresFrom(description: string, r: Rng): Features {
  const t = description.toLowerCase();
  const noWater = has(t, ["no water", "no pond", "dry", "没有水", "干"]);
  return {
    pond: !noWater && (has(t, ["pond", "lake", "water", "fish", "lily", "池", "湖", "水", "鱼", "荷"]) || r.chance(0.6)),
    well: !has(t, ["no well"]) && (has(t, ["well", "井"]) || r.chance(0.75)),
    houses: has(t, ["village", "houses", "town", "neighbo", "村", "房子们", "镇", "街坊", "两座", "two houses"]) ? 2 : 1,
    trees: has(t, ["forest", "woods", "trees", "grove", "森林", "树林", "林"]) ? "many" : has(t, ["open", "meadow", "field", "草地", "空旷", "广场"]) ? "few" : "some",
    flowers: has(t, ["flower", "garden", "bloom", "spring", "花", "春"]) || r.chance(0.5),
  };
}

// ---------------------------------------------------------------- blueprint

/** Rounded rectangle test, evaluated on 2×2 blocks so region edges step in chunky 2 px clusters. */
const inRoundRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, rad: number) => {
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad && x >= x0 && x <= x1 && y >= y0 && y <= y1;
};

const bez = (t: number, a: number, b: number, c: number) => (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c;

/** Shortest distance from a point to a quadratic curve (sampled). */
function distToCurve(x: number, y: number, pts: { x: number; y: number }[]) {
  let best = Infinity;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const px = bez(t, pts[0].x, pts[1].x, pts[2].x);
    const py = bez(t, pts[0].y, pts[1].y, pts[2].y);
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
}

export const ROAD_HALF_WIDTH = 23; // a 46 px road: two characters side by side, with room to spare

export function planVillage(description: string, seed: number): Blueprint {
  const r = rng(seed);
  const features = featuresFrom(description, r);
  const flip = r.chance(0.5);
  const W = MAP_W;
  const H = MAP_H;
  const X = (x: number) => (flip ? W - x : x);
  const noise = valueNoise(seed);
  const mat = new Uint8Array(W * H).fill(M.GRASS);
  const blocked = new Uint8Array(W * H);

  // Back edge: a hedge of woodland along the top; high ground with a cliff on one side.
  const backH = (x: number) => 26 + Math.round((noise(x, 0, 40) * 10) / 2) * 2;
  const plateauRight = r.int(176, 204);
  const plateauBottom = r.int(56, 64);
  const FACE_H = 26;
  // Plaza in front of the main house, a road from one side to the bottom edge, maybe a pond in the far corner.
  const plaza = { x0: r.int(200, 212), y0: r.int(112, 118), x1: r.int(404, 414), y1: r.int(180, 188) };
  const houseX = r.int(292, 318);
  const houseBase = plaza.y0 + 6;
  const roadEast = [
    { x: W + 30, y: r.int(150, 170) },
    { x: r.int(430, 445), y: r.int(160, 172) },
    { x: plaza.x1 - 20, y: (plaza.y0 + plaza.y1) / 2 + 6 },
  ];
  const southX = r.int(236, 270);
  const roadSouth = [
    { x: southX + r.int(30, 50), y: plaza.y1 - 10 },
    { x: southX + r.int(10, 30), y: r.int(240, 260) },
    { x: southX, y: H + 30 },
  ];
  const house2 = features.houses === 2 ? { x: r.int(424, 440), base: houseBase - 10 } : null;
  const pond = features.pond ? { cx: r.int(88, 104), cy: r.int(246, 258), rx: r.int(56, 66), ry: r.int(28, 34) } : null;

  for (let by = 0; by < H; by += 2)
    for (let bx = 0; bx < W; bx += 2) {
      const x = bx + 1;
      const y = by + 1;
      const bxu = flip ? W - x : x; // unflipped coordinate for the plan
      let m: Material = M.GRASS;
      const plateauEdge = plateauBottom + Math.round((noise(bxu, 7, 24) - 0.5) * 6 / 2) * 2;
      const onPlateau = inRoundRect(bxu, y, -40, -40, plateauRight, plateauEdge, 26);
      if (y < backH(bxu)) m = M.BACK;
      else if (onPlateau) m = M.HIGH;
      else {
        if (inRoundRect(bxu, y, plaza.x0, plaza.y0, plaza.x1, plaza.y1, 18)) m = M.STONE;
        else if (house2 && inRoundRect(bxu, y, plaza.x1 - 30, house2.base - 4, house2.x + 34, house2.base + 18, 8)) m = M.STONE;
        else {
          const wobble = (noise(bxu, y, 18) - 0.5) * 5;
          if (distToCurve(bxu, y, roadEast) < ROAD_HALF_WIDTH + wobble || distToCurve(bxu, y, roadSouth) < ROAD_HALF_WIDTH + wobble) m = M.DIRT;
        }
        if (pond) {
          const n = (noise(bxu, y, 16) - 0.5) * 0.22;
          if (((bxu - pond.cx) / pond.rx) ** 2 + ((y - pond.cy) / pond.ry) ** 2 < 1 + n) m = M.WATER;
        }
      }
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) mat[(by + dy) * W + bx + dx] = m;
    }
  // Cliff face below the high ground (one column at a time, so it follows the curve).
  for (let x = 0; x < W; x++) {
    let bottom = -1;
    for (let y = 0; y < H; y++) if (mat[y * W + x] === M.HIGH) bottom = y;
    if (bottom < 0) continue;
    for (let y = bottom + 1; y <= bottom + FACE_H && y < H; y++) if (mat[y * W + x] !== M.BACK) mat[y * W + x] = M.FACE;
  }

  const props: Placed[] = [];
  const decor: Blueprint["decor"] = [];
  let n = 0;
  const add = (p: Omit<Placed, "id">) => props.push({ ...p, id: `${p.kind}-${++n}`, x: X(p.x) });

  // Main house on the plaza's back edge, with its door as an object.
  add({ kind: "cottage", x: houseX, base: houseBase, size: 96, object: { type: "feature", solid: true, front: false, label: "house" } });
  if (house2) add({ kind: "cottage", x: house2.x, base: house2.base, size: 72, object: { type: "feature", solid: true, front: false, label: "house2" } });

  // Woodland: background trees on the high ground, a few trees at the side edges, one in a bottom corner (drawn over characters).
  for (const tx of [24, 82, 140]) if (tx < plateauRight - 20) add({ kind: "tree", x: tx + r.int(-6, 6), base: plateauBottom - r.int(2, 8), size: r.range(0.9, 1.05), deep: true });
  if (features.houses === 1) {
    add({ kind: "tree", x: r.int(432, 446), base: r.int(84, 92), size: 1 });
    add({ kind: "tree", x: r.int(468, 476), base: r.int(118, 126), size: 0.95 });
  }
  add({ kind: "tree", x: r.int(4, 12), base: r.int(150, 160), size: 1 });
  if (features.trees !== "few") add({ kind: "tree", x: r.int(-6, 2), base: r.int(196, 206), size: 0.95 });
  if (features.trees === "many") {
    add({ kind: "tree", x: r.int(470, 478), base: r.int(232, 244), size: 0.95 });
    add({ kind: "bush", x: r.int(160, 176), base: plateauBottom + FACE_H + 12, size: 22 });
  }
  add({ kind: "tree", x: r.int(456, 466), base: r.int(326, 334), size: 1.05, object: { type: "plant", solid: true, front: true, label: "tree" } });
  add({ kind: "bush", x: r.int(14, 24), base: r.int(314, 318), size: 26 });

  // Props on open ground: a well on the plaza, a bench by the pond (or on the green), a signpost by the road.
  if (features.well) add({ kind: "well", x: plaza.x0 + r.int(30, 40), base: plaza.y1 - r.int(16, 22), object: { type: "feature", solid: true, front: true, label: "well" } });
  const benchSpot = pond ? { x: pond.cx + pond.rx + r.int(26, 34), y: pond.cy - r.int(14, 20) } : { x: r.int(120, 150), y: r.int(220, 240) };
  add({ kind: "bench", x: benchSpot.x, base: benchSpot.y, object: { type: "seat", solid: true, front: false, label: "bench" } });
  add({ kind: "sign", x: r.int(426, 440), base: roadEast[1].y + ROAD_HALF_WIDTH + r.int(18, 24), object: { type: "sign", solid: true, front: false, label: "sign" } });
  // A small group of barrels and a crate beside the house (one decoration cluster).
  const side = houseX + 62;
  add({ kind: "barrel", x: side, base: houseBase + 1 });
  add({ kind: "barrel", x: side + 12, base: houseBase + 3 });
  add({ kind: "crate", x: side + 6, base: houseBase + 12 });
  // Rocks: at the cliff foot and by the water.
  add({ kind: "rock", x: r.int(110, 150), base: plateauBottom + FACE_H + r.int(8, 12), size: 14 });
  if (pond) add({ kind: "rock", x: pond.cx - pond.rx + r.int(-2, 6), base: pond.cy + pond.ry - 2, size: 12 });

  // Exits where the roads leave the map.
  add({ kind: "exit", x: W - 8, base: roadEast[0].y > H ? H - 8 : Math.round(bez(0.06, roadEast[0].y, roadEast[1].y, roadEast[2].y)) + 8, object: { type: "exit", solid: false, front: false, label: "roadEast" } });
  add({ kind: "exit", x: southX + 4, base: H - 2, object: { type: "exit", solid: false, front: false, label: "roadSouth" } });

  // Decoration in a few groups (never spread evenly).
  const groups: [Blueprint["decor"][number]["kind"], number, number, number][] = [
    ["tufts", r.int(60, 140), r.int(120, 150), 5],
    ["tufts", r.int(330, 380), r.int(220, 260), 4],
    ["pebbles", southX + 10, r.int(250, 290), 4],
    ["pebbles", r.int(440, 470), roadEast[1].y, 3],
  ];
  if (features.flowers) {
    groups.push(["flowers", r.int(50, 110), plateauBottom + FACE_H + r.int(10, 16), 6]);
    groups.push(["flowers", r.int(420, 460), r.int(264, 290), 5]);
  }
  if (pond) {
    groups.push(["reeds", pond.cx - pond.rx + 8, pond.cy - pond.ry + 6, 5]);
    groups.push(["reeds", pond.cx + pond.rx - 12, pond.cy + pond.ry - 6, 4]);
    groups.push(["lilies", pond.cx + r.int(-10, 16), pond.cy + r.int(-4, 8), 4]);
  }
  for (const [kind, x, y, count] of groups) decor.push({ kind, x: X(x), y, n: count });

  // Start spots: on the plaza and the green, apart from each other.
  const spawns = [
    { x: X(houseX - 30), y: houseBase + 34 },
    { x: X(houseX + 18), y: houseBase + 42 },
    { x: X(houseX - 64), y: plaza.y1 + 22 },
    { x: X(houseX + 60), y: plaza.y1 - 6 },
  ];

  return { w: W, h: H, seed, flip, features, mat, blocked, props, decor, spawns };
}

// ---------------------------------------------------------------- painting

type Painted = { canvas: Canvas; props: Placed[] };

function paintGround(cv: Canvas, bp: Blueprint, p: Palette) {
  const { w, h, mat } = bp;
  const noise = valueNoise(bp.seed ^ 0x5bd1e995);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : mat[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const m = mat[y * w + x];
      // Texture is evaluated on 2×2 blocks: clusters, never single noisy pixels.
      const bx = x & ~1;
      const by = y & ~1;
      const n = noise(bx, by, 44) * 0.75 + noise(bx, by, 14) * 0.25;
      let c: RGB;
      switch (m) {
        case M.GRASS: {
          c = p.grass[2];
          // The ground's top lip over a road or plaza catches the light.
          const below = at(x, y + 1);
          if ((below === M.DIRT || below === M.STONE) && m === M.GRASS) c = p.grass[3];
          break;
        }
        case M.DIRT: {
          c = n > 0.7 ? p.dirt[3] : p.dirt[2];
          const up = at(x, y - 1), up2 = at(x, y - 2), l = at(x - 1, y), rr = at(x + 1, y);
          if (up === M.GRASS || up2 === M.GRASS) c = p.dirt[1]; // shade under the grass lip
          else if (l === M.GRASS || rr === M.GRASS) c = p.dirt[1];
          break;
        }
        case M.STONE:
          c = plazaStone(x, y, bp, p, at);
          break;
        case M.WATER:
          c = waterPixel(x, y, p, at, n);
          break;
        case M.HIGH:
          c = p.high[2];
          break;
        case M.FACE:
          c = cliffPixel(x, y, p, at);
          break;
        case M.BACK:
          c = p.leaf[0];
          break;
        default:
          c = p.grass[2];
      }
      cv.set(x, y, c);
    }
  // A dark line where grass meets the pond (left, right and near shore), so the water reads as a shape.
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (mat[y * w + x] !== M.GRASS) continue;
      if (mat[(y - 1) * w + x] === M.WATER || mat[y * w + x - 1] === M.WATER || mat[y * w + x + 1] === M.WATER) cv.set(x, y, p.grass[1]);
    }
  // Soft shadow on the ground at the foot of the cliff and the back hedge.
  for (let x = 0; x < w; x++)
    for (let y = 1; y < h; y++) {
      const above = mat[(y - 1) * w + x];
      if ((above === M.FACE || above === M.BACK) && WALKABLE_MATERIALS.includes(mat[y * w + x])) {
        const depth = above === M.FACE ? 4 : 3;
        for (let k = 0; k < depth && y + k < h; k++) if (WALKABLE_MATERIALS.includes(mat[(y + k) * w + x]) && (k < depth - 1 || (x >> 1) % 2 === 0)) shadeAt(cv, x, y + k, p);
      }
    }
}

const shadeCache = new WeakMap<Palette, (c: RGB) => RGB>();
function shadeAt(cv: Canvas, x: number, y: number, p: Palette) {
  let s = shadeCache.get(p);
  if (!s) shadeCache.set(p, (s = shadeFor(p)));
  if (cv.inside(x, y)) cv.set(x, y, s(cv.get(x, y)));
}

function plazaStone(x: number, y: number, bp: Blueprint, p: Palette, at: (x: number, y: number) => number): RGB {
  // Curb: one darker ring where the plaza meets grass or road, a darker front edge at the bottom.
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (at(x + dx, y + dy) !== M.STONE) return dy === 1 ? p.stone[0] : p.stone[1];
  const rowH = 9;
  const row = Math.floor(y / rowH);
  const yy = y % rowH;
  const off = ((row * 2654435761) >>> 0) % 16;
  const stoneW = 16;
  const k = Math.floor((x + off) / stoneW);
  const xx = (x + off) % stoneW;
  if (yy === rowH - 1 || xx === stoneW - 1) return p.stone[1];
  const v = ((row * 73856093) ^ (k * 19349663) ^ bp.seed) >>> 0;
  const tone = v % 10 < 2 ? p.stone[3] : p.stone[2];
  if (yy === 0 && xx < 7) return p.stone[3];
  if (yy === rowH - 2 && xx > stoneW - 6 && tone === p.stone[2]) return p.stone[1];
  return tone;
}

function waterPixel(x: number, y: number, p: Palette, at: (x: number, y: number) => number, n: number): RGB {
  // Bank: the earth face shows along the far (top) shore; foam along the near (bottom) shore.
  let above = 0;
  while (above < 4 && at(x, y - above - 1) === M.WATER) above++;
  if (above === 0) return p.rock[1];
  if (above === 1) return p.rock[0];
  if (above === 2) return p.water[0];
  if (at(x, y + 1) !== M.WATER) return p.water[3];
  if (at(x - 1, y) !== M.WATER || at(x + 1, y) !== M.WATER) return p.water[1];
  if (above === 3) return p.water[1];
  // Sparse horizontal glints in clusters.
  const band = (y >> 1) % 5 === 0 && ((x >> 2) * 7 + (y >> 1) * 3) % 11 < 2 && n > 0.45;
  return band ? p.water[3] : p.water[2];
}

/** Jittered boulder centres for cliff faces: rows of rounded stones, offset row to row. */
const boulder = (i: number, row: number) => {
  const h = ((i * 374761393) ^ (row * 668265263)) >>> 0;
  return { x: i * 13 + (row % 2) * 6 + (h % 5) - 2, y: row * 9 + 5 + ((h >> 3) % 3) - 1, s: 6 + ((h >> 6) % 3) };
};

function cliffPixel(x: number, y: number, p: Palette, at: (x: number, y: number) => number): RGB {
  let t = 0; // rows below the top of the face
  while (at(x, y - t - 1) === M.FACE) t++;
  let left = 0; // rows to the bottom of the face
  while (at(x, y + left + 1) === M.FACE) left++;
  const drip = ((x * 2654435761) >>> 0) % 9;
  // Grass lip hanging over the top, with a few longer drips.
  if (t === 0) return p.high[3];
  if (t === 1) return p.high[2];
  if (t === 2) return drip < 5 ? p.high[1] : p.leafOutline;
  if (t === 3 && drip < 2) return p.high[1];
  if (t === 4 && drip === 0) return p.high[0];
  if (left <= 1) return p.rock[0];
  // Rounded boulders (nearest of a few jittered centres), lit on the upper left, with dark cracks between.
  const ty = t - 3;
  let d1 = Infinity, d2 = Infinity;
  let best = { x: 0, y: 0, s: 6 };
  const row0 = Math.floor(ty / 9);
  for (let row = row0 - 1; row <= row0 + 1; row++) {
    const i0 = Math.floor((x - (row % 2) * 6) / 13);
    for (let i = i0 - 1; i <= i0 + 2; i++) {
      const b = boulder(i, row);
      const d = Math.hypot((x - b.x) / 1.25, ty - b.y);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        best = b;
      } else if (d < d2) d2 = d;
    }
  }
  if (d2 - d1 < 1.1) return p.rock[0];
  const l = -((x - best.x) * 0.55 + (ty - best.y) * 0.85) / best.s;
  // Darker toward the foot of the face (further from the light).
  const low = left < 5;
  if (l > 0.45 && !low) return p.rock[3];
  if (l > -0.25) return low ? p.rock[1] : p.rock[2];
  return p.rock[1];
}

/** Small clusters of blades on the grass, grouped by a low-frequency mask (calm areas stay calm). */
function grassClusters(cv: Canvas, bp: Blueprint, p: Palette, r: Rng) {
  const noise = valueNoise(bp.seed ^ 0x2545f491);
  const { w, h, mat } = bp;
  const ok = (x: number, y: number, m: number) => x >= 0 && y >= 0 && x < w && y < h && mat[y * w + x] === m;
  const stamps: [number, number, number][][] = [
    [[0, 0, 3], [2, 0, 3], [0, 1, 3], [1, 1, 3], [2, 1, 1], [1, 2, 1]],
    [[1, 0, 3], [0, 1, 3], [1, 1, 3], [0, 2, 1], [1, 2, 1]],
    [[0, 0, 3], [1, 0, 4], [0, 1, 3], [1, 1, 3], [2, 1, 3], [1, 2, 1], [2, 2, 1]],
  ];
  for (let y = 2; y < h - 3; y += 6)
    for (let x = 2; x < w - 3; x += 6) {
      for (const [m, ramp] of [[M.GRASS, p.grass], [M.HIGH, p.high]] as const) {
        if (!ok(x, y, m) || !ok(x + 3, y + 3, m)) continue;
        const dense = noise(x, y, 52);
        const prob = dense > 0.62 ? 0.55 : dense > 0.5 ? 0.18 : 0.04;
        if (!r.chance(prob)) continue;
        const jx = x + r.int(0, 3);
        const jy = y + r.int(0, 3);
        for (const [dx, dy, tone] of r.pick(stamps)) if (ok(jx + dx, jy + dy, m)) cv.set(jx + dx, jy + dy, ramp[Math.min(tone, ramp.length - 1)]);
      }
    }
}

function paintBackHedge(cv: Canvas, bp: Blueprint, p: Palette, r: Rng) {
  // A wall of tree tops along the back edge: overlapping clumps over a dark mass.
  const { w, h, mat } = bp;
  const bottom: number[] = [];
  for (let x = 0; x < w; x++) {
    let b = -1;
    for (let y = 0; y < h && y < 80; y++) if (mat[y * w + x] === M.BACK) b = y;
    bottom.push(b);
  }
  for (const layer of [1, 0]) {
    for (let x = -10 + layer * 9; x < w + 16; x += r.int(15, 23)) {
      const bx = Math.max(0, Math.min(w - 1, x));
      if (bottom[bx] < 0) continue;
      const rad = r.int(12, 17);
      const s = new Sprite(rad * 2 + 4, rad * 2 + 2);
      const c = rad + 2;
      s.ellipse(c, rad + 1, rad, rad * 0.88, (px, py, nx, ny) => {
        const l = -(nx * 0.55 + ny * 0.85) + ((((px >> 1) * 7 + (py >> 1) * 13) % 9) === 0 ? -0.3 : 0);
        const i = l > 0.5 ? 3 : l > 0 ? 2 : l > -0.55 ? 1 : 0;
        return p.leaf[Math.max(0, i - layer)];
      });
      s.ox = x - c;
      s.oy = bottom[bx] - rad * 2 + 4 - layer * 9 + r.int(-2, 2);
      stamp(cv, s, s.outline(p.leafOutline));
    }
  }
}

function paintDecor(cv: Canvas, bp: Blueprint, p: Palette, r: Rng) {
  const ok = (x: number, y: number, m: number[]) => cv.inside(x, y) && m.includes(bp.mat[y * bp.w + x]);
  for (const d of bp.decor) {
    for (let i = 0; i < d.n; i++) {
      const x = Math.round(d.x + r.range(-14, 14));
      const y = Math.round(d.y + r.range(-8, 8));
      if (d.kind === "tufts" && ok(x, y, [M.GRASS]) && ok(x + 4, y + 2, [M.GRASS])) {
        // A little "w" of blades: light tips, dark base.
        for (const [dx, dy, c] of [[0, 0, 4], [3, 0, 4], [0, 1, 3], [1, 1, 3], [3, 1, 3], [2, 1, 3], [1, 2, 1], [2, 2, 1]] as const) cv.set(x + dx, y + dy, p.grass[c]);
      } else if (d.kind === "flowers" && ok(x, y, [M.GRASS]) && ok(x + 2, y + 2, [M.GRASS])) {
        const petal = p.flower[r.pick([0, 2, 3, 0])];
        cv.set(x + 1, y + 2, p.grass[1]);
        cv.set(x + 1, y + 3, p.grass[1]);
        for (const [dx, dy] of [[1, 0], [0, 1], [2, 1], [1, 2]]) cv.set(x + dx, y + dy, petal);
        cv.set(x + 1, y + 1, p.flower[1]);
      } else if (d.kind === "pebbles" && ok(x, y, [M.DIRT]) && ok(x + 2, y + 1, [M.DIRT])) {
        cv.set(x, y, p.dirt[3]);
        cv.set(x + 1, y, p.dirt[3]);
        cv.set(x, y + 1, p.dirt[1]);
        cv.set(x + 1, y + 1, p.dirt[1]);
      } else if (d.kind === "reeds" && ok(x, y + 6, [M.WATER, M.GRASS])) {
        for (let k = 0; k < 3; k++) {
          const rx = x + k * 2;
          const tall = 5 + ((k * 7) % 3);
          for (let t = 0; t < tall; t++) cv.set(rx, y + 6 - t, t > tall - 3 ? p.grass[4] : p.grass[1]);
          cv.set(rx, y + 6 - tall, p.dirt[1]);
          cv.set(rx, y + 5 - tall, p.dirt[1]);
        }
      } else if (d.kind === "lilies" && ok(x, y, [M.WATER]) && ok(x + 8, y + 5, [M.WATER]) && ok(x + 4, y - 3, [M.WATER])) {
        const s = new Sprite(9, 6);
        s.ellipse(4.5, 3, 4.5, 2.6, (_x, _y, nx, ny) => (nx + ny < -0.2 ? p.grass[4] : nx + ny > 0.7 ? p.grass[1] : p.grass[3]));
        s.set(5, 2, p.water[2]);
        s.set(6, 2, p.water[2]);
        s.set(5, 1, p.water[2]);
        if (i % 2 === 0) {
          s.set(3, 1, p.flower[0]);
          s.set(4, 1, p.flower[0]);
          s.set(3, 0, p.flower[2]);
        }
        s.ox = x;
        s.oy = y;
        stamp(cv, s);
      }
    }
  }
}

function buildProp(pl: Placed, p: Palette, r: Rng) {
  switch (pl.kind) {
    case "tree":
      return art.tree(p, r, pl.size ?? 1, pl.deep ? 1 : 0);
    case "bush":
      return art.bush(p, r, pl.size ?? 22);
    case "cottage":
      return art.cottage(p, r, pl.size ?? 96, { windows: (pl.size ?? 96) >= 90 ? 2 : 1 });
    case "well":
      return art.well(p);
    case "bench":
      return art.bench(p);
    case "sign":
      return art.signpost(p);
    case "barrel":
      return art.barrel(p);
    case "crate":
      return art.crate(p);
    case "rock":
      return art.rock(p, r, pl.size ?? 14);
    default:
      return null;
  }
}

/** Cast shadow: a flat ellipse at the base, pushed to the lower right (light from the upper left). */
function castShadow(cv: Canvas, bp: Blueprint, p: Palette, cx: number, cy: number, rx: number, ry: number) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1 || !cv.inside(x, y)) continue;
      const m = bp.mat[y * bp.w + x];
      if (WALKABLE_MATERIALS.includes(m) || m === M.HIGH) shadeAt(cv, x, y, p);
    }
}

export function paintVillage(bp: Blueprint, p: Palette = WESTERN_FANTASY): Painted {
  const cv = new Canvas(bp.w, bp.h);
  const r = rng(bp.seed ^ 0x9e3779b9);
  paintGround(cv, bp, p);
  grassClusters(cv, bp, p, r);
  paintBackHedge(cv, bp, p, r);
  paintDecor(cv, bp, p, r);
  const props = bp.props.map((pl) => ({ ...pl }));
  const drawn: { pl: Placed; b: art.Built }[] = [];
  for (const pl of props) {
    const b = buildProp(pl, p, r);
    if (pl.kind === "door" || pl.kind === "exit" || !b) continue;
    b.sprite.ox = pl.x - b.baseX;
    b.sprite.oy = pl.base - b.baseY;
    pl.box = { x0: b.sprite.ox, y0: b.sprite.oy, x1: b.sprite.ox + b.sprite.w, y1: b.sprite.oy + b.sprite.h };
    drawn.push({ pl, b });
    if (pl.kind === "cottage" && "door" in b) {
      const d = (b as ReturnType<typeof art.cottage>).door;
      const isMain = pl.object?.label === "house";
      props.push({
        id: `door-${pl.id}`,
        kind: "door",
        x: b.sprite.ox + d.x + d.w / 2,
        base: pl.base,
        box: { x0: b.sprite.ox + d.x, y0: b.sprite.oy + d.y, x1: b.sprite.ox + d.x + d.w, y1: b.sprite.oy + d.y + d.h },
        object: { type: "door", solid: false, front: false, label: isMain ? "door" : "door2" },
      });
    }
  }
  // Shadows first (they fall on the ground), then everything in depth order.
  for (const { pl, b } of drawn) {
    const w = b.sprite.w;
    const big = pl.kind === "cottage";
    castShadow(cv, bp, p, pl.x + (big ? 6 : w * 0.18), pl.base + (big ? 1 : 0), big ? w * 0.52 : Math.max(5, w * 0.42), big ? 5 : Math.max(2, w * 0.13));
  }
  drawn.sort((a, b) => a.pl.base - b.pl.base);
  for (const { pl, b } of drawn) stamp(cv, b.sprite, b.sprite.outline(pl.kind === "tree" || pl.kind === "bush" ? p.leafOutline : p.outline));
  return { canvas: cv, props };
}

// ---------------------------------------------------------------- everything together

export type LabelKey = "house" | "house2" | "door" | "door2" | "well" | "bench" | "sign" | "tree" | "roadEast" | "roadSouth";

export function villageSeed(description: string, nonce: number) {
  return hashSeed(`${description.trim().toLowerCase()}#${nonce}`);
}

/** Pixels that block walking although their material is walkable: house walls and roofs, edge tree masses. */
export function markBlocked(bp: Blueprint, props: Placed[]) {
  const { w, h, blocked } = bp;
  blocked.fill(0);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) blocked[y * w + x] = 1;
  };
  for (const pl of props) {
    if (!pl.box) continue;
    if (pl.kind === "cottage") fill(pl.box.x0, pl.box.y0, pl.box.x1, pl.base + 1);
    // Trees standing at the side edges are part of the woodland: no squeezing behind them.
    else if (pl.kind === "tree" && !pl.object && (pl.box.x0 < 4 || pl.box.x1 > w - 4)) fill(pl.box.x0, pl.box.y0 + 6, pl.box.x1, pl.base + 2);
    else if (pl.kind === "tree" && !pl.object) fill(pl.box.x0 + 4, pl.base - 12, pl.box.x1 - 4, pl.base + 2);
    else if (pl.kind === "bush" || pl.kind === "barrel" || pl.kind === "crate" || pl.kind === "rock") fill(pl.box.x0, pl.base - Math.min(8, pl.box.y1 - pl.box.y0), pl.box.x1, pl.base + 1);
  }
}
