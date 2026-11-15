/**
 * BEHAVIOR CATALOG — the tuning file.
 * --------------------------------------------------------------------------
 * Every number that shapes behavior lives here, in plain tables, so it can
 * be tuned without touching the engine. See docs/BEHAVIOR_ENGINE.md.
 *
 * FEATURES (what a term can read), all 0–1 unless noted:
 *   p.*  personality   p.intro, p.extro, p.cautious, p.impulsive, p.reserved, p.expressive,
 *                      p.distrustful, p.trusting, p.avoidant, p.confront, p.playful, p.serious,
 *                      p.empathy, p.dependent, p.independent, p.idealist, p.pragmatic, p.rebel,
 *                      and from the written profile: p.pride, p.calm, p.strangerWary, p.socialBg, p.loyal, p.hides
 *   e.*  feelings      e.happiness … e.confusion (after the event's first impression), e.positive, e.distress
 *   r.*  relationship  (how the reactor feels about the other) r.trustPos, r.trustNeg, r.affPos, r.affNeg,
 *                      r.respPos, r.respNeg, r.familiarity, r.unfamiliar, r.rivalry, r.tension, r.fear,
 *                      r.close (= familiarity × positive affection)
 *   m.*  memories      m.betrayed, m.helped, m.argument, m.rejected, m.complimented, m.criticized,
 *                      m.provoked, m.cooperated, m.promise, m.repeat (same thing from same person lately)
 *   c.*  context       c.close (already at talking distance), c.far, c.unsettling (ruins, dreamscape),
 *                      c.public (street), c.goalLink (the other appears in the reactor's goals)
 *
 * A TERM is { f, w }: f is one feature or a LIST of features that are
 * multiplied together. Lists are how factors interact: ["p.intro",
 * "r.unfamiliar"] only counts when the character is introverted AND the
 * other is a stranger, so an introvert greeting a close friend is not
 * pushed away by their introversion.
 *
 * SCORE(action) = base + Σ w × Π features + preference
 * P(action)     ∝ exp(score / temperature) × repetition penalty
 * temperature   = TEMPERATURE.base + TEMPERATURE.impulsive × p.impulsive
 */
import type { Feeling, MemoryKind, Reaction } from "../types";
import type { RelationDelta } from "./relations";

export type Term = { f: string | string[]; w: number };

// ---------------------------------------------------------------- triggers

export const TRIGGERS = ["approached", "spoken_to", "criticized", "complimented", "provoked", "forced_cooperation", "helped", "teased", "brushed_off"] as const;
export type TriggerId = (typeof TRIGGERS)[number];

export type TriggerDef = {
  /**
   * First impression: how much each feeling rises (0–100 units per 1.0 of
   * the term) before any action is chosen. Multiplied by reactivity.
   */
  appraisal: Partial<Record<Feeling, Term[]>>;
  /** How the reactor's view of the other shifts because of the event itself (before their own reaction). */
  relation?: RelationDelta;
  /** The other's view of the reactor shifts too (they did the thing). */
  memory?: { kind: MemoryKind; importance: number };
};

export const TRIGGER_DEFS: Record<TriggerId, TriggerDef> = {
  approached: {
    appraisal: {
      anxiety: [{ f: ["p.intro", "r.unfamiliar"], w: 30 }, { f: ["p.strangerWary", "r.unfamiliar"], w: 30 }, { f: ["p.distrustful", "r.unfamiliar"], w: 12 }, { f: "r.fear", w: 30 }, { f: "m.betrayed", w: 25 }, { f: "r.close", w: -25 }, { f: "p.socialBg", w: -15 }],
      fear: [{ f: "r.fear", w: 35 }, { f: "m.betrayed", w: 15 }],
      happiness: [{ f: "r.close", w: 35 }, { f: ["p.extro", "r.familiarity"], w: 15 }, { f: "m.helped", w: 15 }],
      affection: [{ f: "r.close", w: 15 }],
      anger: [{ f: "m.betrayed", w: 30 }, { f: ["r.tension", "p.confront"], w: 20 }],
      surprise: [{ f: "r.unfamiliar", w: 10 }],
      excitement: [{ f: ["p.extro", "r.unfamiliar", "p.socialBg"], w: 15 }, { f: ["p.extro", "r.close"], w: 15 }],
    },
  },
  spoken_to: {
    appraisal: {
      anxiety: [{ f: ["p.intro", "r.unfamiliar"], w: 18 }, { f: ["p.strangerWary", "r.unfamiliar"], w: 18 }, { f: "r.fear", w: 20 }, { f: "m.betrayed", w: 18 }, { f: "r.close", w: -15 }],
      happiness: [{ f: "r.close", w: 25 }, { f: "p.extro", w: 8 }],
      anger: [{ f: "m.betrayed", w: 20 }, { f: ["r.tension", "p.confront"], w: 12 }],
      confusion: [{ f: "r.unfamiliar", w: 6 }],
    },
  },
  criticized: {
    appraisal: {
      frustration: [{ f: [], w: 25 }, { f: "p.pride", w: 25 }, { f: "p.impulsive", w: 15 }],
      anger: [{ f: "p.impulsive", w: 25 }, { f: ["p.pride", "r.respNeg"], w: 25 }, { f: "r.tension", w: 15 }, { f: "r.respPos", w: -20 }],
      sadness: [{ f: ["p.empathy", "r.affPos"], w: 25 }, { f: "p.dependent", w: 12 }],
      embarrassment: [{ f: "p.pride", w: 18 }, { f: "p.reserved", w: 8 }],
      surprise: [{ f: [], w: 30 }, { f: "m.criticized", w: -30 }],
    },
    relation: { tension: 6, affection: -3 },
    memory: { kind: "criticized", importance: 2 },
  },
  complimented: {
    appraisal: {
      happiness: [{ f: [], w: 15 }, { f: "r.trustPos", w: 25 }, { f: "r.affPos", w: 20 }, { f: "r.affNeg", w: -20 }],
      embarrassment: [{ f: "p.reserved", w: 20 }, { f: ["p.hides", "r.affPos"], w: 35 }, { f: "p.intro", w: 10 }],
      confusion: [{ f: "r.affNeg", w: 45 }, { f: "r.trustNeg", w: 30 }, { f: "r.rivalry", w: 15 }],
      surprise: [{ f: "r.affNeg", w: 35 }, { f: "r.unfamiliar", w: 10 }],
      affection: [{ f: "r.close", w: 15 }],
    },
    relation: { affection: 3, tension: -3 },
    memory: { kind: "complimented", importance: 1 },
  },
  provoked: {
    appraisal: {
      anger: [{ f: [], w: 25 }, { f: "p.confront", w: 25 }, { f: "p.impulsive", w: 15 }, { f: "m.repeat", w: 30 }, { f: "m.provoked", w: 15 }],
      frustration: [{ f: [], w: 25 }, { f: "m.repeat", w: 20 }],
      anxiety: [{ f: "p.avoidant", w: 15 }, { f: "r.fear", w: 20 }],
      sadness: [{ f: ["p.empathy", "r.affPos"], w: 15 }],
    },
    relation: { tension: 10, affection: -6, trust: -3 },
    memory: { kind: "provoked", importance: 2 },
  },
  forced_cooperation: {
    appraisal: {
      frustration: [{ f: "r.rivalry", w: 35 }, { f: "p.independent", w: 15 }, { f: "r.tension", w: 15 }],
      anxiety: [{ f: "r.fear", w: 20 }, { f: ["p.intro", "r.unfamiliar"], w: 10 }],
      happiness: [{ f: "c.goalLink", w: 15 }, { f: "p.dependent", w: 10 }, { f: "r.close", w: 20 }],
      anger: [{ f: "m.betrayed", w: 20 }, { f: ["r.rivalry", "p.pride"], w: 15 }],
    },
    relation: { familiarity: 6 },
    memory: { kind: "cooperated", importance: 2 },
  },
  helped: {
    appraisal: {
      happiness: [{ f: [], w: 25 }, { f: "r.trustPos", w: 10 }],
      affection: [{ f: "r.trustPos", w: 20 }, { f: "p.empathy", w: 10 }, { f: "r.close", w: 10 }],
      embarrassment: [{ f: "p.pride", w: 25 }, { f: "p.independent", w: 12 }],
      confusion: [{ f: "r.affNeg", w: 30 }, { f: "m.betrayed", w: 20 }],
      surprise: [{ f: "r.affNeg", w: 20 }],
    },
    relation: { trust: 6, affection: 5 },
    memory: { kind: "helped", importance: 2 },
  },
  teased: {
    appraisal: {
      happiness: [{ f: ["p.playful", "r.close"], w: 30 }, { f: ["p.playful", "r.familiarity"], w: 10 }],
      embarrassment: [{ f: "p.reserved", w: 20 }, { f: "p.pride", w: 15 }],
      frustration: [{ f: "p.serious", w: 18 }, { f: "p.pride", w: 15 }, { f: "m.repeat", w: 15 }],
      anger: [{ f: "r.tension", w: 20 }, { f: ["p.pride", "r.affNeg"], w: 15 }],
    },
    relation: { familiarity: 3 },
    memory: { kind: "teased", importance: 1 },
  },
  brushed_off: {
    appraisal: {
      sadness: [{ f: "p.dependent", w: 25 }, { f: "r.affPos", w: 20 }],
      frustration: [{ f: "p.confront", w: 20 }, { f: "p.pride", w: 10 }],
      confusion: [{ f: [], w: 15 }],
    },
    relation: { affection: -4 },
    memory: { kind: "rejected", importance: 2 },
  },
};

/** How strongly first impressions hit: impulsive people react bigger, calm people smaller (but feelings still build up). */
export const REACTIVITY = { base: 0.8, impulsive: 0.4, calm: -0.35 };

// ---------------------------------------------------------------- actions

export const BEHAVIOR_ACTIONS = [
  "approach",
  "retreat",
  "stay_still",
  "face_target",
  "greet",
  "initiate_conversation",
  "avoid_conversation",
  "express_surprise",
  "show_affection",
  "express_frustration",
  "ask_question",
  "respond_cautiously",
  "respond_playfully",
  "respond_defensively",
  "stay_silent",
  "change_subject",
  "challenge",
  "acknowledge",
] as const;
export type BehaviorAction = (typeof BEHAVIOR_ACTIONS)[number];

/** How an action looks on stage. Executed through the existing validated stage actions (never teleports). */
export type MoveKind = "toward" | "closer" | "away" | "step_back" | "face" | "still" | "hop" | "stomp" | "glance" | "sigh" | "shift" | "turn_away";

export type ActionDef = {
  triggers: TriggerId[] | "all";
  base: number;
  terms: Term[];
  /** What the body does. */
  move: MoveKind;
  /** Does the character say something? */
  speaks: boolean;
  /** Which feeling this action tends to put on show (else the strongest felt). */
  shows?: Feeling;
  /** Decisions before this exact action can be picked again by the same character. */
  cooldown?: number;
  /** Matching reaction in the character's own tendencies (approved analysis or sliders). */
  pref?: Reaction;
  /** After acting: how the reactor's view of the other shifts, and how the other's view of the reactor shifts. */
  selfRel?: RelationDelta;
  otherRel?: RelationDelta;
  /** After acting: how the reactor's own feelings shift (venting, relief…). */
  selfFeel?: Partial<Record<Feeling, number>>;
};

const SOCIAL: TriggerId[] = ["approached", "spoken_to"];

export const ACTION_DEFS: Record<BehaviorAction, ActionDef> = {
  approach: {
    triggers: ["approached", "spoken_to", "complimented", "helped", "forced_cooperation"],
    base: -0.5,
    terms: [{ f: "p.extro", w: 0.6 }, { f: "r.close", w: 1.6 }, { f: "e.positive", w: 0.8 }, { f: "e.affection", w: 0.8 }, { f: ["p.intro", "r.unfamiliar"], w: -1.2 }, { f: "e.distress", w: -1.2 }, { f: "r.fear", w: -1.5 }, { f: "m.betrayed", w: -1.5 }, { f: "r.tension", w: -0.6 }, { f: "c.close", w: -0.8 }, { f: "e.embarrassment", w: -0.9 }],
    move: "closer",
    speaks: false,
    pref: "act",
    selfRel: { familiarity: 3 },
    otherRel: { affection: 1 },
  },
  retreat: {
    triggers: ["approached", "spoken_to", "criticized", "provoked", "teased"],
    base: -0.9,
    terms: [{ f: ["p.intro", "r.unfamiliar"], w: 1.3 }, { f: "e.anxiety", w: 1.2 }, { f: "e.fear", w: 1.4 }, { f: "r.fear", w: 1.4 }, { f: "m.betrayed", w: 1.0 }, { f: ["p.strangerWary", "r.unfamiliar"], w: 0.9 }, { f: "p.socialBg", w: -0.8 }, { f: "r.close", w: -1.6 }, { f: "p.confront", w: -0.9 }, { f: "p.pride", w: -0.4 }, { f: "c.close", w: 0.4 }, { f: ["e.embarrassment", "p.reserved"], w: 0.8 }],
    move: "step_back",
    speaks: false,
    cooldown: 1,
    pref: "withdraw",
    selfFeel: { anxiety: -10 },
    otherRel: { affection: -2 },
  },
  stay_still: {
    triggers: "all",
    base: -0.3,
    terms: [{ f: "p.reserved", w: 0.4 }, { f: "p.cautious", w: 0.4 }, { f: ["e.distress", "p.avoidant"], w: 0.6 }, { f: "p.calm", w: 0.3 }, { f: "e.excitement", w: -0.8 }, { f: "p.impulsive", w: -0.4 }],
    move: "still",
    speaks: false,
  },
  face_target: {
    triggers: "all",
    base: 0.1,
    terms: [{ f: "p.cautious", w: 0.3 }, { f: "r.respPos", w: 0.4 }, { f: "e.confusion", w: 0.4 }, { f: "p.distrustful", w: 0.3 }, { f: "r.tension", w: 0.3 }],
    move: "face",
    speaks: false,
  },
  greet: {
    triggers: SOCIAL,
    base: -0.1,
    terms: [{ f: "p.extro", w: 0.9 }, { f: ["p.extro", "r.unfamiliar"], w: 0.3 }, { f: "r.close", w: 1.2 }, { f: "e.happiness", w: 0.8 }, { f: "r.familiarity", w: 0.5 }, { f: "p.empathy", w: 0.3 }, { f: "e.distress", w: -0.8 }, { f: "m.betrayed", w: -1.4 }, { f: "r.fear", w: -0.8 }, { f: ["p.intro", "r.unfamiliar"], w: -0.6 }, { f: "r.affNeg", w: -0.8 }, { f: "r.tension", w: -0.7 }],
    move: "face",
    speaks: true,
    cooldown: 1,
    selfRel: { familiarity: 3 },
    otherRel: { affection: 3, familiarity: 3 },
  },
  initiate_conversation: {
    triggers: SOCIAL,
    base: -0.7,
    terms: [{ f: "p.extro", w: 1.0 }, { f: "r.close", w: 0.9 }, { f: "e.excitement", w: 0.8 }, { f: "p.impulsive", w: 0.4 }, { f: "c.goalLink", w: 0.6 }, { f: ["p.intro", "r.close"], w: 0.6 }, { f: "e.distress", w: -1.0 }, { f: ["p.intro", "r.unfamiliar"], w: -1.0 }, { f: "m.betrayed", w: -1.2 }, { f: "r.tension", w: -0.7 }, { f: "r.fear", w: -0.8 }],
    move: "toward",
    speaks: true,
    cooldown: 1,
    pref: "act",
    selfRel: { familiarity: 5 },
    otherRel: { familiarity: 5, affection: 2 },
  },
  avoid_conversation: {
    triggers: ["approached", "spoken_to", "complimented", "forced_cooperation"],
    base: -1.0,
    terms: [{ f: ["p.intro", "r.unfamiliar"], w: 0.9 }, { f: "m.betrayed", w: 1.6 }, { f: "r.affNeg", w: 0.8 }, { f: "r.tension", w: 0.5 }, { f: "e.embarrassment", w: 0.6 }, { f: "e.sadness", w: 0.5 }, { f: ["p.avoidant", "r.tension"], w: 0.6 }, { f: "r.close", w: -1.4 }, { f: "p.empathy", w: -0.4 }],
    move: "turn_away",
    speaks: true,
    cooldown: 1,
    pref: "withdraw",
    otherRel: { affection: -4 },
  },
  express_surprise: {
    triggers: ["approached", "complimented", "helped", "criticized", "teased"],
    base: -1.1,
    terms: [{ f: "e.surprise", w: 2.2 }, { f: "p.expressive", w: 0.5 }, { f: "e.confusion", w: 0.5 }, { f: "p.reserved", w: -0.4 }],
    move: "hop",
    speaks: true,
    shows: "surprise",
    cooldown: 1,
  },
  show_affection: {
    triggers: ["approached", "spoken_to", "complimented", "helped"],
    base: -1.5,
    terms: [{ f: "e.affection", w: 2.0 }, { f: "r.close", w: 1.2 }, { f: "p.expressive", w: 0.5 }, { f: "p.reserved", w: -0.4 }, { f: "e.embarrassment", w: -0.6 }, { f: "r.affNeg", w: -2.0 }],
    move: "closer",
    speaks: true,
    shows: "affection",
    cooldown: 2,
    pref: "comfort",
    selfRel: { affection: 3 },
    otherRel: { affection: 6, trust: 2 },
  },
  express_frustration: {
    triggers: ["criticized", "provoked", "forced_cooperation", "teased", "spoken_to", "brushed_off"],
    base: -1.0,
    terms: [{ f: "e.frustration", w: 1.6 }, { f: "e.anger", w: 1.2 }, { f: "p.expressive", w: 0.4 }, { f: "p.calm", w: -0.5 }, { f: "m.repeat", w: 0.8 }, { f: "r.respPos", w: -0.6 }, { f: "r.close", w: -0.4 }],
    move: "stomp",
    speaks: true,
    shows: "frustration",
    cooldown: 1,
    pref: "confront",
    selfFeel: { frustration: -10 },
    selfRel: { tension: 4 },
    otherRel: { tension: 5, affection: -2 },
  },
  ask_question: {
    triggers: ["approached", "spoken_to", "complimented", "criticized", "forced_cooperation", "helped"],
    base: -0.6,
    terms: [{ f: "e.confusion", w: 1.4 }, { f: "p.distrustful", w: 0.4 }, { f: "p.cautious", w: 0.3 }, { f: "r.unfamiliar", w: 0.3 }, { f: "p.idealist", w: 0.2 }, { f: "r.trustNeg", w: 0.3 }],
    move: "glance",
    speaks: true,
    cooldown: 1,
    pref: "investigate",
    selfRel: { familiarity: 2 },
  },
  respond_cautiously: {
    triggers: ["approached", "spoken_to", "complimented", "criticized", "forced_cooperation", "helped"],
    base: -0.3,
    terms: [{ f: "p.cautious", w: 0.6 }, { f: "p.distrustful", w: 0.5 }, { f: ["p.cautious", "r.unfamiliar"], w: 0.8 }, { f: "e.anxiety", w: 0.8 }, { f: "m.betrayed", w: 0.8 }, { f: "r.trustNeg", w: 0.6 }, { f: "r.fear", w: 0.5 }, { f: "r.close", w: -1.0 }, { f: "e.positive", w: -0.4 }],
    move: "still",
    speaks: true,
    selfRel: { familiarity: 2 },
  },
  respond_playfully: {
    triggers: ["approached", "spoken_to", "complimented", "teased", "criticized", "forced_cooperation"],
    base: -0.9,
    terms: [{ f: "p.playful", w: 1.4 }, { f: "e.happiness", w: 0.6 }, { f: "r.close", w: 0.6 }, { f: "r.familiarity", w: 0.3 }, { f: "p.serious", w: -0.6 }, { f: "e.anger", w: -1.0 }, { f: "e.distress", w: -0.8 }, { f: "r.tension", w: -0.4 }],
    move: "hop",
    speaks: true,
    cooldown: 1,
    pref: "joke",
    otherRel: { affection: 2 },
  },
  respond_defensively: {
    triggers: ["criticized", "provoked", "teased", "complimented"],
    base: -0.6,
    terms: [{ f: "p.pride", w: 1.2 }, { f: "e.anger", w: 0.8 }, { f: "e.frustration", w: 0.6 }, { f: "p.impulsive", w: 0.5 }, { f: "r.trustNeg", w: 0.4 }, { f: "r.respPos", w: -0.8 }, { f: "p.calm", w: -0.4 }, { f: "p.empathy", w: -0.2 }, { f: ["r.close", "e.positive"], w: -0.8 }],
    move: "shift",
    speaks: true,
    pref: "confront",
    selfRel: { tension: 3 },
    otherRel: { tension: 4 },
  },
  stay_silent: {
    triggers: ["criticized", "provoked", "complimented", "teased", "forced_cooperation", "helped"],
    base: -0.6,
    terms: [{ f: "p.reserved", w: 0.7 }, { f: "p.avoidant", w: 0.6 }, { f: ["e.frustration", "p.reserved"], w: 0.8 }, { f: "p.calm", w: 0.4 }, { f: "p.impulsive", w: -0.6 }, { f: "p.expressive", w: -0.4 }, { f: ["p.hides", "e.affection"], w: 1.2 }],
    move: "still",
    speaks: false,
    pref: "withdraw",
  },
  change_subject: {
    triggers: ["criticized", "complimented", "teased", "spoken_to", "approached"],
    base: -1.0,
    terms: [{ f: "p.avoidant", w: 0.6 }, { f: "e.embarrassment", w: 1.2 }, { f: "p.playful", w: 0.3 }, { f: "p.hides", w: 0.7 }, { f: ["p.pride", "e.embarrassment"], w: 0.5 }],
    move: "glance",
    speaks: true,
    cooldown: 1,
    pref: "deflect",
  },
  challenge: {
    triggers: ["criticized", "provoked", "forced_cooperation", "teased", "approached"],
    base: -1.3,
    terms: [{ f: "p.confront", w: 0.3 }, { f: ["p.confront", "e.anger"], w: 1.4 }, { f: ["p.confront", "r.tension"], w: 1.0 }, { f: "r.rivalry", w: 1.2 }, { f: "e.anger", w: 0.8 }, { f: "p.impulsive", w: 0.5 }, { f: "p.pride", w: 0.4 }, { f: "r.respPos", w: -0.6 }, { f: "r.close", w: -0.8 }, { f: "r.fear", w: -0.6 }, { f: "p.calm", w: -0.4 }],
    move: "toward",
    speaks: true,
    cooldown: 1,
    pref: "confront",
    selfFeel: { anger: -5 },
    selfRel: { tension: 6, rivalry: 3 },
    otherRel: { tension: 8, rivalry: 4, respect: 1 },
  },
  acknowledge: {
    triggers: ["criticized", "complimented", "forced_cooperation", "helped"],
    base: -0.4,
    terms: [{ f: "r.respPos", w: 1.4 }, { f: "r.trustPos", w: 0.6 }, { f: "p.empathy", w: 0.4 }, { f: "p.dependent", w: 0.2 }, { f: "p.pride", w: -0.7 }, { f: "e.anger", w: -0.6 }, { f: "r.rivalry", w: -0.4 }, { f: "p.idealist", w: 0.2 }, { f: "c.goalLink", w: 0.5 }],
    move: "sigh",
    speaks: true,
    pref: "cooperate",
    selfFeel: { frustration: -8, anger: -8 },
    selfRel: { respect: 4, tension: -3 },
    otherRel: { respect: 3, affection: 2 },
  },
};

/** How much the character's own reaction tendencies (approved analysis or sliders) add, per point of −1…1 preference. */
export const PREFERENCE_WEIGHT = 0.4;

/** Softmax temperature: low = picks the top option almost always; high = more variety. Impulsive characters vary more. */
export const TEMPERATURE = { base: 0.45, impulsive: 0.3 };

/** Repetition: each use of the same action in the character's last REPEAT_WINDOW decisions multiplies its chance by this. */
export const REPEAT_PENALTY = 0.5;
export const REPEAT_WINDOW = 4;

/**
 * Expression: how much of a feeling shows on the outside.
 * shown = felt × (base + expressive × p.expressive), × MASKED_FACTOR when canon or personality hides it.
 * Then shown ≥ strong → level 3, ≥ moderate → 2, ≥ subtle → 1, else nothing shows at all.
 */
export const EXPRESSION = { base: 0.35, expressive: 0.85, subtle: 18, moderate: 40, strong: 65, maskedFactor: 0.3, hidesFactor: 0.45 };

/** Hesitation before reacting, ms: cautious + anxious people pause; impulsive people don't. */
export const HESITATION = { max: 1200, cautious: 500, anxiety: 700, impulsive: -500 };
