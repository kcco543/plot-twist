/**
 * What each kind of interaction does, at "ordinary" size, before validation.
 * --------------------------------------------------------------------------
 *   effect     long-term numbers (from's view of to). Scaled by significance,
 *              then repetition, diminishing returns, caps and stage rules.
 *   feel       immediate feelings of `from` (the emotion layer): these may be
 *              big. They never write the long-term numbers.
 *   evidence   what it says about `to` (impressions).
 */
import type { Feelings } from "../types";
import type { Delta, ImpressionTheme, InteractionKind, Significance } from "./types";

export type KindDef = {
  effect: Delta;
  defaultSig: Significance;
  feel?: Feelings;
  evidence?: { theme: ImpressionTheme; value: number; weight: number }[];
};

export const KINDS: Record<InteractionKind, KindDef> = {
  small_talk: { effect: { familiarity: 1.2, affection: 0.6, trust: 0.3 }, defaultSig: "ordinary", feel: { happiness: 4 } },
  compliment: { effect: { affection: 1.5, familiarity: 0.5 }, defaultSig: "ordinary", feel: { happiness: 12, embarrassment: 8 }, evidence: [{ theme: "kind", value: 0.3, weight: 0.4 }] },
  thanks: { effect: { affection: 0.8, respect: 0.3 }, defaultSig: "ordinary", feel: { happiness: 8 } },
  gift: { effect: { affection: 2, trust: 0.5, familiarity: 1 }, defaultSig: "ordinary", feel: { happiness: 18, gratitude: 20, surprise: 10 }, evidence: [{ theme: "kind", value: 0.4, weight: 0.5 }] },
  photo: { effect: { affection: 1, familiarity: 1.5 }, defaultSig: "ordinary", feel: { happiness: 8, surprise: 6 } },
  help: { effect: { trust: 3, affection: 2, respect: 1, familiarity: 1, dependence: 1 }, defaultSig: "meaningful", feel: { gratitude: 35, happiness: 12 }, evidence: [{ theme: "reliable", value: 0.6, weight: 1 }, { theme: "kind", value: 0.5, weight: 1 }] },
  rescue: { effect: { trust: 6, affection: 4, respect: 4, familiarity: 2, dependence: 2 }, defaultSig: "major", feel: { gratitude: 60, surprise: 25, happiness: 15 }, evidence: [{ theme: "reliable", value: 0.8, weight: 2 }, { theme: "kind", value: 0.8, weight: 2 }, { theme: "competent", value: 0.5, weight: 1 }] },
  cooperate: { effect: { respect: 1.5, trust: 1, familiarity: 1.5, tension: -1 }, defaultSig: "ordinary", feel: { happiness: 6 }, evidence: [{ theme: "reliable", value: 0.3, weight: 0.6 }, { theme: "competent", value: 0.4, weight: 0.6 }] },
  shared_experience: { effect: { affection: 2.5, familiarity: 3, trust: 1.5 }, defaultSig: "meaningful", feel: { happiness: 20, excitement: 15 } },
  share_secret: { effect: { trust: 4, affection: 2, familiarity: 2 }, defaultSig: "meaningful", feel: { surprise: 15, affection: 10 }, evidence: [{ theme: "honest", value: 0.6, weight: 1.2 }] },
  make_promise: { effect: { trust: 0.5 }, defaultSig: "ordinary", feel: { happiness: 5 } },
  keep_promise: { effect: { trust: 4, respect: 1 }, defaultSig: "meaningful", feel: { happiness: 15, gratitude: 15 }, evidence: [{ theme: "reliable", value: 1, weight: 1.5 }] },
  break_promise: { effect: { trust: -6, affection: -2, tension: 3 }, defaultSig: "meaningful", feel: { sadness: 25, anger: 20 }, evidence: [{ theme: "reliable", value: -1, weight: 1.5 }] },
  apology: { effect: { tension: -2 }, defaultSig: "ordinary", feel: { surprise: 6 } },
  agree: { effect: { affection: 0.3 }, defaultSig: "ordinary", feel: { happiness: 4 } },
  disagree_respectfully: { effect: { respect: 1, tension: 0.5 }, defaultSig: "ordinary", feel: { frustration: 6 }, evidence: [{ theme: "honest", value: 0.4, weight: 0.6 }, { theme: "respectful", value: 0.3, weight: 0.4 }] },
  valid_argument: { effect: { respect: 2 }, defaultSig: "ordinary", feel: { surprise: 8 }, evidence: [{ theme: "competent", value: 0.6, weight: 0.8 }] },
  argument: { effect: { tension: 3, affection: -1.5, trust: -0.5 }, defaultSig: "ordinary", feel: { anger: 25, frustration: 20 } },
  criticize: { effect: { tension: 2, affection: -1.5 }, defaultSig: "ordinary", feel: { anger: 12, sadness: 10, embarrassment: 10 }, evidence: [{ theme: "kind", value: -0.4, weight: 0.6 }] },
  insult: { effect: { affection: -4, respect: -2, tension: 4, trust: -1 }, defaultSig: "meaningful", feel: { anger: 35, sadness: 15 }, evidence: [{ theme: "kind", value: -0.8, weight: 1.2 }] },
  tease: { effect: { familiarity: 0.5, affection: 0.3, tension: 0.5 }, defaultSig: "ordinary", feel: { embarrassment: 10, happiness: 6 } },
  provoke: { effect: { tension: 3, rivalry: 1, affection: -1 }, defaultSig: "ordinary", feel: { anger: 22, frustration: 12 }, evidence: [{ theme: "kind", value: -0.5, weight: 0.7 }] },
  boundary_push: { effect: { trust: -2, tension: 2.5, affection: -1 }, defaultSig: "ordinary", feel: { anxiety: 18, frustration: 18 }, evidence: [{ theme: "respectful", value: -0.8, weight: 1 }] },
  respect_boundary: { effect: { trust: 1.5, respect: 1 }, defaultSig: "ordinary", feel: { happiness: 6 }, evidence: [{ theme: "respectful", value: 0.7, weight: 1 }] },
  betrayal: { effect: { trust: -9, affection: -4, tension: 5 }, defaultSig: "major", feel: { anger: 45, sadness: 40, surprise: 20 }, evidence: [{ theme: "honest", value: -1, weight: 2 }, { theme: "reliable", value: -1, weight: 2 }] },
  threat: { effect: { trust: -5, fear: 6, tension: 4, affection: -2.5 }, defaultSig: "major", feel: { fear: 45, anger: 25, anxiety: 30 }, evidence: [{ theme: "safe", value: -1, weight: 2 }] },
  reunion: { effect: { affection: 1.5, familiarity: 1 }, defaultSig: "ordinary", feel: { happiness: 20, excitement: 10 } },
  rejection: { effect: { affection: -1.5, tension: 1 }, defaultSig: "ordinary", feel: { sadness: 15, embarrassment: 10 } },
};

export const SIG_RANK: Record<Significance, number> = { trivial: 0, ordinary: 1, meaningful: 2, major: 3 };
export const sigFromRank = (r: number): Significance => (["trivial", "ordinary", "meaningful", "major"] as const)[Math.max(0, Math.min(3, r))];

/** Is this kind good news for the relationship (repetition only dampens the good side)? */
export const isPositiveKind = (k: InteractionKind) => {
  const e = KINDS[k].effect;
  return (e.trust ?? 0) + (e.affection ?? 0) + (e.respect ?? 0) - (e.tension ?? 0) > 0;
};

/** Behavior-engine triggers → what the other person did. */
export const TRIGGER_KIND: Record<string, InteractionKind> = {
  approached: "small_talk",
  spoken_to: "small_talk",
  criticized: "criticize",
  complimented: "compliment",
  provoked: "provoke",
  forced_cooperation: "cooperate",
  helped: "help",
  teased: "tease",
  brushed_off: "rejection",
};

/** Behavior-engine actions → what the reactor did, as the other person sees it. */
export const ACTION_KIND: Record<string, InteractionKind> = {
  greet: "small_talk",
  initiate_conversation: "small_talk",
  avoid_conversation: "rejection",
  show_affection: "compliment",
  express_frustration: "argument",
  ask_question: "small_talk",
  respond_cautiously: "small_talk",
  respond_playfully: "tease",
  respond_defensively: "argument",
  stay_silent: "small_talk",
  change_subject: "small_talk",
  challenge: "provoke",
  acknowledge: "valid_argument",
};

/** Story-engine events → kind. */
export const EVENT_KIND: Record<string, InteractionKind> = {
  argument: "argument",
  kindness: "help",
  confide: "share_secret",
  rivalry: "provoke",
  tease: "tease",
  misunderstanding: "argument",
  askHelp: "cooperate",
  memoryEcho: "small_talk",
  goalStep: "cooperate",
};

/** Conversation topics (the speaker's own view, as they say it). */
export const TOPIC_KIND: Record<string, InteractionKind> = {
  apologize: "small_talk",
  compliment: "small_talk",
  cheerUp: "small_talk",
  confide: "small_talk",
  challenge: "provoke",
  introduce: "small_talk",
};
