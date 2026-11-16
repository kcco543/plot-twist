import "server-only";

/**
 * AI configuration. Keys are read from server environment variables only
 * (.env.local in development) and never sent to the browser.
 *   ANTHROPIC_API_KEY   dialogue, story wording, personality analysis (Claude)
 *   OPENAI_API_KEY      pixel character + map generation (OpenAI image model)
 * Optional: OPENAI_IMAGE_MODEL, IMAGE_PROVIDER, AI_DISABLED=1, AI_TALK_MOCK=1
 * (TEST replies in development only).
 *
 * Which Claude model each feature uses (cheapest that does the job well):
 *   ANTHROPIC_MODEL        personality analysis + feedback refinement (rare, complex)  default claude-opus-5-5
 *   ANTHROPIC_TALK_MODEL   conversations, photo and gift reactions (frequent)          default claude-sonnet-5-5
 *   ANTHROPIC_STORY_MODEL  wording of story beats the engine already decided           default claude-haiku-5-5
 * Usage modes, limits and the usage dashboard: see usage.ts.
 */
export const TEXT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const TALK_MODEL = process.env.ANTHROPIC_TALK_MODEL || "claude-sonnet-5-5";
export const STORY_MODEL = process.env.ANTHROPIC_STORY_MODEL || "claude-haiku-5-5";
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
export const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "openai").toLowerCase();

const disabled = () => process.env.AI_DISABLED === "1";

export const textConfigured = () => !disabled() && Boolean(process.env.ANTHROPIC_API_KEY);
export const imageConfigured = () => !disabled() && IMAGE_PROVIDER === "openai" && Boolean(process.env.OPENAI_API_KEY);

/** Developer test double for conversations: never in production, never labelled as AI. */
export const talkMock = () => process.env.AI_TALK_MOCK === "1" && process.env.NODE_ENV !== "production";

export type AiMode = "offline" | "balanced" | "full";
export type AiStatus = { text: boolean; image: boolean; textModel: string | null; imageModel: string | null; talk: "ai" | "mock" | null; mode: AiMode };

/** `mode` comes from usage.ts (passed in to keep this file free of state). Offline turns every Claude feature off. */
export function aiStatus(mode: AiMode = "balanced"): AiStatus {
  const text = textConfigured() && mode !== "offline";
  return {
    text,
    image: imageConfigured(),
    textModel: text ? TALK_MODEL : null,
    imageModel: imageConfigured() ? IMAGE_MODEL : null,
    talk: text ? "ai" : mode !== "offline" && talkMock() ? "mock" : null,
    mode,
  };
}
