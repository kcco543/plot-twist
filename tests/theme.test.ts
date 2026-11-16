import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { contrast } from "../src/lib/theme/color";
import { frameGrid } from "../src/lib/theme/frames";
import { APPROVED_ACCENTS, BASE_THEMES, buildThemeVars, defaultUiTheme, DENSITIES, MOODS, resolveUiTheme, sanitizeUiTheme, SEMANTIC_TOKENS, THEMED_FRAMES, themePalette, type WorldUiTheme } from "../src/lib/theme/themes";
import { suggestTheme } from "../src/lib/theme/suggest";

const every = (): WorldUiTheme[] => BASE_THEMES.flatMap((b) => MOODS.map((m) => ({ ...defaultUiTheme(b), moodVariant: m })));

/** Decode a frames.css data-URI SVG back into a 12×12 colour grid. */
function decode(url: string): (string | null)[][] {
  const svg = decodeURIComponent(url.replace(/^url\("data:image\/svg\+xml,/, "").replace(/"\)$/, ""));
  const g: (string | null)[][] = Array.from({ length: 12 }, () => Array(12).fill(null));
  for (const m of svg.matchAll(/<rect x='(\d+)' y='(\d+)' width='(\d+)' height='1' fill='(#[0-9a-f]{6})'\/>/g)) {
    for (let k = 0; k < Number(m[3]); k++) g[Number(m[2])][Number(m[1]) + k] = m[4];
  }
  return g;
}

describe("world UI themes", () => {
  it("runtime frames use exactly the brand frame geometry", () => {
    const css = fs.readFileSync("src/app/frames.css", "utf8");
    const panel = css.match(/--frame-panel: (url\(".*?"\));/)![1];
    expect(frameGrid(["#ffffff", "#fffaf3", "#efe4f7", "#b8a8dc"])).toEqual(decode(panel));
    // Same transparent corner steps in every themed frame, inlay or not.
    const mask = (g: (string | null)[][]) => g.map((r) => r.map((c) => (c ? 1 : 0)));
    expect(mask(frameGrid(["#111111", "#222222", "#333333", "#444444"], { inlay: "#555555" }))).toEqual(mask(decode(panel)));
  });

  it("defines every semantic token and every re-coloured frame, for every base and mood", () => {
    for (const t of every()) {
      const v = buildThemeVars(t);
      for (const k of SEMANTIC_TOKENS) expect(v[`--pt-${k}`], `${t.baseTheme}/${t.moodVariant} --pt-${k}`).toBeTruthy();
      for (const f of THEMED_FRAMES) expect(v[`--frame-${f}`], `${t.baseTheme} frame ${f}`).toMatch(/^url\("data:image\/svg\+xml,/);
    }
    // The brand (no world) defines the same semantic tokens in globals.css.
    const globals = fs.readFileSync("src/app/globals.css", "utf8");
    for (const k of SEMANTIC_TOKENS) expect(globals).toContain(`--pt-${k}:`);
  });

  it("keeps the same readability in every base, mood and approved accent", () => {
    const themes = every().flatMap((t) => [t, ...APPROVED_ACCENTS[t.baseTheme].primary.map((primary, i) => ({ ...t, approvedAccentOverrides: { primary, accent: APPROVED_ACCENTS[t.baseTheme].accent[i] } }))]);
    for (const t of themes) {
      const p = themePalette(t);
      const id = `${t.baseTheme}/${t.moodVariant}/${JSON.stringify(t.approvedAccentOverrides)}`;
      expect(contrast(p.ink, p.surface), id).toBeGreaterThanOrEqual(7);
      expect(contrast(p.ink, p.bg), id).toBeGreaterThanOrEqual(7);
      expect(contrast(p.inkSoft, p.surface), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.label, p.surface), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.rose, p.surface), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.successText, p.surface), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.errorText, p.surface), id).toBeGreaterThanOrEqual(4.5);
      // Button text (ink) on every candy button face.
      for (const r of [p.primary, p.accent, p.secondary, p.calm, p.success, p.error]) expect(contrast(p.ink, r.base), id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.focus, p.surface), id).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses the brief's base colours for the default mood", () => {
    const wf = themePalette(defaultUiTheme("western-fantasy"));
    expect(wf.bg).toBe("#f3ebd6");
    expect(wf.surface).toBe("#fff7e8");
    expect(wf.primary.lo).toBe("#668a72");
    expect(wf.accent.lo).toBe("#b98b43");
    expect(themePalette(defaultUiTheme("modern")).surface).toBe("#ffffff");
    expect(themePalette(defaultUiTheme("ancient-china")).accent.lo).toBe("#b95349");
    expect(themePalette(defaultUiTheme("otherworld")).bg).toBe("#efe8fa");
  });

  it("validates stored themes: unknown values fall back, unapproved colours and motifs are dropped", () => {
    expect(sanitizeUiTheme(undefined, "modern")).toBeNull();
    expect(sanitizeUiTheme({ baseTheme: "modern" }, "otherworld")).toBeNull(); // world type changed: use the new default
    const t = sanitizeUiTheme(
      { baseTheme: "modern", moodVariant: "evil", approvedAccentOverrides: { primary: "#ff0000", accent: "#F2B05A" }, decorativeMotifIds: ["window", "<script>", "raindrop", "star", "moon"], decorationDensity: "max", confirmed: true },
      "modern",
    )!;
    expect(t.moodVariant).toBe("default");
    expect(t.approvedAccentOverrides).toEqual({ accent: "#f2b05a" });
    expect(t.decorativeMotifIds).toEqual(["window", "raindrop", "star"]);
    expect(t.decorationDensity).toBe("standard");
    expect(DENSITIES).toContain(t.decorationDensity);
    // Legacy worlds (no theme saved) get their world type's default; no world = brand.
    expect(resolveUiTheme({ worldId: "ancient-china" })).toMatchObject({ baseTheme: "ancient-china", moodVariant: "default", confirmed: false });
    expect(resolveUiTheme({ worldId: null })).toBeNull();
  });
});

describe("theme suggestions from the world description", () => {
  it("matches the brief's examples", () => {
    const a = suggestTheme("A crowded mushroom marketplace floating in the clouds.", "otherworld");
    expect(["cheerful", "dreamy"]).toContain(a.mood);
    expect(a.motifs).toEqual(expect.arrayContaining(["mushroom", "cloud"]));
    const b = suggestTheme("A quiet temple library hidden in the mountains.", "ancient-china");
    expect(["sacred", "calm", "mysterious"]).toContain(b.mood);
    expect(b.motifs).toEqual(expect.arrayContaining(["mountain"]));
    const c = suggestTheme("A rainy apartment neighborhood with neon convenience stores.", "modern");
    expect(c.mood).toBe("moody");
    expect(c.motifs).toEqual(expect.arrayContaining(["raindrop", "window"]));
  });
  it("works in Chinese", () => {
    const s = suggestTheme("山中安静的寺庙藏书阁，云雾缭绕", "ancient-china");
    expect(s.confidence).not.toBe("none");
    expect(s.motifs).toContain("mountain");
  });
  it("suggests nothing from vague or empty text", () => {
    expect(suggestTheme("", "modern").confidence).toBe("none");
    expect(suggestTheme("A place.", "modern")).toMatchObject({ mood: "default", motifs: [], confidence: "none" });
  });
});

import { migrateSave } from "../src/lib/gameStore";

describe("theme data in world saves", () => {
  it("legacy saves load unchanged with no theme (the world type's default skin is used)", () => {
    const legacy = { version: 1, worldId: "modern", characters: [], environment: { description: "x", type: "street" }, log: [], story: { turn: 3, characters: {}, bonds: {}, events: [] }, sprites: [], updatedAt: 5 };
    const s = migrateSave(legacy);
    expect(s.uiTheme).toBeUndefined();
    expect(s.story.turn).toBe(3);
    expect(resolveUiTheme(s)).toMatchObject({ baseTheme: "modern", moodVariant: "default" });
  });
  it("keeps a saved theme through a reload, and never applies one saved for a different world type", () => {
    const uiTheme = { ...defaultUiTheme("otherworld"), moodVariant: "dreamy", decorativeMotifIds: ["mushroom"], confirmed: true };
    const s = migrateSave(JSON.parse(JSON.stringify({ worldId: "otherworld", uiTheme })));
    expect(s.uiTheme).toMatchObject({ moodVariant: "dreamy", decorativeMotifIds: ["mushroom"], themeVersion: 1, confirmed: true });
    expect(migrateSave({ worldId: "modern", uiTheme }).uiTheme).toBeUndefined();
  });
});
