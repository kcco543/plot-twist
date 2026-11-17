import { describe, expect, it } from "vitest";
import { blank, type Img } from "@/lib/sprites/pixelize";
import { MAP_NATIVE_WIDTH, MAP_PALETTE, colorCount, despeckle, enlarge, guessWalkable, isNativeSize, nativeSize, snapMapToGrid } from "@/lib/pixelArt/mapPixels";
import { DEFAULT_STAGE_WIDTH, STAGE_WIDTHS, defaultLayout, readLayout } from "@/lib/scene/layout";
import { MAP_COMPOSITION, MAP_STYLE, mapEditPrompt, mapPrompt } from "@/lib/ai/server/mapPrompt";
import { hiddenBehind } from "@/components/game/SceneLayers";

const set = (img: Img, x: number, y: number, c: number[]) => img.data.set([...c, 255], (y * img.w + x) * 4);

/** A fake "generated" 1536×1024 map: calm sandy floor in the middle, busy hedges round the edges, a pond lower left, sub-pixel noise everywhere. */
function fakeMap(): Img {
  const W = 1536, H = 1024;
  const img = blank(W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const fx = x / W, fy = y / H;
      const edge = fx < 0.12 || fx > 0.88 || fy < 0.22 || fy > 0.92;
      const pond = (fx - 0.25) ** 2 / 0.01 + (fy - 0.72) ** 2 / 0.015 < 1;
      let c: number[];
      if (pond) c = [60, 140, 190];
      else if (edge) c = ((x >> 3) + (y >> 3)) % 2 ? [40, 110, 50] : [150, 200, 90]; // hedge texture: strong 8 px checker
      else c = ((x >> 5) + (y >> 4)) % 2 ? [232, 200, 150] : [220, 188, 140]; // planks: two close tones
      // Painterly noise the snap must remove.
      set(img, x, y, c.map((v) => Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 18)))));
    }
  return img;
}

describe("snapMapToGrid", () => {
  const big = fakeMap();
  const snapped = snapMapToGrid(big);

  it("puts the map on the native art-pixel grid with a limited palette", () => {
    expect(snapped.w).toBe(MAP_NATIVE_WIDTH);
    expect(snapped.h).toBe(320);
    expect(colorCount(big)).toBeGreaterThan(1000);
    expect(colorCount(snapped)).toBeLessThanOrEqual(MAP_PALETTE);
  });

  it("is opaque everywhere", () => {
    for (let i = 3; i < snapped.data.length; i += 4) expect(snapped.data[i]).toBe(255);
  });

  it("native sizes follow the picture's aspect ratio", () => {
    expect(nativeSize(1536, 1024)).toEqual({ width: 480, height: 320 });
    expect(nativeSize(1024, 1024)).toEqual({ width: 480, height: 480 });
    expect(isNativeSize(480)).toBe(true);
    expect(isNativeSize(1536)).toBe(false);
  });

  it("enlarge is exact nearest-neighbour", () => {
    const e = enlarge(snapped, 1536, 1024);
    expect(e.w).toBe(1536);
    expect(colorCount(e)).toBe(colorCount(snapped));
    expect(Array.from(e.data.subarray(0, 4))).toEqual(Array.from(snapped.data.subarray(0, 4)));
  });
});

describe("despeckle", () => {
  it("removes a lone pixel but keeps a one-pixel line", () => {
    const img = blank(9, 9);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) set(img, x, y, [200, 180, 140]);
    set(img, 2, 2, [10, 10, 10]); // stray
    for (let x = 0; x < 9; x++) set(img, x, 6, [80, 50, 30]); // outline
    const out = despeckle(img);
    expect(Array.from(out.data.subarray((2 * 9 + 2) * 4, (2 * 9 + 2) * 4 + 3))).toEqual([200, 180, 140]);
    expect(Array.from(out.data.subarray((6 * 9 + 4) * 4, (6 * 9 + 4) * 4 + 3))).toEqual([80, 50, 30]);
  });
});

describe("guessWalkable", () => {
  const snapped = snapMapToGrid(fakeMap());
  const { cols, rows } = defaultLayout(snapped.w, snapped.h);
  const floor = guessWalkable(snapped, cols, rows)!;
  const at = (fx: number, fy: number) => floor[Math.floor(fy * rows) * cols + Math.floor(fx * cols)];

  it("finds the big calm ground in the middle", () => {
    expect(floor).not.toBeNull();
    expect(at(0.55, 0.55)).toBe("1");
    expect(at(0.7, 0.4)).toBe("1");
  });

  it("leaves busy edges and water out", () => {
    expect(at(0.04, 0.5)).toBe("0");
    expect(at(0.5, 0.05)).toBe("0");
    expect(at(0.25, 0.72)).toBe("0");
  });

  it("gives up on a picture with no calm ground (the caller uses the shape guess)", () => {
    const noise = blank(96, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) set(noise, x, y, (x + y) % 2 ? [20, 90, 40] : [200, 220, 120]);
    expect(guessWalkable(noise, 96, 64)).toBeNull();
  });
});

describe("scene layout on the pixel grid", () => {
  it("plays a native map at its own size: one map pixel = one character pixel", () => {
    expect(defaultLayout(480, 320).stageWidth).toBe(480);
    expect(readLayout({ ...defaultLayout(480, 320), stageWidth: STAGE_WIDTHS.tiny }, 480, 320).stageWidth).toBe(480);
  });

  it("keeps the character-size choice for older high-resolution maps", () => {
    expect(defaultLayout(1536, 1024).stageWidth).toBe(DEFAULT_STAGE_WIDTH);
    expect(readLayout({ ...defaultLayout(1536, 1024), stageWidth: STAGE_WIDTHS.tiny }, 1536, 1024).stageWidth).toBe(STAGE_WIDTHS.tiny);
  });

  it("the play-area grid is the same for a map and its pixel-grid copy, so painted floors line up", () => {
    const a = defaultLayout(1536, 1024);
    const b = defaultLayout(480, 320);
    expect([a.cols, a.rows]).toEqual([b.cols, b.rows]);
  });
});

describe("map prompts follow the style guide", () => {
  it("asks for the native pixel canvas, character scale and open ground", () => {
    const p = mapPrompt({ description: "a bakery", type: "interior", world: "western-fantasy" });
    expect(p).toContain(MAP_STYLE);
    expect(p).toContain(MAP_COMPOSITION);
    expect(p).toContain("480 by 320");
    expect(p).toContain("28 pixels tall");
    expect(p).toMatch(/two thirds of the picture is open, walkable ground/);
    expect(p).toMatch(/no gradients, no blur/i);
  });

  it("region edits keep the same pixel size", () => {
    expect(mapEditPrompt({ instruction: "add a well" })).toMatch(/same pixel size and grid/);
  });
});

describe("occlusion fade", () => {
  const front = { bounds: { x0: 100, y0: 50, x1: 160, y1: 90 }, baseY: 90 };
  it("fades a cut-out only while someone stands behind it", () => {
    expect(hiddenBehind({ x: 130, y: 80 }, front)).toBe(true);
    expect(hiddenBehind({ x: 130, y: 95 }, front)).toBe(false); // in front
    expect(hiddenBehind({ x: 40, y: 80 }, front)).toBe(false); // beside
  });
});
