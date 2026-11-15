/**
 * LIVE image-generation checks (OpenAI). Costs a few cents (1 sprite + 1 map); skipped unless asked:
 *
 *   RUN_LIVE_IMAGES=1 npx vitest run tests/live/image.live.test.ts
 *
 * The key is read from the server environment, or from .env.local if the
 * variable isn't set (it is never printed). Results go through the same
 * /api/ai/sprite and /api/ai/map routes the game uses, and the generated
 * files are written to tests/live/images/ (git-ignored) so you can look at them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(__dirname, "images");

function loadEnvLocal() {
  const f = path.join(ROOT, ".env.local");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (process.env.RUN_LIVE_IMAGES === "1") loadEnvLocal();
const LIVE = process.env.RUN_LIVE_IMAGES === "1" && !!process.env.OPENAI_API_KEY;

/** Width, height and PNG colour type (6 = RGBA, so transparency is possible). */
function pngInfo(b: Buffer) {
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}
function webpSize(b: Buffer) {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
const fromDataUrl = (u: string) => Buffer.from(u.slice(u.indexOf(",") + 1), "base64");

describe.skipIf(!LIVE)("live image generation (OpenAI)", () => {
  beforeAll(() => mkdirSync(OUT, { recursive: true }));

  it("the key is accepted and the image model is available", async () => {
    const { verifyKeys } = await import("@/lib/ai/server/verify");
    const openai = (await verifyKeys(true)).find((c) => c.service === "openai")!;
    expect(openai.result).toBe("ok");
  }, 30_000);

  it("turns a reference image into a separate transparent pixel character", async () => {
    const { POST } = await import("@/app/api/ai/sprite/route");
    const refPath = path.join(ROOT, "public/assets/characters/portrait-01.png");
    const ref = readFileSync(refPath);
    const before = Buffer.from(ref);
    const form = new FormData();
    form.set("image", new Blob([ref], { type: "image/png" }), "reference.png");
    form.set("appearance", "short teal hair, round glasses, mustard scarf");
    form.set("world", "western-fantasy");
    const res = await POST(new Request("http://local/api/ai/sprite", { method: "POST", body: form }));
    const data = await res.json();
    expect(res.status, JSON.stringify(data)).toBe(200);
    const png = fromDataUrl(data.image);
    writeFileSync(path.join(OUT, "sprite.png"), png);
    const info = pngInfo(png);
    expect(info.colorType).toBe(6); // RGBA: transparent background is possible
    expect(info.width).toBe(1024);
    // The reference file itself is untouched.
    expect(readFileSync(refPath).equals(before)).toBe(true);
  }, 200_000);

  it("draws a map from the written description and environment type", async () => {
    const { POST } = await import("@/app/api/ai/map/route");
    const description = "A cozy bookshop interior with a red sofa by a round window, tall shelves on the left and a cat asleep on the counter.";
    const res = await POST(new Request("http://local/api/ai/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, type: "interior", world: "modern" }) }));
    const data = await res.json();
    expect(res.status, JSON.stringify(data)).toBe(200);
    const img = fromDataUrl(data.image);
    const isWebp = img.toString("ascii", 8, 12) === "WEBP";
    writeFileSync(path.join(OUT, isWebp ? "map.webp" : "map.png"), img);
    const size = isWebp ? webpSize(img) : pngInfo(img);
    expect(size).toMatchObject({ width: 1536, height: 1024 });
  }, 200_000);
});
