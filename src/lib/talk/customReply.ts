/**
 * "ASK SOMETHING ELSE" — the player's own words.
 * --------------------------------------------------------------------------
 * The player can type anything (English, Chinese, emoji…). The speaking
 * character says it in their speech bubble, and with AI conversations on the
 * listener answers it in character (src/lib/talk/ai). With AI off, the game
 * says plainly that nobody can answer typed messages yet: it never invents a
 * scripted reply and calls it AI.
 */

/** Longest message the composer accepts (characters). */
export const CUSTOM_MAX = 200;

/** Clean what was typed: trim, collapse runs of blank lines, cap the length (by characters, so emoji/中文 aren't cut in half). Empty = nothing to send. */
export function cleanMessage(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return Array.from(text).slice(0, CUSTOM_MAX).join("").trim();
}
