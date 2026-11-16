import { afterEach, describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { hexToRgb, hslToRgb, hsvToRgb, nearestInPalette, parseHex, pushRecent, rgbToHex, rgbToHsl, rgbToHsv } from "@/lib/color/color";
import { pantoneMatch, registerPantoneProvider } from "@/lib/color/pantone";

describe("colour maths", () => {
  it("parses HEX (3 or 6 digits, with or without #) and refuses anything else", () => {
    expect(parseHex("#ABC")).toBe("#aabbcc");
    expect(parseHex("5b4a86")).toBe("#5b4a86");
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("pink")).toBeNull();
  });

  it("round-trips HEX ↔ RGB ↔ HSV ↔ HSL without drifting", () => {
    for (const hex of ["#000000", "#ffffff", "#5b4a86", "#f5a8c5", "#9de3c8", "#ff0000", "#00ff00", "#0000ff", "#808080"]) {
      const rgb = hexToRgb(hex);
      expect(rgbToHex(rgb)).toBe(hex);
      // Integer HSV/HSL lose a little precision; never more than 2 per channel.
      for (const back of [hsvToRgb(rgbToHsv(rgb)), hslToRgb(rgbToHsl(rgb))]) {
        expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(2);
        expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(2);
        expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(2);
      }
    }
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 });
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
  });

  it("limited-palette mode snaps to the nearest palette colour", () => {
    const pal = ["#000000", "#ffffff", "#f5a8c5", "#9de3c8"];
    expect(nearestInPalette("#f0a0c0", pal)).toBe("#f5a8c5");
    expect(nearestInPalette("#101010", pal)).toBe("#000000");
  });

  it("recent colours: newest first, no duplicates, capped", () => {
    let r: string[] = [];
    for (const h of ["#111111", "#222222", "#111111"]) r = pushRecent(r, h, 2);
    expect(r).toEqual(["#111111", "#222222"]);
  });
});

describe("Pantone: no invented codes", () => {
  afterEach(() => registerPantoneProvider(null));

  it("without a licensed library it says so and returns no code", () => {
    expect(pantoneMatch("#f5a8c5")).toEqual({ status: "unavailable" });
    expect(en.editor.pantone.unavailable).toMatch(/licensed/i);
    expect(zh.editor.pantone.unavailable).toMatch(/授权/);
  });

  it("an approximate provider is always labelled unverified; only a verified one is shown as official", () => {
    registerPantoneProvider({ name: "Test approximation", verified: false, nearest: () => ({ code: "TEST-0001", hex: "#f5a8c5" }) });
    expect(pantoneMatch("#f5a8c5")).toMatchObject({ status: "match", verified: false });
    registerPantoneProvider({ name: "Broken", verified: true, nearest: () => { throw new Error("x"); } });
    expect(pantoneMatch("#f5a8c5")).toEqual({ status: "none", provider: "Broken" });
  });

  it("no Pantone-looking codes are hard-coded in the game", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(__dirname, "..", "src");
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx|json)$/.test(e.name) && files.push(path.join(d, e.name))));
    walk(root);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/\b\d{2}-\d{4}\s?(TCX|TPX|TPG)\b|PANTONE\s+\d{3,4}\s?[CU]\b/);
  });
});

describe("colour picker strings", () => {
  it("exist in both languages", () => {
    expect(Object.keys(zh.editor.colorPicker).sort()).toEqual(Object.keys(en.editor.colorPicker).sort());
    expect(Object.keys(zh.editor.pantone).sort()).toEqual(Object.keys(en.editor.pantone).sort());
  });
});
