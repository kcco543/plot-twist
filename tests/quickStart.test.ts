import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser, type FakeStorage } from "./fakeBrowser";
import { INDEX_KEY } from "@/lib/saves/format";
import { nextTip, parseTips, TIP_ORDER, type TipsState } from "@/lib/onboarding/tips";

type Saves = typeof import("@/lib/saves/worldSaves");
type Game = typeof import("@/lib/gameStore");
type Demo = typeof import("@/lib/demo/demoWorld");

describe("Quick Start demo world", () => {
  let local: FakeStorage;
  let navigations: string[];
  let saves: Saves;
  let game: Game;
  let demo: Demo;

  /** A page reload: memory is gone, browser storage stays. */
  const reload = async () => {
    vi.resetModules();
    saves = await import("@/lib/saves/worldSaves");
    game = await import("@/lib/gameStore");
    demo = await import("@/lib/demo/demoWorld");
  };
  const index = () => JSON.parse(local.getItem(INDEX_KEY) ?? "{}");

  beforeEach(async () => {
    ({ local, navigations } = fakeBrowser());
    await reload();
  });

  it("opens a ready-made world in Play: Otherworld, the sample cast, nothing to set up", async () => {
    expect(demo.playDemo("en")).toBe(false);
    expect(navigations).toEqual(["/play"]);
    await reload();
    const save = game.getSave();
    expect(save.worldId).toBe("otherworld");
    expect(save.characters.map((c) => c.name)).toEqual(["Wren", "Mira", "Tobi"]);
    expect(save.characters.every((c) => c.relationships.length > 0)).toBe(true);
    expect(save.observation?.frequency).toBe("high");
    expect(demo.isDemoData(save)).toBe(true);
    expect(index().worlds).toHaveLength(1);
    expect(index().worlds[0]).toMatchObject({ name: "Demo: Cloud Island", theme: "otherworld", characterCount: 3 });
  });

  it("uses the player's language for the cast and the world name", async () => {
    demo.playDemo("zh-CN");
    await reload();
    expect(game.getSave().characters.map((c) => c.name)).toEqual(["雯雯", "米拉", "托比"]);
    expect(index().worlds[0].name).toBe("演示：云岛");
  });

  it("reopens the same demo instead of making another one", async () => {
    demo.playDemo("en");
    await reload();
    game.gameActions.appendLines([{ speaker: { kind: "narrator" }, key: "custom", params: { text: "progress" } }]);
    expect(demo.playDemo("en")).toBe(true); // already this tab's world: the caller just navigates
    await reload();
    expect(index().worlds).toHaveLength(1);
    expect(game.getSave().log.map((l) => ("params" in l ? l.params?.text : l.text))).toEqual(["progress"]);
  });

  it("leaves every other world exactly as it was", async () => {
    const own = saves.createWorld();
    saves.enterWorld(own.id, "/studio");
    await reload();
    game.gameActions.selectWorld("modern");
    game.gameActions.addCharacter();
    const before = local.getItem(saves.allWorlds()[0].storageKey);
    demo.playDemo("en");
    await reload();
    await demo.resetDemo("en");
    await reload();
    expect(index().worlds).toHaveLength(2);
    expect(local.getItem(saves.allWorlds().find((w) => w.id === own.id)!.storageKey)).toBe(before);
  });

  it("Reset demo starts the same world over (same id, fresh story)", async () => {
    demo.playDemo("en");
    await reload();
    const id = saves.activeWorldId();
    game.gameActions.appendLines([{ speaker: { kind: "narrator" }, key: "custom", params: { text: "old" } }]);
    game.gameActions.removeFromWorld(game.getSave().characters[0].id);
    await demo.resetDemo("en");
    expect(navigations.at(-1)).toBe("/play");
    await reload();
    expect(saves.activeWorldId()).toBe(id);
    expect(game.getSave().log).toEqual([]);
    expect(game.getSave().characters).toHaveLength(3);
    expect(index().worlds).toHaveLength(1);
  });

  it("an ordinary world is never treated as the demo", async () => {
    const w = saves.createWorld();
    saves.enterWorld(w.id, "/play");
    await reload();
    game.gameActions.addSampleCast("en");
    expect(demo.isDemoData(game.getSave())).toBe(false);
    expect(demo.findDemoWorldId()).toBe(null);
  });
});

describe("Starting a new world makes no save until a world type is picked", () => {
  let local: FakeStorage;
  let navigations: string[];
  let saves: Saves;
  let game: Game;
  const reload = async () => {
    vi.resetModules();
    saves = await import("@/lib/saves/worldSaves");
    game = await import("@/lib/gameStore");
  };

  beforeEach(async () => {
    ({ local, navigations } = fakeBrowser());
    await reload();
  });

  it("leaving the current world creates nothing; picking a type creates exactly one world", async () => {
    const first = saves.createWorld();
    saves.enterWorld(first.id, "/play");
    await reload();
    saves.leaveWorld("/worlds");
    expect(navigations.at(-1)).toBe("/worlds");
    await reload();
    expect(saves.activeWorldId()).toBe(null);
    expect(saves.allWorlds()).toHaveLength(1);
    game.gameActions.selectWorld("ancient-china");
    expect(saves.allWorlds()).toHaveLength(2);
    expect(saves.activeWorldId()).not.toBe(first.id);
    expect(JSON.parse(local.getItem(saves.allWorlds()[0].storageKey) ?? "null")).toBe(null);
  });
});

describe("First-time tips", () => {
  const state = (done: TipsState["done"], skipped = false): TipsState => ({ skipped, done });

  it("go in order, one at a time", () => {
    const seen: string[] = [];
    let s = state([]);
    for (let i = 0; i < TIP_ORDER.length; i++) {
      const tip = nextTip(s, { demo: true, canTalk: true });
      if (!tip) break;
      seen.push(tip);
      s = state([...s.done, tip]);
    }
    expect(seen).toEqual(["talk", "contrast", "object", "watch", "makeOwn"]);
    expect(nextTip(s, { demo: true, canTalk: true })).toBe(null);
  });

  it("skip turns every tip off", () => {
    expect(nextTip(state([], true), { demo: true, canTalk: true })).toBe(null);
  });

  it("the contrast tip is demo-only, and talk tips wait for two people", () => {
    expect(nextTip(state(["talk"]), { demo: false, canTalk: true })).toBe("object");
    expect(nextTip(state([]), { demo: true, canTalk: false })).toBe("object");
  });

  it("reads stored state leniently (unknown or broken data = start over)", () => {
    expect(parseTips(null)).toEqual({ skipped: false, done: [] });
    expect(parseTips("not json")).toEqual({ skipped: false, done: [] });
    expect(parseTips(JSON.stringify({ skipped: true, done: ["talk", "nope", "talk"] }))).toEqual({ skipped: true, done: ["talk"] });
  });
});
