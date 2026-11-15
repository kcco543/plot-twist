/**
 * CHARACTER PROFILE MANAGER — long-term personality, read-only.
 * --------------------------------------------------------------------------
 * Turns the 10 personality sliders AND the written profile into 0–1 factors
 * the behavior engine scores with, and reads the character's locked canon /
 * rules for hard limits. Nothing here ever changes a slider or the text:
 * personality is stable, feelings and relationships live elsewhere.
 */
import { approvedBehavior } from "../character/model";
import { traitVector } from "../behavior/tendencies";
import { tendenciesFor } from "../story/engine";
import type { Character, Reaction } from "../types";
import { textHas } from "./text";

/** Personality factors, all 0–1. Opposite poles are both listed so weight tables read naturally. */
export type PersonalityFactors = {
  extro: number;
  intro: number;
  impulsive: number;
  cautious: number;
  expressive: number;
  reserved: number;
  trusting: number;
  distrustful: number;
  idealist: number;
  pragmatic: number;
  dependent: number;
  independent: number;
  confront: number;
  avoidant: number;
  playful: number;
  serious: number;
  empathy: number;
  rebel: number;
  /** From the written profile (keywords, EN + 中文). 0 when nothing is written. */
  pride: number;
  calm: number;
  strangerWary: number;
  socialBg: number;
  loyal: number;
  hides: number;
};

export const PERSONALITY_KEYS = Object.keys({
  extro: 0, intro: 0, impulsive: 0, cautious: 0, expressive: 0, reserved: 0, trusting: 0, distrustful: 0, idealist: 0, pragmatic: 0,
  dependent: 0, independent: 0, confront: 0, avoidant: 0, playful: 0, serious: 0, empathy: 0, rebel: 0, pride: 0, calm: 0,
  strangerWary: 0, socialBg: 0, loyal: 0, hides: 0,
} satisfies PersonalityFactors) as (keyof PersonalityFactors)[];

type TextCue = { fields: (keyof Character)[]; words: string[] };

/**
 * Written-profile cues. A cue found in the text gives the factor 0.8
 * (1 if it's in two or more fields). Words are matched case-insensitively;
 * English words need word boundaries and are skipped after "not"/"never".
 */
export const TEXT_CUES: Record<"pride" | "calm" | "strangerWary" | "socialBg" | "loyal" | "hides", TextCue> = {
  pride: {
    fields: ["personality", "identity", "values", "habits", "background", "speakingStyle"],
    words: ["proud", "pride", "arrogant", "vain", "haughty", "prideful", "骄傲", "自负", "高傲", "好面子", "自尊心", "傲气"],
  },
  calm: {
    fields: ["personality", "identity", "habits", "speakingStyle"],
    words: ["calm", "composed", "steady", "unflappable", "even-tempered", "serene", "冷静", "沉着", "淡定", "稳重", "温和"],
  },
  strangerWary: {
    fields: ["fears", "background", "personality"],
    words: ["strangers", "new people", "crowds", "being watched", "陌生人", "人多", "生人"],
  },
  socialBg: {
    fields: ["background", "habits", "identity"],
    words: ["market", "ferry", "tavern", "inn", "busy", "crowd", "merchant", "performer", "talks to everyone", "shopkeeper", "集市", "客栈", "渡口", "热闹", "商人", "跑堂", "街头"],
  },
  loyal: {
    fields: ["values", "personality", "rules"],
    words: ["loyal", "loyalty", "keeps promises", "keeps their word", "忠诚", "义气", "守信", "重承诺"],
  },
  hides: {
    fields: ["personality", "canon", "rules", "habits", "speakingStyle"],
    words: ["hides their feelings", "hides her feelings", "hides his feelings", "never admits", "tsundere", "keeps feelings to", "poker face", "嘴硬", "口是心非", "从不表露", "不承认", "藏着心事"],
  },
};

export { textHas };

export function cueStrength(c: Character, cue: TextCue): number {
  let hits = 0;
  for (const f of cue.fields) {
    const v = c[f];
    if (typeof v === "string" && v.trim() && cue.words.some((w) => textHas(v, w))) hits++;
  }
  return hits === 0 ? 0 : hits === 1 ? 0.8 : 1;
}

export function personalityOf(c: Character): PersonalityFactors {
  const t = traitVector(c);
  const n = (v: number) => Math.min(1, Math.max(0, v / 100));
  const cue = (k: keyof typeof TEXT_CUES) => cueStrength(c, TEXT_CUES[k]);
  return {
    extro: n(t.extroversion),
    intro: 1 - n(t.extroversion),
    impulsive: n(t.impulsiveness),
    cautious: 1 - n(t.impulsiveness),
    expressive: n(t.expressiveness),
    reserved: 1 - n(t.expressiveness),
    trusting: n(t.trust),
    distrustful: 1 - n(t.trust),
    idealist: n(t.idealism),
    pragmatic: 1 - n(t.idealism),
    dependent: n(t.dependence),
    independent: 1 - n(t.dependence),
    confront: n(t.confrontation),
    avoidant: 1 - n(t.confrontation),
    playful: n(t.playfulness),
    serious: 1 - n(t.playfulness),
    empathy: n(t.empathy),
    rebel: n(t.rebelliousness),
    pride: cue("pride"),
    calm: cue("calm"),
    strangerWary: cue("strangerWary"),
    socialBg: cue("socialBg"),
    loyal: cue("loyal"),
    hides: cue("hides"),
  };
}

// ---------------------------------------------------------------- canon limits

/**
 * Hard limits read from what the player wrote as rules / canon (and the
 * approved analysis' boundaries). A match REMOVES actions before any dice are
 * rolled, and can cap how strongly a feeling may show.
 */
export type CanonRule = { id: string; pattern: RegExp; bans: string[]; masks?: ("affection" | "fear" | "sadness")[] };

export const CANON_RULES: CanonRule[] = [
  {
    id: "hidesAffection",
    pattern: /never\s+(?:shows?|admits?|expresses?|says?|confesses?)\b[^.。!?！？]{0,40}\b(?:affection|feelings?|love|cares?)|hides?\s+(?:his|her|their|my)\s+feelings|从不(?:表露|承认|说出)|不会表白|嘴硬|口是心非/i,
    bans: ["show_affection"],
    masks: ["affection"],
  },
  { id: "neverRetreats", pattern: /never\s+(?:backs?\s+down|runs?\s+away|retreats?|flees?)|从不退缩|绝不后退|绝不逃/i, bans: ["retreat", "avoid_conversation"], masks: ["fear"] },
  { id: "neverStartsFights", pattern: /never\s+(?:starts?|picks?)\s+(?:a\s+)?fights?|never\s+(?:violent|aggressive)|从不(?:动手|挑衅)|不主动挑衅/i, bans: ["challenge"] },
  { id: "neverJokes", pattern: /never\s+(?:jokes?|laughs?)|从不开玩笑/i, bans: ["respond_playfully"] },
  { id: "neverApologizes", pattern: /never\s+apologi[sz]es?|从不道歉|绝不认错/i, bans: ["acknowledge"] },
  { id: "neverIgnores", pattern: /never\s+ignores?\s+(?:anyone|people|a\s+friend|friends)|从不冷落/i, bans: ["avoid_conversation"] },
  { id: "neverCries", pattern: /never\s+(?:cries|lets\s+anyone\s+see\s+(?:them|her|him)\s+cry)|从不哭|不在人前哭/i, bans: [], masks: ["sadness"] },
];

export type CanonLimits = { banned: Map<string, string>; masked: Set<string>; matched: string[] };

/** Rules from rules/canon (always), any locked field, and the approved analysis' boundaries. */
export function canonLimits(c: Character): CanonLimits {
  const texts = [c.rules, c.canon, ...c.lockedFields.map((f) => c[f]), ...(approvedBehavior(c)?.profile.boundaries ?? [])].filter((s) => s && s.trim());
  const text = texts.join("\n");
  const banned = new Map<string, string>();
  const masked = new Set<string>();
  const matched: string[] = [];
  for (const r of CANON_RULES) {
    if (!r.pattern.test(text)) continue;
    matched.push(r.id);
    for (const b of r.bans) banned.set(b, r.id);
    for (const m of r.masks ?? []) masked.add(m);
  }
  return { banned, masked, matched };
}

// ---------------------------------------------------------------- individual preferences

/** The character's own reaction tendencies (approved AI analysis, else sliders), as −1…1 around neutral. */
export function preferencesOf(c: Character): Record<Reaction, number> {
  const tend = tendenciesFor(c);
  return Object.fromEntries(Object.entries(tend).map(([k, v]) => [k, (v - 50) / 50])) as Record<Reaction, number>;
}

/** Is `other` part of this character's written goals? (name mentioned). */
export function goalMentions(c: Character, other: Character | null): boolean {
  const name = other?.name.trim();
  return !!name && name.length >= 2 && c.goals.toLowerCase().includes(name.toLowerCase());
}
