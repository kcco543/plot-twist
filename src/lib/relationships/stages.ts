/**
 * RELATIONSHIP STAGES — named stages with hysteresis and milestone gates.
 * --------------------------------------------------------------------------
 * Each axis (trust, affection, respect, familiarity, tension) has a ladder
 * (config.ts). Moving UP into a stage needs the value to reach its `enter`
 * threshold AND the supporting milestones; moving DOWN happens only when the
 * value falls below the stage's lower `exit` threshold. So a value sitting
 * between exit and enter never flickers between two stages.
 *
 * Labels ("friend", "respected rival"…) are read from several stages at
 * once, never from a single number and never from a passing emotion.
 */
import type { Relation } from "../types";
import { RELATIONSHIP_CONFIG as C, type StageDef } from "./config";
import { AXES, type Axis, type Milestone, type RelProgress, type StageChange, type StagePending } from "./types";

export const ladder = (axis: Axis): StageDef[] => C.stages[axis];
export const stageIndex = (axis: Axis, id: string | undefined) => Math.max(0, ladder(axis).findIndex((s) => s.id === id));
export const valueOf = (rel: Relation, axis: Axis) => (rel[axis] as number | undefined) ?? 0;

/** The stage a value sits in, ignoring history (old saves, written canon, a fresh record). */
export function stageForValue(axis: Axis, v: number): string {
  const l = ladder(axis);
  let i = 0;
  for (let k = 1; k < l.length; k++) if (v >= l[k].enter) i = k;
  return l[i].id;
}

export function initialStages(rel: Relation): Partial<Record<Axis, string>> {
  return Object.fromEntries(AXES.map((a) => [a, stageForValue(a, valueOf(rel, a))])) as Partial<Record<Axis, string>>;
}

/**
 * Milestones that count for `axis`. Trust has to be rebuilt after a betrayal
 * or a broken promise: only milestones after the latest one that is still
 * unresolved count.
 */
export function supportFor(axis: Axis, p: RelProgress): Milestone[] {
  let after = -Infinity;
  if (axis === "trust") {
    for (const c of p.conflicts) if (!c.resolved && (c.kind === "betrayal" || c.kind === "broken_promise" || c.kind === "threat")) after = Math.max(after, c.turn);
  }
  return p.milestones.filter((m) => m.positive && m.turn > after && (C.milestoneAxes[m.kind] as readonly Axis[]).includes(axis));
}

/** What the next stage up still needs (empty = nothing). */
export function missingFor(axis: Axis, def: StageDef, p: RelProgress, interactions: number): string[] {
  const need: string[] = [];
  const sup = supportFor(axis, p);
  if (sup.length < def.need) need.push(`milestones:${sup.length}/${def.need}`);
  if (def.distinct && new Set(sup.map((m) => m.kind)).size < def.distinct) need.push(`distinct:${new Set(sup.map((m) => m.kind)).size}/${def.distinct}`);
  if (def.interactions && interactions < def.interactions) need.push(`interactions:${interactions}/${def.interactions}`);
  return need;
}

/** Highest value a positive change may reach on this axis right now (the next stage's door, unless it is open). */
export function ceilingFor(axis: Axis, p: RelProgress, interactions: number): number {
  const l = ladder(axis);
  const cur = stageIndex(axis, p.stages[axis]);
  for (let k = cur + 1; k < l.length; k++) {
    if (missingFor(axis, l[k], p, interactions).length) return l[k].enter + C.ceilingSlack;
  }
  return Infinity;
}

/** Move stages after a value change: up only through open doors, down only below exit. */
export function updateStages(rel: Relation, p: RelProgress, interactions: number): { stages: Partial<Record<Axis, string>>; changes: StageChange[]; pending: StagePending[] } {
  const stages = { ...p.stages };
  const changes: StageChange[] = [];
  const pending: StagePending[] = [];
  for (const axis of AXES) {
    const l = ladder(axis);
    const v = valueOf(rel, axis);
    let i = stageIndex(axis, stages[axis] ?? stageForValue(axis, v));
    const from = l[i].id;
    // Down first (hysteresis: below exit).
    while (i > 0 && v < l[i].exit) i--;
    // Up, one door at a time.
    while (i + 1 < l.length && v >= l[i + 1].enter) {
      const missing = missingFor(axis, l[i + 1], p, interactions);
      if (missing.length) {
        pending.push({ axis, next: l[i + 1].id, needs: missing });
        break;
      }
      i++;
    }
    stages[axis] = l[i].id;
    if (l[i].id !== from) changes.push({ axis, from, to: l[i].id });
  }
  return { stages, changes, pending };
}

// ---------------------------------------------------------------- labels

export const BOND_LABELS = ["stranger", "acquaintance", "friend", "close_friend", "family", "partner", "rival", "respected_rival", "enemy", "wary"] as const;
export type BondLabel = (typeof BOND_LABELS)[number];

/**
 * What this relationship is, read from several stages together (and the
 * player's written relationship label, which stays as written). Trust alone
 * never makes a friend; respect alone never makes affection.
 */
export function bondLabel(rel: Relation, stages: Partial<Record<Axis, string>>): BondLabel {
  const at = (axis: Axis) => stageIndex(axis, stages[axis] ?? stageForValue(axis, valueOf(rel, axis)));
  const trust = at("trust");
  const aff = at("affection");
  const resp = at("respect");
  const fam = at("familiarity");
  const tension = at("tension");
  const written = rel.label;
  if (written === "family" || written === "partner") return written;
  if (aff <= 1 && (tension >= 2 || trust === 0)) return "enemy";
  if ((rel.rivalry ?? 0) >= 40) return resp >= 3 ? "respected_rival" : "rival";
  if (aff >= 4 && trust >= 4 && fam >= 2) return "close_friend";
  if (aff >= 3 && trust >= 3 && fam >= 2) return "friend";
  // Guarded trust alone is just not knowing someone yet; "wary" needs strain or coldness too.
  if (trust <= 1 && fam >= 1 && (tension >= 1 || aff <= 1)) return "wary";
  return fam >= 1 ? "acquaintance" : "stranger";
}
