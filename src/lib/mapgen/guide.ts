/**
 * GUIDED MAP ART — the layout block-out and the alignment check (pure, no DOM)
 * --------------------------------------------------------------------------
 * Trial pipeline (PIXEL_ART_STYLE_GUIDE.md §18). Gameplay and artwork are two
 * layers that share one coordinate system:
 *
 *   GAMEPLAY  the kit's plan (scenes.ts → Blueprint): walkable ground,
 *             obstacles, spawns, interactive objects, exits and foreground
 *             occlusion. It never looks at the picture.
 *   ARTWORK   the image service repaints a flat colour block-out of that SAME
 *             plan (`guideFromPlan`), so roads, plaza, water, buildings and
 *             trees are drawn where the plan says they are. The result is
 *             snapped onto the 480×320 pixel grid like every generated map.
 *
 * `checkAlignment` then measures how well the picture kept to the plan: the
 * share of walkable floor that still LOOKS like ground (nothing painted over
 * a road), and the share of solid objects that look like objects (nothing
 * left out). It is a colour heuristic, not a guarantee; the overlay in the
 * Map Lab shows exactly which cells disagree.
 */
import type { Img } from "../sprites/pixelize";
import { blank } from "../sprites/pixelize";
import type { SceneLayout } from "../scene/layout";
import { M, WALKABLE_MATERIALS, type Blueprint, type Placed } from "./village";

/** What each flat colour in the block-out stands for (sent to the image service with the block-out). */
export const GUIDE_LEGEND: { id: number; hex: string; meaning: string }[] = [
  { id: M.GRASS, hex: "#6fa84a", meaning: "open grass (walkable)" },
  { id: M.DIRT, hex: "#b98a55", meaning: "a wide packed-dirt road or path (walkable)" },
  { id: M.STONE, hex: "#cfc4aa", meaning: "a paved flagstone or cobblestone square (walkable)" },
  { id: M.WATER, hex: "#3a8cc6", meaning: "water (not walkable)" },
  { id: M.HIGH, hex: "#4c7a36", meaning: "raised ground behind a cliff or retaining wall (not walkable)" },
  { id: M.FACE, hex: "#776d60", meaning: "the vertical front face of a cliff or stone retaining wall" },
  { id: M.BACK, hex: "#2c552a", meaning: "dense woodland at the edge of the map (not walkable)" },
  { id: M.RIM, hex: "#a9a395", meaning: "a stone rim or bank beside water (walkable)" },
  { id: M.BRIDGE, hex: "#8a5a32", meaning: "a wooden bridge (walkable)" },
  { id: M.LEDGE, hex: "#958b78", meaning: "a low stone ledge (not walkable)" },
  { id: M.STEPS, hex: "#b3a891", meaning: "stone steps (walkable)" },
  { id: 20, hex: "#e6d9bb", meaning: "the front and side walls of a building, with its door (dark brown)" },
  { id: 21, hex: "#b4503a", meaning: "a building's roof, seen from above at an angle" },
  { id: 29, hex: "#b9a782", meaning: "the shaded side wall of a building (the building is seen from the front-left, three-quarter view)" },
  { id: 22, hex: "#3b7431", meaning: "a tree canopy (the trunk below it is brown)" },
  { id: 23, hex: "#4f8c3d", meaning: "a bush" },
  { id: 24, hex: "#9c978c", meaning: "a stone object (well, rock, column, standing stone, ruined wall)" },
  { id: 25, hex: "#94653a", meaning: "a wooden object (bench, signpost, barrel, crate, stall, log)" },
];

const PROP_CLASS = { WALL: 20, ROOF: 21, CANOPY: 22, BUSH: 23, STONEWORK: 24, WOOD: 25, TRUNK: 26, DOOR: 27, LIGHT: 28, SIDE: 29 } as const;
const EXTRA: Record<number, string> = { 26: "#6a4529", 27: "#4a2f1b", 28: "#f2c75c" };
const OUTLINE = "#2a1d13";

const rgbOf = (h: string) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const;
};
const COLOUR: Record<number, readonly [number, number, number]> = {};
for (const e of GUIDE_LEGEND) COLOUR[e.id] = rgbOf(e.hex);
for (const [k, h] of Object.entries(EXTRA)) COLOUR[Number(k)] = rgbOf(h);

export type GuidePlan = {
  /** 480×320 flat-colour block-out, the picture sent to the image service (enlarged). */
  guide: Img;
  /** Per pixel: the class drawn there (material id, or a PROP_CLASS id). */
  classes: Uint8Array;
};

/** Plan → flat block-out. Every shape sits exactly where the gameplay layer has it. */
export function guideFromPlan(bp: Blueprint, props: Placed[]): GuidePlan {
  const { w, h } = bp;
  const cls = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) cls[i] = bp.mat[i] || M.GRASS;
  const outline = new Uint8Array(w * h);
  const set = (x: number, y: number, c: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) cls[y * w + x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: number) => {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) set(x, y, c);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, c: number) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, c);
  };
  // Painter's order: back to front, so a nearer object covers a farther one, as on screen.
  const ordered = props.filter((p) => p.box && p.kind !== "exit" && p.kind !== "door").sort((a, b) => a.base - b.base);
  for (const pl of ordered) {
    const b = pl.box!;
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const mark = new Uint8Array(w * h);
    const before = cls.slice();
    switch (pl.kind) {
      case "cottage": {
        // Front wall, a shaded side wall on the far side (three-quarter view), and the roof over both.
        const roofBottom = b.y0 + bh * 0.55;
        const side = bw * 0.16;
        const front = { x0: bp.flip ? b.x0 + side : b.x0, x1: bp.flip ? b.x1 : b.x1 - side };
        rect(front.x0, roofBottom, front.x1, b.y1, PROP_CLASS.WALL);
        rect(bp.flip ? b.x0 : b.x1 - side, roofBottom, bp.flip ? b.x0 + side : b.x1, b.y1 - 3, PROP_CLASS.SIDE);
        rect(b.x0, b.y0, b.x1, roofBottom, PROP_CLASS.ROOF);
        const doorX = (front.x0 + front.x1) / 2;
        rect(doorX - 6, b.y1 - 18, doorX + 6, b.y1, PROP_CLASS.DOOR);
        break;
      }
      case "stall":
        rect(b.x0, b.y0, b.x1, b.y0 + bh * 0.4, PROP_CLASS.ROOF);
        rect(b.x0 + 2, b.y0 + bh * 0.4, b.x1 - 2, b.y1, PROP_CLASS.WOOD);
        break;
      case "tree":
      case "bigtree":
      case "palm": {
        const trunkW = Math.max(4, bw * 0.16);
        rect(pl.x - trunkW / 2, b.y0 + bh * 0.55, pl.x + trunkW / 2, b.y1, PROP_CLASS.TRUNK);
        ellipse((b.x0 + b.x1) / 2, b.y0 + bh * 0.36, bw / 2, bh * 0.36, PROP_CLASS.CANOPY);
        break;
      }
      case "bush":
      case "mushrooms":
        ellipse((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, bw / 2, bh / 2, PROP_CLASS.BUSH);
        break;
      case "well":
        rect(b.x0 + 2, b.y0, b.x1 - 2, b.y0 + bh * 0.35, PROP_CLASS.ROOF);
        rect(b.x0, b.y0 + bh * 0.45, b.x1, b.y1, PROP_CLASS.STONEWORK);
        break;
      case "lamp":
        rect(pl.x - 1, b.y0 + 4, pl.x + 2, b.y1, PROP_CLASS.TRUNK);
        rect(pl.x - 3, b.y0, pl.x + 4, b.y0 + 6, PROP_CLASS.LIGHT);
        break;
      case "shrine":
        rect(b.x0, b.y0, b.x1, b.y1, PROP_CLASS.STONEWORK);
        rect((b.x0 + b.x1) / 2 - 2, b.y0 + 2, (b.x0 + b.x1) / 2 + 2, b.y0 + 6, PROP_CLASS.LIGHT);
        break;
      case "rock":
      case "stone":
        ellipse((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, bw / 2, bh / 2, PROP_CLASS.STONEWORK);
        break;
      case "column":
      case "brokenColumn":
      case "fallenColumn":
      case "ruinWall":
      case "arch":
        rect(b.x0, b.y0, b.x1, b.y1, PROP_CLASS.STONEWORK);
        if (pl.kind === "arch") rect(b.x0 + bw * 0.3, b.y0 + bh * 0.35, b.x1 - bw * 0.3, b.y1, cls[Math.min(h - 1, Math.round(b.y1) + 2) * w + Math.round(pl.x)] || M.GRASS);
        break;
      default:
        // bench, sign, barrel, crate, pot, log, stump
        rect(b.x0, b.y0, b.x1, b.y1, PROP_CLASS.WOOD);
    }
    for (let i = 0; i < w * h; i++) if (cls[i] !== before[i]) mark[i] = 1;
    // A 1 px dark outline around each object's silhouette: object boundaries the image service can't blur.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mark[i]) continue;
        if ((x > 0 && mark[i - 1]) || (x < w - 1 && mark[i + 1]) || (y > 0 && mark[i - w]) || (y < h - 1 && mark[i + w])) outline[i] = 1;
      }
    for (let i = 0; i < w * h; i++) if (mark[i]) outline[i] = 0;
  }
  const guide = blank(w, h);
  const ol = rgbOf(OUTLINE);
  for (let i = 0; i < w * h; i++) {
    const c = outline[i] ? ol : COLOUR[cls[i]] ?? COLOUR[M.GRASS];
    guide.data[i * 4] = c[0];
    guide.data[i * 4 + 1] = c[1];
    guide.data[i * 4 + 2] = c[2];
    guide.data[i * 4 + 3] = 255;
  }
  return { guide, classes: cls };
}

export type Alignment = {
  /** Share of the play area's floor cells whose pixels still look like ground (1 = nothing painted over a walkway). */
  floorClear: number;
  /** Share of solid-object pixels that look like an object, not ground (1 = nothing left out). */
  solidsPresent: number;
  /** cols × rows, "1" where a floor cell looks blocked in the picture (shown in red in the Map Lab). */
  blockedCells: string;
};

const GROUND_CLASSES = new Set<number>(WALKABLE_MATERIALS);

/**
 * How closely the finished picture follows the plan. Each class's average
 * colour is measured in the picture; a floor pixel "looks blocked" when its
 * colour is nearer an obstacle class than any ground class.
 */
export function checkAlignment(art: Img, classes: Uint8Array, scene: SceneLayout): Alignment {
  const w = art.w;
  const h = art.h;
  const sums = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < w * h; i++) {
    const s = sums.get(classes[i]) ?? [0, 0, 0, 0];
    s[0] += art.data[i * 4];
    s[1] += art.data[i * 4 + 1];
    s[2] += art.data[i * 4 + 2];
    s[3]++;
    sums.set(classes[i], s);
  }
  // Only classes big enough to have a meaningful average colour.
  const means = [...sums].filter(([, s]) => s[3] >= 60).map(([c, s]) => ({ c, ground: GROUND_CLASSES.has(c), r: s[0] / s[3], g: s[1] / s[3], b: s[2] / s[3] }));
  const looksGround = (i: number) => {
    let best = Infinity;
    let ground = true;
    for (const m of means) {
      const d = (art.data[i * 4] - m.r) ** 2 + (art.data[i * 4 + 1] - m.g) ** 2 + (art.data[i * 4 + 2] - m.b) ** 2;
      if (d < best) {
        best = d;
        ground = m.ground;
      }
    }
    return ground;
  };
  const { cols, rows, floor } = scene;
  const cw = w / cols;
  const ch = h / rows;
  let floorCells = 0;
  let clear = 0;
  const blocked: string[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (floor[k] !== "1") {
        blocked.push("0");
        continue;
      }
      floorCells++;
      let n = 0;
      let g = 0;
      for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y++)
        for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) {
          n++;
          if (looksGround(y * w + x)) g++;
        }
      // A cell is "blocked" in the picture when most of it looks like an obstacle.
      const isClear = g >= n * 0.4;
      if (isClear) clear++;
      blocked.push(isClear ? "0" : "1");
    }
  let solid = 0;
  let present = 0;
  for (let i = 0; i < w * h; i++) {
    if (GROUND_CLASSES.has(classes[i]) || classes[i] === M.WATER || classes[i] === M.BACK || classes[i] === M.HIGH) continue;
    solid++;
    if (!looksGround(i)) present++;
  }
  return { floorClear: floorCells ? clear / floorCells : 0, solidsPresent: solid ? present / solid : 1, blockedCells: blocked.join("") };
}
