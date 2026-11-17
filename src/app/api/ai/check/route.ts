import { verifyKeys } from "@/lib/ai/server/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live check of each AI key + model (no generation, no cost). Never returns the keys. */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("fresh") === "1";
  return Response.json({ checks: await verifyKeys(force) }, { headers: { "Cache-Control": "no-store" } });
}
