/**
 * WORLD-REACTIVE UI THEMES (pure, no DOM)
 * --------------------------------------------------------------------------
 * Layer A · brand   — globals.css: typography, pixel unit, frame geometry,
 *                     spacing, interaction states, motion timing. Never
 *                     changed by a theme.
 * Layer B · base    — one per world type (WorldId): palette, materials
 *                     (frame inlay), motif vocabulary, motion flavour.
 * Layer C · mood    — refines the base: colour temperature, accent shift,
 *                     decoration density, ambient motion. Never replaces it.
 * Layer D · motifs  — up to three small motifs picked from the world
 *                     description (validated ids only, never free-form CSS).
 *
 * buildThemeVars() turns a WorldUiTheme into CSS custom properties that
 * override the brand tokens. Components never contain theme-specific values:
 * they read the same tokens and frames in every world.
 */
import type { WorldId } from "../types";
import { adjust, contrast, ensureContrast, isHex, mix } from "./color";
import { frameUrl, type FrameColors, type FrameStyle } from "./frames";
import { isMotifId, motifSvg, patternSvg, svgUrl, type MotifId } from "./motifs";

export const THEME_VERSION = 1;
export const BASE_THEMES: WorldId[] = ["western-fantasy", "modern", "ancient-china", "otherworld"];

export const MOODS = ["default", "cozy", "cheerful", "dreamy", "mysterious", "calm", "sacred", "moody", "rustic", "elegant"] as const;
export type MoodId = (typeof MOODS)[number];

export const DENSITIES = ["minimal", "standard", "decorative"] as const;
export type Density = (typeof DENSITIES)[number];

export type MotionPreset = "paper" | "slide" | "ink" | "float";

/** What each world save stores (SaveData.uiTheme). */
export type WorldUiTheme = {
  baseTheme: WorldId;
  moodVariant: MoodId;
  /** Only colours from the base theme's approved list (APPROVED_ACCENTS). */
  approvedAccentOverrides: { primary?: string; accent?: string };
  /** At most MAX_MOTIFS ids from MOTIFS. */
  decorativeMotifIds: MotifId[];
  decorationDensity: Density;
  themeVersion: typeof THEME_VERSION;
  /** The player confirmed this theme (World Builder). Unconfirmed = the safe default. */
  confirmed: boolean;
  updatedAt: number;
};

export const MAX_MOTIFS = 3;

type BaseSpec = {
  background: string;
  panel: string;
  primary: string;
  secondary: string;
  accent: string;
  calm: string;
  text: string;
  border: string;
  /** The theme's own motif vocabulary (World Builder offers these first). */
  vocabulary: MotifId[];
  /** Corner ornaments on framed panels and the portrait frame. */
  corners: [MotifId, MotifId];
  /** Double-layer (inlaid) panel borders. */
  inlay: "accent" | "primary" | null;
  motion: MotionPreset;
  /** Chinese serif for display headings only. */
  serifDisplay?: boolean;
};

/** Layer B. Colours from the PLOT TWIST! world theme brief. */
export const BASES: Record<WorldId, BaseSpec> = {
  "western-fantasy": {
    background: "#f3ebd6",
    panel: "#fff7e8",
    primary: "#668a72",
    secondary: "#a8655a",
    accent: "#b98b43",
    calm: "#6f8fae",
    text: "#383b32",
    border: "#807458",
    vocabulary: ["leaf", "vine", "book", "key", "potion", "quill", "crest"],
    corners: ["leaf", "crest"],
    inlay: "accent",
    motion: "paper",
  },
  modern: {
    background: "#e8edf2",
    panel: "#ffffff",
    primary: "#527aab",
    secondary: "#4f9f9a",
    accent: "#f090a8",
    calm: "#8e9fc4",
    text: "#303b4c",
    border: "#78899f",
    vocabulary: ["window", "raindrop", "camera", "message", "folder", "pin", "citylight"],
    corners: ["pin", "message"],
    inlay: null,
    motion: "slide",
  },
  "ancient-china": {
    background: "#efe8d9",
    panel: "#faf5ea",
    primary: "#54796f",
    secondary: "#5e6f86",
    accent: "#b95349",
    calm: "#7b9a9a",
    text: "#333b39",
    border: "#777466",
    vocabulary: ["cloud", "lantern", "bamboo", "seal", "mountain", "fan", "scroll", "jade"],
    corners: ["seal", "cloud"],
    inlay: null,
    motion: "ink",
    serifDisplay: true,
  },
  otherworld: {
    background: "#efe8fa",
    panel: "#fff8fe",
    primary: "#9680d3",
    secondary: "#6fa8d6",
    accent: "#f2a2c4",
    calm: "#a3b4f0",
    text: "#473d69",
    border: "#a18dc5",
    vocabulary: ["star", "mushroom", "moon", "crystal", "bubble", "cloud", "sparkle"],
    corners: ["star", "sparkle"],
    inlay: "accent",
    motion: "float",
  },
};

/** The only colours the player may swap in, per base theme (Layer B stays recognisable). */
export const APPROVED_ACCENTS: Record<WorldId, { primary: string[]; accent: string[] }> = {
  "western-fantasy": { primary: ["#668a72", "#6f7f9e", "#8a6f5a", "#7a8a4e"], accent: ["#b98b43", "#a8655a", "#9a7bb0", "#c08a5a"] },
  modern: { primary: ["#527aab", "#4f9f9a", "#6d6fb8", "#5a7d8c"], accent: ["#f090a8", "#f2b05a", "#8ad0b8", "#b79cf0"] },
  "ancient-china": { primary: ["#54796f", "#5e6f86", "#7a6a52", "#6b7f4f"], accent: ["#b95349", "#c48a3a", "#8a5a8a", "#4f8a8a"] },
  otherworld: { primary: ["#9680d3", "#6fa8d6", "#d07fb0", "#7fbfa8"], accent: ["#f2a2c4", "#f6c27a", "#9be0d0", "#b8a6f2"] },
};

type MoodSpec = {
  /** −1 cool … +1 warm: tints surfaces and nudges hues. */
  temp: number;
  /** Saturation multiplier for primary / accent. */
  sat: number;
  /** Extra tint mixed into surfaces (dreamy lilac, mysterious dusk). */
  tint?: [string, number];
  /** Accent pulled toward this colour. */
  accentPull?: [string, number];
  density: Density;
};

/** Layer C. Small, bounded adjustments: the base palette always stays in charge. */
export const MOOD_SPECS: Record<MoodId, MoodSpec> = {
  default: { temp: 0, sat: 1, density: "standard" },
  cozy: { temp: 0.6, sat: 0.95, density: "standard" },
  cheerful: { temp: 0.25, sat: 1.18, density: "decorative" },
  dreamy: { temp: -0.2, sat: 0.95, tint: ["#d9c8f5", 0.1], density: "decorative" },
  mysterious: { temp: -0.5, sat: 0.9, tint: ["#5b5878", 0.07], density: "standard" },
  calm: { temp: -0.15, sat: 0.82, density: "minimal" },
  sacred: { temp: 0.3, sat: 0.9, accentPull: ["#c9a24a", 0.45], density: "standard" },
  moody: { temp: -0.6, sat: 0.75, tint: ["#6f7a8c", 0.06], density: "minimal" },
  rustic: { temp: 0.5, sat: 0.85, tint: ["#c9a77a", 0.07], density: "standard" },
  elegant: { temp: 0, sat: 0.8, density: "minimal" },
};

const WARM = "#ffcf8a";
const COOL = "#9fb8f0";

export const isWorldId = (v: unknown): v is WorldId => typeof v === "string" && (BASE_THEMES as string[]).includes(v);
export const isMood = (v: unknown): v is MoodId => typeof v === "string" && (MOODS as readonly string[]).includes(v);

/** The safe default for a world (legacy saves, new worlds, "Restore base theme"). */
export function defaultUiTheme(base: WorldId, now = 0): WorldUiTheme {
  return { baseTheme: base, moodVariant: "default", approvedAccentOverrides: {}, decorativeMotifIds: [], decorationDensity: "standard", themeVersion: THEME_VERSION, confirmed: false, updatedAt: now };
}

/**
 * Versioned migration / validation of a stored theme. Anything unknown is
 * dropped back to the default, never trusted: only known moods, densities,
 * motif ids and approved colours survive.
 */
export function sanitizeUiTheme(raw: unknown, worldId: WorldId | null): WorldUiTheme | null {
  if (!worldId) return null;
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || r.baseTheme !== worldId) return null;
  const approved = APPROVED_ACCENTS[worldId];
  const ov = r.approvedAccentOverrides && typeof r.approvedAccentOverrides === "object" ? (r.approvedAccentOverrides as Record<string, unknown>) : {};
  const pickOv = (v: unknown, list: string[]) => (isHex(v) && list.includes(v.toLowerCase()) ? v.toLowerCase() : undefined);
  const primary = pickOv(ov.primary, approved.primary);
  const accent = pickOv(ov.accent, approved.accent);
  const motifs = Array.isArray(r.decorativeMotifIds) ? [...new Set(r.decorativeMotifIds.filter(isMotifId))].slice(0, MAX_MOTIFS) : [];
  return {
    baseTheme: worldId,
    moodVariant: isMood(r.moodVariant) ? r.moodVariant : "default",
    approvedAccentOverrides: { ...(primary ? { primary } : {}), ...(accent ? { accent } : {}) },
    decorativeMotifIds: motifs,
    decorationDensity: (DENSITIES as readonly unknown[]).includes(r.decorationDensity) ? (r.decorationDensity as Density) : "standard",
    themeVersion: THEME_VERSION,
    confirmed: r.confirmed === true,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
  };
}

/** The theme a world shows: its saved one if valid, else the default for its world type. */
export function resolveUiTheme(save: { worldId: WorldId | null; uiTheme?: unknown }): WorldUiTheme | null {
  if (!save.worldId) return null;
  return sanitizeUiTheme(save.uiTheme, save.worldId) ?? defaultUiTheme(save.worldId);
}

// ---------------------------------------------------------------- palette

export type Ramp = { lo: string; base: string; hi: string };
/** A candy ramp from one mid colour: shade = the colour, face and highlight are tints of it. */
const ramp = (c: string, face = 0.5): Ramp => ({ lo: c, base: mix(c, "#ffffff", face), hi: mix(c, "#ffffff", 0.84) });

export type ThemePalette = {
  bg: string;
  surface: string;
  well: string;
  line: string;
  ink: string;
  inkSoft: string;
  inkMute: string;
  outline: string;
  label: string;
  rose: string;
  successText: string;
  errorText: string;
  frameLine: string;
  primary: Ramp;
  accent: Ramp;
  secondary: Ramp;
  calm: Ramp;
  success: Ramp;
  error: Ramp;
  warm: Ramp;
  plum: string;
  focus: string;
  shadowRgb: string;
};

/** Layers B + C (+ approved overrides) → final colours, with readability enforced. */
export function themePalette(t: WorldUiTheme): ThemePalette {
  const b = BASES[t.baseTheme];
  const m = MOOD_SPECS[t.moodVariant];
  const temp = (c: string, amount: number) => (m.temp === 0 ? c : mix(c, m.temp > 0 ? WARM : COOL, Math.abs(m.temp) * amount));
  const surf = (c: string) => {
    let out = temp(c, 0.1);
    if (m.tint) out = mix(out, m.tint[0], m.tint[1]);
    return out;
  };
  const hue = m.temp * -6; // warm moods lean hues toward orange, cool toward blue
  const tone = (c: string) => (hue === 0 && m.sat === 1 ? temp(c, 0.12) : adjust(temp(c, 0.12), { hue, sat: m.sat }));

  const bg = surf(b.background);
  const surface = surf(b.panel);
  let primaryC = tone(t.approvedAccentOverrides.primary ?? b.primary);
  let accentC = tone(t.approvedAccentOverrides.accent ?? b.accent);
  if (m.accentPull && !t.approvedAccentOverrides.accent) accentC = mix(accentC, m.accentPull[0], m.accentPull[1]);
  const secondaryC = tone(b.secondary);
  const calmC = tone(b.calm);
  // Very light colours (Otherworld's pink) still need a shade that reads as a rim.
  if (contrast(primaryC, surface) < 2) primaryC = mix(primaryC, b.text, 0.25);
  if (contrast(accentC, surface) < 1.6) accentC = mix(accentC, b.text, 0.18);

  const well = mix(surface, primaryC, 0.07);
  const line = mix(surface, b.border, 0.28);
  const primary = ramp(primaryC);
  const accent = ramp(accentC, 0.45);
  const secondary = ramp(secondaryC);
  const calm = ramp(calmC);
  const success = ramp(mix("#4fae8c", bg, 0.12), 0.48);
  const error = ramp(mix("#e07a5f", bg, 0.1), 0.5);
  const warm = ramp(mix("#e98a6a", accentC, 0.35), 0.5);

  const faces = [surface, bg, well, primary.base, accent.base, secondary.base, calm.base, success.base, error.base, primary.hi, accent.hi];
  const ink = ensureContrast(temp(b.text, 0.05), faces, 7);
  const inkSoft = ensureContrast(mix(ink, surface, 0.3), [surface, bg, well], 4.6, ink);
  const inkMute = ensureContrast(mix(ink, surface, 0.5), [surface, bg], 3, ink);
  const label = ensureContrast(primaryC, [surface, bg, well], 4.6, ink);
  const rose = ensureContrast(accentC, [surface, bg, well], 4.6, ink);
  const successText = ensureContrast(success.lo, [surface, bg], 4.6, ink);
  const errorText = ensureContrast(error.lo, [surface, bg], 4.6, ink);
  const outline = mix(b.border, ink, 0.35);
  const frameLine = mix(b.border, surface, 0.25);
  const plum = mix(ink, "#16131f", 0.35);
  const focus = ensureContrast(primaryC, [surface, bg], 3, ink);
  const o = hexRgb(outline);
  return { bg, surface, well, line, ink, inkSoft, inkMute, outline, label, rose, successText, errorText, frameLine, primary, accent, secondary, calm, success, error, warm, plum, focus, shadowRgb: o };
}

const hexRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

// ---------------------------------------------------------------- tokens

/** Semantic tokens every theme must define (Layer A names, spec 8.1). */
export const SEMANTIC_TOKENS = [
  "background", "surface", "panel", "primary", "secondary", "accent", "text", "muted-text", "border", "border-highlight",
  "shadow", "focus", "hover", "selected", "disabled", "error", "success",
] as const;

/** Brand frames a theme re-colours. Geometry comes from frames.ts and never changes. */
export const THEMED_FRAMES = [
  "panel", "card", "inset", "inset-focus", "cream", "gold", "gold-card", "tab", "disabled",
  "pink", "pink-pressed", "butter", "butter-pressed", "mint", "mint-pressed", "lavender", "lavender-pressed",
  "periwinkle", "periwinkle-pressed", "plum", "plum-pressed", "ghost", "ghost-pressed", "coral", "coral-pressed",
] as const;

export type ThemeVars = Record<`--${string}`, string>;

/** Everything a world skin sets on <html> (or on a preview box). */
export function buildThemeVars(t: WorldUiTheme): ThemeVars {
  const p = themePalette(t);
  const b = BASES[t.baseTheme];
  const v: ThemeVars = {};
  const set = (k: string, val: string) => (v[`--${k}`] = val);

  // Brand token names (what every component already uses)
  set("color-bg", p.bg);
  set("color-surface", p.surface);
  set("color-well", p.well);
  set("color-line", p.line);
  set("color-ink", p.ink);
  set("color-ink-soft", p.inkSoft);
  set("color-ink-mute", p.inkMute);
  set("color-outline", p.outline);
  set("color-label", p.label);
  set("color-rose", p.rose);
  set("color-mint-deep", p.successText);
  set("color-coral-deep", p.errorText);
  set("color-plum", p.plum);
  const ramps: [string, Ramp][] = [["pink", p.primary], ["butter", p.accent], ["lavender", p.secondary], ["periwinkle", p.calm], ["mint", p.success], ["peach", p.warm]];
  for (const [name, r] of ramps) {
    set(`color-${name}-lo`, r.lo);
    set(`color-${name}`, r.base);
    set(`color-${name}-hi`, r.hi);
  }
  set("color-coral", p.error.base);
  set("color-teal", p.calm.base);

  // Semantic tokens (spec names)
  set("pt-background", p.bg);
  set("pt-surface", p.surface);
  set("pt-panel", p.surface);
  set("pt-primary", p.primary.lo);
  set("pt-secondary", p.secondary.lo);
  set("pt-accent", p.accent.lo);
  set("pt-text", p.ink);
  set("pt-muted-text", p.inkSoft);
  set("pt-border", p.frameLine);
  set("pt-border-highlight", p.accent.lo);
  set("pt-shadow", `rgba(${p.shadowRgb}, 0.16)`);
  set("pt-focus", p.focus);
  set("pt-hover", p.primary.hi);
  set("pt-selected", p.accent.base);
  set("pt-disabled", mix(p.surface, p.line, 0.6));
  set("pt-error", p.errorText);
  set("pt-success", p.successText);
  set("shadow-rgb", p.shadowRgb);

  // Frames: same 12×12 geometry, theme colours, optional inlay ring.
  const inlay = b.inlay === "accent" ? mix(p.accent.lo, p.surface, 0.35) : b.inlay === "primary" ? mix(p.primary.lo, p.surface, 0.35) : undefined;
  const panelStyle: FrameStyle = inlay ? { inlay } : {};
  const white = mix(p.surface, "#ffffff", 0.7);
  const btn = (r: Ramp): [FrameColors, FrameColors] => [[r.hi, r.base, r.lo, p.outline], [r.lo, r.base, r.base, p.outline]];
  const frames: Record<(typeof THEMED_FRAMES)[number], [FrameColors, FrameStyle?]> = {
    panel: [[white, p.surface, mix(p.surface, p.frameLine, 0.22), p.frameLine], panelStyle],
    card: [[white, mix(p.surface, p.well, 0.6), mix(p.well, p.frameLine, 0.2), mix(p.frameLine, p.surface, 0.2)]],
    inset: [[mix(p.well, p.frameLine, 0.25), mix(p.surface, "#ffffff", 0.5), white, p.frameLine]],
    "inset-focus": [[mix(p.well, p.frameLine, 0.25), mix(p.surface, "#ffffff", 0.5), white, p.focus]],
    cream: [[white, p.surface, mix(p.surface, p.frameLine, 0.18), p.frameLine], panelStyle],
    gold: [[p.accent.hi, p.surface, p.accent.base, p.accent.lo], { inlay: mix(p.accent.base, p.surface, 0.5) }],
    "gold-card": [[p.accent.hi, mix(p.surface, p.accent.hi, 0.5), p.accent.base, p.accent.lo]],
    tab: [[p.secondary.hi, p.secondary.base, p.secondary.lo, p.outline]],
    disabled: [[mix(p.well, p.surface, 0.5), mix(p.well, p.surface, 0.5), mix(p.well, p.surface, 0.5), mix(p.line, p.frameLine, 0.4)]],
    pink: [btn(p.primary)[0]],
    "pink-pressed": [btn(p.primary)[1]],
    butter: [btn(p.accent)[0]],
    "butter-pressed": [btn(p.accent)[1]],
    mint: [btn(p.success)[0]],
    "mint-pressed": [btn(p.success)[1]],
    lavender: [btn(p.secondary)[0]],
    "lavender-pressed": [btn(p.secondary)[1]],
    periwinkle: [btn(p.calm)[0]],
    "periwinkle-pressed": [btn(p.calm)[1]],
    plum: [[white, mix(p.surface, p.well, 0.7), mix(p.well, p.frameLine, 0.3), p.outline]],
    "plum-pressed": [[mix(p.well, p.frameLine, 0.3), mix(p.surface, p.well, 0.7), mix(p.surface, p.well, 0.7), p.outline]],
    ghost: [[white, p.surface, mix(p.surface, p.frameLine, 0.25), p.frameLine]],
    "ghost-pressed": [[mix(p.surface, p.frameLine, 0.25), p.surface, p.surface, p.frameLine]],
    coral: [btn(p.error)[0]],
    "coral-pressed": [btn(p.error)[1]],
  };
  for (const [name, [cols, style]] of Object.entries(frames)) set(`frame-${name}`, frameUrl(cols, style));
  // Portrait badge: antique brass · clean digital card · jade and paper · starry pastel.
  const portrait: Record<WorldId, [FrameColors, FrameStyle?]> = {
    "western-fantasy": [[p.accent.hi, p.surface, p.accent.base, p.accent.lo], { inlay: mix(p.accent.lo, p.surface, 0.3) }],
    modern: [[white, white, p.line, p.primary.lo]],
    "ancient-china": [[p.primary.hi, p.surface, p.primary.base, p.primary.lo], { inlay: mix(p.surface, p.well, 0.5) }],
    otherworld: [[p.accent.hi, p.surface, p.accent.base, p.primary.lo], { inlay: p.secondary.hi }],
  };
  set("frame-portrait", frameUrl(...portrait[t.baseTheme]));
  // Game stage rim and world cards for this world: same geometry, the skin's own material.
  const rim = t.baseTheme === "western-fantasy" ? p.accent : p.primary;
  set(`frame-world-${t.baseTheme}`, frameUrl([rim.hi, p.surface, rim.base, rim.lo], panelStyle));

  // Motifs (Layer B corners + Layer D description motifs in the page pattern)
  const cornerA = b.corners[0];
  const cornerB = t.decorativeMotifIds[0] ?? b.corners[1];
  set("motif-corner-a", svgUrl(motifSvg(cornerA, t.baseTheme === "ancient-china" ? p.accent.lo : mix(p.accent.lo, p.ink, 0.15))));
  set("motif-corner-b", svgUrl(motifSvg(cornerB, mix(p.primary.lo, p.surface, 0.15))));
  const patternIds: MotifId[] = [...t.decorativeMotifIds, ...b.vocabulary].filter((x, i, a) => a.indexOf(x) === i).slice(0, 3);
  set("bg-pattern", svgUrl(patternSvg(patternIds, mix(p.bg, p.frameLine, 0.22))));
  set("motion-preset", b.motion);
  if (b.serifDisplay) set("font-display", "var(--font-pixelify), var(--font-noto-serif-sc), var(--font-noto-sc), system-ui, serif");
  return v;
}

/** Data attributes that go with the vars (CSS keys on them for per-world details). */
export function themeAttributes(t: WorldUiTheme) {
  return { "data-world-theme": t.baseTheme, "data-mood": t.moodVariant, "data-density": t.decorationDensity, "data-motion-preset": BASES[t.baseTheme].motion };
}
