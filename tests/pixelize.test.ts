import { describe, expect, it } from "vitest";
import { blank, checkSprite, contentBox, makePortrait, makeSprite, type Img } from "@/lib/sprites/pixelize";

/** A 400×600 "character" on a flat cream background: head, body in two colors, soft anti-aliased edge. */
function fakeUpload(): Img {
  const img = blank(400, 600);
  for (let y = 0; y < 600; y++)
    for (let x = 0; x < 400; x++) {
      const i = (y * 400 + x) * 4;
      let c = [255, 250, 243];
      const head = (x - 200) ** 2 + (y - 160) ** 2 < 90 ** 2;
      const body = x > 130 && x < 270 && y > 250 && y < 560;
      if (head) c = [250, 210, 180];
      if (body) c = y < 400 ? [245, 168, 197] : [127, 143, 224];
      if (!head && !body && (x - 200) ** 2 + (y - 160) ** 2 < 92 ** 2) c = [252, 230, 210]; // blurry edge
      img.data.set([...c, 255], i);
    }
  return img;
}

describe("pixel conversion", () => {
  it("makes a 32×32 sprite with hard edges, a limited palette and feet on row 30", () => {
    const s = makeSprite(fakeUpload(), { colors: 8, outline: true, removeBackground: true })!;
    expect(s.w).toBe(32);
    expect(checkSprite(s)).toEqual({ ok: true, issues: [] });
    const box = contentBox(s)!;
    expect(box.y + box.h - 1).toBe(30);
    expect(box.h).toBeGreaterThanOrEqual(26);
  });

  it("makes a 96×96 portrait from the top of the figure", () => {
    const p = makePortrait(fakeUpload())!;
    expect([p.w, p.h]).toEqual([96, 96]);
    for (let i = 3; i < p.data.length; i += 4) expect([0, 255]).toContain(p.data[i]);
  });

  it("reports when nothing is left to convert", () => {
    expect(makeSprite(blank(64, 64))).toBeNull();
  });

  it("flags images that don't meet the sprite spec", () => {
    const soft = blank(32, 32);
    for (let i = 3; i < soft.data.length; i += 4) soft.data[i] = 120;
    expect(checkSprite(soft).issues).toContain("softEdges");
  });
});
