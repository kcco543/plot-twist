/**
 * EMOTION EFFECTS — small pixel symbols drawn around a character.
 * --------------------------------------------------------------------------
 * One registry, one style. Every effect is built from tiny bitmaps ("glyphs")
 * drawn in art pixels inside the scaled stage, so they get the same crisp,
 * whole-pixel look as the sprites and follow the character automatically.
 * Every glyph gets the same 1px dark outline (added in code), so all effects
 * read on light and dark backgrounds alike.
 *
 * To add an emotion later:
 *   1. add its id to EMOTIONS in emotions.ts,
 *   2. add (or reuse) glyphs below and an entry in EFFECTS,
 *   3. add its name to "emotions" in both locale files.
 * Nothing else needs to change: the renderer, the test panel and the
 * reduced-motion handling all read from here.
 */
import type { Emotion, EmotionLevel } from "./emotions";

/** Palette letters used in glyph rows. "." is transparent. */
export const FX_PALETTE: Record<string, string> = {
  w: "#ffffff",
  y: "#ffe08a", // butter
  Y: "#e8b85a", // butter-lo
  p: "#f5a8c5", // pink
  P: "#d97aa2", // pink-lo
  r: "#e5536a", // anger red
  R: "#b8344f",
  g: "#d9d3e6", // smoke light
  G: "#a69db8", // smoke dark
  b: "#8fd8e6", // teal (tears)
  B: "#5aa9d6",
  l: "#c3b2f0", // lavender
  L: "#977ed8",
  o: "#ffc3a0", // peach
};
/** Outline colour added around every glyph. */
export const FX_OUTLINE = "#3d3060";

export type Glyph = { rows: string[] };

export const GLYPHS = {
  sparkle: { rows: ["..y..", ".yYy.", "yYwYy", ".yYy.", "..y.."] },
  star4: { rows: ["...y...", "...y...", "..yYy..", "yyYwYyy", "..yYy..", "...y...", "...y..."] },
  dot: { rows: ["yy", "yy"] },
  heart: { rows: [".pp.pp.", "pwpppPp", "ppppppP", ".ppppP.", "..ppP..", "...P..."] },
  heartSmall: { rows: ["p.p", "ppp", ".p."] },
  blush: { rows: ["p.p.p", ".P.P."] },
  sweat: { rows: [".b.", "bwb", "bbB", ".B."] },
  vein: { rows: ["rr.rr", "rR.Rr", ".....", "rR.Rr", "rr.rr"] },
  puff: { rows: [".gg.", "gwgG", "gggG", ".GG."] },
  cloud: { rows: ["..gg...", ".gwgg..", "gwgggG.", "ggggGGG", ".GGGGG."] },
  tear: { rows: [".b.", ".b.", "bwb", "bBB", ".B."] },
  tremble: { rows: ["l.", ".L", "l.", ".L"] },
  exclaim: { rows: ["rr", "rr", "rr", "Rr", "..", "rr"] },
  flash: { rows: ["y...y", ".y.y.", ".....", ".y.y.", "y...y"] },
  question: { rows: [".ll.", "l..L", "...L", "..L.", "..l.", "....", "..l."] },
  swirl: { rows: [".lll.", "l...L", "l.l.L", "l.LL.", ".L..."] },
} satisfies Record<string, Glyph>;
export type GlyphId = keyof typeof GLYPHS;

/**
 * Motions. Each is a CSS animation in globals.css (`fx-<name>`), drawn in art
 * pixels with steps() timing so things move in whole pixels.
 */
export const FX_MOTIONS = ["twinkle", "burst", "float", "pop", "drip", "shake", "rise", "spin"] as const;
export type FxMotion = (typeof FX_MOTIONS)[number];

/** Where a particle sits, in art px relative to the top-centre of the character's head. */
export type FxSlot = { glyph: GlyphId; x: number; y: number; motion: FxMotion; delay: number };

/** Small body motion on the sprite itself while the character reacts. */
export const BODY_MOTIONS = ["hop", "bounce", "shake", "tremble", "droop", "jolt", "tilt"] as const;
export type BodyMotion = (typeof BODY_MOTIONS)[number];

export type EffectDef = {
  /** Particles by level. Level 1 uses the first `count[0]` slots, and so on. Max 3. */
  slots: FxSlot[];
  count: [number, number, number];
  /** One loop of the effect, ms. */
  duration: number;
  /** Shown while the character reacts (short), then the effect goes quiet. */
  body: BodyMotion | null;
  /** Icon for the test panel / legends. */
  icon: GlyphId;
};

// Head top is (0, 0). Negative y = above the head. Sprites are 32 px, the face sits at about y 8–16.
export const EFFECTS: Record<Exclude<Emotion, "neutral">, EffectDef> = {
  happy: {
    slots: [
      { glyph: "sparkle", x: 11, y: -4, motion: "twinkle", delay: 0 },
      { glyph: "sparkle", x: -13, y: 0, motion: "twinkle", delay: 420 },
      { glyph: "dot", x: 7, y: -10, motion: "twinkle", delay: 820 },
    ],
    count: [1, 2, 3],
    duration: 1200,
    body: "bounce",
    icon: "sparkle",
  },
  excited: {
    slots: [
      { glyph: "star4", x: -14, y: -6, motion: "burst", delay: 0 },
      { glyph: "star4", x: 12, y: -8, motion: "burst", delay: 180 },
      { glyph: "sparkle", x: 0, y: -14, motion: "burst", delay: 360 },
    ],
    count: [1, 2, 3],
    duration: 700,
    body: "hop",
    icon: "star4",
  },
  affectionate: {
    slots: [
      { glyph: "heart", x: 10, y: -4, motion: "float", delay: 0 },
      { glyph: "heartSmall", x: -10, y: -2, motion: "float", delay: 600 },
      { glyph: "heartSmall", x: 2, y: -12, motion: "float", delay: 1100 },
    ],
    count: [1, 2, 3],
    duration: 1600,
    body: "tilt",
    icon: "heart",
  },
  embarrassed: {
    slots: [
      { glyph: "blush", x: -6, y: 14, motion: "pop", delay: 0 },
      { glyph: "blush", x: 6, y: 14, motion: "pop", delay: 0 },
      { glyph: "sweat", x: 11, y: 0, motion: "drip", delay: 300 },
    ],
    count: [2, 2, 3],
    duration: 1400,
    body: "droop",
    icon: "blush",
  },
  angry: {
    slots: [
      { glyph: "vein", x: 10, y: -2, motion: "pop", delay: 0 },
      { glyph: "puff", x: -12, y: -4, motion: "rise", delay: 200 },
      { glyph: "puff", x: 13, y: -10, motion: "rise", delay: 650 },
    ],
    count: [1, 2, 3],
    duration: 900,
    body: "shake",
    icon: "vein",
  },
  frustrated: {
    slots: [
      { glyph: "cloud", x: 0, y: -10, motion: "rise", delay: 0 },
      { glyph: "puff", x: -12, y: -2, motion: "rise", delay: 500 },
      { glyph: "puff", x: 12, y: -4, motion: "rise", delay: 950 },
    ],
    count: [1, 2, 3],
    duration: 1500,
    body: "droop",
    icon: "cloud",
  },
  sad: {
    slots: [
      { glyph: "tear", x: -5, y: 12, motion: "drip", delay: 0 },
      { glyph: "tear", x: 5, y: 12, motion: "drip", delay: 700 },
      { glyph: "tear", x: 11, y: 2, motion: "drip", delay: 1200 },
    ],
    count: [1, 2, 3],
    duration: 1600,
    body: "droop",
    icon: "tear",
  },
  anxious: {
    slots: [
      { glyph: "sweat", x: 10, y: 0, motion: "drip", delay: 0 },
      { glyph: "tremble", x: -13, y: 4, motion: "shake", delay: 0 },
      { glyph: "tremble", x: 14, y: 8, motion: "shake", delay: 120 },
    ],
    count: [1, 2, 3],
    duration: 1300,
    body: "tremble",
    icon: "sweat",
  },
  surprised: {
    slots: [
      { glyph: "exclaim", x: 0, y: -12, motion: "pop", delay: 0 },
      { glyph: "flash", x: -12, y: -6, motion: "burst", delay: 60 },
      { glyph: "flash", x: 12, y: -6, motion: "burst", delay: 60 },
    ],
    count: [1, 2, 3],
    duration: 800,
    body: "jolt",
    icon: "exclaim",
  },
  confused: {
    slots: [
      { glyph: "question", x: 10, y: -8, motion: "pop", delay: 0 },
      { glyph: "swirl", x: -12, y: -4, motion: "spin", delay: 0 },
      { glyph: "question", x: -2, y: -14, motion: "pop", delay: 500 },
    ],
    count: [1, 2, 3],
    duration: 1200,
    body: "tilt",
    icon: "question",
  },
};

export function effectFor(emotion: Emotion): EffectDef | null {
  return emotion === "neutral" ? null : EFFECTS[emotion];
}

/** Particles to draw for an emotion at a level. Never more than 3 per character. */
export function particlesFor(emotion: Emotion, level: EmotionLevel): FxSlot[] {
  const def = effectFor(emotion);
  if (!def) return [];
  return def.slots.slice(0, Math.min(3, def.count[level - 1]));
}

/** How long the burst plays after an emotion starts (ms). Afterwards one quiet particle remains at level 2+. */
export const BURST_LOOPS = 2;
export const burstMs = (emotion: Emotion) => (effectFor(emotion)?.duration ?? 0) * BURST_LOOPS + 400;

export type Pixel = { x: number; y: number; color: string };

/** Glyph → filled pixels, with a 1px outline added around the shape (consistent style for every effect). */
export function glyphPixels(id: GlyphId): { w: number; h: number; pixels: Pixel[] } {
  const rows = GLYPHS[id].rows;
  const h = rows.length + 2;
  const w = Math.max(...rows.map((r) => r.length)) + 2;
  const filled = (x: number, y: number) => {
    const ch = rows[y - 1]?.[x - 1];
    return !!ch && ch !== ".";
  };
  const pixels: Pixel[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) pixels.push({ x, y, color: FX_PALETTE[rows[y - 1][x - 1]] ?? FX_OUTLINE });
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) pixels.push({ x, y, color: FX_OUTLINE });
    }
  return { w, h, pixels };
}
