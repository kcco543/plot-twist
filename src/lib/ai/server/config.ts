import "server-only";

/**
 * AI configuration. Keys are read from server environment variables only
 * (.env.local in development) and never sent to the browser.
 *   ANTHROPIC_API_KEY   personality analysis + story writing (Claude)
 *   OPENAI_API_KEY      pixel character + map generation (OpenAI image model)
 * Optional: ANTHROPIC_MODEL, OPENAI_IMAGE_MODEL, IMAGE_PROVIDER, AI_DISABLED=1
 * Conversations (/api/ai/talk): ANTHROPIC_TALK_MODEL (defaults to ANTHROPIC_MODEL),
 *   usage limits in limits.ts, and AI_TALK_MOCK=1 for TEST replies in development only.
 */
export const TEXT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const TALK_MODEL = process.env.ANTHROPIC_TALK_MODEL || TEXT_MODEL;
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
export const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "openai").toLowerCase();

const disabled = () => process.env.AI_DISABLED === "1";

export const textConfigured = () => !disabled() && Boolean(process.env.ANTHROPIC_API_KEY);
export const imageConfigured = () => !disabled() && IMAGE_PROVIDER === "openai" && Boolean(process.env.OPENAI_API_KEY);

/** Developer test double for conversations: never in production, never labelled as AI. */
export const talkMock = () => process.env.AI_TALK_MOCK === "1" && process.env.NODE_ENV !== "production";

export type AiStatus = { text: boolean; image: boolean; textModel: string | null; imageModel: string | null; talk: "ai" | "mock" | null };

export function aiStatus(): AiStatus {
  return {
    text: textConfigured(),
    image: imageConfigured(),
    textModel: textConfigured() ? TEXT_MODEL : null,
    imageModel: imageConfigured() ? IMAGE_MODEL : null,
    talk: textConfigured() ? "ai" : talkMock() ? "mock" : null,
  };
}
