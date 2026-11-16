import { AiError, aiErrorResponse, structuredCall } from "@/lib/ai/server/claude";
import { TALK_MODEL, textConfigured } from "@/lib/ai/server/config";
import { takeTalkSlot, visitorKey } from "@/lib/ai/server/limits";
import { mockEnabled, mockReply, TALK_SYSTEM, talkParts } from "@/lib/ai/server/talk";
import { PROBLEM_FEEDBACK, replyProblem, sanitizeReply } from "@/lib/talk/ai/checks";
import { TalkReplySchema, TalkRequestSchema, type TalkResponse } from "@/lib/talk/ai/contract";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Largest request body accepted (bytes). Character profiles are capped well below this. */
const MAX_BODY = 48_000;
/** Each model call gets this long; one retry at most when a reply breaks the rules. */
const CALL_TIMEOUT_MS = 22_000;

/**
 * One in-character reply from the listener (see src/lib/ai/server/talk.ts).
 * The key stays on the server. The request is validated and size-capped,
 * each visitor is rate-limited, and the reply is checked (character,
 * language, repetition) before it is returned. A reply that still breaks the
 * rules after one retry is rejected, never patched up or replaced.
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
  const body = TalkRequestSchema.safeParse(json);
  if (!body.success) return Response.json({ error: "bad_request", message: "Invalid conversation request" }, { status: 400 });
  const r = body.data;

  const mock = !textConfigured() && mockEnabled();
  if (!textConfigured() && !mock) return aiErrorResponse(new AiError("not_configured", "ANTHROPIC_API_KEY is not set"));

  const slot = takeTalkSlot(visitorKey(req));
  if (!slot.ok) {
    const error = slot.reason === "busy" ? "busy" : "limit";
    return Response.json({ error, message: slot.reason === "busy" ? "A reply is already being written" : "Conversation limit reached, try again later" }, { status: 429, headers: { "Retry-After": String(slot.retryAfter) } });
  }
  try {
    if (mock) {
      await new Promise((res) => setTimeout(res, 600));
      const out: TalkResponse = { reply: sanitizeReply(mockReply(r), r), source: "mock", model: "test-double", attempts: 1 };
      return Response.json(out);
    }
    // The character profiles stay the same for the whole conversation, so they are sent as a cached prefix.
    const { prefix, rest } = talkParts(r);
    let user = rest;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const reply = sanitizeReply(await structuredCall({ feature: "talk", schema: TalkReplySchema, system: TALK_SYSTEM, cachePrefix: prefix, user, effort: "low", maxTokens: 3000, timeoutMs: CALL_TIMEOUT_MS, maxRetries: 0, model: TALK_MODEL }), r);
      const problem = replyProblem(reply, r);
      if (!problem) {
        const out: TalkResponse = { reply, source: "ai", model: TALK_MODEL, attempts: attempt };
        return Response.json(out);
      }
      user = `${rest}\n\n<rejected_reply reason="${problem}">\n${PROBLEM_FEEDBACK[problem]}\n</rejected_reply>`;
    }
    throw new AiError("invalid_output", "The reply did not fit the character, even after a retry");
  } catch (err) {
    return aiErrorResponse(err);
  } finally {
    slot.release();
  }
}
