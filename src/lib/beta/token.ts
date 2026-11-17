/**
 * BETA PASS: the signed cookie a tester gets after entering a valid access code.
 * --------------------------------------------------------------------------
 * Web Crypto only, so the same code runs in the middleware (edge) and in the
 * API routes (Node). Server-side only: never import this from a client component.
 *
 *   cookie value = base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 *   payload      = { t: tester id (random), c: which code (short hash), i: issued at (s) }
 *
 * The HMAC key is BETA_COOKIE_SECRET when set, otherwise derived from the
 * access codes themselves, so changing the codes signs everyone out. A pass
 * whose code was removed from BETA_ACCESS_CODES stops working at once.
 */

export const BETA_COOKIE = "pt_beta";
/** A pass lasts 30 days; testers enter the code again after that. */
export const BETA_MAX_AGE_S = 30 * 24 * 60 * 60;

export type BetaPass = { t: string; c: string; i: number };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The configured access codes (comma or newline separated, trimmed, empty ones dropped). */
export function accessCodes(env: Record<string, string | undefined> = process.env): string[] {
  return (env.BETA_ACCESS_CODES ?? "")
    .split(/[,\n]/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 6);
}

/**
 * Must AI routes see a beta pass? Yes in production (fail closed), unless
 * BETA_OPEN=1. In development only when codes are configured, so the local
 * workflow at localhost:3000 keeps working as before.
 */
export function betaRequired(env: Record<string, string | undefined> = process.env): boolean {
  if (env.BETA_OPEN === "1") return false;
  if (env.NODE_ENV === "production") return true;
  return accessCodes(env).length > 0;
}

async function sha256hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short, non-reversible id of one access code (what the pass remembers). */
export const codeId = async (code: string) => (await sha256hex(`pt-beta-code:${code}`)).slice(0, 12);

async function hmacKey(env: Record<string, string | undefined>): Promise<CryptoKey | null> {
  const secret = env.BETA_COOKIE_SECRET || (accessCodes(env).length ? `pt-beta-derived:${accessCodes(env).join("\n")}` : "");
  if (!secret) return null;
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Constant-time string comparison (both sides hashed first, so lengths don't leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256hex(a), sha256hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Which configured code (if any) matches what the tester typed. */
export async function matchCode(input: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const typed = input.trim();
  if (!typed || typed.length > 100) return null;
  let found: string | null = null;
  // Compare against every code (no early exit) so timing says nothing about which one is close.
  for (const code of accessCodes(env)) if ((await safeEqual(typed.toLowerCase(), code.toLowerCase())) && !found) found = code;
  return found;
}

export async function signPass(pass: BetaPass, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const key = await hmacKey(env);
  if (!key) return null;
  const body = b64url(enc.encode(JSON.stringify(pass)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export function newTesterId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** A valid, unexpired pass whose code is still configured, or null. */
export async function verifyPass(value: string | undefined | null, env: Record<string, string | undefined> = process.env, nowS = Math.floor(Date.now() / 1000)): Promise<BetaPass | null> {
  if (!value || value.length > 400) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const key = await hmacKey(env);
  const sigBytes = unb64url(sig);
  if (!key || !sigBytes) return null;
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, enc.encode(body));
  if (!ok) return null;
  let pass: BetaPass;
  try {
    pass = JSON.parse(new TextDecoder().decode(unb64url(body) ?? new Uint8Array()));
  } catch {
    return null;
  }
  if (typeof pass?.t !== "string" || typeof pass.c !== "string" || typeof pass.i !== "number") return null;
  if (pass.i > nowS + 60 || nowS - pass.i > BETA_MAX_AGE_S) return null;
  const ids = await Promise.all(accessCodes(env).map(codeId));
  return ids.includes(pass.c) ? pass : null;
}

/** Read one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
