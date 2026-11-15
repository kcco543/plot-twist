/**
 * FEEDBACK-BASED REFINEMENT of a character's behavioral profile.
 * --------------------------------------------------------------------------
 * The player writes feedback on an analysis ("reserved with strangers, but
 * playful with close friends; not timid"). The AI proposes a REVISED profile
 * plus an account of what it changed and why, what it kept, what it wasn't
 * sure about, and anything that contradicts locked canon. Nothing is applied
 * until the player accepts it, and a canon conflict must be resolved first.
 *
 * Every accepted, rejected or restored change is kept as a revision on the
 * character's BehaviorRecord. That record belongs to the active world's
 * character, so refining in one world never touches another world or the
 * Character Library. Dialogue and behavior read approvedBehavior(), i.e. the
 * latest accepted profile.
 *
 * Pure functions (no React, no storage), unit-tested in tests/refine.test.ts.
 */
import { z } from "zod";
import { CHARACTER_TEXT_FIELDS, type BehaviorProfile, type BehaviorRecord } from "../types";
import { BehaviorProfileSchema } from "./schema";

/** Profile sections a change can be about. */
export const PROFILE_SECTIONS = ["summary", "coreTraits", "speech", "emotionalPatterns", "decisionStyle", "socialStyle", "motivations", "boundaries", "dialogueApproaches", "reactionTendencies", "storyHooks"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** What the AI returns (structured output). */
export const RefineOutputSchema = z.object({
  /** How the AI understood the feedback, in one or two sentences (shown to the player). */
  interpretation: z.string(),
  /** Each conclusion that was adjusted. */
  changes: z.array(z.object({ section: z.enum(PROFILE_SECTIONS), before: z.string(), after: z.string(), why: z.string() })),
  /** Conclusions that were checked and kept because the feedback didn't touch them or they're still right. */
  kept: z.array(z.string()),
  /** Parts of the feedback that could be read more than one way, with the reading the proposal used. */
  ambiguities: z.array(z.object({ question: z.string(), interpretation: z.string() })),
  /** Parts of the feedback that contradict a locked canon field. */
  canonConflicts: z.array(z.object({ field: z.enum(CHARACTER_TEXT_FIELDS), canon: z.string(), feedback: z.string(), note: z.string() })),
  profile: BehaviorProfileSchema,
});
export type RefineOutput = z.infer<typeof RefineOutputSchema>;

export type ProfileChange = { section: ProfileSection; before: string; after: string; why: string };

export type AnalysisProposal = {
  id: string;
  at: number;
  feedback: string;
  /** The profile version this proposal was made from (stale if the profile changed since). */
  sourceVersion: number;
  interpretation: string;
  changes: ProfileChange[];
  kept: string[];
  ambiguities: { question: string; interpretation: string }[];
  canonConflicts: { field: string; canon: string; feedback: string; note: string }[];
  /** The player chose to keep locked canon and asked again without the conflicting part. */
  keepCanon: boolean;
  profile: BehaviorProfile;
  source: "ai" | "mock";
};

export type AnalysisRevision = {
  id: string;
  at: number;
  kind: "feedback" | "restore";
  feedback: string;
  previous: BehaviorProfile;
  proposed: BehaviorProfile | null;
  accepted: BehaviorProfile | null;
  status: "accepted" | "rejected";
  /** Profile version the change was made from, and the version it produced (accepted only). */
  sourceVersion: number;
  resultVersion: number | null;
  interpretation?: string;
  changes?: ProfileChange[];
  source?: "ai" | "mock" | "player";
};

/** How many revisions are kept per character (each holds up to three profiles). */
export const REVISION_LIMIT = 12;

export const versionOf = (r: BehaviorRecord) => r.version ?? 1;

/** Can this proposal be accepted as it stands? (canon conflicts must be resolved, ambiguities confirmed, not stale) */
export function acceptBlockers(r: BehaviorRecord, p: AnalysisProposal, confirmedAmbiguities: boolean): ("canon" | "ambiguous" | "stale")[] {
  const out: ("canon" | "ambiguous" | "stale")[] = [];
  if (p.canonConflicts.length && !p.keepCanon) out.push("canon");
  if (p.ambiguities.length && !confirmedAmbiguities) out.push("ambiguous");
  if (p.sourceVersion !== versionOf(r)) out.push("stale");
  return out;
}

const push = (r: BehaviorRecord, rev: AnalysisRevision) => [...(r.revisions ?? []), rev].slice(-REVISION_LIMIT);

export function withProposal(r: BehaviorRecord, p: AnalysisProposal): BehaviorRecord {
  return { ...r, proposal: p };
}

/** Accept: the proposal becomes the active profile (approved: the player reviewed it), version + 1. */
export function acceptProposal(r: BehaviorRecord, confirmedAmbiguities: boolean, now = Date.now()): BehaviorRecord {
  const p = r.proposal;
  if (!p || acceptBlockers(r, p, confirmedAmbiguities).length) return r;
  const v = versionOf(r) + 1;
  return {
    ...r,
    profile: p.profile,
    status: "approved",
    approvedAt: now,
    version: v,
    proposal: null,
    revisions: push(r, { id: p.id, at: now, kind: "feedback", feedback: p.feedback, previous: r.profile, proposed: p.profile, accepted: p.profile, status: "accepted", sourceVersion: p.sourceVersion, resultVersion: v, interpretation: p.interpretation, changes: p.changes, source: p.source }),
  };
}

/** Reject: nothing changes except the history. */
export function rejectProposal(r: BehaviorRecord, now = Date.now()): BehaviorRecord {
  const p = r.proposal;
  if (!p) return r;
  return {
    ...r,
    proposal: null,
    revisions: push(r, { id: p.id, at: now, kind: "feedback", feedback: p.feedback, previous: r.profile, proposed: p.profile, accepted: null, status: "rejected", sourceVersion: p.sourceVersion, resultVersion: null, interpretation: p.interpretation, changes: p.changes, source: p.source }),
  };
}

/**
 * Restore an earlier profile: `which` = the profile before that revision
 * ("previous") or the one it produced ("accepted"). Recorded as a revision
 * itself, so a restore can be undone too.
 */
export function restoreRevision(r: BehaviorRecord, revisionId: string, which: "previous" | "accepted", newId: string, now = Date.now()): BehaviorRecord {
  const rev = r.revisions?.find((x) => x.id === revisionId);
  const target = rev ? (which === "previous" ? rev.previous : rev.accepted) : null;
  if (!rev || !target) return r;
  const v = versionOf(r) + 1;
  return {
    ...r,
    profile: target,
    version: v,
    proposal: null,
    revisions: push(r, { id: newId, at: now, kind: "restore", feedback: "", previous: r.profile, proposed: target, accepted: target, status: "accepted", sourceVersion: versionOf(r), resultVersion: v, source: "player" }),
  };
}

/** "Restore previous version": undo the latest accepted change (feedback or restore). */
export function lastAccepted(r: BehaviorRecord): AnalysisRevision | null {
  return [...(r.revisions ?? [])].reverse().find((x) => x.status === "accepted") ?? null;
}

/** Sections whose content differs between two profiles (validation of the AI's change list, and the "kept" view). */
export function changedSections(a: BehaviorProfile, b: BehaviorProfile): ProfileSection[] {
  return PROFILE_SECTIONS.filter((s) => JSON.stringify(a[s]) !== JSON.stringify(b[s]));
}

/**
 * The AI's change list must match what actually changed: a section that
 * changed but isn't listed is added (with the real before/after), and a
 * listed change to an unchanged section is dropped. So the player always
 * sees every real change.
 */
export function reconcileChanges(before: BehaviorProfile, after: BehaviorProfile, listed: ProfileChange[]): ProfileChange[] {
  const real = new Set(changedSections(before, after));
  const out = listed.filter((c) => real.has(c.section));
  const brief = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 300);
  for (const s of real) if (!out.some((c) => c.section === s)) out.push({ section: s, before: brief(before[s]), after: brief(after[s]), why: "" });
  return out;
}
