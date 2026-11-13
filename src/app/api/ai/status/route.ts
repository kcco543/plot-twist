import { aiStatus } from "@/lib/ai/server/config";

export const dynamic = "force-dynamic";

/** Which AI features are configured. Says nothing about the keys themselves. */
export function GET() {
  return Response.json(aiStatus(), { headers: { "Cache-Control": "no-store" } });
}
