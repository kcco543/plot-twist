import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser, type FakeStorage } from "./fakeBrowser";
import { forgetCharacterInStory } from "@/lib/library/templates";
import { LIBRARY_KEY } from "@/lib/library/templates";
import { worldKey } from "@/lib/saves/format";

type Saves = typeof import("@/lib/saves/worldSaves");
type Game = typeof import("@/lib/gameStore");
type Library = typeof import("@/lib/library/characterLibrary");
type Ai = typeof import("@/lib/ai/client");

describe("Character Library and per-world characters", () => {
  let local: FakeStorage;
  let saves: Saves;
  let game: Game;
  let lib: Library;
  let ai: Ai;

  /** A page reload: memory is gone, browser storage stays. */
  const reload = async () => {
    vi.resetModules();
    saves = await import("@/lib/saves/worldSaves");
    game = await import("@/lib/gameStore");
    lib = await import("@/lib/library/characterLibrary");
    ai = await import("@/lib/ai/client");
  };
  const enter = async (id: string) => {
    saves.enterWorld(id, "/studio");
    await reload();
  };
  const mira = () => game.getSave().characters.find((c) => c.name === "Mira")!;

  beforeEach(async () => {
    ({ local } = fakeBrowser());
    await reload();
  });

  /** Scenarios 1–3: Mira in the library, added to World A and World B. */
  async function setup() {
    const a = saves.createWorld();
    const b = saves.createWorld();
    const tpl = lib.libraryActions.createBlank();
    lib.libraryActions.update(tpl.id, { name: "Mira", personality: "Curious and kind.", traits: { extroversion: 50 }, appearance: "Silver braid", lockedFields: ["name"] });
    const original = lib.getLibrary().templates[0];

    await enter(a.id);
    game.gameActions.selectWorld("western-fantasy");
    const inA = game.gameActions.addFromLibrary(lib.getLibrary().templates[0]);
    const rowan = game.gameActions.addCharacter();
    game.gameActions.updateCharacter(rowan.id, { name: "Rowan" });

    await enter(b.id);
    game.gameActions.selectWorld("modern");
    const inB = game.gameActions.addFromLibrary(lib.getLibrary().templates[0]);
    const eli = game.gameActions.addCharacter();
    game.gameActions.updateCharacter(eli.id, { name: "Eli" });
    return { a, b, original, inA, inB, rowan, eli };
  }

  it("1–3: adds the same library original to two worlds as separate characters", async () => {
    const { original, inA, inB } = await setup();
    expect(original).toMatchObject({ name: "Mira", personality: "Curious and kind." });
    expect(inA.id).not.toBe(inB.id);
    expect(inA.id).not.toBe(original.id);
    expect(inA.templateId).toBe(original.id);
    expect(inB.templateId).toBe(original.id);
    expect(inA).toMatchObject({ name: "Mira", personality: "Curious and kind.", appearance: "Silver braid", lockedFields: ["name"], traits: { extroversion: 50 } });
  });

  it("4–6: editing Mira in World A changes neither World B nor the original", async () => {
    const { a, b, original } = await setup();
    await enter(a.id);
    game.gameActions.updateCharacter(mira().id, { personality: "Introverted and cautious.", identity: "Mage", traits: { extroversion: 10 } });
    expect(mira()).toMatchObject({ personality: "Introverted and cautious.", identity: "Mage", traits: { extroversion: 10 } });

    await enter(b.id);
    expect(mira()).toMatchObject({ personality: "Curious and kind.", identity: "", traits: { extroversion: 50 } });
    expect(lib.getLibrary().templates[0]).toEqual(original);
  });

  it("7–8: a new look in World B leaves World A and the original's art alone", async () => {
    const { a, b } = await setup();
    await enter(b.id);
    const art = { sprite: "data:image/png;base64,B", portrait: "data:image/png;base64,BP", source: "edited" as const };
    game.gameActions.saveSprite(art, "Mira (student)", mira().id);
    game.gameActions.updateCharacter(mira().id, { appearance: "Hoodie and glasses", portrait: 3 });
    expect(mira().art?.sprite).toBe(art.sprite);

    await enter(a.id);
    expect(mira()).toMatchObject({ art: null, appearance: "Silver braid", portrait: 0 });
    expect(lib.getLibrary().templates[0]).toMatchObject({ art: null, appearance: "Silver braid" });
  });

  it("editing the original later never changes characters already in worlds", async () => {
    const { a, original } = await setup();
    lib.libraryActions.update(original.id, { personality: "Rewritten original" });
    await enter(a.id);
    expect(mira().personality).toBe("Curious and kind.");
  });

  it("9–10: removing Mira from World A keeps her in World B and the library, and cleans A's references", async () => {
    const { a, b } = await setup();
    await enter(a.id);
    const m = mira();
    const rowan = game.getSave().characters.find((c) => c.name === "Rowan")!;
    const key = [m.id, rowan.id].sort().join("|");
    game.gameActions.setStory({
      ...game.getSave().story,
      characters: {
        [m.id]: { mood: "calm", intensity: 1, memories: [] },
        [rowan.id]: {
          mood: "irritated",
          intensity: 2,
          memories: [{ id: "m1", turn: 1, eventType: "argument", reaction: null, withId: m.id, withName: "Mira", mood: "irritated", importance: 2, note: "Mira beat me", at: 1 }],
        },
      },
      bonds: { [key]: { affinity: -20, trust: 5 } },
    });
    game.gameActions.appendLog({ speaker: { kind: "character", name: "Mira", id: m.id }, key: "custom", params: { text: "Rivals, then." } });
    game.gameActions.removeFromWorld(m.id);

    const s = game.getSave();
    expect(s.characters.map((c) => c.name)).toEqual(["Rowan"]);
    expect(s.story.characters[m.id]).toBeUndefined();
    expect(s.story.bonds[key]).toBeUndefined();
    expect(s.story.characters[rowan.id].memories[0].withName).toBe("Mira"); // Rowan still remembers her
    expect(s.log).toHaveLength(1); // story history kept

    await enter(b.id);
    expect(mira()).toBeTruthy();
    expect(lib.getLibrary().templates.map((t) => t.name)).toEqual(["Mira"]);
  });

  it("11–12: duplicating World B gives the copy its own Mira", async () => {
    const { b, original } = await setup();
    const copy = await saves.duplicateWorld(b.id, "World B (copy)");
    await enter(copy.id);
    const copyMira = mira();
    expect(copyMira.templateId).toBe(original.id); // still says where she came from
    game.gameActions.updateCharacter(copyMira.id, { personality: "Only in the copy" });

    await enter(b.id);
    expect(mira().id).not.toBe(copyMira.id);
    expect(mira().personality).toBe("Curious and kind.");
  });

  it("13–14: AI dialogue in World A uses A's Mira and saves only to A", async () => {
    const { a, b } = await setup();
    await enter(a.id);
    game.gameActions.updateCharacter(mira().id, { personality: "Introverted and cautious." });
    const aMira = mira();
    const brief = ai.briefFor(aMira);
    expect(brief.id).toBe(aMira.id);
    expect(brief.fields.personality).toBe("Introverted and cautious.");

    const sent: { headers: Record<string, string>; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      sent.push({ headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ lines: [{ speaker: "Mira", text: "…hello." }], memoryNote: "Met Rowan at the gate" }) };
    });
    const out = await ai.requestTurn({ characters: [brief] } as never);
    expect(sent[0].headers["X-Plot-Twist-World"]).toBe(a.id);
    // The game saves the reply the usual way: into the active world.
    game.gameActions.setStory({
      ...game.getSave().story,
      characters: {
        [aMira.id]: {
          mood: "calm",
          intensity: 1,
          memories: [{ id: "mm", turn: 1, eventType: "talk", reaction: null, withId: null, withName: "Rowan", mood: "calm", importance: 1, note: out.memoryNote, at: 1 }],
        },
      },
    });
    game.gameActions.appendLog({ speaker: { kind: "character", name: "Mira", id: aMira.id }, key: "custom", params: { text: out.lines[0].text }, source: "ai" });
    vi.unstubAllGlobals();

    const bBefore = local.getItem(worldKey(b.id));
    expect(bBefore).toBe(local.getItem(worldKey(b.id)));
    const bData = JSON.parse(local.getItem(worldKey(b.id))!);
    expect(bData.log).toEqual([]);
    expect(bData.story.characters).toEqual({});
  });

  it("15: everything is still there after a refresh", async () => {
    const { a, b } = await setup();
    await enter(a.id);
    game.gameActions.updateCharacter(mira().id, { identity: "Mage" });
    await reload();
    expect(saves.activeWorldId()).toBe(a.id);
    expect(mira().identity).toBe("Mage");
    expect(lib.getLibrary().templates).toHaveLength(1);
    expect(JSON.parse(local.getItem(LIBRARY_KEY)!).templates[0].name).toBe("Mira");
    await enter(b.id);
    expect(mira().identity).toBe("");
  });

  it("Save as New Template copies the world version into a new, separate original", async () => {
    const { a } = await setup();
    await enter(a.id);
    game.gameActions.updateCharacter(mira().id, { personality: "Mage Mira", relationships: "Rival of Rowan" });
    const tpl = lib.libraryActions.saveFromCharacter(mira());
    expect(lib.getLibrary().templates.map((t) => t.personality)).toEqual(["Mage Mira", "Curious and kind."]);
    expect(tpl.relationships).toBe(""); // world-specific ties are not reused
    expect(tpl.templateId).toBeUndefined();
    game.gameActions.updateCharacter(mira().id, { personality: "changed again" });
    expect(lib.getLibrary().templates[0].personality).toBe("Mage Mira");
  });

  it("deleting an original from the library leaves every world's version", async () => {
    const { a, original } = await setup();
    lib.libraryActions.remove(original.id);
    await enter(a.id);
    expect(mira().templateId).toBe(original.id);
    expect(lib.getLibrary().templates).toEqual([]);
  });

  it("world characters and library originals never share objects", async () => {
    const { a } = await setup();
    await enter(a.id);
    const tpl = lib.getLibrary().templates[0];
    const c = game.gameActions.addFromLibrary(tpl);
    c.traits.extroversion = 99;
    c.lockedFields.push("goals");
    expect(tpl.traits.extroversion).toBe(50);
    expect(tpl.lockedFields).toEqual(["name"]);
  });

  it("old world saves without library links load unchanged", async () => {
    local.setItem("plot-twist:save:v1", JSON.stringify({ characters: [{ id: "c1", name: "Old friend" }], updatedAt: 5 }));
    await reload();
    expect(game.getSave().characters[0]).toMatchObject({ id: "c1", name: "Old friend" });
    expect(game.getSave().characters[0].templateId).toBeUndefined();
  });
});

describe("forgetCharacterInStory", () => {
  it("drops the character's own and pair records, keeps history", () => {
    const story = { turn: 3, characters: { x: 1, y: 2 }, bonds: { "x|y": 1, "y|z": 2 }, relations: { "x>y": 1, "y>x": 2, "y>z": 3 }, events: [{ actorId: "x" }] };
    expect(forgetCharacterInStory(story, "x")).toEqual({ turn: 3, characters: { y: 2 }, bonds: { "y|z": 2 }, relations: { "y>z": 3 }, events: [{ actorId: "x" }] });
  });
});
