import { beforeEach, describe, expect, it, vi } from "vitest";
import { INDEX_KEY, LEGACY_SAVE_KEY, SESSION_ACTIVE_KEY, WORLD_KEY_PREFIX, cleanWorldName, openIndex, worldKey, type KV } from "@/lib/saves/format";
import { characterIdMap, remapIds } from "@/lib/saves/remap";

/** In-memory localStorage / sessionStorage. `quota` makes writes of big values fail like a full browser. */
class FakeStorage implements KV {
  map = new Map<string, string>();
  quota = Infinity;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new Error("QuotaExceededError");
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** A v0.4-style single save with characters, relationships, memories, story log and a generated map. */
function legacySave() {
  return {
    version: 1,
    worldId: "otherworld",
    characters: [
      { id: "char_a", name: "Juniper", portrait: 0, traits: {}, createdAt: 1000, updatedAt: 1000 },
      { id: "mira", name: "Mira", portrait: 1, traits: {}, createdAt: 2000, updatedAt: 2000 },
    ],
    environment: { description: "a lighthouse", type: "ruins", mapId: "map_old" },
    log: [{ id: "log_1", at: 5, speaker: { kind: "character", name: "Mira", id: "mira" }, key: "custom", params: { text: "mira? Mira!" } }],
    story: {
      turn: 3,
      characters: { char_a: { mood: "calm", intensity: 1, memories: [{ id: "mem_1", withId: "mira", withName: "Mira", note: "mira lent me a pen" }] }, mira: { mood: "happy", intensity: 2, memories: [] } },
      bonds: { "char_a|mira": { affinity: 10, trust: 5 } },
      events: [{ id: "ev_1", actorId: "mira", otherId: "char_a" }],
      relations: { "char_a>mira": { trust: 40 }, "mira>char_a": { trust: -10 } },
    },
    sprites: [],
    updatedAt: 9000,
  };
}

let ids = 0;
const nextId = () => `world_t${++ids}`;

describe("save format v1 → v2 migration", () => {
  it("copies the old save into the first world byte for byte and leaves the original untouched", () => {
    const kv = new FakeStorage();
    const raw = JSON.stringify(legacySave());
    kv.setItem(LEGACY_SAVE_KEY, raw);
    const { index, changed } = openIndex(kv, 10_000, nextId);
    expect(changed).toBe(true);
    expect(index.worlds).toHaveLength(1);
    const w = index.worlds[0];
    expect(kv.getItem(w.storageKey)).toBe(raw);
    expect(w.storageKey).toBe(worldKey(w.id));
    expect(kv.getItem(LEGACY_SAVE_KEY)).toBe(raw);
    expect(index.activeWorldId).toBe(w.id);
    expect(w).toMatchObject({ theme: "otherworld", characterCount: 2, envType: "ruins", mapId: "map_old", createdAt: 1000, lastPlayedAt: 9000 });
    expect(index.migration).toMatchObject({ from: 1, status: "migrated", worldId: w.id, verified: true, backupKey: LEGACY_SAVE_KEY });
  });

  it("runs once: reopening keeps the same single world", () => {
    const kv = new FakeStorage();
    kv.setItem(LEGACY_SAVE_KEY, JSON.stringify(legacySave()));
    const first = openIndex(kv, 1, nextId).index;
    kv.setItem(INDEX_KEY, JSON.stringify(first));
    const second = openIndex(kv, 2, nextId);
    expect(second.changed).toBe(false);
    expect(second.index.worlds.map((w) => w.id)).toEqual(first.worlds.map((w) => w.id));
  });

  it("starts empty when there was no old save", () => {
    const { index } = openIndex(new FakeStorage(), 1, nextId);
    expect(index.worlds).toEqual([]);
    expect(index.migration?.status).toBe("empty");
  });

  it("keeps an unreadable old save exactly as it is", () => {
    const kv = new FakeStorage();
    kv.setItem(LEGACY_SAVE_KEY, "{not json");
    const { index } = openIndex(kv, 1, nextId);
    expect(index.worlds).toEqual([]);
    expect(index.migration?.status).toBe("unreadable");
    expect(kv.getItem(LEGACY_SAVE_KEY)).toBe("{not json");
  });

  it("uses the old save in place when the browser has no room for a copy", () => {
    const kv = new FakeStorage();
    const raw = JSON.stringify(legacySave());
    kv.setItem(LEGACY_SAVE_KEY, raw);
    kv.quota = 100; // the copy will not fit
    const { index } = openIndex(kv, 1, nextId);
    expect(index.worlds[0].storageKey).toBe(LEGACY_SAVE_KEY);
    expect(index.migration?.status).toBe("in-place");
    expect(kv.getItem(LEGACY_SAVE_KEY)).toBe(raw);
  });

  it("handles a partial old save with missing fields", () => {
    const kv = new FakeStorage();
    kv.setItem(LEGACY_SAVE_KEY, JSON.stringify({ characters: [{ name: "No id" }] }));
    const { index } = openIndex(kv, 1, nextId);
    expect(index.worlds[0]).toMatchObject({ theme: null, characterCount: 1, envType: "interior", mapId: null });
  });

  it("rebuilds a damaged index from the world saves and keeps the damaged text", () => {
    const kv = new FakeStorage();
    kv.setItem(`${WORLD_KEY_PREFIX}world_x`, JSON.stringify({ worldId: "modern", characters: [{}, {}], updatedAt: 7 }));
    kv.setItem(INDEX_KEY, "garbage");
    const { index } = openIndex(kv, 50, nextId);
    expect(index.worlds).toHaveLength(1);
    expect(index.worlds[0]).toMatchObject({ id: "world_x", theme: "modern", characterCount: 2 });
    expect(kv.getItem(`${INDEX_KEY}:damaged:50`)).toBe("garbage");
  });

  it("drops broken entries from a stored index but keeps every valid world", () => {
    const kv = new FakeStorage();
    kv.setItem(INDEX_KEY, JSON.stringify({ version: 2, activeWorldId: "gone", worlds: [{ id: "w1", name: "  Café   世界 " }, { nope: true }, { id: "w1" }] }));
    const { index } = openIndex(kv, 1, nextId);
    expect(index.worlds.map((w) => w.id)).toEqual(["w1"]);
    expect(index.worlds[0].name).toBe("Café 世界");
    expect(index.activeWorldId).toBeNull();
  });
});

describe("duplicating rewrites ids", () => {
  it("gives the copy new character ids and rewrites every reference (values and keys)", () => {
    const save = legacySave();
    let n = 0;
    const map = characterIdMap(save, () => `char_new${++n}`);
    map.set("map_old", "map_new");
    const copy = remapIds(save, map);
    const a = map.get("char_a")!;
    const m = map.get("mira")!;
    expect(copy.characters.map((c) => c.id)).toEqual([a, m]);
    expect(Object.keys(copy.story.characters).sort()).toEqual([a, m].sort());
    expect(copy.story.characters[a as "char_a"].memories[0].withId).toBe(m);
    expect(Object.keys(copy.story.relations)).toEqual([`${a}>${m}`, `${m}>${a}`]);
    expect(Object.keys(copy.story.bonds)).toEqual([[a, m].sort().join("|")]);
    expect(copy.story.events[0]).toMatchObject({ actorId: m, otherId: a });
    expect(copy.log[0].speaker).toMatchObject({ id: m, name: "Mira" });
    expect(copy.environment.mapId).toBe("map_new");
    // Written text is never changed, even when it contains an id-like word.
    expect(copy.log[0].params.text).toBe("mira? Mira!");
    expect(copy.story.characters[a as "char_a"].memories[0].note).toBe("mira lent me a pen");
    // The original is not mutated.
    expect(save.characters[1].id).toBe("mira");
  });

  it("keeps bond keys in sorted order after renaming", () => {
    const out = remapIds({ bonds: { "a|b": 1 } }, new Map([["a", "z"]]));
    expect(Object.keys(out.bonds)).toEqual(["b|z"]);
  });
});

describe("world names", () => {
  it("cleans names without cutting Chinese or emoji in half", () => {
    expect(cleanWorldName("  雾港   之城 ")).toBe("雾港 之城");
    const long = "🌙".repeat(60);
    expect(Array.from(cleanWorldName(long))).toHaveLength(40);
  });
});

// ---------------------------------------------------------------- in the browser (fake window)

type Saves = typeof import("@/lib/saves/worldSaves");
type Game = typeof import("@/lib/gameStore");

describe("world saves in the game", () => {
  let local: FakeStorage;
  let session: FakeStorage;
  let saves: Saves;
  let game: Game;
  let navigations: string[];

  /** What a page reload does: memory is gone, browser storage stays. */
  const reload = () => saves.__resetForTests();

  beforeEach(async () => {
    vi.resetModules();
    local = new FakeStorage();
    session = new FakeStorage();
    navigations = [];
    vi.stubGlobal("window", {
      localStorage: local,
      sessionStorage: session,
      location: { assign: (href: string) => navigations.push(href), reload: () => navigations.push("reload") },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    saves = await import("@/lib/saves/worldSaves");
    game = await import("@/lib/gameStore");
  });

  /** Enter a world the way the My Worlds cards do (the page reloads into it). */
  const enter = (id: string) => {
    saves.enterWorld(id, "/play");
    reload();
  };

  it("keeps two worlds completely independent", () => {
    const a = saves.createWorld();
    const b = saves.createWorld();
    enter(a.id);
    game.gameActions.selectWorld("ancient-china");
    const juniper = game.gameActions.addCharacter();
    game.gameActions.updateCharacter(juniper.id, { name: "Juniper" });
    const rook = game.gameActions.addCharacter();
    game.gameActions.setStory({ ...game.getSave().story, relations: { [`${juniper.id}>${rook.id}`]: { trust: 50, affection: 0, respect: 0, familiarity: 0, rivalry: 0, tension: 0, fear: 0 } } } as never);
    game.gameActions.appendLog({ speaker: { kind: "narrator" }, key: "custom", params: { text: "Only in A" } });

    enter(b.id);
    expect(navigations.at(-1)).toBe("/play");
    expect(game.getSave().characters).toEqual([]);
    expect(game.getSave().log).toEqual([]);
    expect((game.getSave().story as { relations?: object }).relations).toBeUndefined();
    game.gameActions.selectWorld("modern");
    game.gameActions.addCharacter();

    enter(a.id);
    expect(game.getSave().worldId).toBe("ancient-china");
    expect(game.getSave().characters.map((c) => c.name)).toEqual(["Juniper", ""]);
    expect(game.getSave().log).toHaveLength(1);

    const index = saves.getIndex();
    expect(index.worlds.find((w) => w.id === a.id)).toMatchObject({ theme: "ancient-china", characterCount: 2 });
    expect(index.worlds.find((w) => w.id === b.id)).toMatchObject({ theme: "modern", characterCount: 1 });
  });

  it("restores the world this tab was playing after a refresh", () => {
    const a = saves.createWorld();
    const b = saves.createWorld();
    enter(b.id);
    game.gameActions.addCharacter();
    reload();
    expect(saves.activeWorldId()).toBe(b.id);
    expect(session.getItem(SESSION_ACTIVE_KEY)).toBe(b.id);
    // A new tab (no session) opens the last played world.
    session.map.clear();
    reload();
    expect(saves.activeWorldId()).toBe(b.id);
    expect(a.id).not.toBe(b.id);
  });

  it("drops late saves from the old world while the page leaves for another one", () => {
    const a = saves.createWorld();
    const b = saves.createWorld();
    enter(a.id);
    saves.enterWorld(b.id, "/play"); // page is leaving: a late AI reply arrives now
    game.gameActions.appendLog({ speaker: { kind: "narrator" }, key: "custom", params: { text: "late" } });
    reload();
    expect(game.getSave().log).toEqual([]);
    enter(a.id);
    expect(game.getSave().log).toEqual([]);
  });

  it("renames without touching id, theme, characters or progress", () => {
    const a = saves.createWorld();
    enter(a.id);
    game.gameActions.selectWorld("otherworld");
    game.gameActions.addCharacter();
    const before = local.getItem(worldKey(a.id));
    expect(saves.renameWorld(a.id, "  雾港 Harbor  ")).toBe(true);
    const w = saves.getIndex().worlds[0];
    expect(w).toMatchObject({ id: a.id, name: "雾港 Harbor", theme: "otherworld", characterCount: 1 });
    expect(local.getItem(worldKey(a.id))).toBe(before);
    expect(saves.renameWorld(a.id, "   ")).toBe(false);
  });

  it("duplicates into an independent world: changing either copy never affects the other", async () => {
    const a = saves.createWorld();
    enter(a.id);
    game.gameActions.selectWorld("western-fantasy");
    const c1 = game.gameActions.addCharacter();
    const c2 = game.gameActions.addCharacter();
    game.gameActions.updateCharacter(c1.id, { name: "Ada" });
    game.gameActions.setStory({ ...game.getSave().story, bonds: { [[c1.id, c2.id].sort().join("|")]: { affinity: 3, trust: 1 } } });

    const copy = await saves.duplicateWorld(a.id, "Ada's world (copy)");
    expect(copy.id).not.toBe(a.id);
    expect(copy).toMatchObject({ name: "Ada's world (copy)", theme: "western-fantasy", characterCount: 2, copiedFrom: a.id });

    enter(copy.id);
    const copied = game.getSave();
    expect(copied.characters.map((c) => c.name)).toEqual(["Ada", ""]);
    expect(copied.characters.map((c) => c.id)).not.toContain(c1.id);
    const [n1, n2] = copied.characters.map((c) => c.id);
    expect(Object.keys(copied.story.bonds)).toEqual([[n1, n2].sort().join("|")]);
    game.gameActions.updateCharacter(n1, { name: "Ada II" });
    game.gameActions.deleteCharacter(n2);
    // Stale id from the original world does nothing here.
    game.gameActions.updateCharacter(c1.id, { name: "should not appear" });
    expect(game.getSave().characters.map((c) => c.name)).toEqual(["Ada II"]);

    enter(a.id);
    expect(game.getSave().characters.map((c) => c.name)).toEqual(["Ada", ""]);
  });

  it("deletes only the chosen world and keeps the original backup", async () => {
    local.setItem(LEGACY_SAVE_KEY, JSON.stringify(legacySave()));
    const migrated = saves.getIndex().worlds[0];
    const other = saves.createWorld();
    enter(other.id);
    game.gameActions.addCharacter();

    await saves.deleteWorld(migrated.id);
    expect(saves.getIndex().worlds.map((w) => w.id)).toEqual([other.id]);
    expect(local.getItem(worldKey(migrated.id))).toBeNull();
    expect(local.getItem(LEGACY_SAVE_KEY)).not.toBeNull();
    expect(game.getSave().characters).toHaveLength(1);
    expect(navigations).not.toContain("reload");
  });

  it("deleting the world being played reloads the page and saves nothing more into it", async () => {
    const a = saves.createWorld();
    enter(a.id);
    game.gameActions.addCharacter();
    await saves.deleteWorld(a.id);
    expect(navigations.at(-1)).toBe("reload");
    game.gameActions.addCharacter(); // a late write before the reload lands
    expect(saves.getIndex().worlds).toEqual([]);
  });

  it("migrates a legacy save on first visit and plays it as the active world", () => {
    local.setItem(LEGACY_SAVE_KEY, JSON.stringify(legacySave()));
    const save = game.getSave();
    expect(save.characters.map((c) => c.name)).toEqual(["Juniper", "Mira"]);
    expect(save.environment.mapId).toBe("map_old");
    game.gameActions.addCharacter();
    // The game writes to the new world save; the original stays exactly as it was.
    expect(JSON.parse(local.getItem(LEGACY_SAVE_KEY)!).characters).toHaveLength(2);
  });
});
