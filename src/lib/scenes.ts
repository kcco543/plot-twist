/**
 * Scripted placeholder interactions for Play Mode.
 * No AI here: lines are assembled from what the player wrote in the
 * Character Studio, so every character already "sounds" like themselves.
 */
import type { Character } from "./types";
import { createBlankCharacter } from "./gameStore";

export type Action = "talk" | "observe" | "wait";

const pick = <T,>(list: T[], n: number) => list[((n % list.length) + list.length) % list.length];
const clean = (s: string) => s.trim().replace(/\s+/g, " ");

export function lineFor(action: Action, c: Character, turn: number, place: string): { speaker: string; text: string } {
  const name = clean(c.name) || "Unnamed";
  if (action === "talk") {
    const topics = (
      [
        ["goals", "what they want"],
        ["fears", "what scares them"],
        ["relationships", "the people in their life"],
        ["background", "where they come from"],
      ] as const
    ).filter(([f]) => clean(c[f]));
    if (topics.length === 0) {
      return { speaker: name, text: "...  (They have nothing to say yet. Give them goals or fears in the Character Studio.)" };
    }
    const [field, label] = pick(topics, turn);
    return { speaker: name, text: `[on ${label}] "${clean(c[field])}"` };
  }
  if (action === "observe") {
    const details = [c.appearance, c.habits, c.personality].map(clean).filter(Boolean);
    if (details.length === 0) return { speaker: "Narrator", text: `You look at ${name}. They're still a sketch.` };
    return { speaker: "Narrator", text: `You watch ${name}. ${pick(details, turn)}` };
  }
  const ambience = [
    `Time passes in the ${place}. Nobody admits they're waiting for something.`,
    `A quiet moment in the ${place}. ${name} glances your way.`,
    `Somewhere in the ${place}, something creaks. Everyone pretends not to notice.`,
  ];
  return { speaker: "Narrator", text: pick(ambience, turn) };
}

/** Shown in Play Mode when the player hasn't created anyone yet. */
export function demoCast(): Character[] {
  const a = createBlankCharacter(0);
  const b = createBlankCharacter(2);
  return [
    {
      ...a,
      id: "demo-1",
      name: "Juniper",
      age: "19",
      appearance: "They keep tucking a pencil behind their ear and forgetting it's there.",
      personality: "Curious, impatient, kind in a loud way.",
      goals: "Find out who left the letter on my doorstep.",
      fears: "That the letter was meant for someone else.",
      relationships: "Owes Rook a favor. Won't say what for.",
    },
    {
      ...b,
      id: "demo-2",
      name: "Rook",
      age: "27",
      appearance: "Long coat, tired eyes, very clean boots.",
      personality: "Dry humor, says less than they know.",
      habits: "Rook taps the table twice before answering any question.",
      goals: "Keep everyone out of trouble. Mostly Juniper.",
      fears: "Being needed and not showing up.",
    },
  ];
}
