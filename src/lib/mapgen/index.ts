/**
 * MAP KIT — "Generate Map" without an image service.
 * --------------------------------------------------------------------------
 * For the worlds and place types it supports, a map is built from a layout
 * plan and drawn pixel by pixel (village.ts), and its play area comes from
 * the same plan. That makes three promises the image service can't:
 *
 *   - authentic pixel art: every pixel is placed on the 480×320 native grid
 *     from a fixed palette (no high-resolution picture squashed onto a grid)
 *   - open, readable ground: the plan keeps obstacles at the edges, a wide
 *     road, 2–4 props on open ground and decoration in a few small groups,
 *     and is checked before it is drawn
 *   - collision that matches the picture: the floor and the objects are
 *     derived from the plan, not guessed from colours
 *
 * It costs nothing and never calls an AI service.
 */
import type { Img } from "../sprites/pixelize";
import { GRID_COLS, gridFor, type SceneLayout, type SceneObject } from "../scene/layout";
import type { EnvironmentTypeId, WorldId } from "../types";
import { MAP_H, MAP_W, M, WALKABLE_MATERIALS, markBlocked, paintVillage, planVillage, villageSeed, type Blueprint, type LabelKey, type Placed } from "./village";

export const KIT_ID = "pixel-kit/village-1";

/** The test world first (PIXEL_ART_STYLE_GUIDE.md §13): Western Fantasy outdoor places. */
export function kitSupports(worldId: WorldId | null, type: EnvironmentTypeId): boolean {
  return worldId === "western-fantasy" && (type === "street" || type === "wilderness");
}

export type KitReport = {
  /** Share of the map characters can walk on. */
  walkable: number;
  /** Share of the walkable floor in the single largest connected area (before islands are removed). */
  connected: number;
  /** Share of the walkable floor not covered by any drawn object (what the player actually sees as open ground). */
  visibleGround: number;
  /** Share of the walkable floor covered by objects drawn over characters. */
  frontCover: number;
  objects: number;
  decorGroups: number;
  colours: number;
  seed: number;
  nonce: number;
};

export type KitMap = { img: Img; scene: SceneLayout; report: KitReport };

/** Interests characters can recognise on each object (autonomy/environment.ts reads these words). */
const INTERESTS: Partial<Record<LabelKey, string[]>> = {
  well: ["water", "well"],
  bench: ["rest"],
  tree: ["tree", "nature"],
  roadEast: ["travel"],
  roadSouth: ["travel"],
};

/** Plan → playable scene: the floor is exactly the plan's open ground, and each object is where it was drawn. */
export function layoutFromBlueprint(bp: Blueprint, props: Placed[], label: (k: LabelKey) => string): { scene: SceneLayout; connected: number } {
  markBlocked(bp, props);
  const { cols, rows } = gridFor(bp.w, bp.h);
  const cw = bp.w / cols;
  const ch = bp.h / rows;
  const cells = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let open = 0;
      let total = 0;
      for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y++)
        for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) {
          total++;
          const i = y * bp.w + x;
          if (WALKABLE_MATERIALS.includes(bp.mat[i]) && !bp.blocked[i]) open++;
        }
      // A cell is floor only when (almost) all of it is open ground: characters never stand on the edge of water or a wall.
      cells[r * cols + c] = open >= total * 0.8 ? 1 : 0;
    }
  // Keep the largest connected walking area only: no floor islands a character could never reach.
  const comp = new Int32Array(cols * rows).fill(-1);
  const sizes: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || comp[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const c = k % cols;
      const r = Math.floor(k / cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        if (cells[n] && comp[n] < 0) {
          comp[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  const total = sizes.reduce((a, b) => a + b, 0);
  const main = sizes.indexOf(Math.max(...sizes, 0));
  for (let i = 0; i < cells.length; i++) if (cells[i] && comp[i] !== main) cells[i] = 0;

  const frac = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
    x0: Math.max(0, b.x0) / bp.w,
    y0: Math.max(0, b.y0) / bp.h,
    x1: Math.min(bp.w, b.x1) / bp.w,
    y1: Math.min(bp.h, b.y1) / bp.h,
  });
  const objects: SceneObject[] = [];
  for (const pl of props) {
    if (!pl.object) continue;
    let box = pl.box;
    if (pl.kind === "exit") {
      // A strip where the road leaves the map.
      box = pl.x > bp.w - 20 ? { x0: bp.w - 14, y0: pl.base - 22, x1: bp.w, y1: pl.base + 10 } : { x0: pl.x - 22, y0: bp.h - 12, x1: pl.x + 22, y1: bp.h };
    }
    if (!box) continue;
    const name = label(pl.object.label);
    const interests = INTERESTS[pl.object.label];
    objects.push({
      id: pl.id,
      label: name,
      type: pl.object.type,
      bounds: frac(box),
      solid: pl.object.solid,
      front: pl.object.front,
      ...(interests ? { interests } : {}),
      // A door here is the house's front door, not a way to another area unless the player links one.
      ...(pl.kind === "door" ? { exit: false } : {}),
    });
  }
  const scene: SceneLayout = {
    v: 1,
    perspective: "angled",
    stageWidth: bp.w,
    cols,
    rows,
    floor: Array.from(cells, (v) => (v ? "1" : "0")).join(""),
    objects,
    spawns: bp.spawns.map((s) => ({ x: s.x / bp.w, y: s.y / bp.h })),
    // The floor comes from the plan itself, not from a guess: nothing to review.
    reviewed: true,
    updatedAt: 0,
  };
  return { scene, connected: total ? Math.max(...sizes) / total : 0 };
}

function measure(bp: Blueprint, cover: Uint8Array, scene: SceneLayout, img: Img) {
  // Open ground = walkable material outside house walls and woodland masses; covered = an object is drawn on it.
  let walk = 0;
  let covered = 0;
  let front = 0;
  for (let i = 0; i < bp.w * bp.h; i++) {
    if (!WALKABLE_MATERIALS.includes(bp.mat[i]) || bp.blocked[i]) continue;
    walk++;
    if (cover[i]) covered++;
    if (cover[i] === 2) front++;
  }
  const colours = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) colours.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
  return {
    walkable: (scene.floor.match(/1/g)?.length ?? 0) / scene.floor.length,
    visibleGround: walk ? 1 - covered / walk : 0,
    frontCover: walk ? front / walk : 0,
    colours: colours.size,
  };
}

/** Minimums a plan must meet before it is drawn (PIXEL_ART_STYLE_GUIDE.md §11). */
export const KIT_LIMITS = { walkable: 0.55, connected: 0.97, visibleGround: 0.88, frontCover: 0.03 };

/**
 * Build a map for `description`. `nonce` picks the variation (a new one per
 * click). A plan that misses the limits is replaced by the next variation.
 */
export function generateKitMap(opts: { description: string; nonce: number; label: (k: LabelKey) => string }): KitMap {
  let fallback: KitMap | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const nonce = opts.nonce + attempt;
    const seed = villageSeed(opts.description, nonce);
    const bp = planVillage(opts.description, seed);
    const { canvas, props, cover } = paintVillage(bp);
    const img = canvas.toImg();
    const { scene, connected } = layoutFromBlueprint(bp, props, opts.label);
    const m = measure(bp, cover, scene, img);
    const report: KitReport = { ...m, connected, objects: scene.objects.length, decorGroups: bp.decor.length, seed, nonce };
    const result = { img, scene, report };
    const ok = m.walkable >= KIT_LIMITS.walkable && connected >= KIT_LIMITS.connected && m.visibleGround >= KIT_LIMITS.visibleGround && m.frontCover <= KIT_LIMITS.frontCover;
    if (ok) return result;
    fallback ??= result;
  }
  return fallback!;
}

export { MAP_W, MAP_H, M, GRID_COLS };
export type { LabelKey };
