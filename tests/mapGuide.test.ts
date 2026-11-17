import { describe, expect, it } from "vitest";
import { GUIDE_LEGEND, checkAlignment, generateKitMap, guideFromPlan, M, type LabelKey } from "@/lib/mapgen";
import { guidedMapPrompt } from "@/lib/ai/mapPrompt";
import { WALKABLE_MATERIALS } from "@/lib/mapgen/village";

const label = (k: LabelKey) => k;
const kitFor = (description: string, type: "street" | "wilderness" | "ruins" = "street") => generateKitMap({ description, type, nonce: 1, label });

describe("guided map art: block-out of the gameplay plan", () => {
  it("gives every legend entry its own colour", () => {
    expect(new Set(GUIDE_LEGEND.map((e) => e.hex)).size).toBe(GUIDE_LEGEND.length);
  });

  it("draws the block-out on the plan's own grid, with walkable ground where the play area is", () => {
    const kit = kitFor("village square with two houses, a well and a bench");
    const { guide, classes } = guideFromPlan(kit.plan.bp, kit.plan.props);
    expect(guide.w).toBe(480);
    expect(guide.h).toBe(320);
    const { cols, rows, floor } = kit.scene;
    // Every floor cell's centre is drawn as a walkable material in the block-out (nothing drawn over the play area).
    let floorCells = 0;
    let groundCentres = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (floor[r * cols + c] !== "1") continue;
        floorCells++;
        const x = Math.floor((c + 0.5) * (480 / cols));
        const y = Math.floor((r + 0.5) * (320 / rows));
        if (WALKABLE_MATERIALS.includes(classes[y * 480 + x])) groundCentres++;
      }
    expect(groundCentres / floorCells).toBeGreaterThan(0.95);
    // Buildings are in it.
    expect(classes.includes(20)).toBe(true);
    expect(classes.includes(21)).toBe(true);
  });

  it("scores a picture that copies the layout as aligned, and one painted over the roads as not", () => {
    const kit = kitFor("village square with two houses, a well and a bench");
    const { guide, classes } = guideFromPlan(kit.plan.bp, kit.plan.props);
    const good = checkAlignment(guide, classes, kit.scene);
    expect(good.floorClear).toBeGreaterThan(0.9);
    expect(good.solidsPresent).toBeGreaterThan(0.95);
    // Paint the roof colour over every walkable pixel: the floor no longer looks like ground.
    const bad = { w: guide.w, h: guide.h, data: new Uint8ClampedArray(guide.data) };
    const roof = GUIDE_LEGEND.find((e) => e.id === 21)!.hex;
    const rgb = [1, 3, 5].map((i) => parseInt(roof.slice(i, i + 2), 16));
    for (let i = 0; i < classes.length; i++) if (classes[i] === M.DIRT || classes[i] === M.STONE) bad.data.set(rgb, i * 4);
    expect(checkAlignment(bad, classes, kit.scene).floorClear).toBeLessThan(good.floorClear - 0.2);
  });

  it("works for every kind of place the kit plans", () => {
    for (const [d, t] of [["forest path", "wilderness"], ["riverbank with a bridge", "wilderness"], ["temple ruins", "ruins"], ["desert oasis", "street"], ["magical clearing", "wilderness"]] as const) {
      const kit = kitFor(d, t);
      const { guide, classes } = guideFromPlan(kit.plan.bp, kit.plan.props);
      expect(checkAlignment(guide, classes, kit.scene).floorClear).toBeGreaterThan(0.85);
    }
  });

  it("tells the image service to keep the layout and lists the colour key", () => {
    const p = guidedMapPrompt({ description: "village square", type: "street", world: "western-fantasy", legend: GUIDE_LEGEND });
    expect(p).toMatch(/LAYOUT BLOCK-OUT/);
    expect(p).toMatch(/Keep the layout exactly/);
    for (const e of GUIDE_LEGEND) expect(p).toContain(e.hex);
    expect(p).toMatch(/three-quarter top-down/);
  });
});
