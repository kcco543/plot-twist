/**
 * BUILT-IN WRITER
 * Turns an engine Beat into story lines using translated templates, so it
 * works offline and in both languages. The player's own words are quoted
 * as written. Used when AI writing is off, unconfigured, or fails.
 */
import { splitItems } from "../behavior/localAnalysis";
import type { Character, EnvironmentTypeId, StoryLine, WorldId } from "../types";
import type { Beat } from "./engine";

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

/** One sentence/item of a written field, rotating with the turn so long fields don't repeat word for word. */
export function excerpt(text: string, turn: number): string {
  const items = splitItems(text, 8);
  if (items.length === 0) return "";
  return clean(items[turn % items.length]);
}

const narrator = { kind: "narrator" as const };
const speakerOf = (c: Character) => ({ kind: "character" as const, name: clean(c.name), id: c.id });

export function beatToLines(beat: Beat, cast: Character[], place: EnvironmentTypeId, world: WorldId): StoryLine[] {
  const actor = cast.find((c) => c.id === beat.actorId);
  if (!actor) return [];
  const other = beat.otherId ? (cast.find((c) => c.id === beat.otherId) ?? null) : null;
  const name = clean(actor.name);
  const otherName = other ? clean(other.name) : "";
  const v = beat.variant;
  const tpl = (t: string, params: Record<string, string>, index = v, speaker: StoryLine["speaker"] = narrator): StoryLine => ({
    speaker,
    key: "tpl",
    tpl: t,
    index,
    params,
    source: "builtin",
  });

  if (beat.kind === "talk") {
    if (!beat.topic) return [{ speaker: speakerOf(actor), key: "scene.silent", params: {}, source: "builtin" }];
    return [
      tpl(`story.talk.${beat.approach}`, { topicKey: `scene.topics.${beat.topic}`, text: excerpt(actor[beat.topic], beat.turn) }, v, speakerOf(actor)),
    ];
  }

  if (beat.kind === "observe") {
    const detail = excerpt([actor.appearance, actor.habits, actor.personality].filter((s) => s.trim()).join("\n"), beat.turn);
    if (!detail) return [{ speaker: narrator, key: "scene.observeEmpty", params: { name }, source: "builtin" }];
    return [tpl(`story.observe.${beat.moodBefore}`, { name, detail })];
  }

  if (beat.kind === "wait") return [{ speaker: narrator, key: "scene.wait", index: v, params: { place, name }, source: "builtin" }];

  // Event: setup → reaction → aftermath
  const field = (f: keyof Character) => (typeof actor[f] === "string" ? excerpt(actor[f] as string, beat.turn) : "");
  const params: Record<string, string> = { name, other: otherName, place };
  let setupKey = `story.events.${beat.type}`;
  switch (beat.type) {
    case "confide":
      params.text = other ? excerpt(other.fears || other.background, beat.turn) : "";
      break;
    case "argument":
      params.text = field("values") || field("goals") || field("personality");
      break;
    case "askHelp":
    case "goalStep":
      params.text = field("goals");
      break;
    case "temptation":
      params.text = field("rules") || field("values");
      break;
    case "fearTrigger":
      params.text = field("fears");
      break;
    case "quietMoment":
      params.text = field("habits") || field("canon") || field("appearance");
      break;
    case "memoryEcho":
      params.memoryKey = `memories.${beat.recalled?.eventType ?? "generic"}`;
      params.with = beat.recalled?.withName ?? "";
      break;
    case "worldQuirk":
      setupKey = `story.events.worldQuirk.${world}`;
      break;
    case "discovery":
      setupKey = `story.events.discovery.${place}`;
      break;
  }
  if (params.text === "") params.text = "…";

  const lines: StoryLine[] = [tpl(setupKey, params)];
  if (beat.outcome) lines.push(tpl(`story.outcome.${beat.outcome}`, params));
  if (beat.reaction) lines.push(tpl(`story.react.${other ? "pair" : "solo"}.${beat.reaction}`, params, v + beat.turn, speakerOf(actor)));
  const after: Record<string, string> = { ...params, moodKey: `moods.${beat.moodAfter}` };
  if (beat.bondBefore && beat.bondAfter) {
    const d = beat.bondAfter.affinity - beat.bondBefore.affinity;
    if (Math.abs(d) >= 5) {
      lines.push(tpl(d > 0 ? "story.bond.up" : "story.bond.down", after));
      return lines;
    }
  }
  lines.push(tpl("story.after", after));
  return lines;
}
