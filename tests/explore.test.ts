import { describe, expect, it } from "vitest";
import { availability, bestAction, keeperOf, resolve, stateOf, type InteractContext } from "@/lib/explore/interact";
import { addScene, connect, linkAt, neighbours, newScene, normalizeScenes, presentIn, setObjectState, travel, FIRST_SCENE_ID, type SceneLink } from "@/lib/explore/scenes";
import { ACTIONS_BY_TYPE, objectsFor, type ObjectType, type WorldObject } from "@/lib/stage/objects";
import { roomFor } from "@/lib/stage/room";
import { StageSim } from "@/lib/stage/sim";
import { juniper } from "./helpers";

const obj = (type: ObjectType, extra: Partial<WorldObject> = {}): WorldObject => ({
  id: `${type}-1`,
  type,
  name: type,
  world: "default",
  place: "interior",
  bounds: { x0: 100, y0: 60, x1: 160, y1: 90 },
  collider: null,
  anchors: [{ x: 130, y: 100 }],
  radius: 10,
  actions: [...ACTIONS_BY_TYPE[type]],
  tags: [],
  ...extra,
});
const ctx = (p: Partial<InteractContext> = {}): InteractContext => ({ actorId: "a", carrying: [], keeperId: null, destination: null, priority: "player", ...p });

describe("objects do real things", () => {
  it("stairs climb and propose leaving the area (player), but never for autonomy", () => {
    const stairs = obj("stairs", { exit: true });
    expect(bestAction(stairs, stateOf(stairs, undefined), ctx())).toBe("climb");
    const r = resolve(stairs, "climb", {}, ctx());
    expect(r.anim).toBe("climb");
    expect(r.follow).toEqual({ kind: "exit" });
    expect(resolve(stairs, "climb", {}, ctx({ priority: "auto" })).follow).toBeUndefined();
  });

  it("the counter finds the bartender and starts a conversation, or explains nobody is there", () => {
    const counter = obj("counter");
    expect(availability(counter, {}, ctx()).find((a) => a.action === "talk")).toEqual({ action: "talk", ok: false, reason: "no_keeper" });
    const r = resolve(counter, "talk", {}, ctx({ keeperId: "bot" }));
    expect(r.follow).toEqual({ kind: "talk", target: "bot" });
    // Autonomy chats at the bar without opening the player's conversation window.
    expect(resolve(counter, "talk", {}, ctx({ keeperId: "bot", priority: "auto" })).follow).toBeUndefined();
  });

  it("keeperOf: the assigned keeper, else whoever stands behind the counter", () => {
    const counter = obj("counter", { keeper: "k" });
    expect(keeperOf(counter, [{ id: "k", x: 0, y: 0 }], "a")).toBe("k");
    const open = obj("counter");
    expect(keeperOf(open, [{ id: "front", x: 130, y: 88 }, { id: "back", x: 130, y: 62 }, { id: "far", x: 400, y: 60 }], "a")).toBe("back");
    expect(keeperOf(open, [{ id: "a", x: 130, y: 62 }], "a")).toBeNull();
  });

  it("doors: open → closed → locked, with reasons, keys and an exit offer", () => {
    const door = obj("door", { exit: true, locked: true });
    const s = stateOf(door, undefined);
    expect(s.locked).toBe(true);
    const av = availability(door, s, ctx());
    expect(av.find((a) => a.action === "open")).toEqual({ action: "open", ok: false, reason: "locked" });
    expect(av.find((a) => a.action === "unlock")).toEqual({ action: "unlock", ok: false, reason: "no_key" });
    expect(resolve(door, "open", s, ctx()).ok).toBe(false);
    const unlocked = resolve(door, "unlock", s, ctx({ carrying: [{ id: "g", name: "Brass key" }] }));
    expect(unlocked.patch?.locked).toBe(false);
    const opened = resolve(door, "open", { locked: false }, ctx());
    expect(opened.patch?.open).toBe(true);
    expect(opened.follow).toEqual({ kind: "exit" });
    // Open exit door: stepping through comes first, and it can be closed again.
    const after = availability(door, { open: true }, ctx());
    expect(after[0].action).toBe("leave");
    expect(after.some((a) => a.action === "close" && a.ok)).toBe(true);
    expect(resolve(door, "close", { open: true }, ctx()).patch?.open).toBe(false);
  });

  it("autonomy never sees leave/enter", () => {
    const door = obj("door", { exit: true });
    expect(availability(door, {}, ctx({ priority: "auto" })).some((a) => a.action === "leave")).toBe(false);
  });

  it("chests open, then search finds the contents", () => {
    const chest = obj("chest", { contents: ["an old map"] });
    expect(resolve(chest, "search", {}, ctx()).ok).toBe(false);
    expect(resolve(chest, "open", {}, ctx()).patch?.open).toBe(true);
    const found = resolve(chest, "search", { open: true }, ctx());
    expect(found.line.params?.text).toBe("an old map");
    expect(found.patch?.searched).toBe(true);
  });

  it("chairs sit, beds rest, signs read their text, tables take a carried item", () => {
    expect(resolve(obj("seat", { actions: ["sit"] }), "sit", {}, ctx()).pose).toBe("sit");
    expect(resolve(obj("bed"), "rest", {}, ctx()).anim).toBe("rest");
    expect(resolve(obj("sign", { actions: ["read"], description: "Closed on Sundays" }), "read", {}, ctx()).line.params?.text).toBe("Closed on Sundays");
    const table = obj("table");
    expect(availability(table, {}, ctx()).find((a) => a.action === "place")).toEqual({ action: "place", ok: false, reason: "nothing_to_place" });
    expect(resolve(table, "place", {}, ctx({ carrying: [{ id: "g1", name: "Mug" }] })).follow).toEqual({ kind: "place", itemId: "g1" });
  });

  it("the sim walks a character to the object and asks the guard first (a locked door refuses)", () => {
    const sim = new StageSim({ room: roomFor("modern", "interior"), idle: false });
    sim.setCast([juniper()]);
    const objects = objectsFor("modern", "interior");
    sim.setObjects(objects);
    const door = objects.find((o) => o.id === "door")!;
    expect(door.exit).toBe(true);
    let locked = true;
    sim.objectGuard = (_a, o, action) => !(o.id === "door" && locked && action === "open");
    expect(sim.request({ type: "use_object", actor: "c-juniper", object: "door", action: "open" }, "test", "player").ok).toBe(false);
    locked = false;
    let arrived: string | null = null;
    sim.onObject = (_actor, id) => (arrived = id);
    expect(sim.request({ type: "use_object", actor: "c-juniper", object: "door", action: "open" }, "test", "player").ok).toBe(true);
    for (let t = 0; t < 8000 && !arrived; t += 16) sim.tick(16);
    expect(arrived).toBe("door");
  });
});

describe("scenes", () => {
  const env = { description: "A Christmas tavern", type: "interior" as const, mapId: "map-1" };
  const base = () => addScene(normalizeScenes(undefined, env), newScene({ id: "s2", name: "Cellar", description: "A cold cellar", envType: "interior", mapId: null, placeholder: true }, 1));
  const link = (p: Partial<SceneLink> = {}): SceneLink => ({ id: "l1", from: FIRST_SCENE_ID, fromExit: "stairs", to: "s2", toEntrance: "door", kind: "stairs", twoWay: true, createdAt: 1, ...p });

  it("older saves migrate to one scene made from the environment", () => {
    const w = normalizeScenes(undefined, env);
    expect(w.list).toHaveLength(1);
    expect(w.list[0]).toMatchObject({ id: FIRST_SCENE_ID, mapId: "map-1", description: "A Christmas tavern" });
  });

  it("links are validated: no self-links, unknown scenes, or two destinations per exit", () => {
    const w = base();
    expect(connect(w, link({ to: FIRST_SCENE_ID })).ok).toBe(false);
    expect(connect(w, link({ to: "nope" })).ok).toBe(false);
    const a = connect(w, link());
    if (!a.ok) throw new Error();
    const b = connect(a.scenes, link({ id: "l2", toEntrance: null }));
    if (!b.ok) throw new Error();
    expect(b.scenes.links).toHaveLength(1);
    // Saved junk is cleaned too.
    const junk = normalizeScenes({ ...a.scenes, links: [...a.scenes.links, link({ id: "x", to: FIRST_SCENE_ID }), link({ id: "y", to: "gone" })] }, env);
    expect(junk.links.map((l) => l.id)).toEqual(["l1"]);
  });

  it("two-way links work from both ends", () => {
    const r = connect(base(), link());
    if (!r.ok) throw new Error();
    expect(linkAt(r.scenes, FIRST_SCENE_ID, "stairs")).toMatchObject({ to: "s2", entrance: "door" });
    expect(linkAt(r.scenes, "s2", "door")).toMatchObject({ to: FIRST_SCENE_ID, entrance: "stairs", reverse: true });
    expect(neighbours(r.scenes, "s2")).toEqual([FIRST_SCENE_ID]);
    const one = connect(base(), link({ twoWay: false }));
    if (!one.ok) throw new Error();
    expect(linkAt(one.scenes, "s2", "door")).toBeNull();
  });

  it("travel moves only the party; stay-behinds keep their spots; object state persists", () => {
    let w = setObjectState(base(), FIRST_SCENE_ID, "front-door", { open: true }, 2);
    const t = travel(w, { to: "s2", travellers: ["hero"], leftSpots: { bot: { x: 50, y: 60, facing: 1 }, hero: { x: 1, y: 1, facing: 1 } }, env, presentIds: ["hero", "bot"] }, 3);
    expect(t).not.toBeNull();
    w = t!.scenes;
    expect(w.active).toBe("s2");
    expect(t!.env).toMatchObject({ mapId: null, description: "A cold cellar" });
    const cast = [{ id: "hero" }, { id: "bot" }];
    expect(presentIn(w, "s2", cast).map((c) => c.id)).toEqual(["hero"]);
    expect(presentIn(w, FIRST_SCENE_ID, cast).map((c) => c.id)).toEqual(["bot"]);
    const main = w.list.find((s) => s.id === FIRST_SCENE_ID)!;
    expect(main.spots).toEqual({ bot: { x: 50, y: 60, facing: 1 } });
    expect(main.objects["front-door"]).toEqual({ open: true });
    // Round trip through a save keeps everything.
    expect(normalizeScenes(JSON.parse(JSON.stringify(w)), t!.env)).toEqual(w);
    // Travelling to the scene you're in is refused.
    expect(travel(w, { to: "s2", travellers: ["hero"], leftSpots: {}, env: t!.env, presentIds: ["hero"] })).toBeNull();
  });
});

describe("sitting stays sitting", () => {
  it("a character the player sat down isn't stood up by idle fidgets or autonomy right away", () => {
    const sim = new StageSim({ room: roomFor("modern", "interior"), idle: true });
    sim.setCast([juniper()]);
    const objects = objectsFor("modern", "interior");
    sim.setObjects(objects);
    const seat = objects.find((o) => o.actions.includes("sit"))!;
    expect(sim.request({ type: "use_object", actor: "c-juniper", object: seat.id, action: "sit" }, "test", "player").ok).toBe(true);
    for (let t = 0; t < 8000 && sim.poseOf("c-juniper") !== "sit"; t += 16) sim.tick(16);
    expect(sim.poseOf("c-juniper")).toBe("sit");
    for (let t = 0; t < 12000; t += 16) sim.tick(16);
    expect(sim.poseOf("c-juniper")).toBe("sit");
    expect(sim.request({ type: "stand_up", actor: "c-juniper" }, "test", "auto").ok).toBe(false);
    expect(sim.request({ type: "stand_up", actor: "c-juniper" }, "test", "player").ok).toBe(true);
  });
});
