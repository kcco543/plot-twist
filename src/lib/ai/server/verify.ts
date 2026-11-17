import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { IMAGE_MODEL, IMAGE_PROVIDER, TEXT_MODEL, imageConfigured, textConfigured } from "./config";

/**
 * LIVE KEY CHECK — asks each provider whether the configured key works and
 * the configured model exists, WITHOUT generating anything (a Models API
 * lookup costs nothing). The answer never contains the key itself.
 *
 *   ok             the key was accepted and the model is listed
 *   missing        no key in the server environment
 *   auth           the provider rejected the key
 *   model_missing  the key works but this model isn't available to it
 *   unreachable    the provider couldn't be reached (network, outage)
 */
export type KeyCheck = { service: "anthropic" | "openai"; uses: string; model: string; result: "ok" | "missing" | "auth" | "model_missing" | "unreachable"; detail?: string };

let cache: { at: number; checks: KeyCheck[] } | null = null;
const CACHE_MS = 60_000;

async function checkAnthropic(): Promise<KeyCheck> {
  const base = { service: "anthropic" as const, uses: "dialogue, personality analysis, feedback refinement, photo and gift reactions", model: TEXT_MODEL };
  if (!textConfigured()) return { ...base, result: "missing" };
  try {
    await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 10_000 }).models.retrieve(TEXT_MODEL);
    return { ...base, result: "ok" };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { ...base, result: "auth" };
    if (err instanceof Anthropic.NotFoundError) return { ...base, result: "model_missing" };
    return { ...base, result: "unreachable", detail: err instanceof Anthropic.APIError ? `HTTP ${err.status ?? "?"}` : undefined };
  }
}

async function checkOpenAI(): Promise<KeyCheck> {
  const base = { service: "openai" as const, uses: "pixel character generation, map generation, region edits, gift pictures", model: IMAGE_MODEL };
  if (IMAGE_PROVIDER !== "openai" || !imageConfigured()) return { ...base, result: "missing" };
  try {
    await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 10_000 }).models.retrieve(IMAGE_MODEL);
    return { ...base, result: "ok" };
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return { ...base, result: "auth" };
    if (err instanceof OpenAI.NotFoundError) return { ...base, result: "model_missing" };
    return { ...base, result: "unreachable", detail: err instanceof OpenAI.APIError ? `HTTP ${err.status ?? "?"}` : undefined };
  }
}

export async function verifyKeys(force = false): Promise<KeyCheck[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.checks;
  const checks = await Promise.all([checkAnthropic(), checkOpenAI()]);
  cache = { at: Date.now(), checks };
  return checks;
}
