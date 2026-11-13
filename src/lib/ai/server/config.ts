import "server-only";

/**
 * AI configuration. Keys are read from server environment variables only
 * (.env.local in development) and never sent to the browser.
 *   ANTHROPIC_API_KEY   personality analysis + story writing (Claude)
 *   OPENAI_API_KEY      pixel character generation (OpenAI image model)
 * Optional: ANTHROPIC_MODEL, OPENAI_IMAGE_MODEL, IMAGE_PROVIDER, AI_DISABLED=1
 */
export const TEXT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
export const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "openai").toLowerCase();

const disabled = () => process.env.AI_DISABLED === "1";

export const textConfigured = () => !disabled() && Boolean(process.env.ANTHROPIC_API_KEY);
export const imageConfigured = () => !disabled() && IMAGE_PROVIDER === "openai" && Boolean(process.env.OPENAI_API_KEY);

export type AiStatus = { text: boolean; image: boolean; textModel: string | null; imageModel: string | null };

export function aiStatus(): AiStatus {
  return {
    text: textConfigured(),
    image: imageConfigured(),
    textModel: textConfigured() ? TEXT_MODEL : null,
    imageModel: imageConfigured() ? IMAGE_MODEL : null,
  };
}
