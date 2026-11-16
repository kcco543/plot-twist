/**
 * AI cost controls: per-feature models, prompt caching, usage modes, limits,
 * the session budget, de-duplication and the usage meter. The Anthropic SDK
 * is mocked: these tests never make a real (paid) request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", async (orig) => {
  const real = await orig<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends real.default {
    constructor(o: ConstructorParameters<typeof real.default>[0]) {
      super(o);
      (this as unknown as { beta: unknown }).beta = { messages: { parse } };
    }
  }
  return { ...real, default: FakeAnthropic };
});

import { AiError, resetDedupe, structuredCall } from "@/lib/ai/server/claude";
import { estimateCost, featureAllowed, gate, getMode, resetUsageForTests, setLimits, setMode, snapshot } from "@/lib/ai/server/usage";
import { resetTalkLimits } from "@/lib/ai/server/limits";
import { POST as talkRoute } from "@/app/api/ai/talk/route";
import { GET as usageGet, POST as usagePost } from "@/app/api/dev/usage/route";
import { buildTalkRequest } from "@/lib/talk/ai/request";
import { sampleCharacter } from "@/lib/mind/scenarios";
import { emptyStory } from "@/lib/story/engine";

const Schema = z.object({ answer: z.string() });
const ok = (over: Record<string, unknown> = {}) => ({
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  parsed_output: { answer: "hi" },
  usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ...over,
});
const call = (over: Partial<Parameters<typeof structuredCall>[0]> = {}) =>
  structuredCall({ feature: "talk", schema: Schema, system: "SYSTEM", user: "hello", effort: "low", model: "claude-sonnet-5-5", maxTokens: 3000, ...over });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-test-secret";
  parse.mockReset();
  resetUsageForTests();
  resetDedupe();
  resetTalkLimits();
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  vi.unstubAllEnvs();
});

describe("models, caching and output limits", () => {
  it("talk: Sonnet, cached system prompt and profile prefix, refusal fallback, capped output", async () => {
    parse.mockResolvedValueOnce(ok());
    await call({ cachePrefix: "PROFILES" });
    const body = parse.mock.calls[0][0];
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.system).toEqual([{ type: "text", text: "SYSTEM", cache_control: { type: "ephemeral" } }]);
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "PROFILES", cache_control: { type: "ephemeral" } });
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: "hello" });
    expect(body.fallbacks).toBe("default");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.max_tokens).toBe(3000);
    expect(body.output_config.effort).toBe("low");
  });

  it("story beats: Haiku with thinking off and no fallback parameter (Haiku has none)", async () => {
    parse.mockResolvedValueOnce(ok({ model: "claude-haiku-5-5" }));
    await call({ feature: "turn", detail: "talk", model: "claude-haiku-5-5", maxTokens: 1500 });
    const body = parse.mock.calls[0][0];
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.fallbacks).toBeUndefined();
    expect(body.betas).toBeUndefined();
  });

  it("analysis: Opus keeps adaptive thinking (no thinking field) at the requested effort", async () => {
    parse.mockResolvedValueOnce(ok({ model: "claude-opus-5-5" }));
    await call({ feature: "analyze", model: "claude-opus-5-5", effort: "medium", maxTokens: 12000, reuse: false });
    const body = parse.mock.calls[0][0];
    expect(body.thinking).toBeUndefined();
    expect(body.output_config.effort).toBe("medium");
  });

  it("clamps max_tokens to the configured ceiling", async () => {
    setLimits({ maxOutputTokens: 1000 });
    parse.mockResolvedValueOnce(ok());
    await call({ maxTokens: 12000 });
    expect(parse.mock.calls[0][0].max_tokens).toBe(1000);
  });
});

describe("usage meter", () => {
  it("records tokens, cache use, model, timing and estimated cost per feature, never text", async () => {
    parse.mockResolvedValueOnce(ok({ usage: { input_tokens: 800, output_tokens: 250, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 } }));
    parse.mockResolvedValueOnce(ok({ usage: { input_tokens: 820, output_tokens: 240, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 } }));
    await call({ user: "first" });
    await call({ user: "second" });
    const s = snapshot();
    const t = s.totals.talk;
    expect(t).toMatchObject({ requests: 2, ok: 2, failed: 0, inputTokens: 1620, outputTokens: 490, cacheWriteTokens: 2000, cacheReadTokens: 2000, models: ["claude-sonnet-5-5"] });
    // $2/M input, $10/M output, writes 1.25× input, reads $0.10/M.
    const expected = (1620 * 2 + 2000 * 2.5 + 2000 * 0.1 + 490 * 10) / 1e6;
    expect(t.costUsd).toBeCloseTo(expected, 8);
    expect(s.spentUsd).toBeCloseTo(expected, 8);
    expect(JSON.stringify(s)).not.toMatch(/first|second|sk-test-secret|SYSTEM/);
  });

  it("records failures with an error code", async () => {
    parse.mockResolvedValueOnce(ok({ stop_reason: "max_tokens", parsed_output: null }));
    await expect(call()).rejects.toMatchObject({ code: "invalid_output" });
    expect(snapshot().totals.talk).toMatchObject({ requests: 1, ok: 0, failed: 1 });
    expect(snapshot().recent[0]).toMatchObject({ ok: false, error: "invalid_output", outputTokens: 200 });
  });

  it("prices Haiku far below Opus for the same tokens", () => {
    const u = { input_tokens: 3000, output_tokens: 300 };
    expect(estimateCost("claude-haiku-5-5", u)).toBeLessThan(estimateCost("claude-opus-5-5", u) / 30);
    // Unknown models are priced high, never as free.
    expect(estimateCost("some-new-model", u)).toBeGreaterThan(0);
  });
});

describe("AI modes", () => {
  it("defaults to Balanced", () => {
    expect(getMode()).toBe("balanced");
  });

  it("Offline: nothing is sent", async () => {
    setMode("offline");
    await expect(call()).rejects.toMatchObject({ code: "ai_off" });
    expect(parse).not.toHaveBeenCalled();
    expect(snapshot().totals.talk.blocked).toBe(1);
  });

  it("Balanced: Observe/Wait beats use built-in lines; Talk and events may use AI; Full allows all", async () => {
    expect(featureAllowed("turn", "balanced", "observe")).toBe(false);
    expect(featureAllowed("turn", "balanced", "wait")).toBe(false);
    expect(featureAllowed("turn", "balanced", "talk")).toBe(true);
    expect(featureAllowed("turn", "balanced", "event")).toBe(true);
    expect(featureAllowed("turn", "full", "observe")).toBe(true);
    expect(featureAllowed("talk", "offline")).toBe(false);
    await expect(call({ feature: "turn", detail: "observe" })).rejects.toMatchObject({ code: "ai_off" });
    expect(parse).not.toHaveBeenCalled();
    setMode("full");
    parse.mockResolvedValueOnce(ok());
    await call({ feature: "turn", detail: "observe" });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("Offline mode switches the conversation route off before any request", async () => {
    setMode("offline");
    const req = buildTalkRequest({
      story: { ...emptyStory(), turn: 3, relations: {}, decisions: [] },
      speaker: sampleCharacter("tobi", "en"),
      listener: sampleCharacter("mira", "en"),
      locale: "en",
      world: "otherworld",
      place: "street",
      placeDescription: "",
      message: "Nice day.",
      kind: "typed",
      topic: null,
      decision: null,
      recentEvents: [],
      usedTopics: [],
    });
    const res = await talkRoute(new Request("http://x/api/ai/talk", { method: "POST", body: JSON.stringify(req) }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("ai_off");
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("limits and budget", () => {
  it("refuses once the per-minute limit is reached", async () => {
    setLimits({ perMinute: 2 });
    parse.mockResolvedValue(ok());
    await call({ user: "a" });
    await call({ user: "b" });
    const err = (await call({ user: "c" }).catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfter).toBeGreaterThan(0);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("refuses more simultaneous requests than allowed", async () => {
    setLimits({ concurrent: 1 });
    let finish!: (v: unknown) => void;
    parse.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const first = call({ user: "slow" });
    await expect(call({ user: "other" })).rejects.toMatchObject({ code: "rate_limited" });
    finish(ok());
    await first;
    expect(parse).toHaveBeenCalledTimes(1);
    // The slot is released after the call.
    expect(gate("talk").ok).toBe(true);
  });

  it("stops at the session budget and says so", async () => {
    setLimits({ sessionBudgetUsd: 0.01 });
    // One expensive Opus reply: 2,000 output tokens at $20/M = $0.04.
    parse.mockResolvedValueOnce(ok({ model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 2000 } }));
    await call({ model: "claude-opus-5-5", user: "x" });
    await expect(call({ user: "y" })).rejects.toMatchObject({ code: "budget" });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(snapshot().blockedReasons.budget).toBe(1);
  });
});

describe("de-duplication", () => {
  it("identical requests in flight share one API call", async () => {
    let finish!: (v: unknown) => void;
    parse.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const a = call({ user: "same" });
    const b = call({ user: "same" });
    finish(ok());
    expect(await a).toEqual(await b);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(snapshot().totals.talk.deduped).toBe(1);
  });

  it("a repeated identical request reuses the answer briefly; 'run again' features always ask again", async () => {
    parse.mockResolvedValue(ok());
    await call({ user: "again" });
    await call({ user: "again" });
    expect(parse).toHaveBeenCalledTimes(1);
    await call({ feature: "analyze", user: "again", reuse: false });
    await call({ feature: "analyze", user: "again", reuse: false });
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("failures are not reused (Try again really tries again)", async () => {
    parse.mockResolvedValueOnce(ok({ stop_reason: "refusal" })).mockResolvedValueOnce(ok());
    await expect(call({ user: "retry me" })).rejects.toMatchObject({ code: "refused" });
    await expect(call({ user: "retry me" })).resolves.toEqual({ answer: "hi" });
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

describe("usage dashboard API", () => {
  it("reports numbers and models only, and changes mode and limits", async () => {
    const res = await usageGet();
    const data = await res.json();
    expect(data.mode).toBe("balanced");
    expect(data.models).toMatchObject({ talk: "claude-sonnet-5-5", turn: "claude-haiku-5-5", analyze: "claude-opus-5-5" });
    expect(JSON.stringify(data)).not.toContain("sk-test-secret");
    const post = (b: unknown) => usagePost(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
    expect((await (await post({ mode: "offline", limits: { sessionBudgetUsd: 0.5 } })).json()).mode).toBe("offline");
    expect(snapshot().limits.sessionBudgetUsd).toBe(0.5);
    expect((await post({ mode: "turbo" })).status).toBe(400);
  });

  it("does not exist in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await usageGet()).status).toBe(404);
  });
});

describe("no AI from background game code", () => {
  // Movement, pathfinding, autonomy, emotions, relationships and the behavior engine run every
  // tick or on timers. None of them may import the AI client or call an API route.
  const dirs = ["src/lib/autonomy", "src/lib/stage", "src/lib/mind", "src/lib/behavior", "src/lib/story"];
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = path.join(d, f);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const files = dirs.flatMap(walk);
  it.each(files)("%s", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/@\/lib\/ai\/client|\/api\/ai\/|@anthropic-ai|fetch\(/);
  });
});
