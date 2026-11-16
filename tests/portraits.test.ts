import { describe, expect, it } from "vitest";
import { blank, upscale, type Img } from "../src/lib/sprites/pixelize";
import {
  MAX_VERSIONS, addVersion, avatarOutdated, clampRect, createPortraits, cropImg, deleteVersion, detectScale, isProtected, normalizePortraits, presetRect, renderAvatar, restoreGenerated, saveChanges, setActiveVersion, toEditable, withAvatar,
  type PortraitVersion,
} from "../src/lib/portraits/model";
import { normalizeCharacter } from "../src/lib/character/model";
import { characterFromTemplate, templateFromCharacter } from "../src/lib/library/templates";
import { artFor } from "../src/lib/character/art";

/** A 2-heads-tall test figure on 64×64: head rows 11–29 (x 23–41), body rows 30–61 (x 16–47). Odd edges, so it is not secretly a 2× image. */
function figure(): Img {
  const img = blank(64, 64);
  const put = (x: number, y: number, c: number[]) => img.data.set(c, (y * 64 + x) * 4);
  for (let y = 11; y < 30; y++) for (let x = 23; x < 42; x++) put(x, y, [240, 200, 170, 255]);
  for (let y = 30; y < 62; y++) for (let x = 16; x < 48; x++) put(x, y, [120, 90, 200, 255]);
  return img;
}
const v = (id: string, kind: PortraitVersion["kind"], parentId: string | null = null): PortraitVersion => ({ id, kind, image: `data:${id}`, w: 64, h: 64, createdAt: 1, parentId });
const av = { rect: { x: 0, y: 0, w: 64, h: 64 }, preset: "square" as const, avatar: "data:a", avatarW: 128, avatarH: 128, thumb: "data:t" };

describe("pixel portrait images", () => {
  it("finds the true resolution of upscaled art and imports it 1:1", () => {
    const art = upscale(figure(), 2);
    expect(detectScale(art)).toBe(2);
    expect(detectScale(figure())).toBe(1);
    const e = toEditable(art);
    expect([e.w, e.h]).toEqual([64, 64]);
    expect(Array.from(e.data)).toEqual(Array.from(figure().data));
  });

  it("hardens soft alpha so imported pixels have crisp edges", () => {
    const img = blank(4, 4);
    img.data.set([10, 20, 30, 90], 0);
    img.data.set([10, 20, 30, 200], 4);
    const e = toEditable(img);
    expect(e.data[3]).toBe(0);
    expect(e.data[7]).toBe(255);
  });

  it("crops in source pixels and keeps transparency", () => {
    const c = cropImg(figure(), { x: 20, y: 8, w: 10, h: 10 });
    expect([c.w, c.h]).toEqual([10, 10]);
    expect(c.data[3]).toBe(0); // (20,8) is above the head: transparent
    expect(c.data[(5 * 10 + 5) * 4 + 3]).toBe(255);
  });

  it("clamps crop boxes to whole pixels inside the image", () => {
    expect(clampRect({ x: -3.4, y: 60.6, w: 10.4, h: 10.6 }, 64, 64)).toEqual({ x: 0, y: 53, w: 10, h: 11 });
    expect(clampRect({ x: 0, y: 0, w: 1, h: 1 }, 64, 64).w).toBe(4);
  });

  it("presets: head is a square at the top of the figure; bust is taller; square covers the figure", () => {
    const img = figure();
    const head = presetRect(img, "head");
    expect(head.w).toBe(head.h);
    expect(head.y).toBeLessThanOrEqual(11);
    expect(head.y + head.h).toBeLessThan(40);
    expect(Math.abs(head.x + head.w / 2 - 32)).toBeLessThanOrEqual(1.5);
    const bust = presetRect(img, "bust");
    expect(bust.h).toBeGreaterThan(head.h);
    const sq = presetRect(img, "square");
    expect(sq.w).toBe(sq.h);
    expect(sq.y).toBeLessThanOrEqual(11);
    expect(sq.y + sq.h).toBeGreaterThanOrEqual(62);
  });

  it("avatar is the crop scaled by a whole number (crisp); thumbnail fits 32×32", () => {
    const { avatar, thumb } = renderAvatar(figure(), { x: 22, y: 10, w: 20, h: 20 });
    expect([avatar.w, avatar.h]).toEqual([100, 100]); // ×5
    expect(Math.max(thumb.w, thumb.h)).toBeLessThanOrEqual(32);
    // Every 5×5 block is one colour: nearest-neighbour, no smoothing.
    for (let y = 0; y < avatar.h; y++) for (let x = 0; x < avatar.w; x++) {
      const a = (y * avatar.w + x) * 4;
      const b = ((y - (y % 5)) * avatar.w + (x - (x % 5))) * 4;
      expect(avatar.data[a]).toBe(avatar.data[b]);
    }
  });
});

describe("portrait versions", () => {
  it("never changes the generated original: editing adds versions, restore brings it back", () => {
    let p = createPortraits({ ...v("gen", "generated"), reference: "data:ref" }, av);
    expect(p.originalReferenceImage).toBe("data:ref");
    p = saveChanges(p, { image: "data:e1", w: 64, h: 64, createdAt: 2 }, "e1");
    expect(p.versions.map((x) => x.id)).toEqual(["gen", "e1"]);
    expect(p.versions[0].image).toBe("data:gen");
    expect(p.activePortraitVersion).toBe("e1");
    expect(p.editedPixelPortrait).toBe("e1");
    // Save changes again: updates the edited version in place (it isn't the avatar source).
    p = saveChanges(p, { image: "data:e1b", w: 64, h: 64, createdAt: 3 }, "unused");
    expect(p.versions.map((x) => x.id)).toEqual(["gen", "e1"]);
    expect(p.versions[1].image).toBe("data:e1b");
    p = restoreGenerated(p);
    expect(p.activePortraitVersion).toBe("gen");
    expect(p.versions).toHaveLength(2);
  });

  it("does not overwrite the version the avatar was cut from, and flags the avatar as outdated instead of re-cutting it", () => {
    let p = createPortraits(v("gen", "generated"), av);
    p = addVersion(p, v("e1", "edited", "gen"));
    p = withAvatar(p, "e1", av);
    p = saveChanges(p, { image: "data:e1b", w: 64, h: 64, createdAt: 3 }, "e2");
    expect(p.versions.find((x) => x.id === "e1")!.image).toBe("data:e1");
    expect(p.activePortraitVersion).toBe("e2");
    expect(avatarOutdated(p)).toBe(true);
    expect(p.avatarCropRect).toEqual(av.rect); // the crop is kept, never reset
  });

  it("caps history without dropping the original, the active version or the avatar source", () => {
    let p = createPortraits(v("gen", "generated"), av);
    for (let i = 0; i < MAX_VERSIONS + 5; i++) p = addVersion(p, v(`e${i}`, "edited"));
    expect(p.versions.length).toBe(MAX_VERSIONS);
    expect(p.versions.some((x) => x.id === "gen")).toBe(true);
    expect(isProtected(p, "gen")).toBe(true);
    expect(deleteVersion(p, "gen")).toBe(p);
    expect(deleteVersion(p, p.activePortraitVersion)).toBe(p);
    const some = p.versions.find((x) => !isProtected(p, x.id))!;
    expect(deleteVersion(p, some.id).versions.length).toBe(MAX_VERSIONS - 1);
    expect(setActiveVersion(p, "missing")).toBe(p);
  });

  it("a new generation becomes the new original; the old one stays restorable in the list", () => {
    let p = createPortraits(v("gen1", "generated"), av);
    p = addVersion(p, { ...v("gen2", "converted"), reference: "data:r2" });
    expect(p.generatedPixelPortrait).toBe("gen2");
    expect(p.originalReferenceImage).toBe("data:r2");
    expect(p.versions.map((x) => x.id)).toContain("gen1");
  });
});

describe("portrait persistence and world isolation", () => {
  const withPortraits = () => normalizeCharacter({ id: "c1", name: "Mira", portraits: createPortraits(v("gen", "generated"), av) });

  it("survives a save round trip; broken data is dropped instead of half-loaded", () => {
    const c = withPortraits();
    const back = normalizeCharacter(JSON.parse(JSON.stringify(c)));
    expect(back.portraits).toEqual(c.portraits);
    expect(normalizeCharacter({ id: "x", portraits: { versions: [] } }).portraits).toBeUndefined();
    expect(normalizePortraits({ versions: [{ id: "a" }] })).toBeNull();
    // Older saves without portraits load exactly as before.
    expect(normalizeCharacter({ id: "old", art: { sprite: "s", portrait: "p", assetId: "a", source: "ai" } }).portraits).toBeUndefined();
  });

  it("the avatar is what the game shows as the portrait", () => {
    const c = withPortraits();
    expect(artFor(c).portrait).toMatchObject({ src: "data:a", width: 128, height: 128 });
  });

  it("each world copy edits independently; the library original is untouched", () => {
    const original = templateFromCharacter(withPortraits(), "tpl1", 1);
    const worldA = characterFromTemplate(original, "a1", 2);
    const worldB = characterFromTemplate(original, "b1", 2);
    worldA.portraits = addVersion(worldA.portraits!, v("editA", "edited"));
    expect(worldA.portraits!.versions).toHaveLength(2);
    expect(worldB.portraits!.versions).toHaveLength(1);
    expect(original.portraits!.versions).toHaveLength(1);
  });
});
