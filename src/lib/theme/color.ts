/**
 * Small colour maths for the theme system (pure, no DOM). Everything works on
 * #rrggbb strings so tokens stay readable in tests and CSS.
 */
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from "../color/color";

/** Mix `a` toward `b` by t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Darken `fg` toward `toward` (default: a deep version of itself) until it
 * reaches `ratio` against every background given. Used so every theme and
 * mood keeps the same readability, whatever the palette.
 */
export function ensureContrast(fg: string, bgs: string[], ratio: number, toward = "#1d1a24"): string {
  let out = fg;
  for (let i = 0; i <= 20; i++) {
    if (bgs.every((bg) => contrast(out, bg) >= ratio)) return out;
    out = mix(fg, toward, (i + 1) / 20);
  }
  return out;
}

/** Shift hue (degrees) and scale saturation / lightness. */
export function adjust(hex: string, { hue = 0, sat = 1, light = 0 }: { hue?: number; sat?: number; light?: number }): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  // HSL here is 0–360 / 0–100 / 0–100; `light` is in the same 0–100 units.
  return rgbToHex(hslToRgb({ h: (hsl.h + hue + 360) % 360, s: Math.max(0, Math.min(100, hsl.s * sat)), l: Math.max(0, Math.min(100, hsl.l + light)) }));
}

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
