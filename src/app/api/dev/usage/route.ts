import { z } from "zod";
import { STORY_MODEL, TALK_MODEL, TEXT_MODEL, textConfigured } from "@/lib/ai/server/config";
import { dashboardEnabled, MODES, resetUsage, setLimits, setMode, snapshot } from "@/lib/ai/server/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only API usage dashboard data (404 in production unless
 * AI_USAGE_DASHBOARD=1). Returns counts, token totals and cost estimates:
 * never keys, prompts or replies. This route itself never calls Anthropic.
 */
const notFound = () => new Response("Not found", { status: 404 });
const noStore = { "Cache-Control": "no-store" };

function body() {
  const s = snapshot();
  return { ...s, keyConfigured: textConfigured(), models: { talk: TALK_MODEL, photo: TALK_MODEL, gift_reaction: TALK_MODEL, turn: STORY_MODEL, analyze: TEXT_MODEL, refine: TEXT_MODEL } };
}

export function GET() {
  if (!dashboardEnabled()) return notFound();
  return Response.json(body(), { headers: noStore });
}

const PatchSchema = z.object({
  mode: z.enum(MODES as [string, ...string[]]).optional(),
  limits: z
    .object({
      perMinute: z.number().positive().optional(),
      concurrent: z.number().positive().optional(),
      maxOutputTokens: z.number().positive().optional(),
      sessionBudgetUsd: z.number().positive().optional(),
    })
    .optional(),
  reset: z.boolean().optional(),
});

export async function POST(req: Request) {
  if (!dashboardEnabled()) return notFound();
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const p = parsed.data;
  if (p.mode) setMode(p.mode as (typeof MODES)[number]);
  if (p.limits) setLimits(p.limits);
  if (p.reset) resetUsage();
  return Response.json(body(), { headers: noStore });
}
