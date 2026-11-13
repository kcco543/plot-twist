/**
 * FUTURE AI STORY GENERATION — request shape only (nothing calls an AI yet).
 * Any generated dialogue, events or narration must be produced in
 * `locale`, the player's selected interface language. User-written
 * character fields are passed through untouched and must never be
 * translated or rewritten unless the player explicitly asks.
 */
import type { Locale } from "@/i18n";
import type { Character, EnvironmentDraft, LogEntry, WorldId } from "../types";

export type StoryGenerationRequest = {
  locale: Locale;
  worldId: WorldId;
  environment: EnvironmentDraft;
  characters: Character[];
  /** Recent story log, oldest first. */
  history: LogEntry[];
  action: "talk" | "observe" | "wait";
  targetCharacterId: string;
};
