/**
 * BEHAVIOR ENGINE — context → candidates → hard limits → weighted choice.
 * --------------------------------------------------------------------------
 *   1. Context evaluator: personality + feelings + relationship (both ways)
 *      + memories + place + distance + goals + availability → features.
 *   2. First impression: the event raises feelings (TRIGGER_DEFS.appraisal).
 *   3. Candidate generator: every action valid for this trigger.
 *   4. Hard constraints, BEFORE any dice: locked canon / rules, busy or
 *      player-controlled characters, unreachable targets, cooldowns.
 *   5. Scoring: base + Σ weight × features + the character's preference.
 *   6. Selection: softmax with a temperature, × repetition penalty, seeded RNG.
 *   7. Expression, movement and dialogue style for the chosen action.
 *
 * Pure functions: same inputs + same seed → same decision (tests rely on it).
 * applyDecision() is the ONLY place that writes the results to story state.
 */
import { emotionOf, withEmotion, type Emotion, type EmotionLevel } from "../emotion/emotions";
import { bondKey, neutralBond, neutralState } from "../story/engine";
import type { StageAction } from "../stage/actions";
import type { Character, CharacterState, EnvironmentTypeId, Feeling, Feelings, Relation, StoryState } from "../types";
import { FEELINGS } from "../types";
import {
  ACTION_DEFS,
  BEHAVIOR_ACTIONS,
  EXPRESSION,
  HESITATION,
  PREFERENCE_WEIGHT,
  REACTIVITY,
  REPEAT_PENALTY,
  REPEAT_WINDOW,
  TEMPERATURE,
  TRIGGER_DEFS,
  type BehaviorAction,
  type MoveKind,
  type Term,
  type TriggerId,
} from "./catalog";
import { addFeelings, FEELING_TO_EMOTION, feelingsOf, ranked } from "./feelings";
import { memoryKindOf, memoryPull, relevantMemories, remember } from "./memory";
import { canonLimits, goalMentions, personalityOf, preferencesOf, type PersonalityFactors } from "./profile";
import { applyRelation, relationOf, withRelation } from "./relations";

export type Rng = () => number;

/** What the stage knows right now (all optional: tests and previews can leave it out). */
export type StageView = {
  /** Floor gap between the two characters (art px). */
  gap?: number | null;
  /** Comfortable talking distance for this pair. */
  talkDistance?: number;
  /** Stage state of the reactor. */
  state?: "idle" | "moving" | "interacting" | "speaking" | "reacting" | null;
  /** The player is directly controlling this character's movement. */
  commanded?: boolean;
  /** A path to the other exists. */
  canReach?: boolean;
  /** There's room to step back. */
  canRetreat?: boolean;
};

export type BehaviorEvent = {
  trigger: TriggerId;
  /** Who reacts. */
  reactorId: string;
  /** Who caused it. */
  otherId: string | null;
};

export type DecideInput = {
  story: StoryState;
  cast: Character[];
  event: BehaviorEvent;
  place?: EnvironmentTypeId;
  stage?: StageView;
  rng: Rng;
};

export type TermResult = { key: string; value: number };
export type Candidate = { action: BehaviorAction; score: number; prob: number; penalty: number; terms: TermResult[] };
export type Rejection = { action: BehaviorAction; reason: "canon" | "busy" | "player_command" | "unreachable" | "already_close" | "no_room" | "cooldown"; detail?: string };

export type Expression = { emotion: Emotion; level: EmotionLevel; feeling: Feeling; felt: number; shown: number; masked: boolean } | null;

export type DialogueStyle = {
  length: "silent" | "terse" | "short" | "full";
  tone: "warm" | "cool" | "tense" | "playful" | "nervous" | "flat";
  /** 0–1 */
  directness: number;
  humor: number;
  formality: number;
  /** How much they'd reveal about themselves. */
  disclosure: number;
  hesitant: boolean;
  /** Address the listener by name (familiar enough). */
  useName: boolean;
};

export type Decision = {
  event: BehaviorEvent;
  turn: number;
  personality: PersonalityFactors;
  feelingsBefore: Feelings;
  /** After the first impression. */
  feelings: Feelings;
  appraisal: Feelings;
  relation: Relation | null;
  /** How the other feels about the reactor (for the panel; the reactor doesn't know this). */
  relationBack: Relation | null;
  memories: { kind: string; withName: string; importance: number; count: number; turn: number }[];
  features: Record<string, number>;
  candidates: Candidate[];
  rejected: Rejection[];
  action: BehaviorAction;
  /** Top reasons (feature keys + contribution) for the chosen action. */
  reasons: TermResult[];
  canonRules: string[];
  expression: Expression;
  /** Stage actions in order, with delays (ms of game time). */
  movement: { delay: number; action: StageAction }[];
  pauseMs: number;
  style: DialogueStyle;
  temperature: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- 1 · context

export function evaluateContext(input: Omit<DecideInput, "rng">, feelings: Feelings) {
  const { story, cast, event, place, stage } = input;
  const me = cast.find((c) => c.id === event.reactorId)!;
  const other = event.otherId ? (cast.find((c) => c.id === event.otherId) ?? null) : null;
  const p = personalityOf(me);
  const bond = other ? (story.bonds[bondKey(me.id, other.id)] ?? neutralBond()) : null;
  const rel = other ? relationOf(story, me, other, bond) : null;
  const relBack = other ? relationOf(story, other, me, bond) : null;
  const state = story.characters[me.id];
  const pull = memoryPull(state, other?.id ?? null, story.turn);
  const recent = (story.decisions ?? []).filter((d) => d.actorId === me.id && d.otherId === (other?.id ?? null) && d.trigger === event.trigger && story.turn - d.turn <= 6);

  const f: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) f[`p.${k}`] = v;
  setFeelingFeatures(f, feelings);
  const r = rel ?? { trust: 0, affection: 0, respect: 0, familiarity: 0, rivalry: 0, tension: 0, fear: 0 };
  f["r.trustPos"] = clamp01(r.trust / 100);
  f["r.trustNeg"] = clamp01(-r.trust / 100);
  f["r.affPos"] = clamp01(r.affection / 100);
  f["r.affNeg"] = clamp01(-r.affection / 100);
  f["r.respPos"] = clamp01(r.respect / 100);
  f["r.respNeg"] = clamp01(-r.respect / 100);
  f["r.familiarity"] = r.familiarity / 100;
  f["r.unfamiliar"] = other ? 1 - r.familiarity / 100 : 0;
  f["r.rivalry"] = r.rivalry / 100;
  f["r.tension"] = r.tension / 100;
  f["r.fear"] = r.fear / 100;
  f["r.close"] = f["r.familiarity"] * f["r.affPos"];
  for (const k of ["betrayed", "helped", "argument", "rejected", "complimented", "criticized", "provoked", "cooperated", "promise"] as const) f[`m.${k}`] = pull[k] ?? 0;
  f["m.repeat"] = clamp01(recent.length / 3);
  const gap = stage?.gap ?? null;
  const talk = stage?.talkDistance ?? 34;
  f["c.close"] = gap !== null && gap <= talk + 6 ? 1 : 0;
  f["c.far"] = gap !== null && gap > 70 ? 1 : 0;
  f["c.unsettling"] = place === "ruins" || place === "dreamscape" ? 1 : place === "wilderness" ? 0.4 : 0;
  f["c.public"] = place === "street" ? 1 : 0;
  f["c.goalLink"] = goalMentions(me, other) ? 1 : 0;
  return { me, other, p, rel, relBack, state, f };
}

function setFeelingFeatures(f: Record<string, number>, feelings: Feelings) {
  for (const k of FEELINGS) f[`e.${k}`] = (feelings[k] ?? 0) / 100;
  f["e.positive"] = Math.max(f["e.happiness"], f["e.excitement"]);
  f["e.distress"] = Math.max(f["e.fear"], f["e.anxiety"]);
}

/** Σ w × Π features, with each term's contribution for the debug panel. */
export function scoreTerms(terms: Term[], f: Record<string, number>): { total: number; parts: TermResult[] } {
  let total = 0;
  const parts: TermResult[] = [];
  for (const t of terms) {
    const keys = Array.isArray(t.f) ? t.f : [t.f];
    const v = keys.reduce((a, k) => a * (f[k] ?? 0), 1) * t.w;
    if (Math.abs(v) < 1e-6) continue;
    total += v;
    parts.push({ key: keys.length ? keys.join(" × ") : "base", value: v });
  }
  return { total, parts };
}

// ---------------------------------------------------------------- 2 · first impression

export function appraise(trigger: TriggerId, f: Record<string, number>, p: PersonalityFactors): Feelings {
  const def = TRIGGER_DEFS[trigger];
  const reactivity = Math.max(0.3, REACTIVITY.base + REACTIVITY.impulsive * p.impulsive + REACTIVITY.calm * p.calm);
  const out: Feelings = {};
  for (const [k, terms] of Object.entries(def.appraisal) as [Feeling, Term[]][]) {
    const v = scoreTerms(terms, f).total * reactivity;
    if (Math.abs(v) >= 1) out[k] = Math.round(v);
  }
  return out;
}

// ---------------------------------------------------------------- 3–6 · decide

export function decide(input: DecideInput): Decision {
  const { story, event, stage, rng } = input;
  const before = feelingsOf(input.story.characters[event.reactorId]);
  // First pass for the first impression, then re-read features with the new feelings.
  const ctx0 = evaluateContext(input, before);
  const appraisal = appraise(event.trigger, ctx0.f, ctx0.p);
  const feelings = addFeelings(before, appraisal);
  const { me, other, p, rel, relBack, state, f } = { ...ctx0, f: { ...ctx0.f } };
  setFeelingFeatures(f, feelings);

  // 3 · candidates
  const valid = BEHAVIOR_ACTIONS.filter((a) => {
    const t = ACTION_DEFS[a].triggers;
    return t === "all" || t.includes(event.trigger);
  });

  // 4 · hard constraints
  const canon = canonLimits(me);
  const rejected: Rejection[] = [];
  const myDecisions = (story.decisions ?? []).filter((d) => d.actorId === me.id);
  const allowed = valid.filter((a) => {
    const def = ACTION_DEFS[a];
    const ban = canon.banned.get(a);
    if (ban) return reject(a, "canon", ban);
    const travels = def.move === "toward" || def.move === "closer" || def.move === "step_back";
    if (travels && stage?.commanded) return reject(a, "player_command");
    if (travels && stage?.state === "speaking") return reject(a, "busy");
    if ((def.move === "toward" || def.move === "closer") && other) {
      if (stage?.canReach === false) return reject(a, "unreachable");
      if (a === "approach" && f["c.close"] === 1) return reject(a, "already_close");
    }
    if (def.move === "step_back" && stage?.canRetreat === false) return reject(a, "no_room");
    if (def.cooldown) {
      const last = myDecisions.slice(-def.cooldown);
      if (last.some((d) => d.action === a)) return reject(a, "cooldown", String(def.cooldown));
    }
    return true;
  });
  function reject(action: BehaviorAction, reason: Rejection["reason"], detail?: string) {
    rejected.push({ action, reason, detail });
    return false;
  }
  // Something must always be possible: standing still breaks no rule.
  if (allowed.length === 0) allowed.push("stay_still");

  // 5 · scores
  const prefs = preferencesOf(me);
  const recentActions = myDecisions.slice(-REPEAT_WINDOW).map((d) => d.action);
  const temperature = TEMPERATURE.base + TEMPERATURE.impulsive * p.impulsive;
  const scored = allowed.map((a) => {
    const def = ACTION_DEFS[a];
    const { total, parts } = scoreTerms(def.terms, f);
    let score = def.base + total;
    if (def.pref) {
      const pv = prefs[def.pref] * PREFERENCE_WEIGHT;
      score += pv;
      if (Math.abs(pv) > 1e-6) parts.push({ key: `pref.${def.pref}`, value: pv });
    }
    const penalty = Math.pow(REPEAT_PENALTY, recentActions.filter((x) => x === a).length);
    return { action: a, score, penalty, terms: parts.sort((x, y) => Math.abs(y.value) - Math.abs(x.value)) };
  });

  // 6 · selection (softmax × repetition penalty)
  const maxS = Math.max(...scored.map((s) => s.score));
  const raw = scored.map((s) => Math.exp((s.score - maxS) / temperature) * s.penalty);
  const sum = raw.reduce((a, b) => a + b, 0);
  const candidates: Candidate[] = scored.map((s, i) => ({ ...s, prob: raw[i] / sum })).sort((a, b) => b.prob - a.prob);
  let roll = rng() * 1;
  let chosen = candidates[candidates.length - 1];
  for (const c of candidates) {
    roll -= c.prob;
    if (roll <= 0) {
      chosen = c;
      break;
    }
  }

  // 7 · expression, timing, movement, dialogue
  const expression = expressionFor(chosen.action, feelings, p, canon.masked);
  const pauseMs = Math.round(Math.max(0, Math.min(HESITATION.max, HESITATION.cautious * p.cautious * (chosen.action === "respond_cautiously" ? 1.5 : 1) + HESITATION.anxiety * f["e.distress"] + HESITATION.impulsive * p.impulsive)));
  const movement = movementFor(chosen.action, me.id, other?.id ?? null, f, stage, pauseMs);
  const style = styleFor(chosen.action, p, f, rel, pauseMs);

  return {
    event,
    turn: story.turn,
    personality: p,
    feelingsBefore: before,
    feelings,
    appraisal,
    relation: rel,
    relationBack: relBack,
    memories: relevantMemories(state, other?.id ?? null).map((m) => ({ kind: memoryKindOf(m) ?? m.eventType, withName: m.withName, importance: m.importance, count: m.count ?? 1, turn: m.turn })),
    features: f,
    candidates,
    rejected,
    action: chosen.action,
    reasons: chosen.terms.filter((t) => t.value > 0).slice(0, 4),
    canonRules: canon.matched,
    expression,
    movement,
    pauseMs,
    style,
    temperature,
  };
}

// ---------------------------------------------------------------- 7 · expression

/**
 * What shows on the outside. Starts from the action's own feeling (or the
 * strongest one felt), scaled by expressiveness. Canon masks (e.g. "never
 * admits feelings") and the written "hides feelings" cue shrink it, and a
 * hidden affection may leak out as a small blush instead.
 */
export function expressionFor(action: BehaviorAction, feelings: Feelings, p: PersonalityFactors, masked: Set<string>): Expression {
  const top = ranked(feelings);
  const wanted = ACTION_DEFS[action].shows;
  const options: Feeling[] = wanted && (feelings[wanted] ?? 0) > 0 ? [wanted, ...top.map(([k]) => k).filter((k) => k !== wanted)] : top.map(([k]) => k);
  const show = EXPRESSION.base + EXPRESSION.expressive * p.expressive;
  for (const k of options.slice(0, 3)) {
    const felt = feelings[k] ?? 0;
    const isMasked = masked.has(k) || (p.hides > 0 && (k === "affection" || k === "sadness" || k === "fear"));
    const factor = masked.has(k) ? EXPRESSION.maskedFactor : isMasked ? EXPRESSION.hidesFactor + (1 - p.hides) * 0.5 : 1;
    const shown = felt * show * factor;
    if (shown >= EXPRESSION.subtle) {
      const level: EmotionLevel = shown >= EXPRESSION.strong ? 3 : shown >= EXPRESSION.moderate ? 2 : 1;
      return { emotion: FEELING_TO_EMOTION[k], level, feeling: k, felt, shown: Math.round(shown), masked: isMasked };
    }
    if (isMasked && k === "affection" && felt >= 40) {
      // Strong feelings they won't show: at most a small blush.
      return { emotion: "embarrassed", level: 1, feeling: k, felt, shown: Math.round(shown), masked: true };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 7 · movement

/** Stage actions for a decision. Delays are game time, so pausing the game pauses them too. */
export function movementFor(action: BehaviorAction, me: string, other: string | null, f: Record<string, number>, stage: StageView | undefined, pauseMs: number): { delay: number; action: StageAction }[] {
  const move: MoveKind = ACTION_DEFS[action].move;
  const out: { delay: number; action: StageAction }[] = [];
  const face = () => other && out.push({ delay: 0, action: { type: "face_target", actor: me, target: other } });
  const talk = Math.round(stage?.talkDistance ?? 32);
  const d = pauseMs;
  switch (move) {
    case "face":
    case "still":
      face();
      break;
    case "closer":
      face();
      if (other) out.push({ delay: d, action: { type: "approach", actor: me, target: other, distance: Math.max(20, talk - 6) } });
      break;
    case "toward":
      face();
      if (other && f["c.close"] !== 1) out.push({ delay: d, action: { type: "approach", actor: me, target: other, distance: Math.max(20, talk) } });
      break;
    case "step_back":
    case "away":
      // One or two steps: further when it's fear, shorter when it's just shyness.
      out.push({ delay: Math.round(d / 2), action: { type: "retreat", actor: me, from: other ?? undefined, distance: Math.round(12 + 18 * Math.max(f["e.fear"], f["e.anxiety"], f["r.fear"])) } });
      break;
    case "turn_away":
      out.push({ delay: 0, action: { type: "idle_reaction", actor: me, kind: "look_around" } });
      if (f["c.close"] === 1) out.push({ delay: 600, action: { type: "retreat", actor: me, from: other ?? undefined, distance: 12 } });
      break;
    case "hop":
      face();
      out.push({ delay: Math.round(d / 2), action: { type: "idle_reaction", actor: me, kind: "hop" } });
      break;
    case "stomp":
      face();
      out.push({ delay: Math.round(d / 2), action: { type: "idle_reaction", actor: me, kind: "stomp" } });
      break;
    case "glance":
      face();
      out.push({ delay: d, action: { type: "idle_reaction", actor: me, kind: "look_around" } });
      break;
    case "sigh":
      face();
      out.push({ delay: d, action: { type: "idle_reaction", actor: me, kind: "sigh" } });
      break;
    case "shift":
      face();
      out.push({ delay: d, action: { type: "idle_reaction", actor: me, kind: "shift" } });
      break;
  }
  return out;
}

// ---------------------------------------------------------------- 7 · dialogue style

export function styleFor(action: BehaviorAction, p: PersonalityFactors, f: Record<string, number>, rel: Relation | null, pauseMs: number): DialogueStyle {
  const def = ACTION_DEFS[action];
  const fam = rel ? rel.familiarity / 100 : 0;
  const talkative = (p.extro + p.expressive) / 2 + f["e.excitement"] * 0.3 - f["e.distress"] * 0.3 + f["r.close"] * 0.3;
  const length: DialogueStyle["length"] = !def.speaks ? "silent" : talkative < 0.35 || action === "respond_cautiously" ? "terse" : talkative < 0.6 ? "short" : "full";
  const tone: DialogueStyle["tone"] =
    f["e.anger"] + f["e.frustration"] > 0.6 || action === "challenge" || action === "respond_defensively"
      ? "tense"
      : f["e.distress"] > 0.35
        ? "nervous"
        : action === "respond_playfully" || (p.playful > 0.6 && f["e.positive"] > 0.3)
          ? "playful"
          : f["r.close"] > 0.3 || f["e.affection"] > 0.3 || action === "greet" || action === "show_affection"
            ? "warm"
            : f["r.unfamiliar"] > 0.6 || f["r.trustNeg"] > 0.3
              ? "cool"
              : "flat";
  return {
    length,
    tone,
    directness: round2(clamp01(p.confront * 0.5 + p.impulsive * 0.3 + f["e.anger"] * 0.3 - f["e.embarrassment"] * 0.3 + 0.1)),
    humor: round2(clamp01(p.playful * 0.7 + f["e.happiness"] * 0.3 - f["e.anger"] * 0.5 - f["e.distress"] * 0.3)),
    formality: round2(clamp01(0.7 - fam * 0.6 + p.serious * 0.2 - p.rebel * 0.2)),
    disclosure: round2(clamp01((rel ? Math.max(0, rel.trust) / 100 : 0) * 0.6 + fam * 0.3 + p.expressive * 0.2 - f["m.betrayed"] * 0.5)),
    hesitant: pauseMs >= 450,
    useName: fam >= 0.5 && def.speaks,
  };
}
const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- apply (the only writer)

/** Most recent decisions kept for repetition / cooldown checks. */
export const MAX_DECISIONS = 40;

/**
 * Write a decision's consequences: the reactor's feelings (first impression
 * + action), what shows, both directions of the relationship, a memory for
 * meaningful events (merged if repeated) and the decision record.
 * Personality is never touched.
 */
export function applyDecision(story: StoryState, d: Decision, cast: Character[], now = Date.now()): StoryState {
  const me = cast.find((c) => c.id === d.event.reactorId);
  if (!me) return story;
  const other = d.event.otherId ? (cast.find((c) => c.id === d.event.otherId) ?? null) : null;
  const def = ACTION_DEFS[d.action];
  const trig = TRIGGER_DEFS[d.event.trigger];
  let s = story;

  // Feelings: first impression, then what acting did (venting, relief…).
  let st: CharacterState = { ...(s.characters[me.id] ?? neutralState()) };
  st.feelings = addFeelings(d.feelings, def.selfFeel ?? {});
  if (d.expression) st = withEmotion(st, d.expression.emotion, d.expression.level, now, false);
  else if (emotionOf(st).emotion !== "neutral" && (st.emotionLevel ?? 0) <= 1) st = withEmotion(st, "neutral", 0, now, false);
  if (trig.memory && other) {
    st = remember(st, { kind: trig.memory.kind, withId: other.id, withName: other.name.trim(), turn: s.turn, importance: trig.memory.importance + (d.expression?.level === 3 ? 1 : 0), eventType: d.event.trigger }, now).state;
  }
  s = { ...s, characters: { ...s.characters, [me.id]: st } };

  // Relationship, both directions, each with its own change.
  if (other) {
    const bond = s.bonds[bondKey(me.id, other.id)] ?? neutralBond();
    const mine = applyRelation(applyRelation(relationOf(s, me, other, bond), trig.relation ?? {}), { familiarity: 2, ...(def.selfRel ?? {}) });
    s = withRelation(s, me.id, other.id, mine);
    if (def.otherRel) s = withRelation(s, other.id, me.id, applyRelation(relationOf(s, other, me, bond), def.otherRel));
  }

  const rec = { turn: s.turn, actorId: me.id, otherId: other?.id ?? null, trigger: d.event.trigger, action: d.action, at: now };
  return { ...s, decisions: [...(s.decisions ?? []), rec].slice(-MAX_DECISIONS) };
}
