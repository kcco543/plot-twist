/**
 * CHARACTER LIBRARY — pure helpers (no React, no storage)
 * --------------------------------------------------------------------------
 * The Character Library holds reusable ORIGINALS ("templates"), separate from
 * every world save. Adding an original to a world makes an independent copy:
 * a new world character id, a deep copy of every field, and `templateId`
 * pointing back at the original (a read-only link, used for "View original").
 *
 * Nothing flows between the two afterwards unless the player asks:
 * - editing a world's version never touches the original or other worlds;
 * - editing the original never touches any world;
 * - "Save as new template" copies a world's version into a NEW original.
 *
 * Templates have the same shape as a Character (so the same editor works),
 * minus world-only things: the written relationships (they name people in a
 * particular world) and the link to another template.
 */
import { normalizeCharacter } from "../character/model";
import type { Character } from "../types";

export type CharacterTemplate = Character & { relationships: "" };

export type LibraryData = { version: 1; templates: CharacterTemplate[] };
export const emptyLibrary: LibraryData = { version: 1, templates: [] };
export const LIBRARY_KEY = "plot-twist:library:v1";

/** Deep copy: worlds and the library never share an object (or an array, or a sprite record). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function toTemplate(raw: unknown): CharacterTemplate {
  const c = normalizeCharacter(raw);
  delete c.templateId;
  return { ...c, relationships: "" };
}

export function normalizeLibrary(raw: unknown): LibraryData {
  const r = (raw ?? {}) as { templates?: unknown };
  const seen = new Set<string>();
  const templates = (Array.isArray(r.templates) ? r.templates : [])
    .filter((t) => t && typeof t === "object" && typeof (t as { id?: unknown }).id === "string")
    .map(toTemplate)
    .filter((t) => !seen.has(t.id) && Boolean(seen.add(t.id)));
  return { version: 1, templates };
}

/** A new library original from a world's character (that character is not changed). */
export function templateFromCharacter(c: Character, id: string, now: number): CharacterTemplate {
  return { ...toTemplate(clone(c)), id, createdAt: now, updatedAt: now };
}

/** A blank original, made from the library page. */
export function blankTemplate(base: Character, id: string): CharacterTemplate {
  return { ...toTemplate(clone(base)), id };
}

/** This world's own copy of a library original. */
export function characterFromTemplate(t: CharacterTemplate, id: string, now: number): Character {
  return { ...normalizeCharacter(clone(t)), id, templateId: t.id, relationships: "", createdAt: now, updatedAt: now };
}

/**
 * Remove a character from a world's story state without breaking it: their
 * own state and every pair record with them (bonds "a|b", relations "a>b",
 * conversation lines, relationship shifts) go; the story log and what OTHER
 * characters remember about them (memories keep the name) stay.
 */
export function forgetCharacterInStory<S extends object>(story: S, id: string): S {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(story)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !k.split(/[|>]/).includes(id)));
    } else out[key] = value;
  }
  return out as S;
}
