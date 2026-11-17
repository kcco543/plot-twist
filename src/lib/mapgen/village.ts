/**
 * VILLAGE KIT — Western Fantasy test world (layout first, then pixels).
 * --------------------------------------------------------------------------
 * A map is planned before anything is drawn:
 *
 *   1. BLUEPRINT  big terrain regions (a sunlit green, a flagstone plaza, a
 *                 worn road, maybe a pond with a stone rim), high ground and
 *                 old trees framing the edges, 2–4 props on open ground,
 *                 decoration in a few groups.
 *   2. PIXELS     the blueprint painted on the 480×320 native grid, one art
 *                 pixel at a time (sprites.ts, palette.ts), in an
 *                 adventure-RPG manner: warm hue-shifted ramps, deep brown
 *                 shadows, organic leafy edges, pools of light and shade.
 *   3. PLAY AREA  the walkable floor, objects and start spots come from the
 *                 SAME blueprint (index.ts → layoutFromBlueprint).
 *
 * The player's description picks features (pond, well, a second house, more
 * trees, flowers) in English or Chinese; the seed picks the variation.
 */
import { Canvas, Sprite, hashSeed, rng, stamp, valueNoise, type RGB, type Rng } from "./canvas";
import { WESTERN_FANTASY, lightFor, shadeFor, type Palette } from "./palette";
import * as art from "./sprites";

export const MAP_W = 480;
export const MAP_H = 320;

/** Ground materials (per pixel). RIM = the stone ring around a pond (walkable). */
export const M = { VOID: 0, GRASS: 1, DIRT: 2, STONE: 3, WATER: 4, HIGH: 5, FACE: 6, BACK: 7, RIM: 8 } as const;
export type Material = (typeof M)[keyof typeof M];
export const WALKABLE_MATERIALS: readonly number[] = [M.GRASS, M.DIRT, M.STONE, M.RIM];

export type PropKind = "tree" | "bigtree" | "bush" | "cottage" | "stall" | "well" | "bench" | "sign" | "lamp" | "barrel" | "crate" | "pot" | "rock" | "door" | "exit";

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
  object?: { type: "feature" | "seat" | "sign" | "plant" | "door" | "exit" | "item" | "light" | "counter"; solid: boolean; front: boolean; label: LabelKey };
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
  /** Small non-solid details in groups. */
  decor: { kind: "flowers" | "ferns" | "leaves" | "pebbles" | "reeds" | "lilies"; x: number; y: number; n: number }[];
  spawns: { x: number; y: number }[];
  /** Road centre lines (map coordinates), for ruts and worn edges. */
  roads: { x: number; y: number }[][];
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
const FACE_H = 30;

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

  // Back edge: deep woods along the top; high ground with a cliff on one side.
  const backH = (x: number) => 24 + Math.round((noise(x, 0, 36) * 12) / 2) * 2;
  const plateauRight = r.int(170, 196);
  const plateauBottom = r.int(50, 56);
  // Flagstone plaza in front of the main house, a road from one side to the bottom edge, maybe a pond in the far corner.
  const plaza = { x0: r.int(198, 208), y0: r.int(118, 124), x1: r.int(404, 414), y1: r.int(184, 192) };
  const houseX = r.int(294, 314);
  const houseBase = plaza.y0 + 6;
  const roadEast = [
    { x: W + 30, y: r.int(160, 176) },
    { x: r.int(430, 445), y: r.int(166, 176) },
    { x: plaza.x1 - 20, y: (plaza.y0 + plaza.y1) / 2 + 8 },
  ];
  const southX = r.int(240, 270);
  const roadSouth = [
    { x: southX + r.int(30, 50), y: plaza.y1 - 10 },
    { x: southX + r.int(10, 30), y: r.int(244, 262) },
    { x: southX, y: H + 30 },
  ];
  const house2 = features.houses === 2 ? { x: r.int(432, 444), base: houseBase - 12 } : null;
  const pond = features.pond ? { cx: r.int(92, 108), cy: r.int(252, 262), rx: r.int(50, 58), ry: r.int(25, 30) } : null;

  for (let by = 0; by < H; by += 2)
    for (let bx = 0; bx < W; bx += 2) {
      const x = bx + 1;
      const y = by + 1;
      const bxu = flip ? W - x : x;
      let m: Material = M.GRASS;
      const plateauEdge = plateauBottom + Math.round(((noise(bxu, 7, 24) - 0.5) * 8) / 2) * 2;
      if (y < backH(bxu)) m = M.BACK;
      else if (inRoundRect(bxu, y, -40, -40, plateauRight, plateauEdge, 30)) m = M.HIGH;
      else {
        // Plaza with a ragged edge where grass creeps over the stones.
        const ragged = (noise(bxu, y, 10) - 0.5) * 10;
        if (inRoundRect(bxu, y, plaza.x0 - ragged, plaza.y0, plaza.x1 + ragged, plaza.y1 + ragged * 0.6, 20)) m = M.STONE;
        else if (house2 && inRoundRect(bxu, y, plaza.x1 - 30, house2.base - 4, house2.x + 30, house2.base + 18, 8)) m = M.STONE;
        else {
          const wobble = (noise(bxu, y, 14) - 0.5) * 7;
          if (distToCurve(bxu, y, roadEast) < ROAD_HALF_WIDTH + wobble || distToCurve(bxu, y, roadSouth) < ROAD_HALF_WIDTH + wobble) m = M.DIRT;
        }
        if (pond) {
          const n = (noise(bxu, y, 16) - 0.5) * 0.12;
          const e = ((bxu - pond.cx) / pond.rx) ** 2 + ((y - pond.cy) / pond.ry) ** 2;
          if (e < 1 + n) m = M.WATER;
          else if (e < 1.32 + n) m = M.RIM;
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

  // Main house on the plaza's back edge (its door is added as an object when drawn).
  add({ kind: "cottage", x: houseX, base: houseBase, size: 100, object: { type: "feature", solid: true, front: false, label: "house" } });
  if (house2) add({ kind: "cottage", x: house2.x, base: house2.base, size: 72, object: { type: "feature", solid: true, front: false, label: "house2" } });
  else add({ kind: "stall", x: r.int(428, 438), base: houseBase + 8, object: { type: "counter", solid: true, front: false, label: "stall" } });

  // Woods on the high ground (background), an old gnarled tree at one side edge, a tree in a bottom corner drawn over characters.
  // A grove on the high ground: overlapping crowns, one mass rather than a row of single trees.
  for (const [tx, back] of [[10, 10], [44, 2], [80, 12], [114, 4], [150, 10]] as const)
    if (tx < plateauRight - 30) add({ kind: "tree", x: tx + r.int(-4, 4), base: plateauBottom - back - r.int(0, 3), size: r.range(1.0, 1.2), deep: true });
  if (!house2) add({ kind: "tree", x: r.int(470, 478), base: r.int(98, 108), size: 1, deep: true });
  add({ kind: "bigtree", x: r.int(14, 22), base: r.int(196, 204), size: features.trees === "few" ? 0.95 : 1.08 });
  if (features.trees === "many") add({ kind: "tree", x: r.int(470, 478), base: r.int(236, 248), size: 1 });
  add({ kind: "tree", x: r.int(458, 468), base: r.int(332, 338), size: 1.05, object: { type: "plant", solid: true, front: true, label: "tree" } });
  // Foliage framing the bottom and side edges (outside the open ground): the scene reads as a lit glade inside the woods.
  add({ kind: "bush", x: r.int(14, 22), base: r.int(318, 322), size: 50 });
  add({ kind: "bush", x: r.int(52, 64), base: r.int(320, 324), size: 32 });
  add({ kind: "bush", x: r.int(4, 8), base: r.int(244, 252), size: 30 });
  add({ kind: "bush", x: r.int(410, 424), base: r.int(322, 326), size: 34 });
  add({ kind: "bush", x: r.int(474, 478), base: r.int(282, 290), size: 32 });
  add({ kind: "bush", x: r.int(168, 182), base: plateauBottom + FACE_H + 14, size: 24 });
  // Undergrowth at the grove's feet, so the high ground reads as woodland.
  for (const ux of [28, 98]) if (ux < plateauRight - 40) add({ kind: "bush", x: ux + r.int(-4, 4), base: plateauBottom - 2, size: 30 });

  // Props on open ground: a well on the plaza, a bench by the pond (or on the green), a signpost by the road, a lamp at the junction.
  if (features.well) add({ kind: "well", x: plaza.x0 + r.int(34, 42), base: plaza.y1 - r.int(16, 20), object: { type: "feature", solid: true, front: true, label: "well" } });
  const benchSpot = pond ? { x: pond.cx + pond.rx + r.int(30, 36), y: pond.cy - r.int(16, 22) } : { x: r.int(120, 150), y: r.int(222, 240) };
  add({ kind: "bench", x: benchSpot.x, base: benchSpot.y, object: { type: "seat", solid: true, front: false, label: "bench" } });
  add({ kind: "sign", x: r.int(428, 440), base: roadEast[1].y + ROAD_HALF_WIDTH + r.int(20, 26), object: { type: "sign", solid: true, front: false, label: "sign" } });
  add({ kind: "lamp", x: southX + r.int(64, 72), base: plaza.y1 + r.int(16, 22), object: { type: "light", solid: true, front: false, label: "lamp" } });
  // One cluster of barrels, pots and a crate beside the house.
  const side = houseX - 70;
  add({ kind: "barrel", x: side, base: houseBase + 2 });
  add({ kind: "pot", x: side + 13, base: houseBase + 5 });
  add({ kind: "crate", x: side - 6, base: houseBase + 12 });
  // Mossy boulders at the cliff foot and by the water.
  add({ kind: "rock", x: r.int(108, 140), base: plateauBottom + FACE_H + r.int(10, 14), size: 18 });
  if (pond) add({ kind: "rock", x: pond.cx - pond.rx - r.int(2, 6), base: pond.cy + pond.ry + 2, size: 14 });

  // Exits where the roads leave the map.
  add({ kind: "exit", x: W - 8, base: Math.round(bez(0.06, roadEast[0].y, roadEast[1].y, roadEast[2].y)) + 8, object: { type: "exit", solid: false, front: false, label: "roadEast" } });
  add({ kind: "exit", x: southX + 4, base: H - 2, object: { type: "exit", solid: false, front: false, label: "roadSouth" } });

  // Decoration in groups, near edges and landmarks (never spread evenly).
  const groups: [Blueprint["decor"][number]["kind"], number, number, number][] = [
    ["ferns", r.int(70, 140), plateauBottom + FACE_H + r.int(12, 20), 6],
    ["ferns", r.int(340, 390), r.int(236, 270), 5],
    ["ferns", r.int(60, 110), r.int(205, 215), 4],
    ["leaves", southX + 18, r.int(236, 290), 7],
    ["leaves", r.int(440, 466), roadEast[1].y + 4, 5],
    ["pebbles", southX + 6, r.int(280, 306), 4],
  ];
  if (features.flowers) {
    groups.push(["flowers", r.int(40, 100), plateauBottom + FACE_H + r.int(18, 26), 6]);
    groups.push(["flowers", r.int(410, 450), r.int(262, 292), 6]);
  }
  if (pond) {
    groups.push(["reeds", pond.cx - pond.rx + 6, pond.cy - pond.ry + 2, 4]);
    groups.push(["reeds", pond.cx + pond.rx - 10, pond.cy + pond.ry - 8, 4]);
    groups.push(["lilies", pond.cx + r.int(-12, 14), pond.cy + r.int(-2, 8), 4]);
  }
  for (const [kind, x, y, count] of groups) decor.push({ kind, x: X(x), y, n: count });

  const spawns = [
    { x: X(houseX - 30), y: houseBase + 34 },
    { x: X(houseX + 20), y: houseBase + 42 },
    { x: X(houseX - 60), y: plaza.y1 + 24 },
    { x: X(houseX + 64), y: plaza.y1 - 8 },
  ];

  const roads = [roadEast, roadSouth].map((pts) => pts.map((q) => ({ x: X(q.x), y: q.y })));
  return { w: W, h: H, seed, flip, features, mat, blocked, props, decor, spawns, roads };
}

// ---------------------------------------------------------------- painting helpers

/** `cover`: 1 where an object is drawn, 2 where an object drawn over characters is (per pixel). */
type Painted = { canvas: Canvas; props: Placed[]; cover: Uint8Array };

const hash = (x: number, y: number, s = 0) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const tones = new WeakMap<Palette, { shade: (c: RGB) => RGB; light: (c: RGB) => RGB }>();
function toneFns(p: Palette) {
  let t = tones.get(p);
  if (!t) tones.set(p, (t = { shade: shadeFor(p), light: lightFor(p) }));
  return t;
}
const shadeAt = (cv: Canvas, x: number, y: number, p: Palette) => cv.inside(x, y) && cv.set(x, y, toneFns(p).shade(cv.get(x, y)));
const lightAt = (cv: Canvas, x: number, y: number, p: Palette) => cv.inside(x, y) && cv.set(x, y, toneFns(p).light(cv.get(x, y)));

/**
 * Hand-drawn little stamps (ASCII): each character is a tone index into the
 * ramp passed when stamping ('.' = leave the pixel alone).
 */
const STAMPS = {
  fern: ["..3...3..", ".323.323.", "..2323...", ".3.22..3.", "323.2.323", ".2..1..2.", "....1...."],
  sprig: ["3.3", "232", ".1."],
  leafClump: ["..3.3..", ".34343.", "3443432", "1233321", ".11.11."],
  dark: [".1.1.", "10101", ".000."],
  tuft: ["4..4", "34.3", "2332"],
  // Relative marks: '-' one tone darker than the ground under it, '+' one tone lighter.
  blade: ["-.-", ".-."],
  tuftRel: ["+..+.", "-+.+-", ".---."],
} as const;

function stampRel(cv: Canvas, x: number, y: number, art: readonly string[], p: Palette, ok: (x: number, y: number) => boolean) {
  const t = toneFns(p);
  for (let j = 0; j < art.length; j++)
    for (let i = 0; i < art[j].length; i++) {
      const ch = art[j][i];
      if (ch === "." || !ok(x + i, y + j)) continue;
      cv.set(x + i, y + j, ch === "-" ? t.shade(cv.get(x + i, y + j)) : t.light(cv.get(x + i, y + j)));
    }
}

function stampArt(cv: Canvas, x: number, y: number, art: readonly string[], ramp: RGB[], ok: (x: number, y: number) => boolean) {
  for (let j = 0; j < art.length; j++)
    for (let i = 0; i < art[j].length; i++) {
      const ch = art[j][i];
      if (ch === ".") continue;
      const px = x + i;
      const py = y + j;
      if (!ok(px, py)) continue;
      cv.set(px, py, ramp[Math.min(ramp.length - 1, Number(ch))]);
    }
}

// ---------------------------------------------------------------- terrain

function paintGround(cv: Canvas, bp: Blueprint, p: Palette) {
  const { w, h, mat } = bp;
  const noise = valueNoise(bp.seed ^ 0x5bd1e995);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : mat[y * w + x]);
  const sunAt = (x: number, y: number) => {
    const centre = 1 - Math.min(1, Math.hypot((x - w * 0.55) / (w * 0.6), (y - h * 0.58) / (h * 0.62)));
    return noise(x, y, 64) * 0.6 + noise(x, y, 22) * 0.2 + centre * 0.35;
  };
  const tone = grassClumps(bp, sunAt);
  const clumpTone = (x: number, y: number) => tone[y * w + x];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const m = mat[y * w + x];
      const bx = x & ~1;
      const by = y & ~1;
      // Sunlight: big soft pools of light on the ground, brighter toward the middle of the map.
      const centre = 1 - Math.min(1, Math.hypot((x - w * 0.55) / (w * 0.6), (y - h * 0.58) / (h * 0.62)));
      const sun = noise(bx, by, 64) * 0.6 + noise(bx, by, 22) * 0.2 + centre * 0.35;
      let c: RGB;
      switch (m) {
        case M.GRASS:
          c = p.grass[clumpTone(x, y)];
          break;
        case M.DIRT:
          c = roadPixel(x, y, bp, p, sun);
          break;
        case M.STONE:
          c = flagstone(x, y, bp, p, at, sun);
          break;
        case M.RIM:
          c = rimStone(x, y, bp, p, at);
          break;
        case M.WATER:
          c = waterPixel(x, y, p, at, noise(bx, by, 12));
          break;
        case M.HIGH:
          c = p.grass[Math.max(1, clumpTone(x, y) - 1)];
          break;
        case M.FACE:
          c = cliffPixel(x, y, p, at);
          break;
        case M.BACK:
          c = y < 10 ? p.deepwood[0] : p.deepwood[1];
          break;
        default:
          c = p.grass[3];
      }
      cv.set(x, y, c);
    }
  leafyEdges(cv, bp, p);
}

/**
 * Grass as a carpet of overlapping rounded clumps (like the references'
 * foliage), not flat colour fields. Each clump takes one tone from the light
 * at its centre; clumps lower on the map overlap the ones behind them, so the
 * borders between light and shade are scalloped. A lighter clump gets a
 * sunlit lip, and the ground just below a lighter clump a dark crescent.
 * Returns a grass-ramp index per pixel.
 */
function grassClumps(bp: Blueprint, sunAt: (x: number, y: number) => number): Uint8Array {
  const { w, h } = bp;
  const base = new Uint8Array(w * h).fill(3);
  const id = new Int32Array(w * h).fill(-1);
  let n = 0;
  for (let row = -1; row * 5 < h + 6; row++) {
    const cy0 = row * 5;
    for (let col = -1; col * 10 < w + 10; col++) {
      const cx = col * 10 + (row % 2 ? 5 : 0) + Math.floor(hash(col, row, bp.seed) * 5) - 2;
      const cy = cy0 + Math.floor(hash(row, col, bp.seed + 3) * 3) - 1;
      const rx = 6 + hash(col, row, bp.seed + 5) * 2.5;
      const ry = 4 + hash(col, row, bp.seed + 7) * 1.2;
      const sun = sunAt(cx, cy);
      const t = sun > 0.7 ? 4 : sun > 0.44 ? 3 : 2;
      const me = n++;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const nx = (x + 0.5 - cx) / rx;
          const ny = (y + 0.5 - cy) / ry;
          if (nx * nx + ny * ny > 1) continue;
          base[y * w + x] = t;
          id[y * w + x] = me;
        }
    }
  }
  const out = new Uint8Array(base);
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const up = i - w;
      if (id[up] === id[i]) continue;
      if (base[up] > base[i]) {
        out[i] = Math.max(1, base[i] - 1);
        if (y + 1 < h && id[i + w] === id[i] && hash(x >> 1, y, 11) < 0.5) out[i + w] = Math.max(1, base[i] - 1);
      } else if (base[up] < base[i]) out[i] = Math.min(5, base[i] + 1);
    }
  return out;
}

/** A worn road: two wheel ruts, darker worn edges under the grass, a few stones pressed into the dirt. */
function roadPixel(x: number, y: number, bp: Blueprint, p: Palette, sun: number): RGB {
  let d = 99;
  for (const r of bp.roads) d = Math.min(d, distToCurve(x, y, r));
  const v = hash(x >> 1, y >> 1, bp.seed + 13);
  let t = sun > 0.66 ? 4 : sun > 0.36 ? 3 : 2;
  if (d > ROAD_HALF_WIDTH - 4) t -= 1;
  else if (Math.abs(d - 9) < 1.6) t -= 1;
  else if (d < 4 && t < 4) t += 0;
  // Stones pressed into the dirt (2×2 with a lit top and a dark foot).
  const sx = x - (x % 9);
  const sy = y - (y % 7);
  if (hash(sx, sy, bp.seed + 17) < 0.12) {
    const ox = sx + 2 + Math.floor(hash(sx, sy, 19) * 4);
    const oy = sy + 2 + Math.floor(hash(sx, sy, 23) * 3);
    if (x >= ox && x < ox + 3 && y === oy) return p.stone[4];
    if (x >= ox && x < ox + 3 && y === oy + 1) return p.stone[2];
    if (x >= ox && x < ox + 3 && y === oy + 2) return p.dirt[1];
  }
  if (v < 0.05) t -= 1;
  return p.dirt[Math.max(1, Math.min(4, t))];
}

/**
 * Where grass meets road, plaza or rim it hangs over in rounded leafy lobes,
 * with a dark line of shade under each lobe: the ground reads as layered
 * and handmade, not as two flat colours touching.
 */
function leafyEdges(cv: Canvas, bp: Blueprint, p: Palette) {
  const { w, h, mat } = bp;
  const isLow = (m: number) => m === M.DIRT || m === M.STONE || m === M.RIM;
  for (let y = 1; y < h - 3; y++)
    for (let x = 1; x < w - 1; x++) {
      if (mat[y * w + x] !== M.GRASS) continue;
      // Grass above a low surface: lobes hang down 1–3 px, shade under them.
      if (isLow(mat[(y + 1) * w + x])) {
        const lobe = Math.round(1 + 1.6 * (0.5 + 0.5 * Math.sin(x * 0.7 + hash(x >> 2, y, bp.seed) * 3)));
        for (let k = 1; k <= lobe; k++) if (isLow(mat[(y + k) * w + x])) cv.set(x, y + k, k === lobe ? p.grass[2] : p.grass[3]);
        if (isLow(mat[(y + lobe + 1) * w + x])) shadeAt(cv, x, y + lobe + 1, p);
        cv.set(x, y, p.grass[4]);
      }
      // Grass below a low surface: a lit lip and a dark edge on the low side.
      if (isLow(mat[(y - 1) * w + x])) {
        cv.set(x, y, p.grass[4]);
        shadeAt(cv, x, y - 1, p);
      }
      // Sides.
      if (isLow(mat[y * w + x - 1]) || isLow(mat[y * w + x + 1])) cv.set(x, y, p.grass[2]);
    }
}

/**
 * Irregular stones (jittered cells): which stone a pixel is on, and whether it
 * sits on a seam. Used for flagstones and the cliff's boulders.
 */
function cellAt(x: number, y: number, cw: number, ch: number, seed: number) {
  const gx = Math.floor(x / cw);
  const gy = Math.floor(y / ch);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let j = gy - 1; j <= gy + 1; j++)
    for (let i = gx - 1; i <= gx + 1; i++) {
      const px = (i + 0.2 + hash(i, j, seed) * 0.6) * cw;
      const py = (j + 0.2 + hash(j, i, seed + 1) * 0.6) * ch;
      const d = Math.hypot((x - px) / cw, (y - py) / ch);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = (i * 7919 + j * 104729) | 0;
      } else if (d < d2) d2 = d;
    }
  return { id, gap: d2 - d1 };
}

function flagstone(x: number, y: number, bp: Blueprint, p: Palette, at: (x: number, y: number) => number, sun: number): RGB {
  const cw = 15;
  const ch = 10;
  const seam = (xx: number, yy: number) => cellAt(xx, yy, cw, ch, bp.seed).gap < 0.12;
  const here = cellAt(x, y, cw, ch, bp.seed);
  const v = hash(here.id, 1, bp.seed);
  // Moss creeping in near the plaza edge, in the seams and on a few stones.
  let edge = 99;
  for (let d = 1; d <= 6 && edge === 99; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if (at(x + dx, y + dy) !== M.STONE && at(x + dx, y + dy) !== -1) edge = d;
  if (here.gap < 0.12) return edge < 5 && hash(x >> 1, y >> 1, 3) < 0.6 ? p.moss[2] : p.stone[1];
  if (edge < 3 && hash(x >> 1, y >> 1, bp.seed) < 0.55) return hash(x, y, 9) < 0.5 ? p.moss[3] : p.moss[2];
  // Each stone is a little slab: a lit upper-left lip, a shaded lower-right edge.
  if (seam(x - 1, y - 1)) return sun > 0.5 ? p.stone[5] : p.stone[4];
  if (seam(x + 1, y + 1) || seam(x, y + 2)) return p.stone[2];
  const base = v < 0.2 ? p.stone[2] : v > 0.82 ? p.stone[4] : p.stone[3];
  // A crack on a few stones.
  if (v > 0.93 && Math.abs(((x * 3 + y * 5) % 11) - 5) < 0.6) return p.stone[1];
  return base;
}

function rimStone(x: number, y: number, bp: Blueprint, p: Palette, at: (x: number, y: number) => number): RGB {
  // Rounded blocks around the pond; the side facing the water shows its face.
  const nearWaterBelow = at(x, y + 1) === M.WATER || at(x, y + 2) === M.WATER;
  const k = Math.floor((x + (y >> 2) * 3) / 7);
  const xx = (x + (y >> 2) * 3) % 7;
  if (xx === 6) return p.rock[1];
  if (nearWaterBelow) return at(x, y + 1) === M.WATER ? p.stone[1] : p.stone[2];
  if (at(x, y - 1) !== M.RIM && at(x, y - 1) !== M.WATER) return p.stone[5];
  return hash(k, y >> 2, bp.seed) < 0.3 ? p.stone[3] : p.stone[4];
}

function waterPixel(x: number, y: number, p: Palette, at: (x: number, y: number) => number, n: number): RGB {
  let above = 0;
  while (above < 6 && at(x, y - above - 1) === M.WATER) above++;
  // Shade under the far rim, then deep water, ripples and a light near shore.
  if (above < 2) return p.water[0];
  if (above < 5) return p.water[1];
  if (at(x, y + 1) !== M.WATER || at(x, y + 2) !== M.WATER) return p.water[4];
  if (at(x - 1, y) !== M.WATER || at(x + 1, y) !== M.WATER) return p.water[2];
  const ripple = (y >> 1) % 4 === 0 && ((x >> 2) * 5 + (y >> 1) * 3) % 9 < 2;
  if (ripple && n > 0.4) return p.water[4];
  return n > 0.62 ? p.water[3] : p.water[2];
}

/** Big chunky rock blocks on a cliff face: lit top facets, dark seams, moss and hanging vines. */
function cliffPixel(x: number, y: number, p: Palette, at: (x: number, y: number) => number): RGB {
  let t = 0;
  while (at(x, y - t - 1) === M.FACE) t++;
  let left = 0;
  while (at(x, y + left + 1) === M.FACE) left++;
  const drip = hash(x, 0, 5);
  // Grass lip over the top, with drips; vines hang from some columns.
  if (t === 0) return p.grass[4];
  if (t === 1) return p.grass[3];
  if (t === 2) return drip < 0.6 ? p.grass[2] : p.moss[1];
  if (t < 3 + Math.floor(drip * 4) && drip > 0.75) return p.moss[2];
  const vine = hash(x >> 1, 1, 9) < 0.08 && t < 3 + Math.floor(hash(x >> 1, 2, 9) * 22);
  if (vine) return (y + x) % 3 === 0 ? p.moss[3] : p.moss[1];
  if (left <= 1) return p.outline;
  // Big rounded boulders stacked in the face: lit upper-left facets, dark seams, deep shade at the foot.
  const seam = (xx: number, yy: number) => cellAt(xx, yy, 18, 11, 77).gap < 0.13;
  if (seam(x, y)) return t > 3 && left > 2 ? p.rock[0] : p.outline;
  if (seam(x - 1, y - 1) || seam(x, y - 1)) return p.rock[4];
  if (seam(x - 2, y - 2)) return p.rock[3];
  if (seam(x + 1, y + 1) || seam(x, y + 2)) return p.rock[1];
  if (left < 6) return p.rock[1];
  return hash(cellAt(x, y, 18, 11, 77).id, 2, 5) < 0.3 ? p.rock[3] : p.rock[2];
}

/** The deep woods along the top: layers of big dark canopies with a few trunks showing at their foot. */
function paintBackWoods(cv: Canvas, bp: Blueprint, p: Palette, r: Rng) {
  const { w, h, mat } = bp;
  const isBark = (c: RGB) => p.bark.some((b) => b[0] === c[0] && b[1] === c[1] && b[2] === c[2]);
  const bottom: number[] = [];
  for (let x = 0; x < w; x++) {
    let b = -1;
    for (let y = 0; y < h && y < 90; y++) if (mat[y * w + x] === M.BACK) b = y;
    bottom.push(b);
  }
  // Trunks at the foot of the woods.
  for (let x = 6; x < w; x += r.int(40, 70)) {
    if (bottom[x] < 0) continue;
    const tw = r.int(5, 8);
    for (let y = bottom[x] - 14; y <= bottom[x] + 2; y++)
      for (let k = 0; k < tw; k++) if (cv.inside(x + k, y) && mat[y * w + x + k] === M.BACK) cv.set(x + k, y, k === 0 ? p.bark[2] : k === tw - 1 ? p.deepwood[0] : p.bark[1]);
  }
  for (const layer of [2, 1, 0]) {
    for (let x = -14 + layer * 11; x < w + 20; x += r.int(18, 28)) {
      const bx = Math.max(0, Math.min(w - 1, x));
      if (bottom[bx] < 0) continue;
      const rad = r.int(14, 22);
      const s = new Sprite(rad * 3, rad * 2 + 6);
      const c = Math.round(rad * 1.5);
      art.canopy(s, p, [{ x: c, y: rad + 2, r: rad }, { x: c - rad * 0.6, y: rad + 6, r: rad * 0.6 }, { x: c + rad * 0.6, y: rad + 5, r: rad * 0.62 }], r.int(0, 9999), { ramp: layer === 0 ? p.leaf : p.deepwood, bias: layer === 0 ? -0.35 : 0.25 - layer * 0.2 });
      s.ox = x - c;
      s.oy = bottom[bx] - rad * 2 - 2 - layer * 10 + r.int(-3, 3);
      stamp(cv, s, s.outline(p.outline));
    }
  }
  // Deep shade in the understory between the trunks.
  for (let x = 0; x < w; x++) {
    const b = bottom[x];
    if (b < 0) continue;
    for (let y = b - 6; y <= b; y++) if (y >= 0 && mat[y * w + x] === M.BACK && !isBark(cv.get(x, y))) cv.set(x, y, y > b - 2 ? p.deepwood[0] : p.deepwood[1]);
  }
  // Shade cast by the woods onto the ground just below.
  for (let x = 0; x < w; x++) {
    const b = bottom[x];
    if (b < 0) continue;
    for (let k = 1; k <= 6; k++) if (WALKABLE_MATERIALS.includes(mat[(b + k) * w + x]) && (k < 5 || (x >> 1) % 2 === 0)) shadeAt(cv, x, b + k, p);
  }
}

/** Ground details in groups: ferns, sprigs, fallen leaves, pebbles, flowers, reeds, lilies. */
function paintDecor(cv: Canvas, bp: Blueprint, p: Palette, r: Rng) {
  const on = (ms: number[]) => (x: number, y: number) => cv.inside(x, y) && ms.includes(bp.mat[y * bp.w + x]);
  const grass = on([M.GRASS, M.HIGH]);
  // Background texture first: leaf clusters across the grass, dense in some places and absent in others.
  const noise = valueNoise(bp.seed ^ 0x2545f491);
  for (let y = 2; y < bp.h - 6; y += 7)
    for (let x = 2; x < bp.w - 6; x += 7) {
      if (!grass(x, y) || !grass(x + 5, y + 4)) continue;
      const dense = noise(x, y, 46);
      const prob = dense > 0.6 ? 0.5 : dense > 0.45 ? 0.22 : 0.08;
      if (!r.chance(prob)) continue;
      const jx = x + r.int(0, 3);
      const jy = y + r.int(0, 3);
      const pick = r.next();
      if (dense > 0.62 && pick < 0.22) stampArt(cv, jx, jy, STAMPS.leafClump, p.moss, grass);
      else if (pick < 0.7) stampRel(cv, jx, jy, STAMPS.blade, p, grass);
      else stampRel(cv, jx, jy, STAMPS.tuftRel, p, grass);
    }
  for (const d of bp.decor) {
    for (let i = 0; i < d.n; i++) {
      const x = Math.round(d.x + r.range(-16, 16));
      const y = Math.round(d.y + r.range(-9, 9));
      if (d.kind === "ferns") stampArt(cv, x, y, STAMPS.fern, p.moss, grass);
      else if (d.kind === "flowers" && grass(x, y)) {
        const petal = r.pick([p.cloth[2], p.cloth[4], p.fallen[3], p.cloth[2]]);
        cv.set(x + 1, y + 2, p.moss[1]);
        cv.set(x + 1, y + 3, p.moss[1]);
        for (const [dx, dy] of [[1, 0], [0, 1], [2, 1], [1, 2]]) if (grass(x + dx, y + dy)) cv.set(x + dx, y + dy, petal);
        cv.set(x + 1, y + 1, p.glow[3]);
      } else if (d.kind === "leaves") {
        const dirt = on([M.DIRT, M.STONE]);
        for (let k = 0; k < 4; k++) {
          const lx = x + r.int(-6, 6);
          const ly = y + r.int(-4, 4);
          const c = r.pick(p.fallen);
          if (dirt(lx, ly)) cv.set(lx, ly, c);
          if (dirt(lx + 1, ly)) cv.set(lx + 1, ly, c);
          if (dirt(lx, ly + 1) && r.chance(0.5)) cv.set(lx, ly + 1, p.fallen[0]);
        }
      } else if (d.kind === "pebbles") {
        const dirt = on([M.DIRT]);
        if (dirt(x, y) && dirt(x + 2, y + 1)) {
          cv.set(x, y, p.stone[3]);
          cv.set(x + 1, y, p.stone[4]);
          cv.set(x, y + 1, p.dirt[1]);
          cv.set(x + 1, y + 1, p.dirt[1]);
        }
      } else if (d.kind === "reeds") {
        const ok = on([M.WATER, M.RIM, M.GRASS]);
        for (let k = 0; k < 3; k++) {
          const rx = x + k * 2;
          const tall = 6 + ((k * 5 + i) % 4);
          for (let t = 0; t < tall; t++) if (ok(rx, y + 6 - t)) cv.set(rx, y + 6 - t, t > tall - 3 ? p.grass[4] : p.moss[2]);
          if (ok(rx, y + 6 - tall)) cv.set(rx, y + 6 - tall, p.dirt[1]);
          if (ok(rx, y + 5 - tall)) cv.set(rx, y + 5 - tall, p.dirt[2]);
        }
      } else if (d.kind === "lilies") {
        const water = on([M.WATER]);
        if (!water(x, y) || !water(x + 9, y + 6) || !water(x + 4, y - 4)) continue;
        const s = new Sprite(10, 6);
        s.ellipse(5, 3, 5, 2.7, (_x, _y, nx, ny) => (nx + ny < -0.3 ? p.grass[5] : nx + ny > 0.6 ? p.moss[2] : p.grass[4]));
        s.set(6, 2, p.water[2]);
        s.set(7, 2, p.water[2]);
        s.set(6, 1, p.water[2]);
        if (i % 2 === 0) {
          s.set(3, 1, p.cloth[4]);
          s.set(4, 1, p.cloth[2]);
          s.set(3, 0, p.cloth[4]);
        }
        s.ox = x;
        s.oy = y;
        stamp(cv, s, s.outline(p.water[0]));
      }
    }
  }
}

function buildProp(pl: Placed, p: Palette, r: Rng) {
  switch (pl.kind) {
    case "bigtree":
      return art.gnarledTree(p, r, pl.size ?? 1);
    case "tree":
      return art.tree(p, r, pl.size ?? 1, pl.deep ? 1 : 0);
    case "bush":
      return art.bush(p, r, pl.size ?? 24);
    case "cottage":
      return art.cottage(p, r, pl.size ?? 100, { windows: (pl.size ?? 100) >= 90 ? 2 : 1 });
    case "stall":
      return art.stall(p, r);
    case "well":
      return art.well(p, r);
    case "bench":
      return art.bench(p);
    case "sign":
      return art.signpost(p);
    case "lamp":
      return art.lampPost(p);
    case "barrel":
      return art.barrel(p);
    case "crate":
      return art.crate(p);
    case "pot":
      return art.pot(p);
    case "rock":
      return art.rock(p, r, pl.size ?? 16);
    default:
      return null;
  }
}

/** Cast shadow: a flat solid shape at the base, pushed to the lower right (light from the upper left). */
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

/** Canopy shade on the ground with a few sunflecks breaking through. */
function canopyShade(cv: Canvas, bp: Blueprint, p: Palette, cx: number, cy: number, rx: number, ry: number, seed: number) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      if (!cv.inside(x, y)) continue;
      const a = Math.atan2(y - cy, x - cx);
      const edge = 1 + 0.12 * Math.sin(a * 5 + seed);
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (d > edge) continue;
      const m = bp.mat[y * bp.w + x];
      if (!WALKABLE_MATERIALS.includes(m) && m !== M.HIGH) continue;
      const fleck = hash(x >> 2, y >> 1, seed) < 0.06 && d < edge - 0.2;
      if (!fleck) shadeAt(cv, x, y, p);
    }
}

/** A pool of warm light around a lantern, in hard steps. */
function lightPool(cv: Canvas, bp: Blueprint, p: Palette, cx: number, cy: number, rad: number) {
  for (let y = Math.floor(cy - rad * 0.6); y <= cy + rad * 0.6; y++)
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      if (!cv.inside(x, y)) continue;
      const d = Math.hypot((x - cx) / rad, (y - cy) / (rad * 0.6));
      // Ragged, dithered rim: a glow, not a disc.
      const rim = 0.55 + hash(x >> 1, y >> 1, 31) * 0.35;
      if (d > 1 || (d > rim && (x + y) % 2 === 0) || (d > rim + 0.15 && (x * 3 + y) % 4 !== 1)) continue;
      if (!WALKABLE_MATERIALS.includes(bp.mat[y * bp.w + x])) continue;
      lightAt(cv, x, y, p);
    }
}

/** Darker edges of the frame (in hard steps along a ragged line): the middle of the map is where the light is. */
function vignette(cv: Canvas, bp: Blueprint, p: Palette) {
  const noise = valueNoise(bp.seed ^ 0x1234567);
  for (let y = 0; y < bp.h; y++)
    for (let x = 0; x < bp.w; x++) {
      const m = bp.mat[y * bp.w + x];
      if (m === M.BACK) continue;
      const e = Math.min(x, bp.w - 1 - x, (bp.h - 1 - y) * 1.3);
      const ragged = 12 + noise(x & ~3, y & ~3, 18) * 16;
      if (e < ragged) shadeAt(cv, x, y, p);
      if (e < ragged * 0.4) shadeAt(cv, x, y, p);
    }
}

export function paintVillage(bp: Blueprint, p: Palette = WESTERN_FANTASY): Painted {
  const cv = new Canvas(bp.w, bp.h);
  const r = rng(bp.seed ^ 0x9e3779b9);
  paintGround(cv, bp, p);
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
  // Light and shade on the ground first, then the woods, then everything standing, in depth order.
  for (const { pl, b } of drawn) {
    const w = b.sprite.w;
    if (pl.kind === "bigtree") canopyShade(cv, bp, p, pl.x + w * 0.16, pl.base + 4, w * 0.5, 16, bp.seed);
    else if (pl.kind === "tree" && !pl.deep) canopyShade(cv, bp, p, pl.x + 8, pl.base + 2, w * 0.42, 9, bp.seed + 1);
    else if (pl.kind === "cottage") castShadow(cv, bp, p, pl.x + 8, pl.base + 2, w * 0.52, 6);
    else if (pl.kind !== "tree") castShadow(cv, bp, p, pl.x + w * 0.2, pl.base, Math.max(5, w * 0.45), Math.max(2, w * 0.14));
    if (pl.kind === "lamp") lightPool(cv, bp, p, pl.x, pl.base + 2, 24);
    if (pl.kind === "cottage") {
      const d = props.find((q) => q.id === `door-${pl.id}`);
      if (d?.box) lightPool(cv, bp, p, d.box.x1 + 6, pl.base + 8, 18);
    }
  }
  vignette(cv, bp, p);
  paintBackWoods(cv, bp, p, r);
  drawn.sort((a, b) => a.pl.base - b.pl.base);
  const cover = new Uint8Array(bp.w * bp.h);
  for (const { pl, b } of drawn) {
    const ol = b.sprite.outline(p.outline);
    stamp(cv, b.sprite, ol);
    const f = pl.object?.front ? 2 : 1;
    const mark = (x: number, y: number) => {
      const mx = b.sprite.ox + x;
      const my = b.sprite.oy + y;
      if (mx >= 0 && my >= 0 && mx < bp.w && my < bp.h) cover[my * bp.w + mx] = Math.max(cover[my * bp.w + mx], f);
    };
    for (const [x, y] of ol) mark(x, y);
    for (let y = 0; y < b.sprite.h; y++) for (let x = 0; x < b.sprite.w; x++) if (b.sprite.px[y * b.sprite.w + x]) mark(x, y);
  }
  return { canvas: cv, props, cover };
}

// ---------------------------------------------------------------- everything together

export type LabelKey = "house" | "house2" | "door" | "door2" | "well" | "bench" | "sign" | "tree" | "roadEast" | "roadSouth" | "stall" | "lamp";

export function villageSeed(description: string, nonce: number) {
  return hashSeed(`${description.trim().toLowerCase()}#${nonce}`);
}

/** Pixels that block walking although their material is walkable: house walls and roofs, edge trees, small props' feet. */
export function markBlocked(bp: Blueprint, props: Placed[]) {
  const { w, h, blocked } = bp;
  blocked.fill(0);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) blocked[y * w + x] = 1;
  };
  for (const pl of props) {
    if (!pl.box) continue;
    if (pl.kind === "cottage") fill(pl.box.x0, pl.box.y0, pl.box.x1, pl.base + 1);
    // The old tree at the side edge is part of the woodland: no squeezing behind it, and its roots block.
    else if (pl.kind === "bigtree") fill(pl.box.x0, pl.box.y0 + 8, pl.box.x1 - 8, pl.base + 3);
    else if (pl.kind === "tree" && !pl.object && (pl.box.x0 < 4 || pl.box.x1 > w - 4)) fill(pl.box.x0, pl.box.y0 + 6, pl.box.x1, pl.base + 2);
    else if (pl.kind === "tree" && !pl.object) fill(pl.box.x0 + 4, pl.base - 12, pl.box.x1 - 4, pl.base + 2);
    else if (pl.kind === "bush" && (pl.box.x0 < 4 || pl.box.x1 > w - 4 || pl.box.y1 > h - 4)) fill(pl.box.x0, pl.box.y0 + 2, pl.box.x1, pl.box.y1);
    else if (pl.kind === "bush" || pl.kind === "barrel" || pl.kind === "crate" || pl.kind === "rock" || pl.kind === "pot") fill(pl.box.x0, pl.base - Math.min(8, pl.box.y1 - pl.box.y0), pl.box.x1, pl.base + 1);
  }
}
