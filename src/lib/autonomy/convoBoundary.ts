/**
 * CONVERSATION BOUNDARIES — after a character ends a conversation, when are
 * they willing to talk to that person again?
 *
 * Not a timer. A cooldown is NECESSARY but never SUFFICIENT. All of these
 * must hold:
 *
 *   1. cooldown   enough time has passed since they ended it (or since the
 *                 last time the other person pushed). Longer for a more
 *                 serious ending, each push, and a character who holds on to
 *                 things; shorter for a forgiving, trusting one.
 *   2. calm       they have emotionally recovered: anger, frustration,
 *                 sadness and fear (the feelings that ended it) are below 35.
 *   3. repair     for an upset (severity 2+) ending, something has happened
 *                 since: an apology, help, a gift, a kept promise, the other
 *                 respecting a boundary… A long, trusting history (trust ≥ 40)
 *                 can stand in for repair after a severity-2 ending, never
 *                 after severity 3.
 *   4. relation   trust hasn't collapsed (> −40) and they aren't afraid of
 *                 the other person (fear < 70).
 *
 * Trying again too soon is a PUSH: it is refused, recorded as a
 * boundary_push in the relationship (so it costs a little trust and respect),
 * and makes the next cooldown longer. Retrying can never bypass the refusal.
 */
import { level } from "../mind/feelings";
import { personalityOf } from "../mind/profile";
import { currentRelation, progressOf } from "../relationships/progression";
import type { Character, StoryState } from "../types";
import type { AgencyState, ConvoBoundary } from "./types";

export const boundaryKey = (who: string, other: string) => `${who}>${other}`;

/** Every number the rule uses. */
export const CONVO_BOUNDARY = {
  /** Base cooldown per severity (ms of real play). */
  cooldownMs: { 1: 45_000, 2: 120_000, 3: 300_000 } as const,
  /** Each push adds this share of the base. */
  perPush: 0.6,
  /** Feelings must all be below this. */
  calmBelow: 35,
  /** A trusting history can stand in for repair after a severity-2 ending. */
  trustInsteadOfRepair: 40,
  minTrust: -40,
  maxFear: 70,
  /** Interactions that count as repair, when `other` did them after the boundary. */
  repairKinds: ["apology", "help", "rescue", "gift", "keep_promise", "respect_boundary", "thanks", "shared_experience", "compliment"] as const,
};

export type BoundaryCheck = {
  willing: boolean;
  /** i18n keys under autonomy.why: what still stands in the way (empty when willing). */
  blockers: ("cooldown" | "upset" | "repair" | "trust" | "fear")[];
  /** When the cooldown alone would allow it again (ms timestamp). */
  cooldownUntil: number;
};

export const boundaryOf = (a: AgencyState | undefined, who: string, other: string): ConvoBoundary | null => {
  const b = a?.boundaries[boundaryKey(who, other)];
  return b && !b.resolvedAt ? b : null;
};

/** `who` ended (or refused) a conversation with `other`. A second ending while one stands makes it more serious. */
export function recordBoundary(a: AgencyState, who: string, other: string, severity: 1 | 2 | 3, turn: number, now = Date.now()): AgencyState {
  const prev = boundaryOf(a, who, other);
  const sev = (prev ? Math.min(3, Math.max(prev.severity, severity) + (prev.severity >= severity ? 1 : 0)) : severity) as 1 | 2 | 3;
  const b: ConvoBoundary = { who, other, at: now, turn, severity: sev, pushes: prev?.pushes ?? 0, lastPushAt: prev?.lastPushAt ?? 0 };
  return { ...a, boundaries: { ...a.boundaries, [boundaryKey(who, other)]: b } };
}

/** How severe an ending is, from how `who` feels right now. */
export function severityFrom(story: StoryState, who: string): 1 | 2 | 3 {
  const f = story.characters[who]?.feelings ?? {};
  const peak = Math.max(level(f, "anger"), level(f, "frustration"), level(f, "sadness"), level(f, "fear"), level(f, "anxiety"));
  return peak >= 70 ? 3 : peak >= 40 ? 2 : 1;
}

/** Holding on vs letting go, 0.6 (forgiving) … 1.6 (holds on), from personality. */
export function grudgeFactor(c: Character): number {
  const p = personalityOf(c);
  return Math.min(1.6, Math.max(0.6, 1 + 0.35 * p.pride + 0.25 * p.distrustful + 0.2 * p.reserved - 0.35 * p.empathy - 0.25 * p.trusting - 0.15 * p.calm));
}

export function cooldownUntil(b: ConvoBoundary, who: Character): number {
  const base = CONVO_BOUNDARY.cooldownMs[b.severity] * (1 + CONVO_BOUNDARY.perPush * b.pushes) * grudgeFactor(who);
  return Math.max(b.at, b.lastPushAt) + Math.round(base);
}

/** Would `who` talk to `other` (null other = the player's own avatar is not modelled here; always willing)? */
export function willingToTalk(story: StoryState, agency: AgencyState | undefined, who: Character, other: Character, now = Date.now()): BoundaryCheck {
  const b = boundaryOf(agency, who.id, other.id);
  if (!b) return { willing: true, blockers: [], cooldownUntil: 0 };
  const blockers: BoundaryCheck["blockers"] = [];
  const until = cooldownUntil(b, who);
  if (now < until) blockers.push("cooldown");
  const f = story.characters[who.id]?.feelings ?? {};
  if ((["anger", "frustration", "sadness", "fear"] as const).some((k) => level(f, k) >= CONVO_BOUNDARY.calmBelow)) blockers.push("upset");
  const rel = currentRelation(story, who, other);
  const repaired = progressOf(story, who, other, now).history.some((h) => h.at > b.at && h.positive && (CONVO_BOUNDARY.repairKinds as readonly string[]).includes(h.kind));
  if (b.severity >= 2 && !repaired && !(b.severity === 2 && rel.trust >= CONVO_BOUNDARY.trustInsteadOfRepair && b.pushes === 0)) blockers.push("repair");
  if (rel.trust <= CONVO_BOUNDARY.minTrust) blockers.push("trust");
  if (rel.fear >= CONVO_BOUNDARY.maxFear) blockers.push("fear");
  return { willing: blockers.length === 0, blockers, cooldownUntil: until };
}

/** `other` tried again before `who` was ready. */
export function recordPush(a: AgencyState, who: string, other: string, now = Date.now()): AgencyState {
  const b = boundaryOf(a, who, other);
  if (!b) return a;
  return { ...a, boundaries: { ...a.boundaries, [boundaryKey(who, other)]: { ...b, pushes: b.pushes + 1, lastPushAt: now } } };
}

/** They talked again: the boundary is kept for history but no longer applies. */
export function resolveBoundary(a: AgencyState, who: string, other: string, now = Date.now()): AgencyState {
  const b = boundaryOf(a, who, other);
  if (!b) return a;
  return { ...a, boundaries: { ...a.boundaries, [boundaryKey(who, other)]: { ...b, resolvedAt: now } } };
}
