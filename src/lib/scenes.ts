/**
 * Scripted placeholder interactions for Play Mode (no AI).
 * Lines are built from what the player wrote in the Character Studio and
 * stored as translation keys, so every predefined phrase exists in English
 * and Chinese while the player's own words stay untouched.
 */
import type { Character, EnvironmentTypeId, LogEntry, StoryLine } from "./types";
import { createBlankCharacter } from "./gameStore";
import { translate, translateList, type Locale } from "@/i18n";

export type Action = "talk" | "observe" | "wait";

const TOPICS = ["goals", "fears", "relationships", "background"] as const;
const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const pickIndex = (len: number, n: number) => ((n % len) + len) % len;

export function lineFor(action: Action, c: Character, turn: number, place: EnvironmentTypeId): StoryLine {
  const name = clean(c.name);
  const character = { kind: "character" as const, name };
  const narrator = { kind: "narrator" as const };
  if (action === "talk") {
    const topics = TOPICS.filter((f) => clean(c[f]));
    if (topics.length === 0) return { speaker: character, key: "scene.silent", params: {} };
    const topic = topics[pickIndex(topics.length, turn)];
    return { speaker: character, key: "scene.talk", params: { topic, text: clean(c[topic]) } };
  }
  if (action === "observe") {
    const details = [c.appearance, c.habits, c.personality].map(clean).filter(Boolean);
    if (details.length === 0) return { speaker: narrator, key: "scene.observeEmpty", params: { name } };
    return { speaker: narrator, key: "scene.observe", params: { name, detail: details[pickIndex(details.length, turn)] } };
  }
  return { speaker: narrator, key: "scene.wait", index: turn, params: { place, name } };
}

export function introLine(description: string, place: EnvironmentTypeId): StoryLine {
  const text = clean(description);
  return text
    ? { speaker: { kind: "narrator" }, key: "custom", params: { text } }
    : { speaker: { kind: "narrator" }, key: "scene.intro", params: { place } };
}

/** Turn a stored line into display text in the active language. */
export function renderLine(line: StoryLine | LogEntry, locale: Locale): { speaker: string; text: string } {
  if (typeof line.speaker === "string" && "text" in line) return { speaker: line.speaker, text: line.text }; // v0.1 save
  const l = line as StoryLine;
  const unnamed = translate(locale, "common.unnamed");
  const p: Record<string, string> = { ...l.params };
  if (p.name !== undefined) p.name = p.name || unnamed;
  if (p.place) p.place = translate(locale, `environments.${p.place}.name`);
  if (p.topic) p.topic = translate(locale, `scene.topics.${p.topic}`);
  const speaker = l.speaker.kind === "narrator" ? translate(locale, "scene.narrator") : l.speaker.name || unnamed;
  let text: string;
  if (l.key === "custom") text = p.text ?? "";
  else if (l.key === "scene.wait") {
    const list = translateList(locale, "scene.wait");
    text = list[pickIndex(list.length, l.index ?? 0)].replace(/\{(\w+)\}/g, (_, k) => p[k] ?? "");
  } else text = translate(locale, l.key, p);
  return { speaker, text };
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
