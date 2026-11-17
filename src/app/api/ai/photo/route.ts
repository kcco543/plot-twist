import { AiError, aiErrorResponse, assertImageInput, structuredCall } from "@/lib/ai/server/claude";
import { TALK_MODEL, textConfigured, talkMock } from "@/lib/ai/server/config";
import { takeTalkSlot } from "@/lib/ai/server/limits";
import { betaGuard } from "@/lib/ai/server/beta";
import { mockPhotoReply, PHOTO_SYSTEM, photoContent } from "@/lib/ai/server/photo";
import { checkImage, PHOTO_PROBLEM_FEEDBACK, photoProblem, sanitizePhotoReply } from "@/lib/photo/checks";
import { PhotoReplySchema, PhotoRequestSchema, PHOTO_AI_MAX_BYTES, type PhotoResponse } from "@/lib/photo/contract";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Largest request body accepted (bytes): the base64 image plus the character context. */
const MAX_BODY = Math.ceil((PHOTO_AI_MAX_BYTES * 4) / 3) + 64_000;
/** Each model call gets this long; one retry at most when a reply breaks the rules. */
const CALL_TIMEOUT_MS = 25_000;

/**
 * One character's reaction to a photo the player chose to share (see
 * src/lib/ai/server/photo.ts). The browser sends the photo only after the
 * player confirms it. The key stays on the server; the body is size-capped
 * and validated, the image's real type and size are checked, each visitor
 * is rate-limited, and the reply is checked before it is returned.
 *
 * Privacy: the image is passed straight to the model and then dropped. It is
 * never written to disk or logged (errors log a code only), and nothing about
 * the photo is kept on the server.
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return Response.json({ error: "too_large", message: "Photo too large" }, { status: 413 });
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "too_large", message: "Photo too large" }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* handled below */
  }
  const body = PhotoRequestSchema.safeParse(json);
  if (!body.success) return Response.json({ error: "bad_request", message: "Invalid photo request" }, { status: 400 });
  const r = body.data;
  const image = checkImage(r.image.data, r.image.mediaType);
  if (!image.ok) return Response.json({ error: image.problem === "size" ? "too_large" : "bad_image", message: "The photo could not be used" }, { status: image.problem === "size" ? 413 : 415 });

  const mock = !textConfigured() && talkMock();
  if (!textConfigured() && !mock) return aiErrorResponse(new AiError("not_configured", "ANTHROPIC_API_KEY is not set"));

  const g = await betaGuard(req, "photo");
  if (!g.ok) return g.response;
  const slot = takeTalkSlot(`photo:${g.key}`);
  if (!slot.ok) {
    await g.refund();
    const error = slot.reason === "busy" ? "busy" : "limit";
    return Response.json({ error, message: slot.reason === "busy" ? "A reaction is already being written" : "Photo limit reached, try again later" }, { status: 429, headers: { "Retry-After": String(slot.retryAfter) } });
  }
  try {
    if (mock) {
      await new Promise((res) => setTimeout(res, 700));
      const out: PhotoResponse = { reply: sanitizePhotoReply(mockPhotoReply(r), r), source: "mock", model: "test-double", attempts: 1 };
      return Response.json(out);
    }
    await assertImageInput(TALK_MODEL);
    let extra = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const reply = sanitizePhotoReply(
        await structuredCall({ feature: "photo", schema: PhotoReplySchema, system: PHOTO_SYSTEM, user: photoContent(r, extra), effort: "low", maxTokens: 3000, timeoutMs: CALL_TIMEOUT_MS, maxRetries: 0, model: TALK_MODEL }),
        r,
      );
      const problem = photoProblem(reply, r);
      if (!problem) {
        const out: PhotoResponse = { reply, source: "ai", model: TALK_MODEL, attempts: attempt };
        return Response.json(out);
      }
      extra = `\n\n<rejected_reply reason="${problem}">\n${PHOTO_PROBLEM_FEEDBACK[problem]}\n</rejected_reply>`;
    }
    throw new AiError("invalid_output", "The reaction did not fit the character, even after a retry");
  } catch (err) {
    await g.refundIf(err);
    return aiErrorResponse(err);
  } finally {
    slot.release();
  }
}
