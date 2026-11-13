import { describe, expect, it } from "vitest";
import { normalizeCharacter, profileInputHash } from "@/lib/character/model";
import { detectConflicts, openConflicts } from "@/lib/character/traits";
import { migrateSave } from "@/lib/gameStore";
import { juniper, makeChar, mei } from "./helpers";

describe("saves from earlier versions", () => {
  const v03Character = {
    id: "char_old",
    name: "Juniper Vale",
    age: "19",
    appearance: "Pencil behind the ear.",
    personality: "Curious.",
    background: "Grew up above a bakery.",
    goals: "Find the letter writer.",
    fears: "Being forgotten.",
    habits: "Hums.",
    relationships: "Owes Rook.",
    rules: "Never lies to children.",
    portrait: 3,
    createdAt: 1,
    updatedAt: 2,
  };

  it("keeps every field the player wrote and adds the new ones empty", () => {
    const c = normalizeCharacter(v03Character);
    for (const [k, v] of Object.entries(v03Character)) expect(c[k as keyof typeof c]).toEqual(v);
    expect(c.identity).toBe("");
    expect(c.traits).toEqual({});
    expect(c.lockedFields).toEqual([]);
    expect(c.behavior).toBeNull();
    expect(c.art).toBeNull();
  });

  it("migrates a whole v0.3 save without losing characters, world, setting or log", () => {
    const old = {
      version: 1,
      worldId: "otherworld",
      characters: [v03Character],
      environment: { description: "A bookshop", type: "interior" },
      log: [{ id: "l1", at: 1, speaker: "Juniper", text: "hi" }],
      updatedAt: 5,
    };
    const s = migrateSave(old);
    expect(s.worldId).toBe("otherworld");
    expect(s.environment.description).toBe("A bookshop");
    expect(s.log).toHaveLength(1);
    expect(s.characters[0].name).toBe("Juniper Vale");
    expect(s.story.events).toEqual([]);
    expect(s.sprites).toEqual([]);
  });

  it("clamps bad slider values and drops unknown traits", () => {
    const c = normalizeCharacter({ ...v03Character, traits: { extroversion: 140, trust: -3, nonsense: 50, empathy: "x" } });
    expect(c.traits).toEqual({ extroversion: 100, trust: 0 });
  });
});

describe("written profile vs sliders", () => {
  it("spots English conflicts and suggests (but does not apply) a fix", () => {
    const c = makeChar({ personality: "Shy and quiet, a loner.", traits: { extroversion: 90 } });
    const [conflict] = detectConflicts(c);
    expect(conflict.id).toBe("extroversion:low");
    expect(conflict.words).toContain("shy");
    expect(conflict.suggested).toBe(25);
    expect(c.traits.extroversion).toBe(90);
  });

  it("spots Chinese conflicts", () => {
    expect(detectConflicts(mei()).map((c) => c.id)).toEqual(["extroversion:low"]);
  });

  it("ignores negated words", () => {
    const c = makeChar({ personality: "Not shy at all. Never cautious.", traits: { extroversion: 90, impulsiveness: 90 } });
    expect(detectConflicts(c)).toEqual([]);
  });

  it("does not flag 'kind of'", () => {
    const c = makeChar({ personality: "Kind of grumpy.", traits: { empathy: 10 } });
    expect(detectConflicts(c)).toEqual([]);
  });

  it("hides conflicts the player chose to keep", () => {
    const c = { ...mei(), resolvedConflicts: ["extroversion:low"] };
    expect(openConflicts(c)).toEqual([]);
  });

  it("changes the analysis hash when the profile or sliders change, not when art changes", () => {
    const a = juniper();
    expect(profileInputHash({ ...a, traits: { ...a.traits, trust: 10 } })).not.toBe(profileInputHash(a));
    expect(profileInputHash({ ...a, goals: a.goals + "!" })).not.toBe(profileInputHash(a));
    expect(profileInputHash({ ...a, portrait: 5 })).toBe(profileInputHash(a));
  });
});
