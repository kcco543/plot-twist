import { RefineRequestSchema } from "@/lib/ai/contracts";
import { AiError, aiErrorResponse, structuredCall } from "@/lib/ai/server/claude";
import { TEXT_MODEL, talkMock, textConfigured } from "@/lib/ai/server/config";
import { mockRefine, REFINE_SYSTEM, refineUser } from "@/lib/ai/server/refine";
import { canonSentences, pinLockedCanon, reconcileChanges, RefineOutputSchema } from "@/lib/behavior/refine";
import { finishProfile } from "@/lib/behavior/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Feedback → PROPOSED revised profile (never applied here: the player accepts
 * or rejects it in the Character Studio). The change list is checked against
 * what really changed, so nothing changes silently.
 */
export async function POST(req: Request) {
  const body = RefineRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request", message: "Invalid refinement request" }, { status: 400 });
  let current;
  try {
    current = finishProfile(body.data.profile);
  } catch {
    return Response.json({ error: "bad_request", message: "The current profile is not valid" }, { status: 400 });
  }
  const mock = !textConfigured() && talkMock();
  try {
    const raw = mock ? mockRefine(body.data, current) : await structuredCall({ feature: "refine", schema: RefineOutputSchema, system: REFINE_SYSTEM, user: refineUser(body.data, current), effort: "medium", maxTokens: 12000, model: TEXT_MODEL, reuse: false });
    const out = RefineOutputSchema.parse(raw);
    let revised;
    try {
      revised = finishProfile(out.profile);
    } catch {
      throw new AiError("invalid_output", "The revised profile was incomplete");
    }
    // Locked canon stays word for word (never reworded or translated), enforced here, not just asked for.
    const ch = body.data.character;
    const lockedText = (f: (typeof ch.lockedFields)[number]) => (f === "name" ? "" : (ch.fields[f] ?? "").trim());
    const { profile, pinned } = pinLockedCanon(current, revised, canonSentences(ch.lockedFields.map(lockedText).filter(Boolean)));
    const changes = reconcileChanges(current, profile, out.changes);
    return Response.json({
      interpretation: out.interpretation.slice(0, 600),
      changes: changes.slice(0, 16).map((c) => ({ ...c, before: c.before.slice(0, 400), after: c.after.slice(0, 400), why: c.why.slice(0, 300) })),
      kept: [...pinned.map((x) => `“${x}”`), ...out.kept].slice(0, 10).map((k) => k.slice(0, 200)),
      ambiguities: out.ambiguities.slice(0, 5),
      canonConflicts: body.data.keepCanon ? [] : out.canonConflicts
            .filter((c) => ch.lockedFields.includes(c.field))
            .slice(0, 5)
            // Quote the canon as the player wrote it, not as the AI restated it.
            .map((c) => ({ ...c, canon: (lockedText(c.field) || c.canon).slice(0, 300) })),
      profile,
      source: mock ? "mock" : "ai",
    });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
