import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { AiMode } from "./config";

/**
 * AI USAGE: modes, limits and the meter behind the development usage dashboard.
 * --------------------------------------------------------------------------
 * Every Claude request goes through structuredCall() (claude.ts), which asks
 * this module for permission first (gate) and reports what it cost afterwards
 * (record). Nothing here ever sees an API key, and no prompt or reply text is
 * stored: only the feature name, model, token counts, timing and an error code.
 *
 * MODES (default "balanced")
 *   offline   no Anthropic requests at all; the game uses its built-in lines.
 *   balanced  AI only for what the player starts: conversations, photo and gift
 *             reactions, personality analysis and refinement, and the wording
 *             of "Talk" and story-event beats. Observe/Wait beats use built-in lines.
 *   full      the AI also words Observe/Wait beats. Same limits and budget.
 * Nothing in any mode calls the AI from timers, movement or the autonomy
 * planner. The one exception is "auto_talk": when two characters agree to a
 * conversation on their own, ONE bounded request writes the whole exchange
 * (autonomy/convoDirector.ts; capped per hour by the observation frequency,
 * per visitor by limits.ts takeAutoTalkSlot, and by this gate). Offline mode
 * uses labelled built-in lines instead.
 *
 * LIMITS (environment variables, or the dashboard in development)
 *   AI_MAX_REQUESTS_PER_MINUTE  Anthropic requests per minute, whole server  (default 20)
 *   AI_MAX_CONCURRENT           Anthropic requests running at once           (default 3)
 *   AI_MAX_OUTPUT_TOKENS        ceiling on max_tokens for any one request    (default 12000)
 *   AI_SESSION_BUDGET_USD       estimated spend allowed per server session   (default 2.00)
 *   AI_MODE                     offline | balanced | full                    (default balanced)
 * When a limit is reached the request is refused before it is sent. The budget
 * is an ESTIMATE kept by this app (one request in flight can go a little over
 * it); it is not a billing cap. Set a real spend limit in the Anthropic Console.
 *
 * In development the dashboard's changes are saved to .plot-twist-ai.json in
 * the project folder (git-ignored) so they survive a restart.
 */

export type Feature = "talk" | "turn" | "analyze" | "refine" | "photo" | "gift_reaction" | "auto_talk";
export const FEATURES: Feature[] = ["talk", "turn", "analyze", "refine", "photo", "gift_reaction", "auto_talk"];
export const MODES: AiMode[] = ["offline", "balanced", "full"];

export type Limits = { perMinute: number; concurrent: number; maxOutputTokens: number; sessionBudgetUsd: number };

/** USD per million tokens. Cache writes (5-minute) cost 1.25× input; reads are listed per model. Update when prices change. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};
/** Unknown model: price it like Opus so the estimate errs high. */
const FALLBACK_PRICE = { input: 5, output: 25, cacheRead: 0.5 };
export const priceFor = (model: string) => PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")] ?? FALLBACK_PRICE;

export type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

export function estimateCost(model: string, u: Usage): number {
  const p = priceFor(model);
  const input = u.input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  return (input * p.input + write * p.input * 1.25 + read * p.cacheRead + (u.output_tokens ?? 0) * p.output) / 1_000_000;
}

// ---------------------------------------------------------------- settings (env + saved dashboard overrides)

const num = (v: unknown, d: number, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n > min ? n : d;
};
const isMode = (m: unknown): m is AiMode => typeof m === "string" && (MODES as string[]).includes(m);

type Saved = { mode?: AiMode; limits?: Partial<Limits> };
const devMode = () => process.env.NODE_ENV !== "production";
const settingsFile = () => process.env.AI_SETTINGS_FILE || path.join(process.cwd(), ".plot-twist-ai.json");

let saved: Saved | null = null;
function loadSaved(): Saved {
  if (saved) return saved;
  saved = {};
  if (devMode() && process.env.VITEST !== "true") {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
      saved = { mode: isMode(raw?.mode) ? raw.mode : undefined, limits: typeof raw?.limits === "object" && raw.limits ? raw.limits : undefined };
    } catch {
      /* no saved settings yet */
    }
  }
  return saved;
}
function persist() {
  if (!devMode() || process.env.VITEST === "true") return;
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(saved ?? {}, null, 2));
  } catch {
    /* read-only folder: keep the setting in memory only */
  }
}

export function getMode(): AiMode {
  const s = loadSaved();
  if (s.mode) return s.mode;
  return isMode(process.env.AI_MODE) ? process.env.AI_MODE : "balanced";
}

export function setMode(mode: AiMode) {
  if (!isMode(mode)) throw new Error("bad mode");
  saved = { ...loadSaved(), mode };
  persist();
}

export function getLimits(): Limits {
  const o = loadSaved().limits ?? {};
  return {
    perMinute: Math.floor(num(o.perMinute, num(process.env.AI_MAX_REQUESTS_PER_MINUTE, 20))),
    concurrent: Math.floor(num(o.concurrent, num(process.env.AI_MAX_CONCURRENT, 3))),
    maxOutputTokens: Math.floor(num(o.maxOutputTokens, num(process.env.AI_MAX_OUTPUT_TOKENS, 12000))),
    sessionBudgetUsd: num(o.sessionBudgetUsd, num(process.env.AI_SESSION_BUDGET_USD, 2)),
  };
}

export function setLimits(patch: Partial<Limits>) {
  const cur = loadSaved().limits ?? {};
  const next: Partial<Limits> = { ...cur };
  if (patch.perMinute !== undefined) next.perMinute = Math.max(1, Math.min(600, Math.floor(num(patch.perMinute, 20))));
  if (patch.concurrent !== undefined) next.concurrent = Math.max(1, Math.min(20, Math.floor(num(patch.concurrent, 3))));
  if (patch.maxOutputTokens !== undefined) next.maxOutputTokens = Math.max(256, Math.min(64000, Math.floor(num(patch.maxOutputTokens, 12000))));
  if (patch.sessionBudgetUsd !== undefined) next.sessionBudgetUsd = Math.max(0.0001, Math.min(1000, num(patch.sessionBudgetUsd, 2)));
  saved = { ...loadSaved(), limits: next };
  persist();
}

/** Is this feature allowed in the current mode? `detail` narrows "turn" by beat kind. */
export function featureAllowed(feature: Feature, mode: AiMode = getMode(), detail?: string): boolean {
  if (mode === "offline") return false;
  if (mode === "full") return true;
  // Balanced: everything the player starts on purpose, except wording routine Observe/Wait beats.
  if (feature === "turn") return detail !== "observe" && detail !== "wait";
  return true;
}

// ---------------------------------------------------------------- the meter

export type RequestRecord = {
  at: number;
  feature: Feature;
  model: string;
  ok: boolean;
  /** Error code only (never a message that could contain user text). */
  error?: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  ms: number;
};

export type FeatureTotals = {
  requests: number;
  ok: number;
  failed: number;
  blocked: number;
  deduped: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  ms: number;
  models: string[];
};

const emptyTotals = (): FeatureTotals => ({ requests: 0, ok: 0, failed: 0, blocked: 0, deduped: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0, ms: 0, models: [] });

const RECENT_MAX = 200;
let state = {
  startedAt: Date.now(),
  recent: [] as RequestRecord[],
  totals: Object.fromEntries(FEATURES.map((f) => [f, emptyTotals()])) as Record<Feature, FeatureTotals>,
  blockedReasons: {} as Record<string, number>,
  minute: [] as number[],
  inFlight: 0,
};

export function spentUsd() {
  return FEATURES.reduce((s, f) => s + state.totals[f].costUsd, 0);
}

export type GateBlock = { reason: "offline" | "mode" | "budget" | "per_minute" | "concurrent"; retryAfter: number };

/**
 * Take a slot for one Anthropic request. Returns a release function, or why
 * the request is refused (nothing is sent in that case).
 */
export function gate(feature: Feature, detail?: string, now = Date.now()): { ok: true; release: () => void } | ({ ok: false } & GateBlock) {
  const mode = getMode();
  const limits = getLimits();
  const block = (b: GateBlock) => {
    state.totals[feature].blocked++;
    state.blockedReasons[b.reason] = (state.blockedReasons[b.reason] ?? 0) + 1;
    return { ok: false as const, ...b };
  };
  if (mode === "offline") return block({ reason: "offline", retryAfter: 0 });
  if (!featureAllowed(feature, mode, detail)) return block({ reason: "mode", retryAfter: 0 });
  if (spentUsd() >= limits.sessionBudgetUsd) return block({ reason: "budget", retryAfter: 0 });
  state.minute = state.minute.filter((t) => now - t < 60_000);
  if (state.minute.length >= limits.perMinute) return block({ reason: "per_minute", retryAfter: Math.max(1, Math.ceil((state.minute[0] + 60_000 - now) / 1000)) });
  if (state.inFlight >= limits.concurrent) return block({ reason: "concurrent", retryAfter: 2 });
  state.minute.push(now);
  state.inFlight++;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      state.inFlight = Math.max(0, state.inFlight - 1);
    },
  };
}

export function record(r: Omit<RequestRecord, "costUsd" | "at"> & { at?: number; costUsd?: number }) {
  const costUsd = r.costUsd ?? estimateCost(r.model, { input_tokens: r.inputTokens, output_tokens: r.outputTokens, cache_creation_input_tokens: r.cacheWriteTokens, cache_read_input_tokens: r.cacheReadTokens });
  const rec: RequestRecord = { ...r, at: r.at ?? Date.now(), costUsd };
  state.recent = [rec, ...state.recent].slice(0, RECENT_MAX);
  const t = state.totals[r.feature];
  t.requests++;
  if (r.ok) t.ok++;
  else t.failed++;
  t.inputTokens += r.inputTokens;
  t.outputTokens += r.outputTokens;
  t.cacheWriteTokens += r.cacheWriteTokens;
  t.cacheReadTokens += r.cacheReadTokens;
  t.costUsd += costUsd;
  t.ms += r.ms;
  if (!t.models.includes(r.model)) t.models.push(r.model);
  if (devMode() && process.env.AI_USAGE_LOG === "1") {
    // Numbers only: never keys, prompts or replies.
    console.info(`[ai-usage] ${rec.feature} ${rec.model} ${rec.ok ? "ok" : `failed:${rec.error}`} in=${rec.inputTokens} out=${rec.outputTokens} cacheW=${rec.cacheWriteTokens} cacheR=${rec.cacheReadTokens} $${rec.costUsd.toFixed(5)} ${rec.ms}ms`);
  }
}

/** An identical request was answered from one already running or just finished: no new API call. */
export function recordDeduped(feature: Feature) {
  state.totals[feature].deduped++;
}

export function snapshot() {
  const limits = getLimits();
  const spent = spentUsd();
  const now = Date.now();
  return {
    mode: getMode(),
    limits,
    startedAt: state.startedAt,
    spentUsd: spent,
    budgetLeftUsd: Math.max(0, limits.sessionBudgetUsd - spent),
    requestsLastMinute: state.minute.filter((t) => now - t < 60_000).length,
    inFlight: state.inFlight,
    totals: state.totals,
    blockedReasons: state.blockedReasons,
    recent: state.recent.slice(0, 50),
    prices: PRICES,
  };
}

/** Start a new development session: clears the meter and the budget count (not the mode or limits). */
export function resetUsage() {
  state = {
    startedAt: Date.now(),
    recent: [],
    totals: Object.fromEntries(FEATURES.map((f) => [f, emptyTotals()])) as Record<Feature, FeatureTotals>,
    blockedReasons: {},
    minute: [],
    inFlight: state.inFlight,
  };
}

/** For tests. */
export function resetUsageForTests() {
  resetUsage();
  state.inFlight = 0;
  saved = {};
}

/** The dashboard and its API exist in development only (or when explicitly enabled). */
export const dashboardEnabled = () => devMode() || process.env.AI_USAGE_DASHBOARD === "1";
