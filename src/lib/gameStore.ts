"use client";

import { createPersistentStore } from "./persistentStore";
import { makeId } from "./id";
import { createBlankCharacter, normalizeCharacter } from "./character/model";
import { emptyStory, withMemoryNote } from "./story/engine";
import type { Character, CharacterArt, EnvironmentDraft, SaveData, SpriteAsset, StoryLine, StoryState, WorldId } from "./types";

/** Same key as v0.1–v0.3, so existing saves load. Older saves are upgraded in place without losing anything. */
const SAVE_KEY = "plot-twist:save:v1";

export const emptySave: SaveData = {
  version: 1,
  worldId: null,
  characters: [],
  environment: { description: "", type: "interior" },
  log: [],
  story: emptyStory(),
  sprites: [],
  updatedAt: null,
};

function normalizeStory(raw: unknown): StoryState {
  const r = (raw ?? {}) as Partial<StoryState>;
  return {
    turn: typeof r.turn === "number" ? r.turn : 0,
    characters: r.characters && typeof r.characters === "object" ? r.characters : {},
    bonds: r.bonds && typeof r.bonds === "object" ? r.bonds : {},
    events: Array.isArray(r.events) ? r.events : [],
  };
}

export function migrateSave(raw: unknown): SaveData {
  const r = (raw ?? {}) as Partial<SaveData>;
  return {
    ...emptySave,
    ...r,
    version: 1,
    environment: { ...emptySave.environment, ...(r.environment ?? {}) },
    characters: Array.isArray(r.characters) ? r.characters.map(normalizeCharacter) : [],
    log: Array.isArray(r.log) ? r.log : [],
    story: normalizeStory(r.story),
    sprites: Array.isArray(r.sprites) ? r.sprites.filter((s) => s && typeof s.sprite === "string") : [],
  };
}

const store = createPersistentStore<SaveData>(SAVE_KEY, emptySave, migrateSave);

export const useSave = store.useStore;
export const getSave = store.get;

const touch = (fn: (s: SaveData) => SaveData) => store.set((s) => ({ ...fn(s), updatedAt: Date.now() }));

export { CHARACTER_TEXT_FIELDS, createBlankCharacter } from "./character/model";

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
    gameActions.appendLines([line]);
  },
  appendLines(lines: StoryLine[]) {
    if (lines.length === 0) return;
    touch((s) => ({ ...s, log: [...s.log, ...lines.map((line) => ({ ...line, id: makeId("log"), at: Date.now() }))].slice(-200) }));
  },
  clearLog() {
    touch((s) => ({ ...s, log: [] }));
  },
  /** Story state is only ever replaced by the engine's result (game rules), never by AI output. */
  setStory(story: StoryState) {
    touch((s) => ({ ...s, story }));
  },
  setMemoryNote(actorId: string, memoryId: string, note: string) {
    touch((s) => ({ ...s, story: withMemoryNote(s.story, actorId, memoryId, note) }));
  },
  resetStory() {
    touch((s) => ({ ...s, story: emptyStory(), log: [] }));
  },
  /** Save a sprite to the library and (optionally) give it to a character. */
  saveSprite(art: Omit<CharacterArt, "assetId">, name: string, characterId?: string): SpriteAsset {
    const asset: SpriteAsset = { ...art, assetId: makeId("sprite"), name, createdAt: Date.now() };
    touch((s) => ({
      ...s,
      sprites: [asset, ...s.sprites].slice(0, 40),
      characters: characterId ? s.characters.map((c) => (c.id === characterId ? { ...c, art: pick(asset), updatedAt: Date.now() } : c)) : s.characters,
    }));
    return asset;
  },
  applySprite(characterId: string, asset: SpriteAsset | null) {
    gameActions.updateCharacter(characterId, { art: asset ? pick(asset) : null });
  },
  deleteSprite(assetId: string) {
    // Characters already wearing it keep their copy.
    touch((s) => ({ ...s, sprites: s.sprites.filter((a) => a.assetId !== assetId) }));
  },
  eraseAll() {
    store.reset();
  },
};

const pick = (a: SpriteAsset): CharacterArt => ({ assetId: a.assetId, sprite: a.sprite, portrait: a.portrait, source: a.source });

/** Where "Continue" should take the player, based on what is filled in. */
export function nextStepFor(save: SaveData): "/worlds" | "/studio" | "/builder" | "/play" {
  if (!save.worldId) return "/worlds";
  if (save.characters.length === 0) return "/studio";
  return "/play";
}
