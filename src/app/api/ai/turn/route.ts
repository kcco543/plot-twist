import { TurnRequestSchema } from "@/lib/ai/contracts";
import { AiError, aiErrorResponse, structuredCall } from "@/lib/ai/server/claude";
import { TURN_SYSTEM, turnUser } from "@/lib/ai/server/prompts";
import { TurnOutputSchema } from "@/lib/behavior/schema";
import { isRepeat } from "@/lib/story/similarity";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Writes the words for a beat the game engine already decided.
 * Output is validated: only allowed speakers, length limits, and no lines
 * that repeat recent dialogue. Names are never taken from the AI.
 */
export async function POST(req: Request) {
  const body = TurnRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request", message: "Invalid turn request" }, { status: 400 });
  const r = body.data;
  const allowed = new Set(["narrator", r.actor.id, ...(r.other ? [r.other.id] : [])]);
  try {
    const out = await structuredCall({ schema: TurnOutputSchema, system: TURN_SYSTEM, user: turnUser(r), effort: "low", maxTokens: 8000 });
    const lines = out.lines
      .filter((l) => allowed.has(l.speaker))
      .map((l) => ({ speaker: l.speaker, text: l.text.trim().slice(0, 320) }))
      .filter((l) => l.text && !isRepeat(l.text, r.recentLines))
      .slice(0, 4);
    if (lines.length === 0) throw new AiError("invalid_output", "The AI repeated itself or used an unknown speaker");
    return Response.json({ lines, memoryNote: out.memoryNote.trim().slice(0, 140) });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
