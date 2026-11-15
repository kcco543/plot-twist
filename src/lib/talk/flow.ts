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

export const TALK_PHASES = ["SELECT_TARGET", "MOVE_TO_TARGET", "FACE_TARGET", "SHOW_OPTIONS", "SPEAK", "WAIT_FOR_RESPONSE", "CONTINUE_OR_EXIT"] as const;
export type TalkPhase = (typeof TALK_PHASES)[number];

export const TALK_TRANSITIONS: Record<TalkPhase, readonly TalkPhase[]> = {
  SELECT_TARGET: ["MOVE_TO_TARGET"],
  MOVE_TO_TARGET: ["FACE_TARGET"],
  FACE_TARGET: ["SHOW_OPTIONS"],
  SHOW_OPTIONS: ["SPEAK"],
  SPEAK: ["WAIT_FOR_RESPONSE"],
  WAIT_FOR_RESPONSE: ["CONTINUE_OR_EXIT"],
  CONTINUE_OR_EXIT: ["SPEAK"],
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
  /** What the last custom message was waiting on (no AI reply service yet). */
  customPending: boolean;
};

export function newSession(id: number, actorId: string, via: TalkSession["via"]): TalkSession {
  return { id, phase: "SELECT_TARGET", actorId, targetId: null, via, round: 0, topics: [], offered: [], composing: false, draft: "", customPending: false };
}

/** Move to `to` if allowed; otherwise the session is returned unchanged. */
export function goTo(s: TalkSession, to: TalkPhase, patch: Partial<TalkSession> = {}): TalkSession {
  if (s.phase === to || !canTalkTransition(s.phase, to)) return s;
  return { ...s, ...patch, phase: to };
}

/** Feedback shown when a conversation could not start or had to stop. */
export const TALK_NOTICES = ["unreachable", "blocked", "noRoom", "busy", "targetLeft", "lostTarget", "tooLong", "cancelled", "emptySpace", "ended"] as const;
export type TalkNoticeKind = (typeof TALK_NOTICES)[number];
export type TalkNotice = { kind: TalkNoticeKind; actor: string; target: string; at: number };
