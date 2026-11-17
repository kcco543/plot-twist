/**
 * SCENE KINDS — one map kit, six kinds of place, one visual language.
 * --------------------------------------------------------------------------
 * The player's words (English or Chinese) and the place type pick a scene
 * kind and a biome. Every kind is planned on the same 480×320 blueprint
 * (materials per pixel + props + decor groups) and painted by the SAME
 * renderer (village.ts → paintVillage): same camera, same light from the
 * upper left, same ramp structure, same outline, same ground treatment.
 * A biome only swaps the hue of some ramps (palette.ts), so a desert or an
 * enchanted glade still belongs to the same game as the village.
 *
 * Every kind follows the same readability plan (PIXEL_ART_STYLE_GUIDE.md §11):
 * obstacles along the edges, one big connected open area, a path 46 px wide
 * to a side edge and to the bottom edge, 3–7 props on open ground, decoration
 * in a few groups. index.ts checks the result before it is used.
 */
import { rng, valueNoise, type Rng } from "./canvas";
import type { Biome } from "./palette";
import {
  M,
  MAP_H,
  MAP_W,
  ROAD_HALF_WIDTH,
  FACE_H,
  WALKABLE_MATERIALS,
  addCliffFaces,
  addLedges,
  bez,
  distToCurve,
  featuresFrom,
  has,
  inRoundRect,
  planVillage,
  type Blueprint,
  type DecorKind,
  type Features,
  type Material,
  type Placed,
  type SceneKind,
} from "./village";
import type { EnvironmentTypeId } from "../types";

export const SCENE_KINDS: SceneKind[] = ["village", "forest", "riverbank", "ruins", "desert", "glade"];

const WORDS = {
  ruins: ["ruin", "ancient", "temple", "column", "pillar", "archway", "abandoned", "forgotten", "遗迹", "废墟", "古迹", "神殿", "石柱", "拱门", "遗址"],
  riverbank: ["river", "stream", "creek", "bridge", "brook", "ford", "河", "溪", "桥"],
  desert: ["desert", "sand", "dune", "oasis", "cactus", "arid", "canyon", "mesa", "沙漠", "沙丘", "绿洲", "戈壁", "荒漠"],
  glade: ["magic", "enchant", "fairy", "fae", "mystic", "spirit", "rune", "glowing", "standing stone", "moonlit", "clearing", "魔法", "魔幻", "精灵", "仙", "神秘", "符文", "发光", "妖精", "空地"],
  forest: ["forest", "woods", "woodland", "trail", "grove", "thicket", "path through", "森林", "树林", "林间", "小径"],
  village: ["village", "town", "square", "market", "street", "cottage", "house", "村", "镇", "广场", "集市", "街", "小屋"],
} as const;

/** Which kind of place a description asks for (the place type decides when the words don't). */
export function sceneKindFor(description: string, type: EnvironmentTypeId): SceneKind {
  const t = description.toLowerCase();
  if (has(t, [...WORDS.ruins]) || (type === "ruins" && !has(t, [...WORDS.village]))) return "ruins";
  if (has(t, [...WORDS.riverbank])) return "riverbank";
  if (has(t, [...WORDS.desert])) return "desert";
  if (has(t, [...WORDS.glade]) && !has(t, [...WORDS.village])) return "glade";
  if (has(t, [...WORDS.forest]) && !has(t, [...WORDS.village])) return "forest";
  if (has(t, [...WORDS.village])) return "village";
  return type === "wilderness" ? "forest" : type === "ruins" ? "ruins" : "village";
}

/** Biome from words: a desert village or enchanted ruins keep the kind's layout with the biome's ramps. */
export function biomeFor(description: string, kind: SceneKind): Biome {
  if (kind === "desert") return "arid";
  if (kind === "glade") return "enchanted";
  const t = description.toLowerCase();
  if (has(t, [...WORDS.desert])) return "arid";
  if (has(t, ["magic", "enchant", "fairy", "mystic", "glowing", "rune", "魔法", "魔幻", "精灵", "仙", "神秘", "发光"])) return "enchanted";
  return "temperate";
}

// ---------------------------------------------------------------- shared planning helpers

type Ctx = {
  r: Rng;
  W: number;
  H: number;
  flip: boolean;
  X: (x: number) => number;
  noise: (x: number, y: number, cell: number) => number;
  mat: Uint8Array;
  props: Placed[];
  decor: Blueprint["decor"];
  features: Features;
  add: (p: Omit<Placed, "id">) => void;
  dec: (kind: DecorKind, x: number, y: number, n: number) => void;
};

function begin(description: string, seed: number): Ctx {
  const r = rng(seed);
  const features = featuresFrom(description, r);
  const flip = r.chance(0.5);
  const W = MAP_W;
  const H = MAP_H;
  const X = (x: number) => (flip ? W - x : x);
  const props: Placed[] = [];
  const decor: Blueprint["decor"] = [];
  let n = 0;
  return {
    r,
    W,
    H,
    flip,
    X,
    noise: valueNoise(seed),
    mat: new Uint8Array(W * H).fill(M.GRASS),
    props,
    decor,
    features,
    add: (p) => props.push({ ...p, id: `${p.kind}-${++n}`, x: X(p.x) }),
    dec: (kind, x, y, count) => decor.push({ kind, x: X(x), y, n: count }),
  };
}

/** Fill the material map from a function of UNFLIPPED coordinates, in 2×2 blocks (clusters, not single pixels). */
function raster(c: Ctx, f: (x: number, y: number) => Material) {
  for (let by = 0; by < c.H; by += 2)
    for (let bx = 0; bx < c.W; bx += 2) {
      const x = bx + 1;
      const y = by + 1;
      const m = f(c.flip ? c.W - x : x, y);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) c.mat[(by + dy) * c.W + bx + dx] = m;
    }
}

const backEdge = (c: Ctx, base: number, amp: number) => (x: number) => base + Math.round((c.noise(x, 0, 36) * amp) / 2) * 2;

/** A road band around a curve, with a slightly wobbly edge. */
const onRoad = (c: Ctx, x: number, y: number, curves: { x: number; y: number }[][]) => {
  const wobble = (c.noise(x, y, 14) - 0.5) * 7;
  return curves.some((pts) => distToCurve(x, y, pts) < ROAD_HALF_WIDTH + wobble);
};

/** Exits where the paths leave the map (index.ts turns them into edge strips). */
function exits(c: Ctx, east: { x: number; y: number }[], southX: number) {
  c.add({ kind: "exit", x: c.W - 8, base: Math.round(bez(0.06, east[0].y, east[1].y, east[2].y)) + 8, object: { type: "exit", solid: false, front: false, label: "roadEast" } });
  c.add({ kind: "exit", x: southX + 4, base: c.H - 2, object: { type: "exit", solid: false, front: false, label: "roadSouth" } });
}

/** The grove on high ground along the top (one mass of overlapping crowns, with undergrowth). */
function grove(c: Ctx, x0: number, x1: number, bottom: number) {
  for (let tx = x0 + 10; tx < x1 - 24; tx += 34 + c.r.int(0, 4)) c.add({ kind: "tree", x: tx + c.r.int(-4, 4), base: bottom - c.r.int(2, 12), size: c.r.range(1.0, 1.2), deep: true });
  for (let ux = x0 + 28; ux < x1 - 36; ux += 70) c.add({ kind: "bush", x: ux + c.r.int(-4, 4), base: bottom - 2, size: 30 });
}

/** Foliage framing the bottom and side edges, outside the open ground. */
function frame(c: Ctx, opts: { left?: boolean; right?: boolean } = {}) {
  c.add({ kind: "bush", x: c.r.int(14, 22), base: c.r.int(318, 322), size: 50 });
  c.add({ kind: "bush", x: c.r.int(52, 64), base: c.r.int(320, 324), size: 32 });
  if (opts.left !== false) c.add({ kind: "bush", x: c.r.int(4, 8), base: c.r.int(244, 252), size: 30 });
  c.add({ kind: "bush", x: c.r.int(410, 424), base: c.r.int(322, 326), size: 34 });
  if (opts.right !== false) c.add({ kind: "bush", x: c.r.int(474, 478), base: c.r.int(282, 290), size: 32 });
}

/** Four start spots on open ground near `focus`, away from props and from each other. */
function spawnsNear(c: Ctx, focus: { x: number; y: number }) {
  const ok = (x: number, y: number) => {
    for (const [dx, dy] of [[-12, -6], [12, -6], [-12, 6], [12, 6], [0, 0]]) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= c.W || py >= c.H || !WALKABLE_MATERIALS.includes(c.mat[py * c.W + px])) return false;
    }
    return true;
  };
  const cands: { x: number; y: number; d: number }[] = [];
  for (let y = 60; y < c.H - 30; y += 8) for (let x = 30; x < c.W - 30; x += 8) cands.push({ x, y, d: Math.hypot(x - c.X(focus.x), (y - focus.y) * 1.4) });
  cands.sort((a, b) => a.d - b.d);
  const chosen: { x: number; y: number }[] = [];
  for (const q of cands) {
    if (chosen.length === 4) break;
    if (!ok(q.x, q.y)) continue;
    if (c.props.some((p) => p.kind !== "exit" && Math.hypot(p.x - q.x, (p.base - q.y) * 1.3) < 34)) continue;
    if (chosen.some((s) => Math.hypot(s.x - q.x, s.y - q.y) < 30)) continue;
    chosen.push({ x: q.x, y: q.y });
  }
  return chosen;
}

function finish(c: Ctx, seed: number, kind: SceneKind, biome: Biome, focus: { x: number; y: number }, roads: { x: number; y: number }[][]): Blueprint {
  return {
    w: c.W,
    h: c.H,
    seed,
    kind,
    biome,
    flip: c.flip,
    features: c.features,
    mat: c.mat,
    blocked: new Uint8Array(c.W * c.H),
    props: c.props,
    decor: c.decor,
    spawns: spawnsNear(c, focus),
    roads: roads.map((pts) => pts.map((q) => ({ x: c.X(q.x), y: q.y }))),
  };
}

// ---------------------------------------------------------------- forest path

function planForest(description: string, seed: number, biome: Biome): Blueprint {
  const c = begin(description, seed);
  const { r, W, H } = c;
  const back = backEdge(c, 30, 16);
  const pr = r.int(150, 176);
  const pb = r.int(58, 66);
  const roadSouth = [{ x: 300, y: 150 }, { x: r.int(220, 250), y: r.int(244, 258) }, { x: r.int(200, 226), y: H + 30 }];
  const roadEast = [{ x: W + 30, y: r.int(214, 232) }, { x: r.int(404, 420), y: r.int(196, 206) }, { x: 300, y: 150 }];
  const pond = c.features.pond && has(description.toLowerCase(), ["pond", "lake", "water", "池", "湖", "水"]) ? { cx: r.int(400, 420), cy: r.int(112, 118), rx: 42, ry: 20 } : null;
  raster(c, (x, y) => {
    if (y < back(x)) return M.BACK;
    if (inRoundRect(x, y, -40, -40, pr, pb + Math.round(((c.noise(x, 7, 24) - 0.5) * 8) / 2) * 2, 30)) return M.HIGH;
    if (pond) {
      const e = ((x - pond.cx) / pond.rx) ** 2 + ((y - pond.cy) / pond.ry) ** 2 - (c.noise(x, y, 16) - 0.5) * 0.12;
      if (e < 1) return M.WATER;
      if (e < 1.32) return M.RIM;
    }
    return onRoad(c, x, y, [roadSouth, roadEast]) ? M.DIRT : M.GRASS;
  });
  addCliffFaces(c.mat, W, H);
  grove(c, 0, pr, pb);
  // Big old trees crowd the sides; one crown in the bottom corner is drawn over characters.
  c.add({ kind: "bigtree", x: r.int(14, 22), base: r.int(200, 212), size: 1.1 });
  c.add({ kind: "tree", x: r.int(470, 478), base: r.int(118, 128), size: 1.1, deep: true });
  if (!pond) c.add({ kind: "tree", x: r.int(420, 440), base: r.int(84, 92), size: 1, deep: true });
  c.add({ kind: "tree", x: r.int(474, 478), base: r.int(176, 186), size: 1 });
  c.add({ kind: "tree", x: r.int(474, 478), base: r.int(250, 262), size: 1.1 });
  c.add({ kind: "tree", x: r.int(4, 10), base: r.int(282, 292), size: 1.05 });
  c.add({ kind: "bigtree", x: r.int(222, 240), base: r.int(70, 78), size: 0.95 });
  c.add({ kind: "tree", x: r.int(456, 466), base: r.int(332, 338), size: 1.05, object: { type: "plant", solid: true, front: true, label: "tree" } });
  frame(c, { right: false });
  // The forest's landmarks: a stone shrine in the clearing, a log to sit on, a signpost at the fork.
  c.add({ kind: "shrine", x: r.int(352, 372), base: r.int(146, 152), object: { type: "light", solid: true, front: false, label: "shrine" } });
  c.add({ kind: "log", x: r.int(136, 160), base: r.int(196, 206), object: { type: "seat", solid: true, front: false, label: "log" } });
  c.add({ kind: "sign", x: r.int(390, 404), base: roadEast[1].y + ROAD_HALF_WIDTH + r.int(18, 24), object: { type: "sign", solid: true, front: false, label: "sign" } });
  c.add({ kind: "stump", x: r.int(188, 200), base: pb + FACE_H + r.int(16, 22) });
  c.add({ kind: "rock", x: r.int(100, 130), base: pb + FACE_H + r.int(10, 14), size: 18 });
  c.add({ kind: "mushrooms", x: r.int(60, 80), base: r.int(284, 292) });
  c.dec("ferns", r.int(70, 140), pb + FACE_H + r.int(14, 22), 7);
  c.dec("ferns", r.int(330, 380), r.int(252, 276), 6);
  c.dec("ferns", r.int(40, 90), r.int(236, 250), 5);
  c.dec("leaves", roadSouth[1].x + 4, r.int(250, 290), 8);
  c.dec("leaves", r.int(330, 380), r.int(176, 196), 6);
  c.dec("pebbles", roadSouth[2].x + 6, r.int(286, 306), 4);
  if (c.features.flowers) c.dec("flowers", r.int(250, 320), r.int(110, 130), 6);
  if (biome === "enchanted") c.dec("fireflies", r.int(200, 300), r.int(120, 160), 6);
  if (pond) c.dec("lilies", pond.cx, pond.cy, 3);
  exits(c, roadEast, roadSouth[2].x);
  return finish(c, seed, "forest", biome, { x: 290, y: 190 }, [roadSouth, roadEast]);
}

// ---------------------------------------------------------------- riverbank

function planRiverbank(description: string, seed: number, biome: Biome): Blueprint {
  const c = begin(description, seed);
  const { r, W, H } = c;
  const back = backEdge(c, 24, 12);
  const river = [{ x: r.int(300, 320), y: -10 }, { x: r.int(270, 290), y: 170 }, { x: r.int(108, 132), y: H + 40 }];
  // Where the river crosses y≈180 is where the bridge goes.
  let bx = 0;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    if (Math.abs(bez(t, river[0].y, river[1].y, river[2].y) - 180) < 2.5) {
      bx = Math.round(bez(t, river[0].x, river[1].x, river[2].x));
      break;
    }
  }
  const half = 24;
  const bridge = { x0: bx - 48, x1: bx + 48, y0: 162, y1: 198 };
  const pr = r.int(150, 170);
  const pb = r.int(54, 60);
  const plaza = { x0: r.int(352, 362), y0: r.int(118, 124), x1: r.int(452, 464), y1: r.int(160, 168) };
  const houseX = r.int(398, 410);
  const roadEast = [{ x: W + 30, y: r.int(196, 206) }, { x: r.int(430, 440), y: r.int(186, 194) }, { x: bridge.x1 - 4, y: 180 }];
  const roadSouth = [{ x: bridge.x1 - 4, y: 182 }, { x: r.int(340, 356), y: r.int(244, 256) }, { x: r.int(356, 372), y: H + 30 }];
  const lane = [{ x: bridge.x0 + 4, y: 180 }, { x: r.int(176, 190), y: r.int(176, 184) }, { x: r.int(96, 116), y: r.int(156, 166) }];
  raster(c, (x, y) => {
    if (y < back(x)) return M.BACK;
    if (inRoundRect(x, y, -40, -40, pr, pb + Math.round(((c.noise(x, 7, 24) - 0.5) * 8) / 2) * 2, 30)) return M.HIGH;
    const d = distToCurve(x, y, river) + (c.noise(x, y, 18) - 0.5) * 6;
    const onBridge = x >= bridge.x0 && x < bridge.x1 && y >= bridge.y0 && y < bridge.y1;
    if (d < half + 7 && onBridge) return M.BRIDGE;
    if (d < half) return M.WATER;
    if (d < half + 6) return M.RIM;
    if (inRoundRect(x, y, plaza.x0, plaza.y0, plaza.x1, plaza.y1, 12)) return M.STONE;
    return onRoad(c, x, y, [roadEast, roadSouth, lane]) ? M.DIRT : M.GRASS;
  });
  addCliffFaces(c.mat, W, H);
  grove(c, 0, pr, pb);
  c.add({ kind: "cottage", x: houseX, base: plaza.y0 + 6, size: 84, object: { type: "feature", solid: true, front: false, label: "house" } });
  c.add({ kind: "barrel", x: houseX + 64, base: plaza.y0 + 4 });
  c.add({ kind: "crate", x: houseX + 72, base: plaza.y0 + 12 });
  c.add({ kind: "bench", x: r.int(110, 130), base: r.int(214, 224), object: { type: "seat", solid: true, front: false, label: "bench" } });
  c.add({ kind: "lamp", x: bridge.x0 - 8, base: bridge.y0 - 4, object: { type: "light", solid: true, front: false, label: "lamp" } });
  c.add({ kind: "sign", x: bridge.x1 + 16, base: bridge.y1 + 22, object: { type: "sign", solid: true, front: false, label: "sign" } });
  c.add({ kind: "bigtree", x: r.int(14, 20), base: r.int(232, 244), size: 1 });
  c.add({ kind: "tree", x: r.int(456, 466), base: r.int(332, 338), size: 1.05, object: { type: "plant", solid: true, front: true, label: "tree" } });
  c.add({ kind: "rock", x: river[1].x + 34, base: 130, size: 16 });
  c.add({ kind: "rock", x: bridge.x0 - 26, base: 236, size: 14 });
  frame(c);
  c.dec("reeds", river[1].x - 30, 120, 4);
  c.dec("reeds", bridge.x0 - 6, 220, 4);
  c.dec("reeds", river[2].x + 40, 290, 4);
  c.dec("lilies", river[1].x - 4, 140, 3);
  c.dec("lilies", Math.round((river[1].x + river[2].x) / 2), 250, 3);
  c.dec("ferns", r.int(60, 120), pb + FACE_H + r.int(12, 20), 6);
  c.dec("leaves", roadSouth[1].x, r.int(250, 290), 6);
  if (c.features.flowers) c.dec("flowers", r.int(410, 450), r.int(260, 292), 6);
  if (biome === "enchanted") c.dec("fireflies", bx, 230, 6);
  exits(c, roadEast, roadSouth[2].x);
  return finish(c, seed, "riverbank", biome, { x: bridge.x1 + 30, y: 210 }, [roadEast, roadSouth, lane]);
}

// ---------------------------------------------------------------- ruins

function planRuins(description: string, seed: number, biome: Biome): Blueprint {
  const c = begin(description, seed);
  const { r, W, H } = c;
  const back = backEdge(c, 26, 14);
  const pl = r.int(W - 176, W - 154);
  const pb = r.int(54, 62);
  const court = { x0: r.int(112, 124), y0: r.int(118, 124), x1: r.int(392, 404), y1: r.int(228, 238) };
  const southX = r.int(236, 262);
  const roadSouth = [{ x: southX + 10, y: court.y1 - 12 }, { x: southX + 4, y: r.int(266, 280) }, { x: southX, y: H + 30 }];
  const roadEast = [{ x: W + 30, y: r.int(206, 220) }, { x: r.int(430, 444), y: r.int(200, 210) }, { x: court.x1 - 16, y: r.int(186, 196) }];
  raster(c, (x, y) => {
    if (y < back(x)) return M.BACK;
    if (inRoundRect(x, y, pl, -40, W + 40, pb + Math.round(((c.noise(x, 7, 24) - 0.5) * 8) / 2) * 2, 30)) return M.HIGH;
    const ragged = (c.noise(x, y, 10) - 0.5) * 14;
    if (inRoundRect(x, y, court.x0 - ragged, court.y0, court.x1 + ragged, court.y1 + ragged * 0.6, 24)) return M.STONE;
    return onRoad(c, x, y, [roadSouth, roadEast]) ? M.DIRT : M.GRASS;
  });
  addCliffFaces(c.mat, W, H);
  addLedges(c.mat, W, H);
  grove(c, pl, W, pb);
  // The ruin itself along the courtyard's back edge: a tall archway between lengths of broken wall.
  const archX = r.int(196, 220);
  c.add({ kind: "arch", x: archX, base: court.y0 + 2, object: { type: "feature", solid: true, front: false, label: "arch" } });
  c.add({ kind: "ruinWall", x: archX - 74, base: court.y0, size: 66 });
  c.add({ kind: "ruinWall", x: archX + 82, base: court.y0 - 2, size: 72 });
  c.add({ kind: "column", x: court.x1 - 22, base: court.y0 + 30, object: { type: "feature", solid: true, front: false, label: "column" } });
  c.add({ kind: "brokenColumn", x: court.x0 + 14, base: court.y0 + 64 });
  c.add({ kind: "brokenColumn", x: court.x1 - 50, base: court.y1 - 6 });
  c.add({ kind: "fallenColumn", x: r.int(290, 312), base: r.int(206, 214), object: { type: "seat", solid: true, front: false, label: "fallenColumn" } });
  c.add({ kind: "sign", x: r.int(426, 438), base: roadEast[1].y + ROAD_HALF_WIDTH + r.int(18, 24), object: { type: "sign", solid: true, front: false, label: "sign" } });
  c.add({ kind: "bigtree", x: r.int(14, 22), base: r.int(196, 206), size: 1.08 });
  c.add({ kind: "tree", x: r.int(14, 24), base: r.int(332, 338), size: 1.05, object: { type: "plant", solid: true, front: true, label: "tree" } });
  c.add({ kind: "rock", x: court.x0 + 40, base: court.y1 + 14, size: 14 });
  c.add({ kind: "rock", x: pl + 20, base: pb + FACE_H + 12, size: 18 });
  frame(c, { left: false });
  c.dec("ferns", court.x0 - 6, court.y0 + 20, 5);
  c.dec("ferns", court.x1 + 16, court.y0 + 50, 5);
  c.dec("pebbles", court.x0 + 60, court.y1 - 20, 5);
  c.dec("pebbles", court.x1 - 80, court.y0 + 30, 4);
  c.dec("leaves", southX + 10, r.int(250, 290), 6);
  if (c.features.flowers || r.chance(0.6)) c.dec("flowers", r.int(330, 380), r.int(256, 286), 6);
  if (biome === "enchanted") c.dec("fireflies", archX, court.y0 + 30, 6);
  exits(c, roadEast, southX);
  return finish(c, seed, "ruins", biome, { x: 260, y: 186 }, [roadSouth, roadEast]);
}

// ---------------------------------------------------------------- desert oasis town

function planDesert(description: string, seed: number): Blueprint {
  const c = begin(description, seed);
  const { r, W, H } = c;
  const back = backEdge(c, 30, 14);
  const pr = r.int(160, 186);
  const pb = r.int(52, 58);
  const plaza = { x0: r.int(204, 214), y0: r.int(118, 124), x1: r.int(398, 408), y1: r.int(182, 190) };
  const houseX = r.int(292, 312);
  const southX = r.int(240, 266);
  const roadEast = [{ x: W + 30, y: r.int(162, 176) }, { x: r.int(430, 444), y: r.int(166, 176) }, { x: plaza.x1 - 20, y: (plaza.y0 + plaza.y1) / 2 + 8 }];
  const roadSouth = [{ x: southX + r.int(30, 46), y: plaza.y1 - 10 }, { x: southX + r.int(10, 26), y: r.int(244, 262) }, { x: southX, y: H + 30 }];
  const oasis = !has(description.toLowerCase(), ["no water", "dry", "没有水"]) ? { cx: r.int(92, 106), cy: r.int(250, 260), rx: r.int(50, 56), ry: r.int(24, 28) } : null;
  raster(c, (x, y) => {
    if (y < back(x)) return M.BACK;
    if (inRoundRect(x, y, -40, -40, pr, pb + Math.round(((c.noise(x, 7, 24) - 0.5) * 8) / 2) * 2, 30)) return M.HIGH;
    const ragged = (c.noise(x, y, 10) - 0.5) * 10;
    let m: Material = M.GRASS;
    if (inRoundRect(x, y, plaza.x0 - ragged, plaza.y0, plaza.x1 + ragged, plaza.y1 + ragged * 0.6, 18)) m = M.STONE;
    else if (onRoad(c, x, y, [roadEast, roadSouth])) m = M.DIRT;
    if (oasis) {
      const e = ((x - oasis.cx) / oasis.rx) ** 2 + ((y - oasis.cy) / oasis.ry) ** 2 - (c.noise(x, y, 16) - 0.5) * 0.12;
      if (e < 1) m = M.WATER;
      else if (e < 1.32) m = M.RIM;
    }
    return m;
  });
  addCliffFaces(c.mat, W, H);
  addLedges(c.mat, W, H);
  c.add({ kind: "cottage", x: houseX, base: plaza.y0 + 6, size: 96, object: { type: "feature", solid: true, front: false, label: "house" } });
  c.add({ kind: "stall", x: r.int(428, 438), base: plaza.y0 + 12, object: { type: "counter", solid: true, front: false, label: "stall" } });
  c.add({ kind: "well", x: plaza.x0 + r.int(30, 38), base: plaza.y1 - r.int(14, 18), object: { type: "feature", solid: true, front: true, label: "well" } });
  c.add({ kind: "sign", x: r.int(428, 440), base: roadEast[1].y + ROAD_HALF_WIDTH + r.int(20, 26), object: { type: "sign", solid: true, front: false, label: "sign" } });
  c.add({ kind: "pot", x: houseX - 64, base: plaza.y0 + 6 });
  c.add({ kind: "pot", x: houseX - 76, base: plaza.y0 + 12 });
  c.add({ kind: "barrel", x: houseX - 54, base: plaza.y0 + 14 });
  // Palms on the high ground and around the water; one in the bottom corner is drawn over characters.
  for (const tx of [26, 84, 140]) if (tx < pr - 26) c.add({ kind: "palm", x: tx + r.int(-6, 6), base: pb - r.int(0, 6), size: r.range(0.9, 1.05) });
  if (oasis) {
    c.add({ kind: "palm", x: oasis.cx - oasis.rx + 4, base: oasis.cy - oasis.ry - 4, size: 1 });
    c.add({ kind: "palm", x: oasis.cx + oasis.rx - 2, base: oasis.cy - oasis.ry + 2, size: 0.9 });
  }
  c.add({ kind: "palm", x: r.int(456, 466), base: r.int(334, 338), size: 1.1, object: { type: "plant", solid: true, front: true, label: "palm" } });
  c.add({ kind: "rock", x: r.int(110, 140), base: pb + FACE_H + r.int(10, 14), size: 18 });
  c.add({ kind: "rock", x: r.int(470, 476), base: r.int(232, 244), size: 20 });
  c.add({ kind: "rock", x: r.int(6, 12), base: r.int(300, 312), size: 22 });
  c.dec("pebbles", southX + 6, r.int(280, 306), 5);
  c.dec("pebbles", r.int(330, 380), r.int(230, 260), 4);
  c.dec("ferns", r.int(60, 120), pb + FACE_H + r.int(12, 20), 4);
  if (oasis) {
    c.dec("reeds", oasis.cx - oasis.rx + 8, oasis.cy - oasis.ry + 4, 4);
    c.dec("reeds", oasis.cx + oasis.rx - 12, oasis.cy + oasis.ry - 8, 3);
    c.dec("lilies", oasis.cx + r.int(-10, 12), oasis.cy + r.int(-2, 6), 3);
  }
  exits(c, roadEast, southX);
  return finish(c, seed, "desert", "arid", { x: houseX, y: plaza.y1 + 16 }, [roadEast, roadSouth]);
}

// ---------------------------------------------------------------- magical clearing

function planGlade(description: string, seed: number): Blueprint {
  const c = begin(description, seed);
  const { r, W, H } = c;
  const back = backEdge(c, 34, 16);
  const pl = r.int(W - 156, W - 136);
  const pb = r.int(56, 64);
  const centre = { x: r.int(236, 256), y: r.int(166, 174) };
  const roadSouth = [{ x: centre.x, y: centre.y + 24 }, { x: r.int(214, 232), y: r.int(258, 270) }, { x: r.int(200, 220), y: H + 30 }];
  const roadEast = [{ x: W + 30, y: r.int(232, 244) }, { x: r.int(396, 410), y: r.int(222, 232) }, { x: centre.x + 40, y: centre.y + 28 }];
  const pond = c.features.pond ? { cx: r.int(64, 76), cy: r.int(134, 140), rx: 38, ry: 18 } : null;
  raster(c, (x, y) => {
    if (y < back(x)) return M.BACK;
    if (inRoundRect(x, y, pl, -40, W + 40, pb + Math.round(((c.noise(x, 7, 24) - 0.5) * 8) / 2) * 2, 30)) return M.HIGH;
    if (pond) {
      const e = ((x - pond.cx) / pond.rx) ** 2 + ((y - pond.cy) / pond.ry) ** 2 - (c.noise(x, y, 16) - 0.5) * 0.12;
      if (e < 1) return M.WATER;
      if (e < 1.32) return M.RIM;
    }
    // A ring of old flagstones around the altar.
    const d = Math.hypot((x - centre.x) / 46, (y - centre.y) / 26);
    if (d < 1 + (c.noise(x, y, 8) - 0.5) * 0.25) return M.STONE;
    return onRoad(c, x, y, [roadSouth, roadEast]) ? M.DIRT : M.GRASS;
  });
  addCliffFaces(c.mat, W, H);
  grove(c, pl, W, pb);
  c.add({ kind: "shrine", x: centre.x, base: centre.y - 2, object: { type: "light", solid: true, front: false, label: "shrine" } });
  // Standing stones around the clearing (gaps between them are wide open).
  const ring: [number, number, number][] = [[-100, -16, 44], [100, -12, 40], [-80, 52, 36], [88, 58, 38]];
  ring.forEach(([dx, dy, h], i) => c.add({ kind: "stone", x: centre.x + dx, base: centre.y + dy, size: h, ...(i === 0 ? { object: { type: "feature" as const, solid: true, front: false, label: "stones" as const } } : {}) }));
  c.add({ kind: "log", x: r.int(350, 372), base: r.int(270, 282), object: { type: "seat", solid: true, front: false, label: "log" } });
  c.add({ kind: "bigtree", x: r.int(14, 22), base: r.int(214, 226), size: 1.12 });
  c.add({ kind: "tree", x: r.int(14, 24), base: r.int(102, 112), size: 1.05, deep: true });
  c.add({ kind: "tree", x: r.int(456, 466), base: r.int(332, 338), size: 1.05, object: { type: "plant", solid: true, front: true, label: "tree" } });
  c.add({ kind: "mushrooms", x: r.int(110, 130), base: r.int(244, 254) });
  c.add({ kind: "mushrooms", x: pl + 30, base: pb + FACE_H + 14 });
  c.add({ kind: "mushrooms", x: r.int(320, 340), base: r.int(110, 120) });
  frame(c);
  c.dec("fireflies", centre.x - 60, centre.y - 30, 6);
  c.dec("fireflies", centre.x + 70, centre.y + 20, 6);
  c.dec("fireflies", r.int(80, 140), r.int(230, 270), 5);
  c.dec("ferns", r.int(50, 110), r.int(180, 196), 6);
  c.dec("ferns", pl + 10, pb + FACE_H + 20, 5);
  c.dec("flowers", r.int(300, 360), r.int(120, 136), 6);
  c.dec("flowers", r.int(120, 170), r.int(276, 296), 5);
  if (pond) {
    c.dec("lilies", pond.cx, pond.cy, 3);
    c.dec("reeds", pond.cx - pond.rx + 6, pond.cy - pond.ry + 2, 3);
  }
  exits(c, roadEast, roadSouth[2].x);
  return finish(c, seed, "glade", "enchanted", { x: centre.x, y: centre.y + 40 }, [roadSouth, roadEast]);
}

// ---------------------------------------------------------------- entry point

/** Plan a map for a description and place type: the kind and biome come from the words, the variation from the seed. */
export function planScene(description: string, seed: number, type: EnvironmentTypeId = "street"): Blueprint {
  const kind = sceneKindFor(description, type);
  const biome = biomeFor(description, kind);
  switch (kind) {
    case "forest":
      return planForest(description, seed, biome);
    case "riverbank":
      return planRiverbank(description, seed, biome);
    case "ruins":
      return planRuins(description, seed, biome);
    case "desert":
      return planDesert(description, seed);
    case "glade":
      return planGlade(description, seed);
    default: {
      const bp = planVillage(description, seed);
      bp.biome = biome;
      return bp;
    }
  }
}
