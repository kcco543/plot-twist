import { BETA_COOKIE } from "@/lib/beta/token";

export const dynamic = "force-dynamic";

/** Forget this browser's beta pass (AI features turn off; saves are untouched). */
export function POST() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": `${BETA_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } });
}
