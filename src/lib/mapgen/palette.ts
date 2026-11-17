/**
 * MAP KIT PALETTE — Western Fantasy, adventure-RPG colour handling
 * (PIXEL_ART_STYLE_GUIDE.md §8, §17).
 *
 * Taken from the reference sheets' colour logic, not their pixels:
 *   - warm, high value contrast: deep warm-brown shadows against bright
 *     mustard and cream lights (never a flat mid-green field)
 *   - hue shifting: every ramp runs from a cool or brown shadow up to a warm
 *     yellow light, so lit areas glow and shaded areas recede
 *   - foliage is olive to mustard, the woods behind are deep olive and teal
 *   - one dark warm outline colour for everything solid
 * Ramps are darkest first. A cast shadow is one step down the same ramp.
 */
import { hex, type RGB } from "./canvas";

const ramp = (...h: string[]) => h.map(hex);

export type Palette = {
  grass: RGB[]; // 0 deepest … 5 highlight
  moss: RGB[]; // foliage clusters on the ground, moss on stone and roofs
  leaf: RGB[]; // tree canopies: 0 interior … 5 sunlit edge
  deepwood: RGB[]; // the woodland behind everything
  dirt: RGB[];
  stone: RGB[]; // cream flagstones and rims
  rock: RGB[]; // cliff faces, boulders
  water: RGB[];
  wood: RGB[];
  bark: RGB[];
  roof: RGB[];
  plaster: RGB[];
  cloth: RGB[]; // awnings, banners
  glow: RGB[]; // lit windows and lanterns
  fallen: RGB[]; // fallen leaves and petals
  outline: RGB;
};

export const WESTERN_FANTASY: Palette = {
  grass: ramp("#33361c", "#56602a", "#828a2e", "#aaab34", "#cfc23c", "#ead867"),
  moss: ramp("#2f3420", "#4a5128", "#6b7330", "#8f9136", "#b7ae3e"),
  leaf: ramp("#232a1d", "#34401f", "#506026", "#7a842d", "#aaa634", "#d6c650"),
  deepwood: ramp("#171a16", "#1f2620", "#2a3528", "#3a4a32", "#4f6038"),
  dirt: ramp("#3f2a20", "#5e3d2b", "#7e5236", "#9d6a42", "#b98552"),
  stone: ramp("#5a4636", "#8a7055", "#b59a74", "#d8be92", "#f0dbab", "#faecc6"),
  rock: ramp("#2e2621", "#4a3d33", "#685645", "#8a755c", "#ad9677"),
  water: ramp("#163a3d", "#1f5f5d", "#2b8c84", "#43b5a5", "#8ad9c1", "#d2f2df"),
  wood: ramp("#2f1f19", "#4d3024", "#714630", "#97623f", "#b98352"),
  bark: ramp("#261b16", "#3f2c22", "#5b3f2e", "#7a573c", "#9a7149"),
  roof: ramp("#3a1f1b", "#5e2e24", "#86402c", "#ac5a36", "#cd7a46", "#e29c5e"),
  plaster: ramp("#7d6a52", "#b29c78", "#d9c49a", "#efdfb6"),
  cloth: ramp("#5a2422", "#8c3a2c", "#b85438", "#e8d7ae", "#f6ead0"),
  glow: ramp("#8a4a1e", "#d08a2a", "#f2c055", "#fbe7a0"),
  fallen: ramp("#a04a24", "#cf7a2c", "#e4aa3c", "#f0d070"),
  outline: hex("#24180f"),
};

/** One step down the same material's ramp (cast shadows, shade). Unknown colours get a generic darker, warmer tone. */
export function shadeFor(p: Palette): (c: RGB) => RGB {
  const map = new Map<string, RGB>();
  const key = (c: RGB) => `${c[0]},${c[1]},${c[2]}`;
  for (const r of [p.grass, p.moss, p.leaf, p.deepwood, p.dirt, p.stone, p.rock, p.water, p.wood, p.bark, p.roof, p.plaster, p.cloth, p.fallen])
    for (let i = 1; i < r.length; i++) if (!map.has(key(r[i]))) map.set(key(r[i]), r[i - 1]);
  return (c) => map.get(key(c)) ?? [Math.round(c[0] * 0.7), Math.round(c[1] * 0.66), Math.round(c[2] * 0.62)];
}

/** One step up the same ramp (pools of light). */
export function lightFor(p: Palette): (c: RGB) => RGB {
  const map = new Map<string, RGB>();
  const key = (c: RGB) => `${c[0]},${c[1]},${c[2]}`;
  for (const r of [p.grass, p.moss, p.leaf, p.dirt, p.stone, p.rock, p.water, p.wood, p.roof, p.plaster]) for (let i = 0; i < r.length - 1; i++) if (!map.has(key(r[i]))) map.set(key(r[i]), r[i + 1]);
  return (c) => map.get(key(c)) ?? c;
}
