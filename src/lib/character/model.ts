/**
 * Character data helpers: blank characters, loading older saves, and the
 * "inputs hash" that tells when a personality analysis is out of date.
 * Pure functions (no React, no storage) so they are easy to test.
 */
import { makeId } from "../id";
import { CHARACTER_TEXT_FIELDS, TRAIT_IDS, type Character, type CharacterTextField, type Traits } from "../types";

export { CHARACTER_TEXT_FIELDS };

export function createBlankCharacter(portrait = 0): Character {
  const now = Date.now();
  const blank = Object.fromEntries(CHARACTER_TEXT_FIELDS.map((f) => [f, ""])) as Record<CharacterTextField, string>;
  return {
    ...blank,
    id: makeId("char"),
    portrait,
    art: null,
    traits: {},
    lockedFields: [],
    resolvedConflicts: [],
    behavior: null,
    createdAt: now,
    updatedAt: now,
  };
}

const clampTrait = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : undefined);

export function normalizeTraits(raw: unknown): Traits {
  const out: Traits = {};
  if (raw && typeof raw === "object") {
    for (const id of TRAIT_IDS) {
      const v = clampTrait((raw as Record<string, unknown>)[id]);
      if (v !== undefined) out[id] = v;
    }
  }
  return out;
}

/**
 * Bring a character from any earlier save version up to date WITHOUT losing
 * anything: every field the player wrote is kept exactly, new fields get
 * empty defaults.
 */
export function normalizeCharacter(raw: unknown): Character {
  const r = (raw ?? {}) as Partial<Character> & Record<string, unknown>;
  const base = createBlankCharacter(typeof r.portrait === "number" ? r.portrait : 0);
  const text = Object.fromEntries(CHARACTER_TEXT_FIELDS.map((f) => [f, typeof r[f] === "string" ? (r[f] as string) : ""])) as Record<CharacterTextField, string>;
  const isField = (f: unknown): f is CharacterTextField => CHARACTER_TEXT_FIELDS.includes(f as CharacterTextField);
  return {
    ...base,
    ...text,
    id: typeof r.id === "string" && r.id ? r.id : base.id,
    art: r.art && typeof r.art === "object" && typeof r.art.sprite === "string" && typeof r.art.portrait === "string" ? r.art : null,
    traits: normalizeTraits(r.traits),
    lockedFields: Array.isArray(r.lockedFields) ? r.lockedFields.filter(isField) : [],
    resolvedConflicts: Array.isArray(r.resolvedConflicts) ? r.resolvedConflicts.filter((x): x is string => typeof x === "string") : [],
    behavior: r.behavior && typeof r.behavior === "object" && r.behavior.profile ? r.behavior : null,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : base.createdAt,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : base.updatedAt,
  };
}

/** Stable short hash (FNV-1a) of everything a personality analysis reads. */
export function profileInputHash(c: Character): string {
  const input = JSON.stringify([CHARACTER_TEXT_FIELDS.map((f) => c[f].trim()), TRAIT_IDS.map((t) => c.traits[t] ?? null), [...c.lockedFields].sort()]);
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** True when the character has enough written or slider info to analyze. */
export function hasPersonalityInput(c: Character) {
  const written = (["personality", "background", "goals", "fears", "values", "habits", "speakingStyle", "identity"] as const).some((f) => c[f].trim());
  return written || Object.keys(c.traits).length > 0;
}

/** The analysis the game may use: approved, else null. Stale approvals still count (the player chose them). */
export function approvedBehavior(c: Character) {
  return c.behavior?.status === "approved" ? c.behavior : null;
}

export const displayName = (c: Pick<Character, "name">, unnamed: string) => c.name.trim() || unnamed;
