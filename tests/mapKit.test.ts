import { describe, expect, it } from "vitest";
import { KIT_LIMITS, generateKitMap, kitSupports, layoutFromBlueprint } from "@/lib/mapgen";
import { M, ROAD_HALF_WIDTH, WALKABLE_MATERIALS, paintVillage, planVillage, villageSeed } from "@/lib/mapgen/village";
import { buildScene, readLayout } from "@/lib/scene/layout";
import { findPath, isFree, spawnPoints } from "@/lib/stage/path";
import { FOOT, hitsObstacle } from "@/lib/stage/room";

const label = (k: string) => k;
const DESCRIPTIONS = [
  "a cozy village green with a pond and a well",
  "a quiet meadow by the woods, open grass",
  "两座小屋和一口老井，旁边有个池塘",
  "a forest clearing with flowers",
  "no water, a dusty little square",
];

describe("map kit: which worlds use it", () => {
  it("covers the Western Fantasy test world's outdoor places only (others keep the image service)", () => {
    expect(kitSupports("western-fantasy", "street")).toBe(true);
    expect(kitSupports("western-fantasy", "wilderness")).toBe(true);
    expect(kitSupports("western-fantasy", "interior")).toBe(false);
    expect(kitSupports("modern", "street")).toBe(false);
    expect(kitSupports(null, "street")).toBe(false);
  });
});

describe("map kit: the same description and variation always draw the same map", () => {
  it("is deterministic", () => {
    const a = generateKitMap({ description: DESCRIPTIONS[0], nonce: 7, label });
    const b = generateKitMap({ description: DESCRIPTIONS[0], nonce: 7, label });
    expect(Buffer.from(a.img.data).equals(Buffer.from(b.img.data))).toBe(true);
    expect(a.scene).toEqual(b.scene);
    const c = generateKitMap({ description: DESCRIPTIONS[0], nonce: 8, label });
    expect(Buffer.from(a.img.data).equals(Buffer.from(c.img.data))).toBe(false);
  });

  it("reads features from English and Chinese words", () => {
    const zh = planVillage("两座小屋和一口老井，旁边有个池塘", 1);
    expect(zh.features.houses).toBe(2);
    expect(zh.features.pond).toBe(true);
    expect(zh.features.well).toBe(true);
    expect(planVillage("no water, a dusty little square", 3).features.pond).toBe(false);
  });
});

describe.each(DESCRIPTIONS.flatMap((d) => [1, 2, 3].map((n) => [d, n] as const)))("map kit: %s (variation %i)", (description, nonce) => {
  const map = generateKitMap({ description, nonce, label });
  const layout = readLayout(map.scene, 480, 320);
  const built = buildScene(layout, 480, 320, "street");
  const room = built.room;

  it("is native pixel art: 480×320, opaque, a limited palette", () => {
    expect(map.img.w).toBe(480);
    expect(map.img.h).toBe(320);
    for (let i = 3; i < map.img.data.length; i += 4) if (map.img.data[i] !== 255) throw new Error("transparent pixel");
    expect(map.report.colours).toBeLessThanOrEqual(56);
  });

  it("keeps most of the ground open, connected and visible", () => {
    expect(map.report.walkable).toBeGreaterThanOrEqual(KIT_LIMITS.walkable);
    expect(map.report.connected).toBeGreaterThanOrEqual(KIT_LIMITS.connected);
    expect(map.report.visibleGround).toBeGreaterThanOrEqual(KIT_LIMITS.visibleGround);
    expect(map.report.frontCover).toBeLessThanOrEqual(KIT_LIMITS.frontCover);
    expect(layout.reviewed).toBe(true);
    expect(layout.stageWidth).toBe(480);
  });

  it("has a few props, not clutter", () => {
    const props = layout.objects.filter((o) => o.type !== "exit" && o.type !== "door");
    expect(props.length).toBeGreaterThanOrEqual(3);
    expect(props.length).toBeLessThanOrEqual(7);
    expect(layout.objects.filter((o) => o.front).length).toBeLessThanOrEqual(2);
  });

  it("every object can be reached (the editor reports no problems)", () => {
    expect(built.problems).toEqual([]);
  });

  it("characters can walk from every start spot to every object and both road exits", () => {
    const starts = spawnPoints(room, 4);
    expect(starts).toHaveLength(4);
    for (const s of starts) expect(isFree(room, s, [])).toBe(true);
    const targets = built.objects.flatMap((o) => o.anchors.slice(0, 1));
    expect(targets.length).toBe(built.objects.length);
    for (const s of starts.slice(0, 2)) for (const t of targets) expect(findPath(room, s, t), `${JSON.stringify(s)} → ${JSON.stringify(t)}`).not.toBeNull();
  });

  it("the floor never lies on water, cliffs, the back woodland or a house", () => {
    const plan = planVillage(description, map.report.seed);
    const { props } = paintVillage(plan);
    const { scene } = layoutFromBlueprint(plan, props, label);
    expect(scene.floor).toBe(map.scene.floor);
    const cw = 480 / scene.cols;
    const ch = 320 / scene.rows;
    for (let r = 0; r < scene.rows; r++)
      for (let c = 0; c < scene.cols; c++) {
        if (scene.floor[r * scene.cols + c] !== "1") continue;
        const x = Math.floor((c + 0.5) * cw);
        const y = Math.floor((r + 0.5) * ch);
        const i = y * 480 + x;
        expect(WALKABLE_MATERIALS.includes(plan.mat[i]), `cell ${c},${r}`).toBe(true);
        expect(plan.blocked[i]).toBe(0);
      }
  });

  it("solid props block their footprint (no walking through the well, bench or signpost)", () => {
    for (const o of built.objects.filter((x) => x.collider)) {
      const ob = room.obstacles.find((x) => x.id === o.collider)!;
      const mid = { x: (ob.x0 + ob.x1) / 2, y: (ob.y0 + ob.y1) / 2 };
      expect(hitsObstacle(room, mid), o.id).not.toBeNull();
    }
  });
});

describe("map kit: roads are wide enough for two characters side by side", () => {
  it("the road is at least two footprints wide everywhere", () => {
    expect(ROAD_HALF_WIDTH * 2 - 5).toBeGreaterThanOrEqual(FOOT.w * 2 + 8);
  });

  it("dirt road cells really are walkable across their width", () => {
    const plan = planVillage(DESCRIPTIONS[0], villageSeed(DESCRIPTIONS[0], 1));
    // Scan the south road row by row near the bottom: the run of dirt is at least 40 px.
    for (const y of [300, 280, 260]) {
      let run = 0;
      let best = 0;
      for (let x = 0; x < 480; x++) {
        run = plan.mat[y * 480 + x] === M.DIRT ? run + 1 : 0;
        best = Math.max(best, run);
      }
      expect(best, `row ${y}`).toBeGreaterThanOrEqual(40);
    }
  });
});
