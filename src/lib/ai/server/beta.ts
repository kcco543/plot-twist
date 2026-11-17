import "server-only";

import { AiError } from "./claude";
import { visitorKey } from "./limits";
import { imagesAllowed, takeQuota } from "./quota";
import { BETA_COOKIE, betaRequired, readCookie, verifyPass, type BetaPass } from "@/lib/beta/token";

/**
 * The one check every paid AI route makes before contacting a provider:
 *   1. beta access: a valid signed pass (see src/lib/beta/token.ts) when required
 *   2. image features switched on for this site (BETA_IMAGES_PER_DAY > 0)
 *   3. the daily allowances (quota.ts), taken atomically
 * The middleware repeats step 1 for every /api/ai route as a backstop.
 */

export async function passFrom(req: Request): Promise<BetaPass | null> {
  return verifyPass(readCookie(req.headers.get("cookie"), BETA_COOKIE));
}

const json = (status: number, error: string, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  Response.json({ error, message, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export const lockedResponse = () => json(401, "beta_locked", "Enter a beta access code to use the AI features");

/** Errors that mean the provider never billed anything: the allowance is given back. */
const UNSENT = new Set(["not_configured", "ai_off", "budget", "rate_limited", "busy", "unsupported", "auth", "billing", "bad_request", "bad_image", "too_large"]);

export type Guard = {
  ok: true;
  /** Key for the per-visitor rate limits in limits.ts: the tester id, else the network address. */
  key: string;
  /** Give the allowance back if `err` means nothing reached the provider. */
  refundIf: (err: unknown) => Promise<void>;
  refund: () => Promise<void>;
};

export async function betaGuard(req: Request, feature: string, opts: { image?: boolean } = {}): Promise<Guard | { ok: false; response: Response }> {
  const pass = await passFrom(req);
  if (betaRequired() && !pass) return { ok: false, response: lockedResponse() };
  if (opts.image && !imagesAllowed()) return { ok: false, response: json(503, "ai_off", "Image generation is switched off on this site") };
  const t = await takeQuota(feature, pass?.t ?? null, req);
  if (!t.ok) {
    return {
      ok: false,
      response: json(429, "quota", t.scope === "site" ? "Today's AI allowance for this site is used up" : "Your AI allowance for today is used up", { scope: t.scope }, { "Retry-After": String(secondsToUtcMidnight()) }),
    };
  }
  return {
    ok: true,
    key: pass ? `tester:${pass.t}` : visitorKey(req),
    refund: t.refund,
    refundIf: async (err) => {
      const code = err instanceof AiError ? err.code : typeof err === "string" ? err : null;
      if (code && UNSENT.has(code)) await t.refund();
    },
  };
}

export function secondsToUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Math.max(60, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000));
}
