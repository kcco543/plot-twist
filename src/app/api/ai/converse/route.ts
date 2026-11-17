import { AiError, aiErrorResponse, structuredCall } from "@/lib/ai/server/claude";
import { AUTO_TALK_MODEL, talkMock, textConfigured } from "@/lib/ai/server/config";
import { CONVERSE_FEEDBACK, CONVERSE_SYSTEM, converseParts, converseProblem, mockConverse, sanitizeConverse } from "@/lib/ai/server/converse";
import { takeAutoTalkSlot, visitorKey } from "@/lib/ai/server/limits";
import { ConverseReplySchema, ConverseRequestSchema, type ConverseResponse } from "@/lib/talk/ai/converse";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 60_000;
const CALL_TIMEOUT_MS = 25_000;
/** A whole short conversation in one reply: bounded output. */
const MAX_TOKENS = 1800;

/**
 * One short autonomous conversation between two characters, written in one
 * request (src/lib/ai/server/converse.ts). Validated, size-capped,
 * rate-limited per visitor (takeAutoTalkSlot) and through the usage gate
 * (feature "auto_talk": mode, budget, per-minute, concurrency). A reply that
 * still breaks the rules after one retry is rejected, never patched up.
 */
export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "too_large", message: "Request too large" }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* handled below */
  }
  const body = ConverseRequestSchema.safeParse(json);
  if (!body.success) return Response.json({ error: "bad_request", message: "Invalid conversation request" }, { status: 400 });
  const r = body.data;
  const mock = !textConfigured() && talkMock();
  if (!textConfigured() && !mock) return aiErrorResponse(new AiError("not_configured", "ANTHROPIC_API_KEY is not set"));
  const slot = takeAutoTalkSlot(visitorKey(req));
  if (!slot.ok) return Response.json({ error: slot.reason === "busy" ? "busy" : "limit", message: "Autonomous conversation limit reached" }, { status: 429, headers: { "Retry-After": String(slot.retryAfter) } });
  try {
    if (mock) {
      await new Promise((res) => setTimeout(res, 500));
      const out: ConverseResponse = { reply: sanitizeConverse(mockConverse(r), r), source: "mock", model: "test-double" };
      return Response.json(out);
    }
    const { prefix, rest } = converseParts(r);
    let user = rest;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const reply = sanitizeConverse(await structuredCall({ feature: "auto_talk", schema: ConverseReplySchema, system: CONVERSE_SYSTEM, cachePrefix: prefix, user, effort: "low", maxTokens: MAX_TOKENS, timeoutMs: CALL_TIMEOUT_MS, maxRetries: 0, model: AUTO_TALK_MODEL }), r);
      const problem = converseProblem(reply, r);
      if (!problem) {
        const out: ConverseResponse = { reply, source: "ai", model: AUTO_TALK_MODEL };
        return Response.json(out);
      }
      user = `${rest}\n\n<rejected reason="${problem}">\n${CONVERSE_FEEDBACK[problem]}\n</rejected>`;
    }
    throw new AiError("invalid_output", "The conversation did not fit the characters, even after a retry");
  } catch (err) {
    return aiErrorResponse(err);
  } finally {
    slot.release();
  }
}
