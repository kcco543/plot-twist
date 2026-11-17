/**
 * Rendering topic labels / reasons with their params in the active language.
 * Params follow the story-line convention: "<x>Key" holds a translation key
 * rendered into <x>, and "place" is an environment id.
 */
import { translate, type Locale } from "@/i18n";

export function talkVars(vars: Record<string, string>, locale: Locale): Record<string, string> {
  const out: Record<string, string> = { ...vars };
  if (vars.place) out.place = translate(locale, `environments.${vars.place}.name`);
  for (const [k, v] of Object.entries(vars)) if (k.endsWith("Key") && v) out[k.slice(0, -3)] = translate(locale, v);
  return out;
}

/** A relationship in a few plain words: its label plus up to two feelings (translation keys under talk.relation). */
export function relationWords(rel: { label?: string; affection: number; trust: number; tension: number; rivalry: number }): { label: string; words: string[] } {
  const words: string[] = [];
  if (rel.affection >= 35) words.push("warm");
  else if (rel.affection <= -20) words.push("cold");
  if (rel.trust >= 35) words.push("trusting");
  else if (rel.trust <= -20) words.push("wary");
  if (rel.tension >= 45) words.push("tense");
  if (rel.rivalry >= 45) words.push("competitive");
  return { label: rel.label ?? "stranger", words: words.length ? words.slice(0, 2) : ["neutral"] };
}
