import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/image", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/image")>();
  return { ...real, getImageProvider: vi.fn(real.getImageProvider) };
});

import { getImageProvider, type ImageProvider } from "@/lib/ai/server/image";
import { buildMask, imageSize, regionToPixels } from "@/lib/ai/server/mapMask";
import { MAP_EDIT_CONSISTENCY, MAP_STYLE, mapEditPrompt } from "@/lib/ai/server/mapPrompt";
import { featherFor, growRegion, moveRegion, oppositeCorner, regionFromPoints, regionIsUsable, regionPixels } from "@/lib/mapSelection";
import { POST as edit } from "@/app/api/ai/map/edit/route";

const mocked = vi.mocked(getImageProvider);
type EditInput = Parameters<NonNullable<ImageProvider["editMap"]>>[0];

/** Decode one of our own RGBA PNGs back into alpha values (row-major). */
function alphaOf(png: Buffer) {
  const { width, height } = imageSize(png)!;
  const chunks: Buffer[] = [];
  for (let i = 8; i < png.length; ) {
    const len = png.readUInt32BE(i);
    if (png.toString("ascii", i + 4, i + 8) === "IDAT") chunks.push(png.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const at = (x: number, y: number) => raw[y * (width * 4 + 1) + 1 + x * 4 + 3];
  return { width, height, at };
}

// A real (blank) 300×200 PNG stands in for the current map.
const MAP = buildMask(300, 200, { x: 0, y: 0, w: 0, h: 0 }, 0);

function form(fields: Record<string, string>, image: Buffer | null = MAP) {
  const f = new FormData();
  if (image) f.set("image", new Blob([new Uint8Array(image)], { type: "image/png" }), "map");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return edit(new Request("http://x/api/ai/map/edit", { method: "POST", body: f }));
}
const good = { instruction: "Add a green-roof cottage here.", x: "0.25", y: "0.25", w: "0.5", h: "0.5", description: "a meadow", type: "wilderness", world: "western-fantasy" };
const fake = (editMap?: ImageProvider["editMap"]): ImageProvider => ({ id: "fake", model: "fake-model", generateSprite: vi.fn(), generateMap: vi.fn(), generateItem: vi.fn(), editMap });

afterEach(() => mocked.mockReset());

describe("selection geometry", () => {
  it("builds a rectangle from two points in any order, inside the map", () => {
    expect(regionFromPoints(0.8, 0.9, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: 0.6000000000000001, h: 0.8 });
    expect(regionFromPoints(-1, -1, 2, 0.5)).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
  });

  it("moves without leaving the map and resizes from the opposite corner", () => {
    const r = { x: 0.5, y: 0.5, w: 0.4, h: 0.4 };
    expect(moveRegion(r, 0.5, -0.9)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 });
    expect(oppositeCorner(r, "nw")).toEqual({ x: 0.9, y: 0.9 });
    expect(oppositeCorner(r, "se")).toEqual({ x: 0.5, y: 0.5 });
    expect(growRegion(r, 1, -1)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.03 });
  });

  it("ignores taps and slivers", () => {
    expect(regionIsUsable(null)).toBe(false);
    expect(regionIsUsable({ x: 0.1, y: 0.1, w: 0.01, h: 0.5 })).toBe(false);
    expect(regionIsUsable({ x: 0.1, y: 0.1, w: 0.05, h: 0.05 })).toBe(true);
  });

  it("maps to whole pixels with a soft border sized to the selection", () => {
    expect(regionPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1536, 1024)).toEqual({ left: 384, top: 512, width: 768, height: 256 });
    expect(featherFor(40, 40)).toBe(3);
    expect(featherFor(800, 600)).toBe(16);
  });
});

describe("edit mask", () => {
  it("reads PNG and WebP sizes", () => {
    expect(imageSize(MAP)).toEqual({ width: 300, height: 200 });
    const vp8x = Buffer.alloc(30);
    vp8x.write("RIFF", 0);
    vp8x.write("WEBPVP8X", 8);
    vp8x.writeUIntLE(1535, 24, 3);
    vp8x.writeUIntLE(1023, 27, 3);
    expect(imageSize(vp8x)).toEqual({ width: 1536, height: 1024 });
    expect(imageSize(Buffer.from("not an image at all, sorry!!!!"))).toBeNull();
  });

  it("is transparent inside the (slightly grown) selection and opaque outside", () => {
    const region = { x: 0.5, y: 0.5, w: 0.25, h: 0.25 };
    const m = alphaOf(buildMask(400, 200, region));
    expect([m.width, m.height]).toEqual([400, 200]);
    const px = regionToPixels(region, 400, 200);
    expect(px).toEqual({ left: 196, top: 96, right: 304, bottom: 154 });
    expect(m.at(250, 125)).toBe(0); // middle of the selection
    expect(m.at(197, 97)).toBe(0); // inside the blend margin
    expect(m.at(195, 125)).toBe(255); // just outside
    expect(m.at(0, 0)).toBe(255);
    expect(m.at(399, 199)).toBe(255);
  });
});

describe("mapEditPrompt", () => {
  it("keeps the house style and asks for a seamless local change", () => {
    const p = mapEditPrompt({ instruction: "Turn this area into a flower garden.", description: "a village", type: "street", world: "ancient-china" });
    expect(p).toContain(MAP_EDIT_CONSISTENCY);
    expect(p).toContain(MAP_STYLE);
    expect(p).toContain("Turn this area into a flower garden.");
    expect(p).toContain("curved tiled roofs");
    expect(p).toMatch(/no text/i);
  });

  it("passes Chinese instructions through", () => {
    expect(mapEditPrompt({ instruction: " 在这里添加一个花圃和木栅栏。\n" })).toContain("在这里添加一个花圃和木栅栏。");
  });
});

describe("/api/ai/map/edit", () => {
  it("needs an image, an instruction and a real selection", async () => {
    expect((await form(good, null)).status).toBe(400);
    expect((await form({ ...good, instruction: "  " })).status).toBe(400);
    expect((await form({ ...good, w: "0.01" })).status).toBe(400);
    expect((await form({ ...good, x: "0.8", w: "0.5" })).status).toBe(400);
    expect((await form(good, Buffer.from("<html>not a map</html>"))).status).toBe(415);
  });

  it("says when no image key is configured", async () => {
    const res = await form(good);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });

  it("says when the provider can't edit part of an image", async () => {
    mocked.mockReturnValue(fake(undefined));
    const res = await form(good);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("unsupported");
  });

  it("sends the map, a matching mask and the styled instruction", async () => {
    const editMap = vi.fn<(input: EditInput) => Promise<Buffer>>(async () => MAP);
    mocked.mockReturnValue(fake(editMap));
    const res = await form({ ...good, instruction: "把这里改成一间绿色屋顶的小屋。" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.image.startsWith("data:image/png;base64,")).toBe(true);
    const input = editMap.mock.calls[0][0];
    expect(input.image.equals(MAP)).toBe(true);
    expect([input.width, input.height]).toEqual([300, 200]);
    const mask = alphaOf(input.mask);
    expect([mask.width, mask.height]).toEqual([300, 200]);
    expect(mask.at(150, 100)).toBe(0);
    expect(mask.at(10, 10)).toBe(255);
    expect(input.prompt).toContain("把这里改成一间绿色屋顶的小屋。");
    expect(input.prompt).toContain("a meadow");
  });

  it("refuses output that is not an image", async () => {
    mocked.mockReturnValue(fake(async () => Buffer.from("<html>")));
    expect((await form(good)).status).toBe(422);
  });
});
