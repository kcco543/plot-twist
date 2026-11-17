/**
 * Story line rendering for Play Mode. Lines are stored as translation keys
 * (built-in writer) or finished text (AI writer / player text), so every
 * predefined phrase exists in English and Chinese while the player's own
 * words stay untouched. What happens each turn is decided by
 * src/lib/story/engine.ts; built-in wording comes from src/lib/story/localWriter.ts.
 */
import type { Character, EnvironmentTypeId, LogEntry, StoryLine } from "./types";
import { createBlankCharacter } from "./character/model";
import { translate, translateList, type Locale } from "@/i18n";
import { englishPronouns, type EnglishPronouns } from "./character/gender";

const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const pickIndex = (len: number, n: number) => ((n % len) + len) % len;

export function introLine(description: string, place: EnvironmentTypeId): StoryLine {
  const text = clean(description);
  return text
    ? { speaker: { kind: "narrator" }, key: "custom", params: { text } }
    : { speaker: { kind: "narrator" }, key: "scene.intro", params: { place } };
}

/** Turn a stored line into display text in the active language. */
/**
 * Pronouns for built-in English narration: templates may use {their}, {them},
 * {they}, {theyAre} and {theyre} for the character in {name}. The play screen
 * registers a lookup (name → pronouns) for the current cast; without one, or
 * for an unspecified character, singular "they" is used.
 */
let pronounLookup: ((name: string) => EnglishPronouns | null) | null = null;
export function setPronounLookup(fn: ((name: string) => EnglishPronouns | null) | null) {
  pronounLookup = fn;
}

export function renderLine(line: StoryLine | LogEntry, locale: Locale): { speaker: string; text: string } {
  if (typeof line.speaker === "string" && "text" in line) return { speaker: line.speaker, text: line.text }; // v0.1 save
  const l = line as StoryLine;
  const unnamed = translate(locale, "common.unnamed");
  const p: Record<string, string> = { ...l.params };
  if (p.name !== undefined) p.name = p.name || unnamed;
  if (p.place) p.place = translate(locale, `environments.${p.place}.name`);
  if (p.topic) p.topic = translate(locale, `scene.topics.${p.topic}`);
  if (p.other !== undefined) p.other = p.other || unnamed;
  if (p.with !== undefined) p.with = p.with || translate(locale, "common.someone");
  const pr = (p.name && pronounLookup?.(l.params.name ?? "")) || englishPronouns(undefined);
  for (const [k, v] of Object.entries(pr)) if (p[k] === undefined) p[k] = v;
  // Params named "<x>Key" hold a translation key: render it into <x> in the active language.
  for (const [k, v] of Object.entries(l.params)) if (k.endsWith("Key") && v) p[k.slice(0, -3)] = translate(locale, v, p);
  const speaker = l.speaker.kind === "narrator" ? translate(locale, "scene.narrator") : l.speaker.name || unnamed;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => p[k] ?? "");
  let text: string;
  if (l.key === "custom") text = p.text ?? "";
  else if (l.key === "tpl") {
    const list = translateList(locale, l.tpl ?? "");
    text = list.length ? fill(list[pickIndex(list.length, l.index ?? 0)]) : translate(locale, l.tpl ?? "", p);
  }
  else if (l.key === "behave") text = behaveText(l, p, locale);
  else if (l.key === "scene.wait") {
    const list = translateList(locale, "scene.wait");
    text = list[pickIndex(list.length, l.index ?? 0)].replace(/\{(\w+)\}/g, (_, k) => p[k] ?? "");
  } else text = translate(locale, l.key, p);
  return { speaker, text };
}

/** A behavior-engine reply: trigger-specific wording if there is one, then length, hesitation and address. */
function behaveText(l: StoryLine, p: Record<string, string>, locale: Locale): string {
  const base = l.tpl ?? "";
  const list = translateList(locale, `${base}.${p.group}.${p.len}`).length ? translateList(locale, `${base}.${p.group}.${p.len}`) : translateList(locale, `${base}.${p.len}`);
  if (!list.length) return "";
  let text = list[pickIndex(list.length, l.index ?? 0)].replace(/\{(\w+)\}/g, (_, k) => p[k] ?? "");
  if (p.addr && p.other) text = translate(locale, "behave.addr", { other: p.other }) + (locale === "en" && !/^I\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
  if (p.pre && !text.startsWith("…")) text = translate(locale, "behave.pre") + text;
  return text;
}

/** Shown in Play Mode when the player hasn't created anyone yet (predefined, so it's translated). */
export function demoCast(locale: Locale): Character[] {
  const tr = (k: string) => translate(locale, k);
  const fields = ["name", "age", "appearance", "personality", "habits", "goals", "fears", "relationships"] as const;
  return (["a", "b"] as const).map((id, i) => {
    const base = createBlankCharacter(i === 0 ? 0 : 2);
    const filled = Object.fromEntries(
      fields.map((f) => {
        const v = tr(`demo.${id}.${f}`);
        return [f, v === `demo.${id}.${f}` ? "" : v];
      }),
    );
    return { ...base, ...filled, id: `demo-${id}` };
  });
}
