import { z } from "zod";
import { AiError, aiErrorResponse } from "@/lib/ai/server/claude";
import { getImageProvider } from "@/lib/ai/server/image";
import { mapPrompt } from "@/lib/ai/server/mapPrompt";

export const runtime = "nodejs";
export const maxDuration = 180;

const MapRequestSchema = z.object({
  description: z.string().trim().min(1).max(600),
  type: z.enum(["interior", "street", "wilderness", "ruins", "dreamscape"]),
  world: z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]).nullable(),
});

/** Each map costs money, so the server never runs more than a couple at once. */
const MAX_IN_FLIGHT = 2;
let inFlight = 0;

const isWebp = (b: Buffer) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
const isPng = (b: Buffer) => b.length >= 4 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG";

/** Environment description → generated top-down map image. The API key never leaves the server. */
export async function POST(req: Request) {
  const parsed = MapRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", message: "Write a description first (up to 600 characters)" }, { status: 400 });
  if (inFlight >= MAX_IN_FLIGHT) return Response.json({ error: "rate_limited", message: "A map is already being drawn" }, { status: 429 });
  inFlight++;
  try {
    const provider = getImageProvider();
    const bytes = await provider.generateMap({ prompt: mapPrompt(parsed.data) });
    const mime = isWebp(bytes) ? "image/webp" : isPng(bytes) ? "image/png" : null;
    if (!mime) throw new AiError("invalid_output", "The image service returned an unexpected format");
    return Response.json({ image: `data:${mime};base64,${bytes.toString("base64")}`, provider: provider.id, model: provider.model });
  } catch (err) {
    return aiErrorResponse(err);
  } finally {
    inFlight--;
  }
}
