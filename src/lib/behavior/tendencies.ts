/**
 * Numbers the game rules use. Derived from the sliders (or, when a slider is
 * not set, a hint from the written profile). Used by the built-in analyzer
 * and as a fallback when no approved analysis exists.
 */
import { effectiveTrait } from "../character/traits";
import { APPROACHES, REACTIONS, type Approach, type Character, type Reaction, type TraitId } from "../types";

export function traitVector(c: Character): Record<TraitId, number> {
  const ids: TraitId[] = ["extroversion", "impulsiveness", "expressiveness", "trust", "idealism", "dependence", "confrontation", "playfulness", "empathy", "rebelliousness"];
  return Object.fromEntries(ids.map((id) => [id, effectiveTrait(c, id)])) as Record<TraitId, number>;
}

const inv = (v: number) => 100 - v;
const round = (v: number) => Math.round(Math.min(100, Math.max(0, v)));

export function reactionTendencies(c: Character): Record<Reaction, number> {
  const t = traitVector(c);
  const r: Record<Reaction, number> = {
    confront: t.confrontation * 0.6 + t.impulsiveness * 0.2 + inv(t.empathy) * 0.2,
    deflect: t.playfulness * 0.4 + inv(t.expressiveness) * 0.3 + inv(t.confrontation) * 0.3,
    withdraw: inv(t.extroversion) * 0.5 + inv(t.confrontation) * 0.3 + inv(t.trust) * 0.2,
    comfort: t.empathy * 0.7 + t.extroversion * 0.15 + t.trust * 0.15,
    joke: t.playfulness * 0.7 + t.extroversion * 0.3,
    investigate: inv(t.trust) * 0.5 + inv(t.impulsiveness) * 0.3 + inv(t.idealism) * 0.2,
    act: t.impulsiveness * 0.6 + t.rebelliousness * 0.25 + inv(t.dependence) * 0.15,
    cooperate: t.dependence * 0.35 + t.trust * 0.35 + inv(t.rebelliousness) * 0.3,
  };
  return Object.fromEntries(REACTIONS.map((k) => [k, round(r[k])])) as Record<Reaction, number>;
}

export function approachScores(c: Character): Record<Approach, number> {
  const t = traitVector(c);
  const s: Record<Approach, number> = {
    direct: (t.confrontation + t.expressiveness) / 2,
    guarded: (inv(t.trust) + inv(t.expressiveness)) / 2,
    warm: (t.empathy * 2 + t.extroversion) / 3,
    teasing: (t.playfulness * 2 + t.extroversion) / 3,
    probing: (inv(t.trust) + inv(t.impulsiveness)) / 2,
    rambling: (t.extroversion + t.expressiveness + t.impulsiveness) / 3,
    formal: (inv(t.rebelliousness) + inv(t.playfulness)) / 2,
    curt: (inv(t.extroversion) + inv(t.empathy)) / 2,
  };
  return Object.fromEntries(APPROACHES.map((k) => [k, round(s[k])])) as Record<Approach, number>;
}

/** The three dialogue approaches that fit best. */
export function topApproaches(c: Character, n = 3): Approach[] {
  const s = approachScores(c);
  return [...APPROACHES].sort((a, b) => s[b] - s[a]).slice(0, n);
}

export function speechLength(c: Character): "terse" | "measured" | "chatty" {
  const t = traitVector(c);
  const v = (t.extroversion + t.expressiveness) / 2;
  return v >= 65 ? "chatty" : v <= 35 ? "terse" : "measured";
}
