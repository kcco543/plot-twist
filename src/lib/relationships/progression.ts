/**
 * RELATIONSHIP PROGRESSION — the single writer of long-term relationships.
 * --------------------------------------------------------------------------
 * Every system that wants a relationship to move (conversations, the
 * behavior engine, story events, gifts, photos, AI replies) describes WHAT
 * HAPPENED as an interaction (kind + significance, optionally a proposed
 * change). recordInteraction() decides what that is worth:
 *
 *   1. significance check   kinds have a ceiling (a compliment is never a
 *                           major event; only some kinds can be major)
 *   2. base change          the kind's effect × significance, or the caller's
 *                           proposal
 *   3. context              apologies weighed against past behavior, promises
 *                           matched to promises actually made, open conflicts
 *                           dampen trust and affection, rivalry slows warmth,
 *                           the character's own trust slider
 *   4. repetition           repeats in the window and over a lifetime give less
 *                           (good effects only; repeated pressure gets worse)
 *   5. caps                 per dimension and in total, by significance
 *   6. stage doors          positive change stops at the next stage's door
 *                           until its milestones exist
 *   7. commit               numbers, history, milestones, impressions,
 *                           conflicts, stages (hysteresis) and an inspector
 *                           record, all in one new StoryState
 *
 * Pure and deterministic (no randomness). On any internal error the story is
 * returned unchanged: a half-applied change is never saved.
 */
import { neutralState } from "../story/engine";
import { addFeelings, feelingsOf, ranked } from "../mind/feelings";
import { relevantMemories } from "../mind/memory";
import { relationOf, relKey, withRelation } from "../mind/relations";
import { PLAYER_ID, type Character, type Feelings, type PlayerBond, type Relation, type StoryState } from "../types";
import { MAJOR_OK, ORDINARY_MAX, RELATIONSHIP_CONFIG as C, RELIABLE_ACTS, SERIOUS_NEGATIVE } from "./config";
import { isPositiveKind, KINDS, SIG_RANK, sigFromRank } from "./interactions";
import { ceilingFor, initialStages, updateStages } from "./stages";
import {
  NUM_KEYS,
  type ChangeRecord,
  type ChangeSource,
  type Conflict,
  type ConflictKind,
  type Delta,
  type Impression,
  type InteractionKind,
  type Milestone,
  type MilestoneKind,
  type NumKey,
  type RelProgress,
  type Significance,
} from "./types";

export type InteractionInput = {
  /** Whose view changes. */
  from: Character;
  /** Who did it; null = the visitor (the player, in photos and gifts). */
  to: Character | null;
  kind: InteractionKind;
  /** What was originally proposed (when a caller already downgraded it). */
  proposedKind?: InteractionKind;
  significance?: Significance;
  /** A proposed change (rules tables, AI). Validated like everything else. */
  proposed?: Delta;
  source: ChangeSource;
  why?: string;
  /** Same thing again (a gift item id, a photo…): repeats of the same key give much less. */
  key?: string;
  /** `from` was struggling when it happened (help then counts as help in a difficult moment). */
  distressed?: boolean;
  /** For share_secret: offered freely (true by default) or pried out. */
  voluntary?: boolean;
  promiseText?: string;
  /** Sensitive-request topic, for boundary_push / respect_boundary. */
  topic?: string;
  /** Reasons a caller already recorded (e.g. the AI's kind was downgraded). */
  reasons?: string[];
  /** Apply the immediate feelings too (default true). */
  feelings?: boolean;
  now?: number;
};

export type InteractionResult = { story: StoryState; change: ChangeRecord | null };

const RANGES: Record<NumKey, [number, number]> = {
  trust: [-100, 100],
  affection: [-100, 100],
  respect: [-100, 100],
  familiarity: [0, 100],
  rivalry: [0, 100],
  tension: [0, 100],
  fear: [0, 100],
  dependence: [0, 100],
};
/** Which direction is "better" for the relationship (repetition only dampens this side). */
const GOOD_DIR: Record<NumKey, 1 | -1> = { trust: 1, affection: 1, respect: 1, familiarity: 1, dependence: 1, tension: -1, rivalry: -1, fear: -1 };

const r1 = (v: number) => Math.round(v * 10) / 10;
const clampK = (k: NumKey, v: number) => Math.max(RANGES[k][0], Math.min(RANGES[k][1], r1(v)));
const num = (rel: Relation, k: NumKey) => (rel[k] as number | undefined) ?? 0;

export const emptyProgress = (rel: Relation, now: number, grandfathered = true): RelProgress => ({
  stages: initialStages(rel),
  grandfathered,
  history: [],
  counts: {},
  milestones: [],
  impressions: [],
  conflicts: [],
  promises: [],
  pressure: {},
  openedSoft: [],
  log: [],
  since: now,
});

// ---------------------------------------------------------------- reading

export const targetId = (to: Character | null) => to?.id ?? PLAYER_ID;
export const progressKey = (fromId: string, toId: string) => relKey(fromId, toId);

/** The long-term relationship `from` has with `to` (characters: behavior-engine relation; visitor: the player bond). */
export function currentRelation(story: StoryState, from: Character, to: Character | null): Relation {
  if (to) return relationOf(story, from, to, story.bonds[bondKeyOf(from.id, to.id)]);
  const b = story.player?.[from.id];
  return { trust: b?.trust ?? 0, affection: b?.affection ?? 0, respect: 0, familiarity: b?.familiarity ?? 0, rivalry: 0, tension: 0, fear: 0, dependence: 0, label: (b?.familiarity ?? 0) >= 20 ? "acquaintance" : "stranger" };
}
const bondKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function progressOf(story: StoryState, from: Character, to: Character | null, now = Date.now()): RelProgress {
  return story.progress?.[progressKey(from.id, targetId(to))] ?? emptyProgress(currentRelation(story, from, to), now);
}

function writeRelation(story: StoryState, from: Character, to: Character | null, rel: Relation): StoryState {
  if (to) return withRelation(story, from.id, to.id, rel);
  const b: PlayerBond = story.player?.[from.id] ?? { trust: 0, affection: 0, familiarity: 0, photos: 0, recent: [] };
  return { ...story, player: { ...(story.player ?? {}), [from.id]: { ...b, trust: rel.trust, affection: rel.affection, familiarity: rel.familiarity } } };
}

export const withProgress = (story: StoryState, fromId: string, toId: string, p: RelProgress): StoryState => ({ ...story, progress: { ...(story.progress ?? {}), [progressKey(fromId, toId)]: p } });

const interactionsOf = (p: RelProgress) => Object.values(p.counts).reduce((a, b) => a + (b ?? 0), 0);
const openSerious = (p: RelProgress) => p.conflicts.filter((c) => !c.resolved && c.severity >= 2);

// ---------------------------------------------------------------- the gate

/** Kinds have a ceiling: a compliment is never a major event, only some kinds can be major, and nothing jumps two levels above its usual size. */
export function validateSignificance(kind: InteractionKind, proposed: Significance, reasons: string[] = []): Significance {
  let sig = proposed;
  if (ORDINARY_MAX.includes(kind) && SIG_RANK[sig] > 1) {
    sig = "ordinary";
    reasons.push("sig:ordinary_kind");
  }
  if (sig === "major" && !MAJOR_OK.includes(kind)) {
    sig = "meaningful";
    reasons.push("sig:major_not_allowed");
  }
  const usual = KINDS[kind].defaultSig;
  if (SIG_RANK[sig] > SIG_RANK[usual] + 1) {
    sig = sigFromRank(SIG_RANK[usual] + 1);
    reasons.push("sig:too_far_above_usual");
  }
  return sig;
}

export function recordInteraction(story: StoryState, input: InteractionInput): InteractionResult {
  try {
    return compute(story, input);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.error("[relationships] change not applied", err);
    return { story, change: null };
  }
}

function compute(story: StoryState, input: InteractionInput): InteractionResult {
  const now = input.now ?? Date.now();
  const { from, to } = input;
  const toId = targetId(to);
  const turn = story.turn;
  const reasons: string[] = [...(input.reasons ?? [])];
  const before = currentRelation(story, from, to);
  const p0 = progressOf(story, from, to, now);
  const p: RelProgress = structuredClone(p0);
  let kind = input.kind;
  const proposedKind = input.proposedKind ?? input.kind;

  // ---- 1. significance
  const proposedSig: Significance = input.significance ?? KINDS[kind].defaultSig;
  let sig = validateSignificance(kind, proposedSig, reasons);

  // ---- 3a. context that can change what the interaction IS
  const milestones: MilestoneKind[] = [];
  const addMilestone = (k: MilestoneKind, positive: boolean, why: string) => {
    milestones.push(k);
    p.milestones = [...p.milestones, { id: `ms-${turn}-${p.milestones.length}-${k}`, kind: k, turn, at: now, positive, why: why.slice(0, 160) } satisfies Milestone].slice(-C.milestoneKeep);
  };
  const openConflict = (k: ConflictKind, severity: 1 | 2 | 3) => {
    // A second argument while one is still open just keeps that one open.
    const same = p.conflicts.find((c) => !c.resolved && c.kind === k && turn - c.turn <= 6);
    if (same && k === "argument") return;
    p.conflicts = [...p.conflicts, { id: `cf-${turn}-${p.conflicts.length}`, kind: k, turn, severity, trustAt: num(before, "trust"), apologies: 0, repair: 0, repairNeeded: C.repairNeeded[k], resolved: false } satisfies Conflict].slice(-12);
  };

  let base: Delta = input.proposed ? { ...input.proposed } : scale(KINDS[kind].effect, C.significanceScale[sig]);
  if (input.proposed) reasons.push("base:proposed");

  if (kind === "apology") {
    const open = [...p.conflicts].reverse().find((c) => !c.resolved);
    if (!open) {
      base = { tension: -0.5 };
      reasons.push("apology:nothing_open");
    } else {
      // Weighed against past behavior: earlier apologies followed by new conflicts make the next one worth less.
      const earlier = p.counts.apology ?? 0;
      const conflictsSince = p.conflicts.filter((c) => c.turn > (p.history.find((h) => h.kind === "apology")?.turn ?? Infinity)).length;
      const rel = impressionScore(p, "reliable");
      const credibility = Math.max(0.15, Math.min(1, (1 / (1 + 0.6 * Math.min(earlier, conflictsSince))) * (0.7 + 0.3 * rel)));
      base = { tension: -3 * credibility, affection: 0.5 * credibility, ...(open.kind === "argument" ? { trust: 0.5 * credibility } : {}) };
      if (open.kind !== "argument") reasons.push(`apology:no_trust_back_for_${open.kind}`);
      reasons.push(`apology:credibility_${credibility.toFixed(2)}`);
      open.apologies += 1;
    }
  }
  if (kind === "make_promise") {
    p.promises = [...p.promises, { id: `pr-${turn}-${p.promises.length}`, turn, text: (input.promiseText ?? input.why ?? "").slice(0, 120), status: "open" as const }].slice(-12);
  }
  if (kind === "keep_promise") {
    const open = p.promises.find((x) => x.status === "open");
    if (!open) {
      kind = "cooperate";
      base = scale(KINDS.cooperate.effect, 1);
      sig = "ordinary";
      reasons.push("promise:none_open_to_keep");
    } else {
      open.status = "kept";
      addMilestone("promise_kept", true, open.text || input.why || "");
    }
  }
  if (kind === "break_promise") {
    const open = p.promises.find((x) => x.status === "open");
    if (open) open.status = "broken";
    else reasons.push("promise:no_record_of_promise");
    // Expectations are higher for someone already trusted: it hurts more, but is still not a betrayal.
    if ((p.stages.trust === "strong" || p.stages.trust === "deep") && base.trust) {
      base = { ...base, trust: base.trust * 1.4 };
      reasons.push("promise:broken_by_trusted");
    }
    openConflict("broken_promise", 2);
    addMilestone("promise_broken", false, input.why ?? "");
  }
  if (kind === "betrayal") {
    openConflict("betrayal", 3);
    addMilestone("betrayed", false, input.why ?? "");
  }
  if (kind === "threat") {
    openConflict("threat", 3);
    addMilestone("threatened", false, input.why ?? "");
  }
  if (kind === "argument" || kind === "insult") openConflict("argument", 1);
  if (kind === "boundary_push") {
    const pr = input.topic ? p.pressure[input.topic] : undefined;
    const pushes = Math.max(0, (pr?.asks ?? 1) - 1);
    const esc = 1 + C.pushEscalation * pushes;
    base = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, (v as number) * esc]));
    reasons.push(`push:escalation_x${esc.toFixed(1)}`);
    const totalPushes = (p.counts.boundary_push ?? 0) + 1;
    if (totalPushes % 3 === 0) {
      addMilestone("boundary_violated", false, input.topic ?? "");
      openConflict("boundary", 2);
    }
  }

  // ---- 3b + 4. context and repetition (good side only)
  const window = p.history.filter((h) => turn - h.turn <= C.repeatWindowTurns && h.turn <= turn);
  const sameKind = window.filter((h) => h.kind === kind);
  // Keyed things (a gift item): the same item again counts much more than a different one.
  const repeats = input.key ? sameKind.filter((h) => h.key !== input.key).length : sameKind.length;
  const lifetime = p.counts[kind] ?? 0;
  const sameItemTimes = input.key ? p.history.filter((h) => h.kind === kind && h.key === input.key).length : 0;
  const sameItem = sameItemTimes > 0;
  const decay = input.key ? C.otherItemDecay : (C.repeatDecayByKind[kind] ?? C.repeatDecay);
  const lifeDecay = C.lifetimeDecayByKind[kind] ?? C.lifetimeDecay;
  let flattery = false;
  if (kind === "compliment") {
    const recent = p.history.slice(-C.flatteryWindow);
    const comps = recent.filter((h) => h.kind === "compliment").length;
    flattery = comps + 1 >= C.flatteryCount && (comps + 1) / (recent.length + 1) >= C.flatteryShare;
  }
  const traits = from.traits;
  const trustTrait = traits.trust ?? 50;
  const conflictsOpen = openSerious(p);
  const proposed: Delta = { ...base };
  const d: Delta = {};
  for (const k of NUM_KEYS) {
    let v = base[k] ?? 0;
    if (!v) continue;
    const good = Math.sign(v) === GOOD_DIR[k];
    if (good && k === "familiarity") {
      v *= 1 / (1 + C.familiarityLifetimeDecay * lifetime);
      if (window.some((h) => h.turn === turn)) v *= 0.5;
    } else if (good) {
      if (repeats > 0) v *= Math.pow(decay, repeats);
      v *= 1 / (1 + lifeDecay * lifetime);
      if (sameItem) v *= Math.pow(C.sameItemDecay, sameItemTimes);
      if (flattery) v = 0;
      if (k === "trust" || k === "affection" || k === "respect") v *= Math.max(C.levelFloor, 1 - Math.max(0, num(before, k)) / C.levelSpan);
      if (k === "affection") v *= 1 - num(before, "rivalry") / 150;
      if (k === "trust") v *= (1 - num(before, "rivalry") / 200) * (0.5 + trustTrait / 100);
      if (conflictsOpen.length && k === "trust") v *= C.openConflictTrust;
      if (conflictsOpen.length && k === "affection") v *= C.openConflictAffection;
    }
    d[k] = v;
  }
  if (repeats > 0 && isPositiveKind(kind)) reasons.push(`repeat:${repeats}_in_window`);
  if (lifetime > 0 && isPositiveKind(kind)) reasons.push(`repeat:lifetime_${lifetime}`);
  if (sameItem) reasons.push("repeat:same_item");
  if (flattery) {
    d.affection = -0.3;
    reasons.push("compliment:reads_as_flattery");
  }
  if (conflictsOpen.length && ((base.trust ?? 0) > 0 || (base.affection ?? 0) > 0)) reasons.push("context:open_conflict");
  if (num(before, "rivalry") >= 30 && ((base.affection ?? 0) > 0 || (base.trust ?? 0) > 0)) reasons.push("context:rivalry_slows_warmth");

  // ---- 5. caps
  const perAxis = C.perAxisCap[sig];
  for (const k of NUM_KEYS) {
    const v = d[k];
    if (!v) continue;
    const serious = SERIOUS_NEGATIVE.includes(kind) && Math.sign(v) !== GOOD_DIR[k];
    const cap = serious ? C.perAxisCap.major : perAxis;
    if (Math.abs(v) > cap) {
      d[k] = Math.sign(v) * cap;
      reasons.push(`cap:${k}`);
    }
  }
  const total = NUM_KEYS.reduce((a, k) => a + Math.abs(d[k] ?? 0), 0);
  const totalCap = SERIOUS_NEGATIVE.includes(kind) ? C.totalCap.major : C.totalCap[sig];
  if (total > totalCap) {
    const f = totalCap / total;
    for (const k of NUM_KEYS) if (d[k]) d[k] = d[k]! * f;
    reasons.push("cap:total");
  }

  // ---- 6. stage doors (and the trust ceiling of an open betrayal)
  const interactions = interactionsOf(p) + 1;
  for (const k of ["trust", "affection", "respect", "familiarity"] as const) {
    const v = d[k];
    if (!v || v <= 0) continue;
    let ceil = ceilingFor(k, p, interactions);
    if (k === "trust") for (const c of conflictsOpen) ceil = Math.min(ceil, Math.max(c.trustAt, num(before, "trust")));
    const cur = num(before, k);
    if (cur + v > ceil) {
      d[k] = Math.max(0, ceil - cur);
      reasons.push(`door:${k}`);
    }
  }

  // ---- 7. commit
  const after: Relation = { ...before };
  const accepted: Delta = {};
  for (const k of NUM_KEYS) {
    const v = d[k];
    if (!v) continue;
    const nv = clampK(k, num(before, k) + v);
    const dv = r1(nv - num(before, k));
    if (dv) {
      (after as Record<string, number | string | undefined>)[k] = nv;
      accepted[k] = dv;
    }
  }
  if (after.label === "stranger" && after.familiarity >= 20) after.label = "acquaintance";

  const positive = isPositiveKind(kind);
  p.history = [...p.history, { turn, at: now, kind, significance: sig, positive, ...(input.key ? { key: input.key } : {}) }].slice(-C.historyKeep);
  p.counts = { ...p.counts, [kind]: (p.counts[kind] ?? 0) + 1 };

  // Milestones from accumulated history.
  detectMilestones(p, kind, sig, turn, input, addMilestone);

  // Conflict repair and resolution.
  for (const c of p.conflicts) {
    if (c.resolved || c.turn === turn) continue;
    if (RELIABLE_ACTS.includes(kind)) c.repair += 1;
    const ok = c.kind === "argument" ? c.apologies >= 1 || c.repair >= 2 : c.apologies >= 1 && c.repair >= c.repairNeeded;
    if (ok) {
      c.resolved = true;
      c.resolvedTurn = turn;
      addMilestone("resolved_disagreement", true, `${c.kind} from turn ${c.turn}`);
    }
  }

  // Impressions (evidence-backed).
  updateImpressions(p, kind, turn, flattery, reasons);

  // Stages (hysteresis + milestone doors).
  const st = updateStages(after, p, interactions);
  p.stages = st.stages;

  // Immediate feelings (emotion layer). Never touches the numbers above.
  const fState = story.characters[from.id] ?? neutralState();
  const feelBefore = feelingsOf(fState);
  let feelAfter: Feelings = feelBefore;
  if (input.feelings !== false && KINDS[kind].feel) {
    const damp = positive ? Math.pow(decay, repeats) * (sameItem ? Math.pow(C.sameItemDecay, sameItemTimes) : 1) : 1;
    const size = Math.min(1.5, C.significanceScale[sig]) * damp;
    feelAfter = addFeelings(feelBefore, scale(KINDS[kind].feel as Delta, size) as Feelings);
  }

  const change: ChangeRecord = {
    id: `chg-${turn}-${p.log.length}-${now.toString(36)}`,
    turn,
    at: now,
    source: input.source,
    kind,
    proposedKind,
    significance: { proposed: proposedSig, accepted: sig },
    proposed: roundDelta(proposed),
    accepted,
    before: pick(before),
    after: pick(after),
    reasons,
    milestones,
    stageChanges: st.changes,
    pending: st.pending,
    feelings: { before: Object.fromEntries(ranked(feelBefore).slice(0, 4)), after: Object.fromEntries(ranked(feelAfter).slice(0, 4)) },
    memories: relevantMemories(fState, toId, 3).map((m) => m.note ?? m.kind ?? m.eventType),
    why: (input.why ?? "").slice(0, 160),
  };
  p.log = [...p.log, change].slice(-C.logKeep);

  let s = writeRelation(story, from, to, after);
  s = withProgress(s, from.id, toId, p);
  if (feelAfter !== feelBefore) s = { ...s, characters: { ...s.characters, [from.id]: { ...(s.characters[from.id] ?? neutralState()), feelings: feelAfter } } };
  return { story: s, change };
}

function detectMilestones(p: RelProgress, kind: InteractionKind, sig: Significance, turn: number, input: InteractionInput, add: (k: MilestoneKind, positive: boolean, why: string) => void) {
  const lastOf = (k: MilestoneKind) => [...p.milestones].reverse().find((m) => m.kind === k)?.turn ?? -Infinity;
  const why = input.why ?? "";
  // Several instances of reliable behavior, in different turns.
  if (RELIABLE_ACTS.includes(kind)) {
    const since = lastOf("reliable_behavior");
    const turns = new Set(p.history.filter((h) => RELIABLE_ACTS.includes(h.kind) && h.turn > since).map((h) => h.turn));
    if (turns.size >= C.reliableActs) add("reliable_behavior", true, `${turns.size} reliable acts`);
  }
  if ((kind === "help" && input.distressed && SIG_RANK[sig] >= 2) || kind === "rescue") {
    if (turn - lastOf("helped_in_difficulty") >= 6) add("helped_in_difficulty", true, why);
  }
  if (kind === "share_secret" && input.voluntary !== false && SIG_RANK[sig] >= 2) add("voluntary_secret", true, why);
  if ((kind === "shared_experience" || (kind === "cooperate" && SIG_RANK[sig] >= 2)) && turn - lastOf("shared_experience") >= C.sharedGap) add("shared_experience", true, why);
  if (kind === "respect_boundary") {
    const since = lastOf("respected_boundaries");
    const n = p.history.filter((h) => h.kind === "respect_boundary" && h.turn > since).length;
    if (n >= C.respectedTimes) add("respected_boundaries", true, `${n} times`);
  }
  if (kind === "valid_argument" || kind === "rescue" || (kind === "cooperate" && SIG_RANK[sig] >= 2)) {
    const since = lastOf("earned_respect");
    const n = p.history.filter((h) => (h.kind === "valid_argument" || h.kind === "rescue" || h.kind === "cooperate") && h.turn > since).length;
    if (n >= C.respectActs) add("earned_respect", true, `${n} times`);
  }
}

const EVIDENCE_RATE = 0.2;
function updateImpressions(p: RelProgress, kind: InteractionKind, turn: number, flattery: boolean, reasons: string[]) {
  const ev = [...(KINDS[kind].evidence ?? [])];
  if (kind === "compliment" && flattery) ev.splice(0, ev.length, { theme: "sincere", value: -0.7, weight: 1 });
  if (kind === "apology" && reasons.some((r) => r.startsWith("apology:credibility_0.") && Number(r.split("_").pop()) < 0.5)) ev.push({ theme: "sincere", value: -0.5, weight: 0.8 });
  if (kind === "apology" && reasons.some((r) => r === "apology:credibility_1.00")) ev.push({ theme: "honest", value: 0.3, weight: 0.5 });
  for (const e of ev) {
    const cur = p.impressions.find((i) => i.theme === e.theme);
    if (!cur) {
      p.impressions.push({ theme: e.theme, score: r2(e.value * Math.min(1, EVIDENCE_RATE * 2 * e.weight)), evidence: e.weight, since: turn, last: turn } satisfies Impression);
      continue;
    }
    const rate = Math.min(0.5, EVIDENCE_RATE * e.weight);
    cur.score = r2(cur.score + (e.value - cur.score) * rate);
    cur.evidence = r2(cur.evidence + e.weight);
    cur.last = turn;
  }
}

export function impressionScore(p: RelProgress, theme: Impression["theme"]): number {
  return p.impressions.find((i) => i.theme === theme)?.score ?? 0;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
function scale(d: Delta, f: number): Delta {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, (v as number) * f])) as Delta;
}
function roundDelta(d: Delta): Delta {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v).map(([k, v]) => [k, r1(v as number)])) as Delta;
}
function pick(rel: Relation): Delta {
  return Object.fromEntries(NUM_KEYS.map((k) => [k, r1(num(rel, k))])) as Delta;
}

/**
 * Turn an AI proposal into a rules proposal: the kind's own size, taking the
 * AI's numbers only where it reads the moment as WORSE than the rule does.
 * Warm words are not evidence; a cold reaction may be.
 */
export function blendProposal(kind: InteractionKind, ai: Delta, sig: Significance): { proposed: Delta; ignoredWarmth: boolean } {
  const base = scale(KINDS[kind].effect, C.significanceScale[validateSignificance(kind, sig)]);
  const out: Delta = { ...base };
  let ignoredWarmth = false;
  for (const k of NUM_KEYS) {
    const a = ai[k];
    if (!a) continue;
    const b = base[k] ?? 0;
    if (Math.sign(a) !== GOOD_DIR[k]) {
      if (Math.sign(b) === GOOD_DIR[k] || Math.abs(a) > Math.abs(b)) out[k] = a;
    } else if (Math.abs(a) > Math.abs(b) || Math.sign(b) !== GOOD_DIR[k]) ignoredWarmth = true;
  }
  return { proposed: out, ignoredWarmth };
}

// ---------------------------------------------------------------- pressure bookkeeping (boundaries.ts uses these)

/** Note a sensitive request and what was decided (refusal, partial, share). */
export function notePressure(story: StoryState, from: Character, to: Character | null, topic: string, intention: string, disclosed: boolean, now = Date.now()): StoryState {
  const p = structuredClone(progressOf(story, from, to, now));
  const cur = p.pressure[topic] ?? { asks: 0, refusals: 0, lastTurn: story.turn, disclosed: 0, respected: false };
  const refused = !disclosed && intention !== "partial_disclosure" && intention !== "share";
  p.pressure = { ...p.pressure, [topic]: { asks: cur.asks + 1, refusals: cur.refusals + (refused ? 1 : 0), lastTurn: story.turn, disclosed: cur.disclosed + (disclosed ? 1 : 0), respected: false, lastIntention: intention } };
  return withProgress(story, from.id, targetId(to), p);
}

/** The asker moved on after a refusal without pushing: mark it respected (once per refusal). */
export function markRespected(story: StoryState, from: Character, to: Character | null, topic: string): StoryState {
  const p = structuredClone(progressOf(story, from, to));
  const cur = p.pressure[topic];
  if (!cur) return story;
  p.pressure = { ...p.pressure, [topic]: { ...cur, respected: true } };
  return withProgress(story, from.id, targetId(to), p);
}

export function addMilestoneDirect(story: StoryState, from: Character, to: Character | null, kind: MilestoneKind, why: string, now = Date.now()): StoryState {
  const p = structuredClone(progressOf(story, from, to, now));
  p.milestones = [...p.milestones, { id: `ms-${story.turn}-${p.milestones.length}-${kind}`, kind, turn: story.turn, at: now, positive: (C.milestoneAxes[kind] as readonly string[]).length > 0, why }].slice(-C.milestoneKeep);
  return withProgress(story, from.id, targetId(to), p);
}

/** Open a soft boundary for one person (a personal decision, see boundaries.ts). */
export function openSoftBoundary(story: StoryState, from: Character, to: Character | null, boundaryId: string): StoryState {
  const p = structuredClone(progressOf(story, from, to));
  if (p.openedSoft.includes(boundaryId)) return story;
  p.openedSoft = [...p.openedSoft, boundaryId];
  return withProgress(story, from.id, targetId(to), p);
}
