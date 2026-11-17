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

/**
 * Biomes reuse the SAME rendering and the same outline, light direction,
 * ramp lengths and value structure; only some ramps change hue. That is what
 * keeps a desert or an enchanted glade in the same visual world as the village.
 */
export type Biome = "temperate" | "arid" | "enchanted";

/** Sun-baked: sand instead of grass, dry scrub, sandstone, clay roofs, adobe walls. */
export const ARID: Palette = {
  ...WESTERN_FANTASY,
  grass: ramp("#5a3e26", "#8a6236", "#b48a4a", "#d2aa5e", "#e8c779", "#f6e0a0"),
  moss: ramp("#3b3420", "#5c5428", "#7d7432", "#9e903c", "#bfae4c"),
  leaf: ramp("#24301c", "#38481f", "#566a26", "#7d8a2e", "#a8a438", "#d0c454"),
  deepwood: ramp("#2a1c16", "#43291e", "#5e3a26", "#7d5232", "#9c6a3e"),
  dirt: ramp("#4a2e1e", "#6e4428", "#925c34", "#b07440", "#c88e52"),
  rock: ramp("#3e2418", "#66392a", "#8f5234", "#b56f42", "#d49258"),
  plaster: ramp("#9a6a48", "#c48e64", "#ddae80", "#f0cfa0"),
  roof: ramp("#3a1d16", "#62301f", "#8c4428", "#b25a30", "#d07a3c", "#e69c58"),
};

/** Old magic in the woods: teal-shifted foliage and water, cool glow, the same warm lights on the ground. */
export const ENCHANTED: Palette = {
  ...WESTERN_FANTASY,
  grass: ramp("#25362a", "#3d5a32", "#5f8338", "#8ca53c", "#b8c24a", "#dcdc74"),
  moss: ramp("#1f3229", "#2f4d3a", "#3f6b48", "#5a8c55", "#86b066"),
  leaf: ramp("#142422", "#1d3631", "#28503f", "#3a6f4c", "#5c9256", "#a6c66a"),
  deepwood: ramp("#0e1618", "#142124", "#1c2f30", "#27413c", "#355447"),
  water: ramp("#123441", "#1a5a63", "#24898a", "#3bb8aa", "#86e0c8", "#d6f6e6"),
  glow: ramp("#1f6d72", "#3fb3a8", "#8ae6c8", "#e4fff0"),
  fallen: ramp("#6a3e8a", "#9a5cb0", "#d08ac8", "#f2c4e0"),
};

export function paletteFor(biome: Biome): Palette {
  return biome === "arid" ? ARID : biome === "enchanted" ? ENCHANTED : WESTERN_FANTASY;
}
