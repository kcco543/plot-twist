/**
 * Colour maths for the pixel editor's colour picker. Pure functions, all
 * channels as integers (RGB 0–255, hue 0–359, saturation/value/lightness
 * 0–100), so what the inputs show is exactly what gets painted.
 */
export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };
export type HSL = { h: number; s: number; l: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const byte = (n: number) => clamp(Math.round(n), 0, 255);

/** "#a1b2c3", "a1b2c3", "#abc" → "#a1b2c3" (lowercase), or null when it isn't a colour. */
export function parseHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

export function hexToRgb(hex: string): RGB {
  const h = parseHex(hex) ?? "#000000";
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export const rgbToHex = ({ r, g, b }: RGB) => `#${[r, g, b].map((n) => byte(n).toString(16).padStart(2, "0")).join("")}`;

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: Math.round((h * 60 + 360) % 360), s: Math.round(max ? (d / max) * 100 : 0), v: Math.round(max * 100) };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const S = clamp(s, 0, 100) / 100;
  const V = clamp(v, 0, 100) / 100;
  const c = V * S;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r1, g1, b1] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = V - c;
  return { r: byte((r1 + m) * 255), g: byte((g1 + m) * 255), b: byte((b1 + m) * 255) };
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: rgbToHsv({ r, g, b }).h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  const v = L + S * Math.min(L, 1 - L);
  return hsvToRgb({ h, s: v ? 2 * (1 - L / v) * 100 : 0, v: v * 100 });
}

/** Perceptual-ish distance (weighted RGB, "redmean"): good enough to pick the nearest palette colour. */
export function colorDistance(a: RGB, b: RGB): number {
  const rm = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** The palette colour closest to `hex` (limited-palette mode). */
export function nearestInPalette(hex: string, palette: string[]): string {
  const want = hexToRgb(hex);
  let best = palette[0] ?? hex;
  let bestD = Infinity;
  for (const p of palette) {
    const d = colorDistance(want, hexToRgb(p));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return parseHex(best) ?? best;
}

/** Add to the front of a most-recent-first list without duplicates. */
export const pushRecent = (list: string[], hex: string, max = 12) => [hex, ...list.filter((x) => x !== hex)].slice(0, max);
