import { createBlankCharacter } from "@/lib/character/model";
import type { Character } from "@/lib/types";

/** Small seeded RNG so engine tests are repeatable. */
export function seeded(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function makeChar(patch: Partial<Character>): Character {
  return { ...createBlankCharacter(0), ...patch };
}

export const juniper = () =>
  makeChar({
    id: "c-juniper",
    name: "Juniper",
    age: "19",
    personality: "Curious, impatient, kind in a loud way.",
    goals: "Find out who left the letter on my doorstep.",
    fears: "That the letter was meant for someone else.",
    rules: "Never reads other people's letters.",
    values: "Honesty, even when it's awkward.",
    habits: "Tucks a pencil behind their ear and forgets it.",
    relationships: "Owes Rook a favor.",
    traits: { extroversion: 80, impulsiveness: 75, empathy: 85, playfulness: 70 },
    lockedFields: ["name", "rules"],
  });

export const rook = () =>
  makeChar({
    id: "c-rook",
    name: "Rook",
    age: "27",
    personality: "Dry humor, says less than they know. Quiet and guarded.",
    goals: "Keep everyone out of trouble.",
    fears: "Being needed and not showing up.",
    habits: "Taps the table twice before answering.",
    traits: { extroversion: 20, trust: 25, expressiveness: 20, confrontation: 35 },
  });

export const mei = () =>
  makeChar({
    id: "c-mei",
    name: "梅",
    personality: "内向，害羞，但很善良。",
    goals: "找到失踪的哥哥。",
    fears: "被所有人遗忘。",
    traits: { extroversion: 85 },
  });
