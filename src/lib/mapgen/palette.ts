/**
 * MAP KIT PALETTE — Western Fantasy (PIXEL_ART_STYLE_GUIDE.md §8).
 * Each material is a short ramp, darkest first: 3–5 flat tones with hard
 * steps, light from the upper left. Walkable ground (grass, dirt, plaza) is
 * the lightest and calmest; obstacles and the background are darker.
 * A cast shadow is the same material one step down its ramp (`shade`).
 */
import { hex, type RGB } from "./canvas";

const ramp = (...h: string[]) => h.map(hex);

export type Palette = {
  grass: RGB[]; // 0 deep … 4 highlight
  high: RGB[]; // grass on high ground / back hedges (a little darker and cooler)
  dirt: RGB[];
  stone: RGB[];
  water: RGB[];
  rock: RGB[];
  wood: RGB[];
  roof: RGB[];
  plaster: RGB[];
  leaf: RGB[];
  flower: RGB[];
  glass: RGB[];
  outline: RGB;
  leafOutline: RGB;
};

export const WESTERN_FANTASY: Palette = {
  grass: ramp("#36602f", "#4f8236", "#6e9e3d", "#8eb94a", "#b5d26a"),
  high: ramp("#24452c", "#335f33", "#4a7a37", "#6a9a40"),
  dirt: ramp("#6e4a30", "#9a6c42", "#bf9058", "#d8ae74"),
  stone: ramp("#6c6058", "#968878", "#bcae98", "#d6cab2"),
  water: ramp("#1d4f63", "#2b7a8c", "#3fa3ac", "#86d4c6"),
  rock: ramp("#3e2f2b", "#5f4a3f", "#83684f", "#a58a6a"),
  wood: ramp("#4a2e22", "#77482d", "#a46a3a", "#c88e52"),
  roof: ramp("#5e2a24", "#8f3e2e", "#bb5a3a", "#dd8456"),
  plaster: ramp("#a08d72", "#d7c59e", "#efe0bc"),
  leaf: ramp("#203d27", "#33612f", "#4f8a35", "#79b043", "#a9d062"),
  flower: ramp("#e47a8a", "#f2cf58", "#f4eedc", "#9b7bc9"),
  glass: ramp("#26394a", "#3c5a6e", "#9fd2d6"),
  outline: hex("#3b2a20"),
  leafOutline: hex("#1e3222"),
};

/** One step down the same material's ramp (cast shadows). Unknown colours get a generic darker, cooler tone. */
export function shadeFor(p: Palette): (c: RGB) => RGB {
  const map = new Map<string, RGB>();
  const key = (c: RGB) => `${c[0]},${c[1]},${c[2]}`;
  for (const r of [p.grass, p.high, p.dirt, p.stone, p.water, p.rock, p.wood, p.roof, p.plaster, p.leaf]) for (let i = 1; i < r.length; i++) map.set(key(r[i]), r[i - 1]);
  return (c) => map.get(key(c)) ?? [Math.round(c[0] * 0.72), Math.round(c[1] * 0.74), Math.round(c[2] * 0.8)];
}
