import { aiStatus } from "@/lib/ai/server/config";
import { getMode } from "@/lib/ai/server/usage";

export const dynamic = "force-dynamic";

/** Which AI features are configured, and the AI usage mode. Says nothing about the keys themselves. */
export function GET() {
  return Response.json(aiStatus(getMode()), { headers: { "Cache-Control": "no-store" } });
}
