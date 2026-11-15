import "server-only";

/**
 * Usage limits and cost safeguards for the AI conversation route.
 * --------------------------------------------------------------------------
 * In-memory (per server process), which is right for a single-player game
 * running locally or on one small server. Settings (all optional):
 *   AI_TALK_PER_MINUTE   replies per visitor per minute   (default 12)
 *   AI_TALK_PER_DAY      replies per visitor per day      (default 300)
 *   AI_TALK_DAILY_LIMIT  replies for the whole server/day (default 1500)
 * Each reply is at most two model calls (one retry when a reply breaks the
 * rules), each capped by max_tokens, so these numbers bound the bill.
 */

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

type Bucket = { minute: number[]; day: number[] };
const buckets = new Map<string, Bucket>();
const inFlight = new Set<string>();
let global: number[] = [];

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export type LimitResult = { ok: true; release: () => void } | { ok: false; reason: "busy" | "minute" | "day" | "global"; retryAfter: number };

/** Take one slot for `key` (a visitor). Call release() when the request is done. */
export function takeTalkSlot(key: string, now = Date.now()): LimitResult {
  const perMin = num(process.env.AI_TALK_PER_MINUTE, 12);
  const perDay = num(process.env.AI_TALK_PER_DAY, 300);
  const globalDay = num(process.env.AI_TALK_DAILY_LIMIT, 1500);
  // One reply at a time per visitor: repeated clicks never stack up paid calls.
  if (inFlight.has(key)) return { ok: false, reason: "busy", retryAfter: 2 };
  const b = buckets.get(key) ?? { minute: [], day: [] };
  b.minute = b.minute.filter((t) => now - t < MIN);
  b.day = b.day.filter((t) => now - t < DAY);
  global = global.filter((t) => now - t < DAY);
  if (global.length >= globalDay) return { ok: false, reason: "global", retryAfter: Math.ceil((global[0] + DAY - now) / 1000) };
  if (b.day.length >= perDay) return { ok: false, reason: "day", retryAfter: Math.ceil((b.day[0] + DAY - now) / 1000) };
  if (b.minute.length >= perMin) return { ok: false, reason: "minute", retryAfter: Math.ceil((b.minute[0] + MIN - now) / 1000) };
  b.minute.push(now);
  b.day.push(now);
  global.push(now);
  buckets.set(key, b);
  inFlight.add(key);
  // Keep the map small.
  if (buckets.size > 5000) for (const k of [...buckets.keys()].slice(0, 1000)) buckets.delete(k);
  return { ok: true, release: () => inFlight.delete(key) };
}

/** A rough visitor key: the forwarded client address (or "local"). Never logged or sent anywhere. */
export function visitorKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}

/** For tests. */
export function resetTalkLimits() {
  buckets.clear();
  inFlight.clear();
  global = [];
}
