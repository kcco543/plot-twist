import "server-only";

/**
 * PUBLIC BETA DAILY AI ALLOWANCES (server-side, never trusted to the browser)
 * --------------------------------------------------------------------------
 * Every paid AI request takes "units" from several daily buckets at once:
 *   - this tester (from their beta pass; the network address when there is none)
 *   - this network address (so clearing cookies doesn't buy a fresh allowance)
 *   - the whole site
 * If ANY bucket would go over, nothing is taken and the request is refused
 * before the AI provider is contacted. Buckets reset at midnight UTC.
 *
 * Where the counts live:
 *   - Supabase (durable, shared by every server instance) when SUPABASE_SECRET_KEY
 *     (or SUPABASE_SERVICE_ROLE_KEY) and the project URL are set. Uses the
 *     pt_take_ai_quota() function from supabase/migrations/*_plot_twist_ai_quota.sql,
 *     which only the secret key may call.
 *   - Otherwise in this server process's memory (resets on restart; on Vercel
 *     each instance counts separately). Still a real limit, just a looser one.
 *
 * Allowances (environment variables, all optional; defaults are deliberately small):
 *   BETA_TEXT_PER_DAY        text units per tester per day           (default 60)
 *   BETA_AUTO_PER_DAY        autonomous conversations per tester/day (default 15)
 *   BETA_IMAGES_PER_DAY      image generations per tester per day    (default 0 = images off)
 *   BETA_TEXT_DAILY_LIMIT    text units for the whole site per day   (default 600)
 *   BETA_AUTO_DAILY_LIMIT    autonomous conversations, whole site    (default 200)
 *   BETA_IMAGES_DAILY_LIMIT  image generations, whole site per day   (default 10)
 * A network address gets 3x a tester's allowance (classmates share Wi-Fi).
 *
 * Quotas apply in production and whenever beta access codes are configured.
 * Plain `npm run dev` without codes keeps the old unlimited-by-quota behaviour
 * (the usage gate in usage.ts still applies).
 */

import { createHash } from "node:crypto";
import { accessCodes } from "@/lib/beta/token";

export type QuotaKind = "text" | "auto" | "image";

/** What one request of each feature costs, in units of its kind. Opus-backed features cost more. */
export const FEATURE_COST: Record<string, { kind: QuotaKind; units: number }> = {
  talk: { kind: "text", units: 1 },
  turn: { kind: "text", units: 1 },
  photo: { kind: "text", units: 2 },
  gift_reaction: { kind: "text", units: 2 },
  analyze: { kind: "text", units: 4 },
  refine: { kind: "text", units: 4 },
  auto_talk: { kind: "auto", units: 1 },
  sprite: { kind: "image", units: 1 },
  map: { kind: "image", units: 1 },
  map_edit: { kind: "image", units: 1 },
  gift_image: { kind: "image", units: 1 },
};

const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
};

export function allowances(env: Record<string, string | undefined> = process.env) {
  return {
    perTester: { text: int(env.BETA_TEXT_PER_DAY, 60), auto: int(env.BETA_AUTO_PER_DAY, 15), image: int(env.BETA_IMAGES_PER_DAY, 0) },
    site: { text: int(env.BETA_TEXT_DAILY_LIMIT, 600), auto: int(env.BETA_AUTO_DAILY_LIMIT, 200), image: int(env.BETA_IMAGES_DAILY_LIMIT, 10) },
  };
}

export const quotasActive = (env: Record<string, string | undefined> = process.env) => env.NODE_ENV === "production" || accessCodes(env).length > 0;

/** Are image features available at all under the current allowances? */
export const imagesAllowed = (env: Record<string, string | undefined> = process.env) => !quotasActive(env) || (allowances(env).perTester.image > 0 && allowances(env).site.image > 0);

// ---------------------------------------------------------------- stores

type Take = { ok: true } | { ok: false; scope: "tester" | "network" | "site" };

interface QuotaStore {
  take(buckets: string[], limits: number[], cost: number): Promise<{ ok: boolean; bucket?: string }>;
  refund(buckets: string[], cost: number): Promise<void>;
  name: "supabase" | "memory";
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

const mem = new Map<string, number>();
const memoryStore: QuotaStore = {
  name: "memory",
  async take(buckets, limits, cost) {
    const d = today();
    for (let i = 0; i < buckets.length; i++) if ((mem.get(`${d}|${buckets[i]}`) ?? 0) + cost > limits[i]) return { ok: false, bucket: buckets[i] };
    for (const b of buckets) mem.set(`${d}|${b}`, (mem.get(`${d}|${b}`) ?? 0) + cost);
    if (mem.size > 20000) for (const k of [...mem.keys()]) if (!k.startsWith(d)) mem.delete(k);
    return { ok: true };
  },
  async refund(buckets, cost) {
    const d = today();
    for (const b of buckets) mem.set(`${d}|${b}`, Math.max(0, (mem.get(`${d}|${b}`) ?? 0) - cost));
  },
};

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return url && key ? { url, key } : null;
}

async function rpc(fn: string, args: unknown): Promise<unknown> {
  const cfg = supabaseConfig()!;
  // New-style secret keys go in `apikey` only; legacy service_role JWTs also as a bearer token.
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: cfg.key };
  if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`;
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args), signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!res.ok) throw new Error(`quota store ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const supabaseStore: QuotaStore = {
  name: "supabase",
  async take(buckets, limits, cost) {
    const r = (await rpc("pt_take_ai_quota", { p_buckets: buckets, p_limits: limits, p_cost: cost })) as { ok?: boolean; bucket?: string } | null;
    return { ok: r?.ok === true, bucket: r?.bucket };
  },
  async refund(buckets, cost) {
    await rpc("pt_refund_ai_quota", { p_buckets: buckets, p_cost: cost });
  },
};

export const quotaStoreName = () => (supabaseConfig() ? "supabase" : "memory");

// ---------------------------------------------------------------- the check

/** The network address, hashed (never stored or logged in the clear). */
export function networkId(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(`pt-net:${process.env.BETA_COOKIE_SECRET ?? ""}:${ip}`).digest("hex").slice(0, 20);
}

export type QuotaTicket = { refund: () => Promise<void> };

/**
 * Take `feature`'s cost from every bucket. Returns a ticket (refund it if the
 * request never reached the AI provider) or why it was refused.
 */
export async function takeQuota(feature: string, testerId: string | null, req: Request): Promise<({ ok: true } & QuotaTicket) | Exclude<Take, { ok: true }>> {
  const noop = { ok: true as const, refund: async () => {} };
  if (!quotasActive()) return noop;
  const cost = FEATURE_COST[feature];
  if (!cost) return { ok: false, scope: "site" };
  const a = allowances();
  const net = networkId(req);
  const buckets = [`site:${cost.kind}`, `net:${net}:${cost.kind}`, ...(testerId ? [`tester:${testerId}:${cost.kind}`] : [])];
  const limits = [a.site[cost.kind], a.perTester[cost.kind] * 3, ...(testerId ? [a.perTester[cost.kind]] : [])];
  // Without a pass (BETA_OPEN=1) the network address is the tester.
  if (!testerId) limits[1] = a.perTester[cost.kind];
  let store: QuotaStore = supabaseConfig() ? supabaseStore : memoryStore;
  let r: { ok: boolean; bucket?: string };
  try {
    r = await store.take(buckets, limits, cost.units);
  } catch {
    // The durable store is unreachable: fall back to this instance's memory rather than to no limit.
    console.warn("[ai-quota] durable store unavailable, using in-memory limits");
    store = memoryStore;
    r = await store.take(buckets, limits, cost.units);
  }
  if (!r.ok) {
    const scope = r.bucket?.startsWith("site:") ? "site" : r.bucket?.startsWith("net:") ? "network" : "tester";
    return { ok: false, scope };
  }
  let refunded = false;
  return {
    ok: true,
    refund: async () => {
      if (refunded) return;
      refunded = true;
      await store.refund(buckets, cost.units).catch(() => {});
    },
  };
}

/** Units left today for this tester (for the access panel). Memory store only reports this instance. */
export function describeAllowances() {
  const a = allowances();
  return { text: a.perTester.text, auto: a.perTester.auto, images: a.perTester.image, store: quotaStoreName() };
}

/** For tests. */
export function resetMemoryQuota() {
  mem.clear();
}
