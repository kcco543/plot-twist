"use client";

import { createPersistentStore } from "./persistentStore";
import { makeId } from "./id";
import type { Character, CharacterTextField, EnvironmentDraft, SaveData, StoryLine, WorldId } from "./types";

const SAVE_KEY = "plot-twist:save:v1";

export const emptySave: SaveData = {
  version: 1,
  worldId: null,
  characters: [],
  environment: { description: "", type: "interior" },
  log: [],
  updatedAt: null,
};

const store = createPersistentStore<SaveData>(SAVE_KEY, emptySave, (raw) => {
  const r = (raw ?? {}) as Partial<SaveData>;
  return {
    ...emptySave,
    ...r,
    environment: { ...emptySave.environment, ...(r.environment ?? {}) },
    characters: Array.isArray(r.characters) ? r.characters : [],
    log: Array.isArray(r.log) ? r.log : [],
  };
});

export const useSave = store.useStore;

const touch = (fn: (s: SaveData) => SaveData) => store.set((s) => ({ ...fn(s), updatedAt: Date.now() }));

export const CHARACTER_TEXT_FIELDS: CharacterTextField[] = [
  "name",
  "age",
  "appearance",
  "personality",
  "background",
  "goals",
  "fears",
  "habits",
  "relationships",
  "rules",
];

export function createBlankCharacter(portrait = 0): Character {
  const now = Date.now();
  const blank = Object.fromEntries(CHARACTER_TEXT_FIELDS.map((f) => [f, ""])) as Record<CharacterTextField, string>;
  return { ...blank, id: makeId("char"), portrait, createdAt: now, updatedAt: now };
}

export const gameActions = {
  selectWorld(worldId: WorldId) {
    touch((s) => ({ ...s, worldId }));
  },
  addCharacter(): Character {
    // Give each new character the first placeholder portrait nobody is using yet.
    const used = new Set(store.get().characters.map((ch) => ch.portrait));
    let portrait = 0;
    while (used.has(portrait) && portrait < used.size) portrait++;
    const c = createBlankCharacter(portrait);
    touch((s) => ({ ...s, characters: [...s.characters, c] }));
    return c;
  },
  updateCharacter(id: string, patch: Partial<Omit<Character, "id">>) {
    touch((s) => ({
      ...s,
      characters: s.characters.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)),
    }));
  },
  deleteCharacter(id: string) {
    touch((s) => ({ ...s, characters: s.characters.filter((c) => c.id !== id) }));
  },
  updateEnvironment(patch: Partial<EnvironmentDraft>) {
    touch((s) => ({ ...s, environment: { ...s.environment, ...patch } }));
  },
  appendLog(line: StoryLine) {
    touch((s) => ({ ...s, log: [...s.log, { ...line, id: makeId("log"), at: Date.now() }].slice(-200) }));
  },
  clearLog() {
    touch((s) => ({ ...s, log: [] }));
  },
  eraseAll() {
    store.reset();
  },
};

/** Where "Continue" should take the player, based on what is filled in. */
export function nextStepFor(save: SaveData): "/worlds" | "/studio" | "/builder" | "/play" {
  if (!save.worldId) return "/worlds";
  if (save.characters.length === 0) return "/studio";
  return "/play";
}
