/**
 * INTENT LIFECYCLE — the only allowed status changes. Anything else is
 * refused, so an intent can't, say, complete without ever executing, or run
 * again after it failed.
 */
import { AUTONOMY, emptyAgency, type AgencyState, type Intent, type IntentStatus } from "./types";

export const INTENT_TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  proposed: ["validated", "failed"],
  validated: ["queued", "failed"],
  queued: ["executing", "interrupted", "failed"],
  executing: ["completed", "interrupted", "failed"],
  completed: [],
  interrupted: [],
  failed: [],
};

export const isFinal = (s: IntentStatus) => INTENT_TRANSITIONS[s].length === 0;
export const isActive = (i: Intent) => i.status === "queued" || i.status === "executing";

/** Move an intent to `to`, or return it unchanged if that isn't allowed. */
export function advance(i: Intent, to: IntentStatus, note?: string, now = Date.now()): Intent {
  if (!INTENT_TRANSITIONS[i.status].includes(to)) return i;
  return { ...i, status: to, updatedAt: now, ...(note ? { note } : {}) };
}

export const agencyOf = (a: AgencyState | undefined): AgencyState => a ?? emptyAgency();

/** Replace one intent; finished ones move to the log. */
export function putIntent(a: AgencyState, i: Intent): AgencyState {
  const others = a.intents.filter((x) => x.id !== i.id);
  if (isFinal(i.status)) return { ...a, intents: others, log: [...a.log.filter((x) => x.id !== i.id), i].slice(-AUTONOMY.logLimit) };
  return { ...a, intents: [...others, i] };
}

export const activeOf = (a: AgencyState, actor: string) => a.intents.filter((i) => i.actor === actor && isActive(i));

/** On load: an intent that was executing when the game was saved is queued again (the walk restarts from where they stand). */
export function resumeAfterLoad(a: AgencyState, now = Date.now()): AgencyState {
  return {
    ...a,
    intents: a.intents
      .filter((i) => isActive(i) && now - i.updatedAt < 10 * 60_000)
      .map((i) => (i.status === "executing" ? { ...i, status: "queued" as const, updatedAt: now, note: "resumed" } : i)),
  };
}
