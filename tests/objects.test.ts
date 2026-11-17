import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { checkObjects, hitObject, objectsFor, OBJECT_ACTIONS, type WorldObject } from "@/lib/stage/objects";
import { FOOT, gap, hitsObstacle, insideWalk, roomFor, type RoomLayout } from "@/lib/stage/room";
import { StageSim } from "@/lib/stage/sim";
import type { EnvironmentTypeId, WorldId } from "@/lib/types";
import { juniper, makeChar, mei, rook } from "./helpers";

const WORLDS: WorldId[] = ["western-fantasy", "modern", "ancient-china", "otherworld"];
const PLACES: EnvironmentTypeId[] = ["interior", "street", "wilderness", "ruins", "dreamscape"];

function setup(world: WorldId = "modern", place: EnvironmentTypeId = "interior", cast = [juniper(), rook(), mei()]) {
  const room = roomFor(world, place);
  const sim = new StageSim({ room, idle: false });
  sim.setCast(cast);
  sim.setObjects(objectsFor(world, place));
  return { sim, room, ids: cast.map((c) => c.id) };
}

/** Run until nobody walks (or the time is up), checking that nobody ever crosses furniture, walls or each other. */
function run(sim: StageSim, room: RoomLayout, ids: string[], ms = 15000) {
  for (let t = 0; t < ms; t += 16) {
    sim.tick(16);
    for (const id of ids) {
      const p = sim.position(id)!;
      expect(insideWalk(room, p), `${id} left the floor at ${p.x},${p.y}`).toBe(true);
      expect(hitsObstacle(room, p), `${id} walked into furniture at ${p.x},${p.y}`).toBeNull();
    }
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) expect(gap(sim.position(ids[i])!, sim.position(ids[j])!)).toBeGreaterThanOrEqual(FOOT.w - 0.5);
    if (ids.every((id) => !sim.walkOf(id))) return t;
  }
  return ms;
}

describe("world objects (annotation layer)", () => {
  it("every built-in room's objects have unique ids, real colliders and a standable anchor", () => {
    for (const w of WORLDS)
      for (const p of PLACES) {
        const objs = objectsFor(w, p);
        expect(objs.length, `${w}/${p}`).toBeGreaterThan(0);
        expect(checkObjects(roomFor(w, p), objs), `${w}/${p}`).toEqual([]);
        for (const o of objs) {
          expect(o.world === "otherworld" || o.world === "default").toBe(true);
          expect(o.place).toBe(p);
          expect([en.objects.names[o.name as keyof typeof en.objects.names], zh.objects.names[o.name as keyof typeof zh.objects.names]].every(Boolean), o.name).toBe(true);
        }
      }
    for (const a of OBJECT_ACTIONS) expect([en.objects.actions[a], zh.objects.actions[a], en.objects.do[a], zh.objects.do[a]].every(Boolean), a).toBe(true);
  });

  it("finds the object under a point, preferring the smaller one", () => {
    const objs = objectsFor("modern", "interior");
    expect(hitObject(objs, { x: 70, y: 40 })?.id).toBe("window");
    expect(hitObject(objs, { x: 266, y: 60 })?.id).toBe("door");
    expect(hitObject(objs, { x: 160, y: 170 })?.id).toBe("rug");
    expect(hitObject(objs, { x: 300, y: 170 })).toBeNull();
  });
});

describe("walking to objects and places", () => {
  it("walks to an object, stops at its interaction point (never inside it) and uses it", () => {
    const { sim, room, ids } = setup();
    const used: string[] = [];
    sim.onObject = (actor, obj, action) => used.push(`${actor}:${obj}:${action}`);
    const r = sim.request({ type: "use_object", actor: ids[0], object: "door" }, "test", "player");
    expect(r.ok).toBe(true);
    run(sim, room, ids);
    expect(used).toEqual([`${ids[0]}:door:open`]);
    const p = sim.position(ids[0])!;
    expect(Math.abs(p.x - 266)).toBeLessThan(24);
    expect(sim.getSnapshot().actors.find((a) => a.id === ids[0])!.usingObject).toBe("door");
  });

  it("sits on a seat and gets up when walking away", () => {
    const { sim, room, ids } = setup();
    sim.request({ type: "use_object", actor: ids[1], object: "rug", action: "sit" }, "test", "player");
    run(sim, room, ids);
    expect(sim.poseOf(ids[1])).toBe("sit");
    sim.request({ type: "walk_to", actor: ids[1], x: 290, y: 170 }, "test", "player");
    expect(sim.poseOf(ids[1])).toBeNull();
  });

  it("refuses unknown objects and actions an object doesn't support", () => {
    const { sim, ids } = setup();
    expect(sim.request({ type: "use_object", actor: ids[0], object: "piano" }, "test", "player")).toMatchObject({ ok: false, reason: "unknown_object" });
    expect(sim.request({ type: "use_object", actor: ids[0], object: "door", action: "sit" }, "test", "player")).toMatchObject({ ok: false, reason: "not_allowed" });
  });

  it("walks to a plain floor spot around the furniture (A*), never through it", () => {
    const { sim, room, ids } = setup("modern", "interior", [juniper()]);
    const id = ids[0];
    // Start left of the table, go to the right of it at the same depth (the table is in the way).
    const start = sim.position(id)!;
    expect(sim.request({ type: "walk_to", actor: id, x: 210, y: 150 }, "test", "player").ok).toBe(true);
    run(sim, room, ids);
    const p = sim.position(id)!;
    expect(Math.hypot(p.x - 210, p.y - 150)).toBeLessThan(6);
    expect(start).not.toEqual(p);
  });

  it("a blocked destination is moved to the nearest reachable spot; an impossible one is refused", () => {
    const { sim, room, ids } = setup("modern", "interior", [juniper()]);
    // Inside the table: goes next to it instead ("nearby").
    const r = sim.request({ type: "walk_to", actor: ids[0], x: 160, y: 137 }, "test", "player");
    expect(r).toMatchObject({ ok: true, note: "nearby" });
    run(sim, room, ids);
    expect(hitsObstacle(room, sim.position(ids[0])!)).toBeNull();
    // A room with a wall across the whole floor: the other side can't be reached.
    const walled: RoomLayout = { ...room, obstacles: [...room.obstacles, { id: "wall", x0: 240, y0: 120, x1: 250, y1: 192 }] };
    const sim2 = new StageSim({ room: walled, idle: false });
    sim2.setCast([juniper()]);
    expect(sim2.previewGoto(ids[0], { x: 290, y: 170 })).toBeNull();
    expect(sim2.request({ type: "walk_to", actor: ids[0], x: 290, y: 170 }, "test", "player")).toMatchObject({ ok: false, reason: "no_path" });
  });

  it("a new command replaces the old walk (cancel + replace), and the old one reports cancelled", () => {
    const { sim, ids } = setup("modern", "interior", [juniper()]);
    const ends: string[] = [];
    sim.onWalkEnd = (_a, outcome, kind) => ends.push(`${kind}:${outcome}`);
    sim.request({ type: "use_object", actor: ids[0], object: "door" }, "test", "player");
    sim.tick(200);
    sim.request({ type: "walk_to", actor: ids[0], x: 40, y: 170 }, "test", "player");
    expect(ends).toContain("object:cancelled");
    expect(sim.walkOf(ids[0])?.kind).toBe("goto");
  });

  it("saves and restores where everyone stands (and sits)", () => {
    const { sim, room, ids } = setup();
    sim.request({ type: "use_object", actor: ids[0], object: "rug", action: "sit" }, "test", "player");
    run(sim, room, ids);
    const saved = sim.spots();
    const sim2 = new StageSim({ room, idle: false });
    sim2.setSavedSpots(saved);
    sim2.setCast([juniper(), rook(), mei()]);
    sim2.setObjects(objectsFor("modern", "interior"));
    for (const id of ids) expect(sim2.position(id)).toEqual({ x: saved[id].x, y: saved[id].y });
    expect(sim2.poseOf(ids[0])).toBe("sit");
  });

  it("gift objects: anyone may admire, only the owner picks it up", async () => {
    const { giftObject, actionAllowed } = await import("@/lib/stage/objects");
    const room = roomFor("modern", "interior");
    const g = giftObject({ id: "g1", owner: "c-rook", name: "Lamp" } as never, { id: "table", x: 160, y: 130 }, room, "default", "interior") as WorldObject;
    expect(actionAllowed(g, "admire", "c-juniper")).toBe(true);
    expect(actionAllowed(g, "pick_up", "c-juniper")).toBe(false);
    expect(actionAllowed(g, "pick_up", "c-rook")).toBe(true);
    expect(checkObjects(room, [g])).toEqual([]);
    void makeChar;
  });
});
