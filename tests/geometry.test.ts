import { describe, expect, it } from "vitest";
import {
  clipBelow,
  clipPathOf,
  commit,
  distToPolygon,
  historyOf,
  insertVertex,
  MAX_VERTICES,
  moveVertex,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  preview,
  rectHitsPolygon,
  rectToPolygon,
  redo,
  removeVertex,
  translatePolygon,
  undo,
  validPolygon,
} from "@/lib/scene/geometry";
import { buildScene, defaultLayout, readLayout, type SceneLayout } from "@/lib/scene/layout";
import { ambientFor, ambientSpec, ambientTiming, defaultAmbientFor, MAX_AMBIENT, readAmbient } from "@/lib/scene/ambient";
import { hitsObstacle } from "@/lib/stage/room";
import type { WorldObject } from "@/lib/stage/objects";

const tri = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.5, y: 0.8 },
];

describe("polygon geometry", () => {
  it("bounds, area and containment", () => {
    expect(polygonBounds(tri)).toEqual({ x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 });
    expect(polygonArea(tri)).toBeCloseTo(0.18);
    expect(pointInPolygon({ x: 0.5, y: 0.4 }, tri)).toBe(true);
    expect(pointInPolygon({ x: 0.25, y: 0.7 }, tri)).toBe(false);
    expect(distToPolygon({ x: 0.5, y: 0.4 }, tri)).toBe(0);
    expect(distToPolygon({ x: 0.5, y: 0.1 }, tri)).toBeCloseTo(0.1);
  });

  it("validates polygons", () => {
    expect(validPolygon(tri)).toBe(true);
    expect(validPolygon(tri.slice(0, 2))).toBe(false);
    expect(validPolygon([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toBe(false); // collinear
    expect(validPolygon([{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(validPolygon("nope")).toBe(false);
  });

  it("edits vertices within limits", () => {
    const sq = rectToPolygon({ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 });
    expect(sq).toHaveLength(4);
    expect(insertVertex(sq, 0, { x: 0.25, y: 0.05 })).toHaveLength(5);
    expect(insertVertex(sq, 0, { x: 0.25, y: 0.05 })[1]).toEqual({ x: 0.25, y: 0.05 });
    expect(removeVertex(sq, 0)).toHaveLength(3);
    expect(removeVertex(tri, 0)).toHaveLength(3); // never below three
    expect(moveVertex(sq, 2, { x: 2, y: -1 })[2]).toEqual({ x: 1, y: 0 }); // clamped to the picture
    const full = Array.from({ length: MAX_VERTICES }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos(i), y: 0.5 + 0.3 * Math.sin(i) }));
    expect(insertVertex(full, 0, { x: 0.5, y: 0.5 })).toHaveLength(MAX_VERTICES);
  });

  it("keeps a moved polygon inside the picture", () => {
    const moved = translatePolygon(tri, 0.5, 0);
    expect(polygonBounds(moved).x1).toBeCloseTo(1);
    expect(polygonBounds(moved).x0).toBeCloseTo(0.4);
  });

  it("clips the lower part of an outline", () => {
    const clipped = clipBelow(rectToPolygon({ x0: 0, y0: 0, x1: 1, y1: 1 }), 0.6);
    expect(polygonBounds(clipped)).toEqual({ x0: 0, y0: 0.6, x1: 1, y1: 1 });
  });

  it("rectangle vs polygon hits", () => {
    expect(rectHitsPolygon({ x0: 0.45, y0: 0.35, x1: 0.55, y1: 0.45 }, tri)).toBe(true);
    expect(rectHitsPolygon({ x0: 0.0, y0: 0.6, x1: 0.15, y1: 0.75 }, tri)).toBe(false);
    // a thin sliver crossing the rect with no vertex inside
    const sliver = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1, y: 0.51 }];
    expect(rectHitsPolygon({ x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }, sliver)).toBe(true);
  });

  it("clip-path in box percentages", () => {
    expect(clipPathOf(tri, { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 })).toBe("polygon(0.00% 0.00%, 100.00% 0.00%, 50.00% 100.00%)");
  });
});

describe("undo history", () => {
  it("commits, undoes, redoes, and forgets redo on a new edit", () => {
    let h = historyOf(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(undo(h)).toBe(h);
    h = commit(h, 9);
    expect(h.future).toHaveLength(0);
    expect(commit(h, 9)).toBe(h); // unchanged state, no step
  });

  it("preview does not add a step; history is capped", () => {
    let h = commit(historyOf(0), 1);
    h = preview(h, 5);
    expect(h.past).toEqual([0]);
    for (let i = 0; i < 100; i++) h = commit(h, 100 + i, 10);
    expect(h.past).toHaveLength(10);
  });
});

describe("scene objects with outlines and metadata", () => {
  const W = 1536;
  const H = 1024;
  const base = (): SceneLayout => {
    const l = defaultLayout(W, H, "angled");
    return { ...l, floor: "1".repeat(l.cols * l.rows) };
  };

  it("reads and validates the new optional fields", () => {
    const l = base();
    const raw = {
      ...l,
      objects: [
        {
          id: "pond",
          label: "Pond",
          type: "feature",
          bounds: { x0: 0, y0: 0, x1: 1, y1: 1 },
          solid: true,
          front: false,
          shape: tri,
          range: 99,
          anchor: { x: 1.5, y: 0.5 },
          actions: ["inspect", "nonsense"],
          interests: ["water", "water", " fish ", 5],
          hidden: true,
          ambient: { kind: "ripple", speed: 9 },
        },
        { id: "broken", label: "x", type: "feature", bounds: { x0: 0, y0: 0, x1: 0.1, y1: 0.1 }, shape: [{ x: 0, y: 0 }], ambient: { kind: "lava" } },
        { id: "still", label: "Lamp", type: "light", bounds: { x0: 0, y0: 0, x1: 0.1, y1: 0.1 }, ambient: null },
      ],
    };
    const r = readLayout(raw, W, H);
    const pond = r.objects[0];
    expect(pond.bounds).toEqual(polygonBounds(tri)); // the outline decides the box
    expect(pond.range).toBe(40);
    expect(pond.anchor).toEqual({ x: 1, y: 0.5 });
    expect(pond.actions).toEqual(["inspect"]);
    expect(pond.interests).toEqual(["water", "fish"]);
    expect(pond.hidden).toBe(true);
    expect(pond.ambient).toMatchObject({ kind: "ripple", speed: 2 });
    expect(r.objects[1].shape).toBeUndefined();
    expect(r.objects[1].ambient).toBeUndefined();
    expect(r.objects[2].ambient).toBeNull();
  });

  it("older layouts without the new fields load unchanged", () => {
    const l = base();
    const raw = { ...l, objects: [{ id: "a", label: "Table", type: "table", bounds: { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }, solid: true, front: false }] };
    const o = readLayout(raw, W, H).objects[0];
    expect(Object.keys(o).sort()).toEqual(["bounds", "front", "id", "label", "solid", "type"]);
  });

  it("a solid outline blocks only its lower polygon, not its whole box", () => {
    const l = base();
    // a triangle pointing down: its lower part is a narrow tip
    const shape = [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.5, y: 0.7 }];
    const built = buildScene({ ...l, objects: [{ id: "rock", label: "Rock", type: "feature", bounds: polygonBounds(shape), solid: true, front: true, shape }] }, W, H, "interior");
    const ob = built.room.obstacles.find((o) => o.id === "rock")!;
    expect(ob.poly && ob.poly.length >= 3).toBe(true);
    const { width, height } = built.size;
    // Bottom corners of the box are outside the triangle: walkable.
    const at = (x: number, y: number) => ({ x: x * width, y: y * height });
    expect(hitsObstacle(built.room, at(0.33, 0.68))).toBeNull();
    expect(hitsObstacle(built.room, at(0.5, 0.66))?.id).toBe("rock");
    expect(built.fronts[0].shape).toHaveLength(3);
  });
});

describe("ambient animation", () => {
  const obj = (o: Partial<WorldObject>): WorldObject => ({ id: "o", type: "feature", label: "", tags: [], ...o }) as WorldObject;

  it("picks defaults from words (EN + ZH) and type, with a stable phase", () => {
    expect(defaultAmbientFor(obj({ label: "Fountain" }))?.kind).toBe("ripple");
    expect(defaultAmbientFor(obj({ label: "灯笼" }))?.kind).toBe("flicker");
    expect(defaultAmbientFor(obj({ label: "Campfire" }))?.kind).toBe("flame");
    expect(defaultAmbientFor(obj({ type: "portal", label: "Arch" }))?.kind).toBe("pulse");
    expect(defaultAmbientFor(obj({ label: "Chair", type: "seat" }))).toBeNull();
    const a = defaultAmbientFor(obj({ id: "lamp-1", type: "light" }))!;
    const b = defaultAmbientFor(obj({ id: "lamp-2", type: "light" }))!;
    expect(a.phase).not.toBe(b.phase);
    expect(defaultAmbientFor(obj({ id: "lamp-1", type: "light" }))!.phase).toBe(a.phase);
  });

  it("respects explicit off, hidden and gifts, ranks and caps", () => {
    const many = Array.from({ length: 20 }, (_, i) => obj({ id: `p${i}`, type: "plant" }));
    const objs = [
      ...many,
      obj({ id: "fire", label: "Hearth" }),
      obj({ id: "off", type: "light", ambient: null }),
      obj({ id: "hid", type: "light", hidden: true }),
      obj({ id: "gift", type: "light", giftId: "g" } as Partial<WorldObject>),
      obj({ id: "dis", type: "light", ambient: ambientSpec("flicker", { enabled: false }) }),
    ];
    const list = ambientFor(objs);
    expect(list).toHaveLength(MAX_AMBIENT);
    expect(list[0].objectId).toBe("fire");
    expect(list.map((x) => x.objectId)).not.toContain("off");
    expect(list.map((x) => x.objectId)).not.toContain("hid");
    expect(list.map((x) => x.objectId)).not.toContain("gift");
    expect(list.map((x) => x.objectId)).not.toContain("dis");
  });

  it("timing from speed and phase; damaged data falls back", () => {
    const t = ambientTiming(ambientSpec("sway", { speed: 2, phase: 0.5, loop: "alternate" }));
    expect(t).toEqual({ duration: 1300, delay: -650, steps: 4, direction: "alternate" });
    expect(readAmbient({ kind: "flame", speed: "fast", phase: 7 })).toMatchObject({ speed: 1, phase: 1, loop: "loop", enabled: true });
    expect(readAmbient({ kind: "nope" })).toBeNull();
  });
});
