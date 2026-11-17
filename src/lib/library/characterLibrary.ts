"use client";

/**
 * CHARACTER LIBRARY — browser side. One localStorage entry
 * ("plot-twist:library:v1"), shared by every world but never written by
 * playing a world. See templates.ts for the rules.
 */
import { createPersistentStore } from "../persistentStore";
import { createBlankCharacter } from "../character/model";
import { makeId } from "../id";
import type { Character } from "../types";
import { LIBRARY_KEY, blankTemplate, emptyLibrary, normalizeLibrary, templateFromCharacter, type CharacterTemplate, type LibraryData } from "./templates";

export type { CharacterTemplate } from "./templates";

const store = createPersistentStore<LibraryData>(LIBRARY_KEY, emptyLibrary, normalizeLibrary);

export const useLibrary = store.useStore;
export const getLibrary = store.get;

export const libraryActions = {
  /** Part of "Erase all data". */
  eraseAll() {
    store.reset();
  },
  /** "Save as new template": copy a world's version into a NEW library original. */
  saveFromCharacter(c: Character): CharacterTemplate {
    const t = templateFromCharacter(c, makeId("tpl"), Date.now());
    store.set((l) => ({ ...l, templates: [t, ...l.templates] }));
    return t;
  },
  createBlank(): CharacterTemplate {
    const t = blankTemplate(createBlankCharacter(store.get().templates.length % 6), makeId("tpl"));
    store.set((l) => ({ ...l, templates: [t, ...l.templates] }));
    return t;
  },
  /** Edit an original. Characters already added to worlds keep their own copies. */
  update(id: string, patch: Partial<Omit<Character, "id">>) {
    const { relationships: _drop, templateId: _link, ...rest } = patch;
    void _drop;
    void _link;
    store.set((l) => ({ ...l, templates: l.templates.map((t) => (t.id === id ? { ...t, ...rest, updatedAt: Date.now() } : t)) }));
  },
  /** Remove an original from the library. Worlds that added it keep their characters. */
  remove(id: string) {
    store.set((l) => ({ ...l, templates: l.templates.filter((t) => t.id !== id) }));
  },
};
