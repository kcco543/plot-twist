import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/image", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/image")>();
  return { ...real, getImageProvider: vi.fn(real.getImageProvider) };
});

import { getImageProvider, type ImageProvider } from "@/lib/ai/server/image";
import { MAP_STYLE, mapPrompt } from "@/lib/ai/server/mapPrompt";
import { POST as map } from "@/app/api/ai/map/route";

const mocked = vi.mocked(getImageProvider);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(16)]);
const post = (body: unknown) => map(new Request("http://x/api/ai/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const fake = (generateMap: ImageProvider["generateMap"]): ImageProvider => ({ id: "fake", model: "fake-model", generateSprite: vi.fn(), generateMap });

afterEach(() => {
  mocked.mockReset();
  delete process.env.OPENAI_API_KEY;
});

describe("mapPrompt", () => {
  it("always uses the fixed house style, whatever the description says", () => {
    const p = mapPrompt({ description: "A dark, gritty cyberpunk alley", type: "street", world: "modern" });
    expect(p).toContain(MAP_STYLE);
    expect(p).toContain("keep the art style");
    expect(p).toMatch(/no text/i);
    expect(p).toMatch(/No people/);
  });

  it("adds the environment layout and world flavor", () => {
    const p = mapPrompt({ description: "tea house", type: "interior", world: "ancient-china" });
    expect(p).toContain("cutaway");
    expect(p).toContain("curved tiled roofs");
    expect(mapPrompt({ description: "x", type: "wilderness", world: null })).not.toContain("Setting flavor");
  });

  it("passes Chinese descriptions through unchanged", () => {
    const p = mapPrompt({ description: "  河边的小茶馆，\n门口挂着灯笼  ", type: "street", world: null });
    expect(p).toContain("河边的小茶馆， 门口挂着灯笼");
    expect(p).toMatch(/Chinese or English/);
  });
});

describe("/api/ai/map", () => {
  it("rejects an empty description", async () => {
    const res = await post({ description: "   ", type: "street", world: null });
    expect(res.status).toBe(400);
  });

  it("rejects unknown environment types", async () => {
    const res = await post({ description: "a garden", type: "spaceship", world: null });
    expect(res.status).toBe(400);
  });

  it("says when no image key is configured", async () => {
    const res = await post({ description: "a garden", type: "wilderness", world: null });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });

  it("returns the generated image and sends the styled prompt", async () => {
    const generateMap = vi.fn(async () => webp);
    mocked.mockReturnValue(fake(generateMap));
    const res = await post({ description: "山谷里的蘑菇村", type: "wilderness", world: "otherworld" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.image.startsWith("data:image/webp;base64,")).toBe(true);
    expect(data.model).toBe("fake-model");
    const prompt = (generateMap.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain("山谷里的蘑菇村");
    expect(prompt).toContain(MAP_STYLE);
  });

  it("refuses output that is not an image", async () => {
    mocked.mockReturnValue(fake(async () => Buffer.from("<html>")));
    const res = await post({ description: "a garden", type: "wilderness", world: null });
    expect(res.status).toBe(422);
  });

  it("does not run more than two maps at once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocked.mockReturnValue(fake(async () => (await gate, webp)));
    const body = { description: "a garden", type: "wilderness", world: null };
    const a = post(body);
    const b = post(body);
    await new Promise((r) => setTimeout(r, 10));
    expect((await post(body)).status).toBe(429);
    release();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
  });
});
