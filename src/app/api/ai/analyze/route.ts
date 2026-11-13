import { AnalyzeRequestSchema } from "@/lib/ai/contracts";
import { aiErrorResponse, structuredCall } from "@/lib/ai/server/claude";
import { ANALYSIS_SYSTEM, analysisUser } from "@/lib/ai/server/prompts";
import { BehaviorProfileSchema, finishProfile } from "@/lib/behavior/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

/** AI personality analysis → structured behavioral profile (the player reviews it before it's used). */
export async function POST(req: Request) {
  const body = AnalyzeRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request", message: "Invalid analysis request" }, { status: 400 });
  try {
    const raw = await structuredCall({ schema: BehaviorProfileSchema, system: ANALYSIS_SYSTEM, user: analysisUser(body.data), effort: "medium" });
    const profile = finishProfile(raw);
    return Response.json({ profile });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
