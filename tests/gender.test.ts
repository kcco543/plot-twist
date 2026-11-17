import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "./fakeBrowser";
import { englishPronouns, genderForPrompt, normalizeGender } from "@/lib/character/gender";
import { normalizeCharacter } from "@/lib/character/model";
import { characterBlock } from "@/lib/ai/server/prompts";
import { renderLine, setPronounLookup } from "@/lib/scenes";
import type { StoryLine } from "@/lib/types";
import { makeChar } from "./helpers";

type Saves = typeof import("@/lib/saves/worldSaves");
type Game = typeof import("@/lib/gameStore");
type Library = typeof import("@/lib/library/characterLibrary");
type Ai = typeof import("@/lib/ai/client");

describe("gender and pronouns", () => {
  it("legacy characters load as unspecified (nothing is guessed)", () => {
    const old = normalizeCharacter({ id: "c1", name: "Mira", personality: "Quiet" });
    expect(old.gender).toBeUndefined();
    expect(genderForPrompt(old.gender)).toBeNull();
    expect(normalizeGender({ identity: "robot", pronouns: "zz" })).toEqual({ identity: "unspecified", pronouns: "unspecified" });
    expect(normalizeCharacter({ id: "c2", gender: { identity: "custom", custom: "storm spirit", pronouns: "custom", customPronouns: "xe/xem/xyr" } }).gender).toEqual({ identity: "custom", custom: "storm spirit", pronouns: "custom", customPronouns: "xe/xem/xyr" });
  });

  it("pronoun forms for narration, separately from gender", () => {
    expect(englishPronouns({ identity: "female", pronouns: "they" }).their).toBe("their");
    expect(englishPronouns({ identity: "nonbinary", pronouns: "she" })).toMatchObject({ they: "she", their: "her", theyAre: "she is" });
    expect(englishPronouns({ identity: "male", pronouns: "he" })).toMatchObject({ them: "him", their: "his" });
    expect(englishPronouns({ identity: "custom", pronouns: "custom", customPronouns: "xe/xem/xyr" })).toMatchObject({ they: "xe", them: "xem", their: "xyr" });
    expect(englishPronouns(undefined).their).toBe("their");
  });

  it("built-in narration uses the character's pronouns", () => {
    const line: StoryLine = { speaker: { kind: "narrator" }, key: "tpl", tpl: "scene.solo.calm", params: { name: "Mira", detail: "" }, index: 0 };
    const keeps: StoryLine = { speaker: { kind: "narrator" }, key: "tpl", tpl: "keepsakes.log.giftMoved.private", params: { name: "Mira", gift: "lamp" } };
    expect(renderLine(keeps, "en").text).toBe("Mira tucked the lamp away among their things.");
    setPronounLookup((n) => (n === "Mira" ? englishPronouns({ identity: "female", pronouns: "she" }) : null));
    expect(renderLine(keeps, "en").text).toBe("Mira tucked the lamp away among her things.");
    setPronounLookup(null);
    void line;
  });

  it("the AI is told the pronouns, and told not to assume when unspecified", () => {
    const brief = { id: "c1", fields: { name: "Mira" }, traits: {}, lockedFields: [], profile: null };
    expect(characterBlock({ ...brief, identity: { gender: "non-binary", pronouns: "they/them" } }, "listener")).toMatch(/gender: non-binary; pronouns: they\/them/);
    expect(characterBlock({ ...brief, identity: { gender: "non-binary", pronouns: "they/them" } }, "listener")).toMatch(/never infer personality/);
    expect(characterBlock(brief, "listener")).toMatch(/not specified/);
    expect(genderForPrompt({ identity: "custom", custom: "storm spirit", pronouns: "unspecified" })).toEqual({ gender: "storm spirit", pronouns: "not specified" });
    void makeChar;
  });
});

describe("gender is saved per world version", () => {
  let saves: Saves;
  let game: Game;
  let lib: Library;
  let ai: Ai;
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
  beforeEach(async () => {
    fakeBrowser();
    await reload();
  });

  it("editing gender/pronouns in World A leaves World B and the library original alone", async () => {
    const a = saves.createWorld();
    const b = saves.createWorld();
    const tpl = lib.libraryActions.createBlank();
    lib.libraryActions.update(tpl.id, { name: "Mira", gender: { identity: "female", pronouns: "she" } });
    await enter(a.id);
    game.gameActions.selectWorld("modern");
    const inA = game.gameActions.addFromLibrary(lib.getLibrary().templates[0]);
    await enter(b.id);
    game.gameActions.selectWorld("modern");
    game.gameActions.addFromLibrary(lib.getLibrary().templates[0]);
    await enter(a.id);
    game.gameActions.updateCharacter(inA.id, { gender: { identity: "nonbinary", pronouns: "they" } });
    await reload();
    expect(game.getSave().characters[0].gender).toEqual({ identity: "nonbinary", pronouns: "they" });
    expect(ai.briefFor(game.getSave().characters[0]).identity).toEqual({ gender: "non-binary", pronouns: "they/them" });
    await enter(b.id);
    expect(game.getSave().characters[0].gender).toEqual({ identity: "female", pronouns: "she" });
    expect(lib.getLibrary().templates[0].gender).toEqual({ identity: "female", pronouns: "she" });
  });
});
