import { z } from "zod";
import { AiError, aiErrorResponse } from "@/lib/ai/server/claude";
import { betaGuard } from "@/lib/ai/server/beta";
import { logImageUsage } from "@/lib/ai/server/usage";
import { getImageProvider, giftPrompt } from "@/lib/ai/server/image";

export const runtime = "nodejs";
export const maxDuration = 180;

const GiftRequestSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().max(240).default(""),
  world: z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]).nullable().default(null),
});

/** Each picture costs money, so only a couple run at once. */
const MAX_IN_FLIGHT = 2;
const FEATURE = "gift_image";
let inFlight = 0;

const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

/** Gift name + description → generated item picture (PNG). The browser turns it into 32×32 pixel art. The API key never leaves the server. */
export async function POST(req: Request) {
  const parsed = GiftRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", message: "Give the gift a name first (up to 40 characters)" }, { status: 400 });
  if (inFlight >= MAX_IN_FLIGHT) return Response.json({ error: "rate_limited", message: "A gift picture is already being drawn" }, { status: 429 });
  const g = await betaGuard(req, FEATURE, { image: true });
  if (!g.ok) return g.response;
  const started = Date.now();
  if (inFlight >= MAX_IN_FLIGHT) {
    await g.refund();
    return Response.json({ error: "rate_limited", message: "A gift picture is already being drawn" }, { status: 429 });
  }
  inFlight++;
  try {
    const provider = getImageProvider();
    const png = await provider.generateItem({ prompt: giftPrompt(parsed.data) });
    if (!isPng(png)) throw new AiError("invalid_output", "The image service returned an unexpected format");
    logImageUsage(FEATURE, true, started);
    return Response.json({ image: `data:image/png;base64,${png.toString("base64")}`, provider: provider.id, model: provider.model });
  } catch (err) {
    await g.refundIf(err);
    logImageUsage(FEATURE, false, started);
    return aiErrorResponse(err);
  } finally {
    inFlight--;
  }
}
