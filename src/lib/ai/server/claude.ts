import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { TEXT_MODEL, textConfigured } from "./config";

export class AiError extends Error {
  constructor(
    public code: "not_configured" | "refused" | "invalid_output" | "rate_limited" | "auth" | "failed",
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
  user: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const anthropic = getClient();
  try {
    const response = await anthropic.beta.messages.parse({
      model: TEXT_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    });
    if (response.stop_reason === "refusal") throw new AiError("refused", "The model declined this request");
    if (response.stop_reason === "max_tokens") throw new AiError("invalid_output", "The response was cut off");
    if (response.parsed_output == null) throw new AiError("invalid_output", "The response did not match the expected format");
    return response.parsed_output as z.infer<S>;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new AiError("auth", "The Anthropic API key was rejected");
    if (err instanceof Anthropic.RateLimitError) throw new AiError("rate_limited", "Rate limited, try again in a moment");
    if (err instanceof Anthropic.APIError) throw new AiError("failed", `Anthropic API error ${err.status ?? ""}`.trim());
    if (err instanceof Anthropic.AnthropicError) throw new AiError("invalid_output", err.message.slice(0, 200));
    throw new AiError("failed", "Could not reach the AI service");
  }
}

export function aiErrorResponse(err: unknown) {
  const e = err instanceof AiError ? err : new AiError("failed", "Unexpected error");
  const status = e.code === "not_configured" ? 503 : e.code === "rate_limited" ? 429 : e.code === "refused" || e.code === "invalid_output" ? 422 : 502;
  if (!(err instanceof AiError)) console.error("[ai]", err);
  return Response.json({ error: e.code, message: e.message }, { status });
}
