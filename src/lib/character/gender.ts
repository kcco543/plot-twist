/**
 * GENDER AND PRONOUNS — an optional part of a character's identity.
 * --------------------------------------------------------------------------
 * Stored per character (so per world: each world's copy has its own), never
 * guessed: a character without the field is "unspecified". Pronouns are a
 * separate choice from gender. Neither is ever used to infer personality,
 * interests, abilities or behavior; they only decide how the character is
 * referred to in narration and AI-written lines.
 */
import type { Character } from "../types";

export const GENDERS = ["unspecified", "female", "male", "nonbinary", "custom"] as const;
export type Gender = (typeof GENDERS)[number];
export const PRONOUN_CHOICES = ["unspecified", "she", "he", "they", "custom"] as const;
export type PronounChoice = (typeof PRONOUN_CHOICES)[number];

export type GenderInfo = {
  identity: Gender;
  /** The player's own words when identity is "custom". */
  custom?: string;
  pronouns: PronounChoice;
  /** e.g. "xe/xem/xyr" when pronouns is "custom". */
  customPronouns?: string;
};

export const UNSPECIFIED: GenderInfo = { identity: "unspecified", pronouns: "unspecified" };

export function normalizeGender(raw: unknown): GenderInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const identity = GENDERS.includes(r.identity as Gender) ? (r.identity as Gender) : "unspecified";
  const pronouns = PRONOUN_CHOICES.includes(r.pronouns as PronounChoice) ? (r.pronouns as PronounChoice) : "unspecified";
  const out: GenderInfo = { identity, pronouns };
  if (typeof r.custom === "string" && r.custom.trim()) out.custom = r.custom.slice(0, 60);
  if (typeof r.customPronouns === "string" && r.customPronouns.trim()) out.customPronouns = r.customPronouns.slice(0, 40);
  return out;
}

export const genderOf = (c: Pick<Character, "gender">): GenderInfo => c.gender ?? UNSPECIFIED;

/** English pronoun forms used by built-in narration. Unspecified uses singular "they", as the game always has. */
export type EnglishPronouns = { they: string; them: string; their: string; theyAre: string; theyre: string };
const THEY: EnglishPronouns = { they: "they", them: "them", their: "their", theyAre: "they are", theyre: "they're" };

export function englishPronouns(g: GenderInfo | undefined): EnglishPronouns {
  switch (g?.pronouns) {
    case "she":
      return { they: "she", them: "her", their: "her", theyAre: "she is", theyre: "she's" };
    case "he":
      return { they: "he", them: "him", their: "his", theyAre: "he is", theyre: "he's" };
    case "custom": {
      const parts = (g.customPronouns ?? "").split(/[/,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return THEY;
      const [s, o = parts[0], p = parts[1] ?? parts[0]] = parts;
      return { they: s, them: o, their: p, theyAre: `${s} is`, theyre: `${s} is` };
    }
    default:
      return THEY;
  }
}

/** Plain description for AI prompts, or null when nothing was chosen (the AI then must not assume one). */
export function genderForPrompt(g: GenderInfo | undefined): { gender: string; pronouns: string } | null {
  if (!g || (g.identity === "unspecified" && g.pronouns === "unspecified")) return null;
  const gender = g.identity === "custom" ? (g.custom?.trim() || "self-described") : g.identity === "nonbinary" ? "non-binary" : g.identity === "unspecified" ? "not specified" : g.identity;
  const pronouns =
    g.pronouns === "she" ? "she/her" : g.pronouns === "he" ? "he/him" : g.pronouns === "they" ? "they/them" : g.pronouns === "custom" ? g.customPronouns?.trim() || "not specified" : "not specified";
  return { gender, pronouns };
}
