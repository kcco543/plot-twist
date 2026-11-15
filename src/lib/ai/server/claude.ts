import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { TEXT_MODEL, textConfigured } from "./config";

export class AiError extends Error {
  constructor(
    public code: "not_configured" | "refused" | "invalid_output" | "rate_limited" | "auth" | "failed" | "timeout" | "unsupported" | "billing",
    message: string,
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
function getClient() {
  if (!textConfigured()) throw new AiError("not_configured", "ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  return client;
}

/**
 * One structured call to Claude. The response must match `schema` (structured
 * outputs) or this throws. Server-side refusal fallbacks are on, so a policy
 * decline is retried on a fallback model before we give up.
 */
export async function structuredCall<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  /** Plain text, or content blocks (e.g. an image followed by text). */
  user: string | BetaContentBlockParam[];
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** Per-request limits (defaults: the client's 90 s and 1 retry). */
  timeoutMs?: number;
  maxRetries?: number;
  /** Defaults to ANTHROPIC_MODEL. */
  model?: string;
}): Promise<z.infer<S>> {
  const anthropic = getClient();
  const reqOpts = opts.timeoutMs !== undefined || opts.maxRetries !== undefined ? { timeout: opts.timeoutMs, maxRetries: opts.maxRetries } : undefined;
  try {
    const response = await anthropic.beta.messages.parse({
      model: opts.model ?? TEXT_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    }, reqOpts);
    if (response.stop_reason === "refusal") throw new AiError("refused", "The model declined this request");
    if (response.stop_reason === "max_tokens") throw new AiError("invalid_output", "The response was cut off");
    if (response.parsed_output == null) throw new AiError("invalid_output", "The response did not match the expected format");
    return response.parsed_output as z.infer<S>;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new AiError("auth", "The Anthropic API key was rejected");
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiError("timeout", "The AI took too long to answer");
    if (err instanceof Anthropic.APIError && /credit balance|billing|quota/i.test(err.message)) throw new AiError("billing", "The Anthropic account has no credits left");
    if (err instanceof Anthropic.RateLimitError) throw new AiError("rate_limited", "Rate limited, try again in a moment");
    if (err instanceof Anthropic.APIError) throw new AiError("failed", `Anthropic API error ${err.status ?? ""}`.trim());
    if (err instanceof Anthropic.AnthropicError) throw new AiError("invalid_output", err.message.slice(0, 200));
    throw new AiError("failed", "Could not reach the AI service");
  }
}

export function aiErrorResponse(err: unknown) {
  const e = err instanceof AiError ? err : new AiError("failed", "Unexpected error");
  const status = e.code === "not_configured" || e.code === "unsupported" ? 503 : e.code === "rate_limited" ? 429 : e.code === "billing" ? 402 : e.code === "timeout" ? 504 : e.code === "refused" || e.code === "invalid_output" ? 422 : 502;
  if (!(err instanceof AiError)) console.error("[ai]", err);
  return Response.json({ error: e.code, message: e.message }, { status });
}

/** Per model: does it accept images? Looked up once (Models API), then remembered. */
const imageSupport = new Map<string, Promise<boolean>>();

/**
 * Check that `model` accepts image input before sending a photo. If the
 * Models API can't be reached or doesn't say, we assume yes and let the
 * request itself decide (it fails clearly if images aren't supported).
 */
export async function assertImageInput(model: string): Promise<void> {
  const anthropic = getClient();
  let known = imageSupport.get(model);
  if (!known) {
    known = anthropic.models
      .retrieve(model, {}, { timeout: 8000, maxRetries: 0 })
      .then((m) => m.capabilities?.image_input?.supported !== false)
      .catch(() => {
        imageSupport.delete(model); // try again next time
        return true;
      });
    imageSupport.set(model, known);
  }
  if (!(await known)) throw new AiError("unsupported", `The configured model (${model}) does not accept images`);
}
