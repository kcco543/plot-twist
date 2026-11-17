/**
 * CONVERSATION FLOW — one walk-and-talk conversation at a time.
 * --------------------------------------------------------------------------
 *   SELECT_TARGET → MOVE_TO_TARGET → FACE_TARGET → SHOW_OPTIONS → SPEAK
 *     → WAIT_FOR_RESPONSE → CONTINUE_OR_EXIT → (SPEAK again, or exit)
 *
 * Pure data: the play screen (src/lib/talk/useTalk.ts) drives it from the
 * stage simulation and the dialogue queue. Any phase may exit (cancel, end,
 * walk failed), which simply drops the session. Every other change must be
 * listed in TALK_TRANSITIONS, so two things can never happen at once
 * (no second topic while a reply is still playing, no options while walking).
 */
import type { TopicChoice } from "./topics";
import type { TalkSuggestion } from "./ai/contract";
import type { TalkErrorCode } from "./ai/request";

export const TALK_PHASES = ["SELECT_TARGET", "MOVE_TO_TARGET", "FACE_TARGET", "SHOW_OPTIONS", "SPEAK", "WAIT_FOR_RESPONSE", "CONTINUE_OR_EXIT"] as const;
export type TalkPhase = (typeof TALK_PHASES)[number];

export const TALK_TRANSITIONS: Record<TalkPhase, readonly TalkPhase[]> = {
  SELECT_TARGET: ["MOVE_TO_TARGET"],
  MOVE_TO_TARGET: ["FACE_TARGET"],
  FACE_TARGET: ["SHOW_OPTIONS"],
  SHOW_OPTIONS: ["SPEAK"],
  SPEAK: ["WAIT_FOR_RESPONSE"],
  WAIT_FOR_RESPONSE: ["CONTINUE_OR_EXIT"],
  // WAIT_FOR_RESPONSE again = "Try again" after an AI reply failed.
  CONTINUE_OR_EXIT: ["SPEAK", "WAIT_FOR_RESPONSE"],
};
export const canTalkTransition = (from: TalkPhase, to: TalkPhase) => TALK_TRANSITIONS[from].includes(to);

/** Phases in which the two characters are standing together, talking. */
export const TALKING_PHASES: readonly TalkPhase[] = ["FACE_TARGET", "SHOW_OPTIONS", "SPEAK", "WAIT_FOR_RESPONSE", "CONTINUE_OR_EXIT"];
/** Phases in which the player can pick what to say. */
export const CHOOSING_PHASES: readonly TalkPhase[] = ["SHOW_OPTIONS", "CONTINUE_OR_EXIT"];

export type TalkSession = {
  /** Changes for every new conversation (stale timers check it). */
  id: number;
  phase: TalkPhase;
  actorId: string;
  /** null while still choosing who to talk to. */
  targetId: string | null;
  /** How the conversation was started (drag on the stage, or tap / list). */
  via: "drag" | "tap";
  /** How many things have been said so far. */
  round: number;
  topics: TopicChoice[];
  /** Topics already offered or used in this conversation (so the next set differs). */
  offered: string[];
  /** The "Ask something else" composer. The draft survives closing it until it is sent. */
  composing: boolean;
  draft: string;
  /** The last typed message got no reply because AI conversations aren't connected. */
  customPending: boolean;
  /** AI-written next lines for the speaker (shown before the rule-based topics). */
  aiTopics: TalkSuggestion[];
  /** The last AI reply failed (shown with the reason; typed messages can be retried). */
  aiError: TalkErrorCode | null;
  /** Whether the last failed reply can be retried. */
  canRetry: boolean;
  /** Where the listener's last reply came from. */
  replySource: "ai" | "mock" | "builtin" | null;
};

export function newSession(id: number, actorId: string, via: TalkSession["via"]): TalkSession {
  return { id, phase: "SELECT_TARGET", actorId, targetId: null, via, round: 0, topics: [], offered: [], composing: false, draft: "", customPending: false, aiTopics: [], aiError: null, canRetry: false, replySource: null };
}

/** Move to `to` if allowed; otherwise the session is returned unchanged. */
export function goTo(s: TalkSession, to: TalkPhase, patch: Partial<TalkSession> = {}): TalkSession {
  if (s.phase === to || !canTalkTransition(s.phase, to)) return s;
  return { ...s, ...patch, phase: to };
}

/** Feedback shown when a conversation could not start or had to stop. */
export const TALK_NOTICES = ["unreachable", "blocked", "noRoom", "busy", "targetLeft", "lostTarget", "tooLong", "cancelled", "emptySpace", "ended", "listenerEnded", "unreachablePlace", "unreachableObject", "nearby", "refused", "walkedAway", "goingTo", "noSuchPlace", "inviteAccepted", "inviteDeclined"] as const;
export type TalkNoticeKind = (typeof TALK_NOTICES)[number];
export type TalkNotice = { kind: TalkNoticeKind; actor: string; target: string; at: number };
