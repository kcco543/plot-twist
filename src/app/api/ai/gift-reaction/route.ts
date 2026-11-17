import { AiError, aiErrorResponse, assertImageInput, structuredCall } from "@/lib/ai/server/claude";
import { TALK_MODEL, talkMock, textConfigured } from "@/lib/ai/server/config";
import { GIFT_SYSTEM, giftContent, mockGiftReply } from "@/lib/ai/server/giftReaction";
import { takeTalkSlot } from "@/lib/ai/server/limits";
import { betaGuard } from "@/lib/ai/server/beta";
import { checkGiftImage, GIFT_PROBLEM_FEEDBACK, giftProblem, sanitizeGiftReply } from "@/lib/gifts/checks";
import { GiftReactionReplySchema, GiftReactionRequestSchema, type GiftReactionResponse } from "@/lib/gifts/contract";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 120_000;
const CALL_TIMEOUT_MS = 25_000;

/**
 * One character's reaction to a gift the player made (see
 * src/lib/ai/server/giftReaction.ts). Same safeguards as conversations and
 * photos: key server-side, validated and size-capped body, rate limit,
 * checked reply with one retry. Nothing is stored on the server.
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
  const body = GiftReactionRequestSchema.safeParse(json);
  if (!body.success) return Response.json({ error: "bad_request", message: "Invalid gift request" }, { status: 400 });
  const r = body.data;
  if (r.gift.image && !checkGiftImage(r.gift.image)) return Response.json({ error: "bad_image", message: "The gift picture could not be used" }, { status: 415 });

  const mock = !textConfigured() && talkMock();
  if (!textConfigured() && !mock) return aiErrorResponse(new AiError("not_configured", "ANTHROPIC_API_KEY is not set"));

  const g = await betaGuard(req, "gift_reaction");
  if (!g.ok) return g.response;
  const slot = takeTalkSlot(`gift:${g.key}`);
  if (!slot.ok) {
    await g.refund();
    const error = slot.reason === "busy" ? "busy" : "limit";
    return Response.json({ error, message: "Try again in a moment" }, { status: 429, headers: { "Retry-After": String(slot.retryAfter) } });
  }
  try {
    if (mock) {
      await new Promise((res) => setTimeout(res, 600));
      const out: GiftReactionResponse = { reply: sanitizeGiftReply(mockGiftReply(r), r), source: "mock", model: "test-double", attempts: 1 };
      return Response.json(out);
    }
    if (r.gift.image) await assertImageInput(TALK_MODEL);
    let extra = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const reply = sanitizeGiftReply(
        await structuredCall({ feature: "gift_reaction", schema: GiftReactionReplySchema, system: GIFT_SYSTEM, user: giftContent(r, extra), effort: "low", maxTokens: 3000, timeoutMs: CALL_TIMEOUT_MS, maxRetries: 0, model: TALK_MODEL }),
        r,
      );
      const problem = giftProblem(reply, r);
      if (!problem) {
        const out: GiftReactionResponse = { reply, source: "ai", model: TALK_MODEL, attempts: attempt };
        return Response.json(out);
      }
      extra = `\n\n<rejected_reply reason="${problem}">\n${GIFT_PROBLEM_FEEDBACK[problem]}\n</rejected_reply>`;
    }
    throw new AiError("invalid_output", "The reaction did not fit the character, even after a retry");
  } catch (err) {
    await g.refundIf(err);
    return aiErrorResponse(err);
  } finally {
    slot.release();
  }
}
