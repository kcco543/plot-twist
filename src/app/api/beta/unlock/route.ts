import { z } from "zod";
import { networkId } from "@/lib/ai/server/quota";
import { BETA_COOKIE, BETA_MAX_AGE_S, accessCodes, codeId, matchCode, newTesterId, signPass } from "@/lib/beta/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exchange a beta access code for a signed, HttpOnly pass cookie. The code is
 * compared on the server only (codes live in BETA_ACCESS_CODES); the browser
 * never learns the valid codes. Wrong guesses are limited per network address.
 */
const Body = z.object({ code: z.string().trim().min(1).max(100) });

const ATTEMPTS = 8;
const WINDOW = 15 * 60_000;
const attempts = new Map<string, number[]>();

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  if (accessCodes().length === 0) return Response.json({ error: "closed" }, { status: 503, headers: noStore });

  const net = networkId(req);
  const now = Date.now();
  const recent = (attempts.get(net) ?? []).filter((t) => now - t < WINDOW);
  if (recent.length >= ATTEMPTS) return Response.json({ error: "too_many" }, { status: 429, headers: { ...noStore, "Retry-After": String(Math.ceil((recent[0] + WINDOW - now) / 1000)) } });

  const code = await matchCode(parsed.data.code);
  if (!code) {
    recent.push(now);
    attempts.set(net, recent);
    if (attempts.size > 5000) for (const k of [...attempts.keys()].slice(0, 1000)) attempts.delete(k);
    // A small delay makes guessing slower without bothering a person.
    await new Promise((r) => setTimeout(r, 400));
    return Response.json({ error: "wrong_code" }, { status: 401, headers: noStore });
  }

  const value = await signPass({ t: newTesterId(), c: await codeId(code), i: Math.floor(now / 1000) });
  if (!value) return Response.json({ error: "closed" }, { status: 503, headers: noStore });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    { headers: { ...noStore, "Set-Cookie": `${BETA_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${BETA_MAX_AGE_S}${secure}` } },
  );
}
