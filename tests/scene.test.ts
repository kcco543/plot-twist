import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { buildScene, defaultLayout, floorShare, footprintOf, guessFloor, nameFromDescription, paintStroke, readLayout, type SceneLayout } from "@/lib/scene/layout";
import { findPath, isFree, spawnPoints } from "@/lib/stage/path";
import { FOOT, gap, hitsObstacle, insideWalk, roomFor, roomSize } from "@/lib/stage/room";
import { StageSim } from "@/lib/stage/sim";
import { validAnchors } from "@/lib/stage/objects";
import { juniper, makeChar, mei, rook } from "./helpers";

// The generated tavern in the bug report: 1536×1024, angled view.
const W = 1536;
const H = 1024;

/** A tavern-like layout: floor everywhere in the lower 70%, a bar counter across the middle with a gap on the right. */
function tavern(extra: Partial<SceneLayout> = {}): SceneLayout {
  const base = defaultLayout(W, H, "angled");
  let floor = "0".repeat(base.cols * base.rows);
  for (let r = Math.floor(base.rows * 0.3); r < base.rows - 1; r++) for (let c = 1; c < base.cols - 1; c++) floor = floor.slice(0, r * base.cols + c) + "1" + floor.slice(r * base.cols + c + 1);
  return {
    ...base,
    floor,
    objects: [
      { id: "bar", label: "bar counter", type: "item", bounds: { x0: 0.02, y0: 0.4, x1: 0.75, y1: 0.55 }, solid: true, front: true },
      { id: "rug", label: "rug", type: "seat", bounds: { x0: 0.3, y0: 0.75, x1: 0.5, y1: 0.85 }, solid: false, front: false },
    ],
    spawns: [
      { x: 0.3, y: 0.8 },
      { x: 0.6, y: 0.8 },
    ],
    reviewed: true,
    ...extra,
  };
}

describe("generated map scenes", () => {
  it("keeps the picture's aspect ratio: stage height follows the image", () => {
    const s = buildScene(tavern(), W, H, "interior");
    expect(s.size.width).toBe(480);
    expect(s.size.height).toBe(320);
    expect(roomSize(s.room)).toEqual({ width: 480, height: 320 });
    const tall = buildScene(defaultLayout(1024, 1536), 1024, 1536, "interior");
    expect(tall.size.height / tall.size.width).toBeCloseTo(1.5, 2);
  });

  it("character size changes the stage width, not the layout (layout is in fractions)", () => {
    const small = buildScene(tavern({ stageWidth: 672 }), W, H, "interior");
    const big = buildScene(tavern({ stageWidth: 400 }), W, H, "interior");
    const barS = small.room.obstacles.find((o) => o.id === "bar")!;
    const barB = big.room.obstacles.find((o) => o.id === "bar")!;
    expect(barS.x1 / small.size.width).toBeCloseTo(barB.x1 / big.size.width, 5);
  });

  it("a free-form floor: feet must be on painted cells", () => {
    const { room } = buildScene(tavern(), W, H, "interior");
    expect(insideWalk(room, { x: 240, y: 300 })).toBe(true);
    expect(insideWalk(room, { x: 240, y: 40 })).toBe(false); // the wall at the top of the picture
    expect(isFree(room, { x: 100, y: 155 })).toBe(false); // the bar's footprint
  });

  it("solid objects block walking; their footprint is the lower part of the box", () => {
    const f = footprintOf({ x0: 0, y0: 0, x1: 10, y1: 40 }, "angled");
    expect(f.y1).toBe(40);
    expect(f.y0).toBeGreaterThan(0);
    const { room } = buildScene(tavern(), W, H, "interior");
    expect(room.obstacles.map((o) => o.id)).toEqual(["bar"]); // the rug isn't solid
  });

  it("finds a way around the bar instead of walking through it", () => {
    const { room } = buildScene(tavern(), W, H, "interior");
    const from = { x: 120, y: 290 };
    const to = { x: 120, y: 120 };
    expect(isFree(room, from) && isFree(room, to)).toBe(true);
    const path = findPath(room, from, to)!;
    expect(path).not.toBeNull();
    let prev = from;
    for (const p of path) {
      const steps = Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 2);
      for (let i = 1; i <= steps; i++) {
        const q = { x: prev.x + ((p.x - prev.x) * i) / steps, y: prev.y + ((p.y - prev.y) * i) / steps };
        expect(hitsObstacle(room, q), `through the bar at ${q.x},${q.y}`).toBeNull();
        expect(insideWalk(room, q)).toBe(true);
      }
      prev = p;
    }
    // It has to go round the right-hand end of the bar (x ≈ 0.75 × 480 = 360).
    expect(Math.max(...path.map((p) => p.x))).toBeGreaterThan(360);
  });

  it("returns no path when the goal is walled off", () => {
    const l = tavern();
    // Close the gap to the right of the bar: paint "not floor" from the bar to the wall.
    const floor = paintStroke(l, { x: 70, y: 33 }, { x: 96, y: 33 }, 3, false);
    const { room } = buildScene({ ...l, floor }, W, H, "interior");
    expect(findPath(room, { x: 120, y: 290 }, { x: 120, y: 120 })).toBeNull();
  });

  it("spawns at the start spots, never inside furniture or each other", () => {
    const { room } = buildScene(tavern(), W, H, "interior");
    const pts = spawnPoints(room, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0].x).toBeCloseTo(0.3 * 480, -1);
    for (const p of pts) expect(isFree(room, p)).toBe(true);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(gap(pts[i], pts[j])).toBeGreaterThanOrEqual(FOOT.w);
  });

  it("a start spot painted inside the bar is moved to the nearest free floor", () => {
    const { room } = buildScene(tavern({ spawns: [{ x: 0.3, y: 0.53 }] }), W, H, "interior");
    const [p] = spawnPoints(room, 1);
    expect(isFree(room, p)).toBe(true);
  });

  it("objects get standable anchors and keep the player's name", () => {
    const s = buildScene(tavern(), W, H, "interior");
    const bar = s.objects.find((o) => o.id === "bar")!;
    expect(bar.label).toBe("bar counter");
    expect(bar.collider).toBe("bar");
    expect(validAnchors(s.room, bar).length).toBeGreaterThan(0);
    expect(bar.tags).toContain("bar");
    expect(s.fronts.map((f) => f.id)).toEqual(["bar"]);
    expect(s.problems).toEqual([]);
  });

  it("flags objects nobody can reach", () => {
    const l = tavern();
    const s = buildScene({ ...l, objects: [...l.objects, { id: "lamp", label: "lamp", type: "light", bounds: { x0: 0.4, y0: 0.02, x1: 0.45, y1: 0.1 }, solid: true, front: false }] }, W, H, "interior");
    expect(s.problems).toEqual([{ objectId: "lamp", kind: "unreachable" }]);
  });

  it("characters walk on a generated map without leaving the floor or entering furniture", () => {
    const s = buildScene(tavern(), W, H, "interior");
    const sim = new StageSim({ room: s.room, idle: false });
    const cast = [juniper(), rook(), mei(), makeChar({ id: "c-x", name: "X" })];
    sim.setCast(cast);
    sim.setObjects(s.objects);
    const ids = cast.map((c) => c.id);
    expect(sim.request({ type: "walk_to", actor: ids[0], x: 120, y: 120 })).toMatchObject({ ok: true });
    expect(sim.request({ type: "use_object", actor: ids[1], object: "bar" })).toMatchObject({ ok: true });
    expect(sim.request({ type: "approach", actor: ids[2], target: ids[3], distance: 26 })).toMatchObject({ ok: true });
    for (let t = 0; t < 30000; t += 16) {
      sim.tick(16);
      for (const id of ids) {
        const p = sim.position(id)!;
        expect(insideWalk(s.room, p), `${id} left the floor at ${p.x},${p.y}`).toBe(true);
        expect(hitsObstacle(s.room, p), `${id} walked into furniture at ${p.x},${p.y}`).toBeNull();
      }
    }
    const end = sim.position(ids[0])!;
    expect(Math.hypot(end.x - 120, end.y - 120)).toBeLessThan(8);
  });

  it("built-in rooms are unchanged (no mask, 320×192)", () => {
    const r = roomFor("otherworld", "street");
    expect(r.mask).toBeUndefined();
    expect(roomSize(r)).toEqual({ width: 320, height: 192 });
  });

  it("damaged or missing layouts fall back to the first guess", () => {
    expect(readLayout(undefined, W, H).reviewed).toBe(false);
    expect(readLayout({ v: 1, cols: 3, rows: 3, floor: "1" }, W, H).cols).toBe(96);
    const ok = readLayout(tavern(), W, H);
    expect(ok.objects).toHaveLength(2);
    expect(ok.reviewed).toBe(true);
    expect(readLayout({ ...tavern(), stageWidth: 99999 }, W, H).stageWidth).toBe(480);
  });

  it("the first guess has floor for both views", () => {
    expect(floorShare(guessFloor(96, 64, "angled"))).toBeGreaterThan(0.2);
    expect(floorShare(guessFloor(96, 58, "side"))).toBeGreaterThan(0.15);
  });

  it("names a map from the first part of its description", () => {
    expect(nameFromDescription("这是一家酒吧的内部，有着木制的桌椅和墙壁。")).toBe("这是一家酒吧的内部");
    expect(nameFromDescription("A cosy tavern. Snow outside.")).toBe("A cosy tavern");
    expect(nameFromDescription("")).toBe("");
  });

  it("every play-area string exists in both languages", () => {
    const keys = (o: object, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(zh.playArea).sort()).toEqual(keys(en.playArea).sort());
  });
});
