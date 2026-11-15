/**
 * "ASK SOMETHING ELSE" — the player's own words, and the slot for a future AI reply.
 * --------------------------------------------------------------------------
 * The player can type anything (English, Chinese, emoji…). The speaking
 * character says it in their speech bubble. A real answer needs an AI that
 * reads the message, which is the NEXT development stage, so for now
 * requestCustomReply() always answers "unavailable" and the game says so
 * plainly. It never invents a scripted reply and calls it AI.
 *
 * Next stage: implement requestCustomReply() with a server route (like
 * src/app/api/ai/turn) that takes a CustomReplyRequest and returns lines for
 * the listener, then set CUSTOM_REPLIES_AVAILABLE from the AI status.
 */
import type { Emotion } from "../emotion/emotions";
import type { EnvironmentTypeId, Relation, WorldId } from "../types";

/** Longest message the composer accepts (characters). */
export const CUSTOM_MAX = 200;

/** Turn on when the AI reply service exists. */
export const CUSTOM_REPLIES_AVAILABLE = false;

export type CustomReplyRequest = {
  locale: string;
  world: WorldId;
  place: EnvironmentTypeId;
  speaker: { id: string; name: string };
  listener: { id: string; name: string };
  /** Exactly what the player typed (trimmed). */
  message: string;
  /** How the listener feels about the speaker, and what their face shows. */
  relation: Relation;
  listenerEmotion: Emotion;
  /** The last few lines of the conversation, for context. */
  recentLines: string[];
};

export type CustomReplyResult =
  | { status: "unavailable"; reason: "not_implemented" | "offline" }
  | { status: "ok"; lines: { speakerId: string; text: string }[]; source: "ai" };

export async function requestCustomReply(req: CustomReplyRequest): Promise<CustomReplyResult> {
  void req;
  return { status: "unavailable", reason: "not_implemented" };
}

/** Clean what was typed: trim, collapse runs of blank lines, cap the length (by characters, so emoji/中文 aren't cut in half). Empty = nothing to send. */
export function cleanMessage(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return Array.from(text).slice(0, CUSTOM_MAX).join("").trim();
}
