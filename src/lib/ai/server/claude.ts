import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { createHash } from "node:crypto";
import { TEXT_MODEL, textConfigured } from "./config";
import { gate, getLimits, record, recordDeduped, type Feature, type Usage } from "./usage";

export class AiError extends Error {
  constructor(
    public code: "not_configured" | "refused" | "invalid_output" | "rate_limited" | "auth" | "failed" | "timeout" | "unsupported" | "billing" | "ai_off" | "budget",
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
function getClient() {
  if (!textConfigured()) throw new AiError("not_configured", "ANTHROPIC_API_KEY is not set");
  // At most one automatic retry (429 / 5xx / network). Routes that retry themselves pass maxRetries: 0.
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  return client;
}

/** Thinking setting per model family, so cheap routes stay cheap and nothing sends a value the model rejects. */
export function thinkingFor(model: string, effort: "low" | "medium" | "high"): { type: "adaptive" } | { type: "disabled" } | { type: "between_tools" } | undefined {
  if (/^claude-haiku-5/.test(model)) return effort === "low" ? { type: "disabled" } : { type: "adaptive" };
  if (/^claude-sonnet-5-5/.test(model)) return { type: "adaptive" };
  return undefined; // Opus 5.5 and others: adaptive by default; effort sets the depth.
}

/** Server-side refusal fallbacks exist for Opus/Sonnet/Fable 5.x, not for Haiku. */
const supportsFallbacks = (model: string) => !/^claude-haiku/.test(model);

// ---------------------------------------------------------------- de-duplication

/** Identical requests share one API call while it runs, and reuse its answer for a few seconds after. */
const inflight = new Map<string, Promise<unknown>>();
const recentResults = new Map<string, { at: number; value: unknown }>();
const REUSE_MS = 20_000;

function requestKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}

/** For tests. */
export function resetDedupe() {
  inflight.clear();
  recentResults.clear();
}

/**
 * One structured call to Claude. The response must match `schema` (structured
 * outputs) or this throws. Server-side refusal fallbacks are on where the
 * model supports them, so a policy decline is retried on a fallback model.
 *
 * Every request passes the usage gate first (mode, budget, per-minute and
 * concurrency limits; see usage.ts) and its token use is recorded after.
 * The stable system prompt (and an optional stable `cachePrefix` at the start
 * of the user turn) is marked for prompt caching.
 */
export async function structuredCall<S extends z.ZodType>(opts: {
  /** Which game feature this is for (usage dashboard, limits, mode). */
  feature: Feature;
  /** Narrows the mode check (e.g. the beat kind for "turn"). */
  detail?: string;
  schema: S;
  system: string;
  /** Plain text, or content blocks (e.g. an image followed by text). */
  user: string | BetaContentBlockParam[];
  /** Stable text placed before `user` and cached (e.g. the character profiles of this conversation). */
  cachePrefix?: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** Per-request limits (defaults: the client's 90 s and 1 retry). */
  timeoutMs?: number;
  maxRetries?: number;
  /** Defaults to ANTHROPIC_MODEL. */
  model?: string;
  /** Reuse an identical answer from the last few seconds (default true). Off for "run again" actions. */
  reuse?: boolean;
}): Promise<z.infer<S>> {
  const model = opts.model ?? TEXT_MODEL;
  const maxTokens = Math.min(opts.maxTokens ?? 8000, getLimits().maxOutputTokens);
  const key = requestKey([opts.feature, model, opts.effort, maxTokens, opts.system, opts.cachePrefix ?? "", opts.user]);
  const reuse = opts.reuse !== false;
  if (reuse) {
    const hit = recentResults.get(key);
    if (hit && Date.now() - hit.at < REUSE_MS) {
      recordDeduped(opts.feature);
      return hit.value as z.infer<S>;
    }
  }
  const running = inflight.get(key);
  if (running) {
    recordDeduped(opts.feature);
    return running as Promise<z.infer<S>>;
  }
  const p = callOnce(opts, model, maxTokens);
  inflight.set(key, p);
  try {
    const value = await p;
    if (reuse) {
      recentResults.set(key, { at: Date.now(), value });
      if (recentResults.size > 200) for (const k of [...recentResults.keys()].slice(0, 50)) recentResults.delete(k);
    }
    return value;
  } finally {
    inflight.delete(key);
  }
}

async function callOnce<S extends z.ZodType>(opts: Parameters<typeof structuredCall<S>>[0], model: string, maxTokens: number): Promise<z.infer<S>> {
  const anthropic = getClient();
  const slot = gate(opts.feature, opts.detail);
  if (!slot.ok) {
    if (slot.reason === "offline" || slot.reason === "mode") throw new AiError("ai_off", slot.reason === "offline" ? "AI is off (Offline mode)" : "This AI feature is off in the current mode");
    if (slot.reason === "budget") throw new AiError("budget", "The development AI budget for this session is used up");
    throw new AiError("rate_limited", slot.reason === "concurrent" ? "Too many AI requests at once" : "Too many AI requests this minute", slot.retryAfter);
  }
  const reqOpts = opts.timeoutMs !== undefined || opts.maxRetries !== undefined ? { timeout: opts.timeoutMs, maxRetries: opts.maxRetries } : undefined;
  const userBlocks: BetaContentBlockParam[] = typeof opts.user === "string" ? [{ type: "text", text: opts.user }] : opts.user;
  const content: BetaContentBlockParam[] = opts.cachePrefix ? [{ type: "text", text: opts.cachePrefix, cache_control: { type: "ephemeral" } }, ...userBlocks] : userBlocks;
  const thinking = thinkingFor(model, opts.effort);
  const started = Date.now();
  let usage: Usage | null = null;
  let servedBy = model;
  try {
    const response = await anthropic.beta.messages.parse(
      {
        model,
        max_tokens: maxTokens,
        ...(supportsFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        ...(thinking ? { thinking } : {}),
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
        output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      },
      reqOpts,
    );
    usage = response.usage;
    servedBy = response.model || model;
    if (response.stop_reason === "refusal") throw new AiError("refused", "The model declined this request");
    if (response.stop_reason === "max_tokens") throw new AiError("invalid_output", "The response was cut off");
    if (response.parsed_output == null) throw new AiError("invalid_output", "The response did not match the expected format");
    meter(opts.feature, servedBy, usage, started, null);
    return response.parsed_output as z.infer<S>;
  } catch (err) {
    const e = toAiError(err);
    meter(opts.feature, servedBy, usage, started, e.code);
    throw e;
  } finally {
    slot.release();
  }
}

function meter(feature: Feature, model: string, u: Usage | null, started: number, error: string | null) {
  record({
    feature,
    model,
    ok: error === null,
    ...(error ? { error } : {}),
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    ms: Date.now() - started,
  });
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiError("auth", "The Anthropic API key was rejected");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", "The AI took too long to answer");
  if (err instanceof Anthropic.APIError && /credit balance|billing|quota/i.test(err.message)) return new AiError("billing", "The Anthropic account has no credits left");
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limited", "Rate limited, try again in a moment");
  if (err instanceof Anthropic.APIError) return new AiError("failed", `Anthropic API error ${err.status ?? ""}`.trim());
  if (err instanceof Anthropic.AnthropicError) return new AiError("invalid_output", err.message.slice(0, 200));
  return new AiError("failed", "Could not reach the AI service");
}

const PUBLIC_MESSAGES: Record<AiError["code"], string> = {
  not_configured: "This AI feature isn't turned on for this site",
  refused: "The AI declined this request",
  invalid_output: "The AI's answer didn't pass the game's checks",
  rate_limited: "Too many requests, try again in a moment",
  auth: "The AI service is unavailable right now",
  failed: "The AI service had a problem",
  timeout: "The AI took too long to answer",
  unsupported: "This AI feature isn't available here",
  billing: "The AI service is unavailable right now",
  ai_off: "This AI feature is switched off right now",
  budget: "Today's AI allowance for this site is used up",
};

export function aiErrorResponse(err: unknown) {
  const e = err instanceof AiError ? err : new AiError("failed", "Unexpected error");
  const status = e.code === "not_configured" || e.code === "unsupported" || e.code === "ai_off" ? 503 : e.code === "rate_limited" || e.code === "budget" ? 429 : e.code === "billing" ? 402 : e.code === "timeout" ? 504 : e.code === "refused" || e.code === "invalid_output" ? 422 : 502;
  if (!(err instanceof AiError)) console.error("[ai]", err instanceof Error ? err.name : "error");
  // Public builds never echo provider details: the browser shows its own message for each code.
  const message = process.env.NODE_ENV === "production" ? PUBLIC_MESSAGES[e.code] : e.message;
  return Response.json({ error: e.code, message }, { status, ...(e.retryAfter ? { headers: { "Retry-After": String(e.retryAfter) } } : {}) });
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
