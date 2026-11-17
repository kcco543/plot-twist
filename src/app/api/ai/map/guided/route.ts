import { z } from "zod";
import { AiError, aiErrorResponse } from "@/lib/ai/server/claude";
import { echoProvider, getImageProvider, imageMock } from "@/lib/ai/server/image";
import { imageSize } from "@/lib/ai/server/mapMask";
import { guidedMapPrompt } from "@/lib/ai/mapPrompt";
import { GUIDE_LEGEND } from "@/lib/mapgen/guide";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const GuidedSchema = z.object({
  description: z.string().trim().min(1).max(600),
  type: z.enum(["interior", "street", "wilderness", "ruins", "dreamscape"]),
  world: z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]).nullable().default(null),
});

/** Like the other map routes: each map costs money, so never more than a couple at once. */
let inFlight = 0;
const MAX_IN_FLIGHT = 2;

const isPng = (b: Buffer) => b.length >= 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG";

/**
 * Guided map art (trial): the game's layout block-out (PNG, 1536×1024) +
 * the player's description → a finished map painted over that layout.
 * The prompt is built here from the same shared text the Map Lab shows.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "bad_request", message: "Expected form data" }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof Blob)) return Response.json({ error: "bad_request", message: "No layout attached" }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "too_large", message: "Layout image is too large" }, { status: 413 });
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const parsed = GuidedSchema.safeParse({ description: text("description") ?? "", type: text("type"), world: text("world") ?? null });
  if (!parsed.success) return Response.json({ error: "bad_request", message: "Write a description first (up to 600 characters)" }, { status: 400 });

  const image = Buffer.from(await file.arrayBuffer());
  const size = isPng(image) ? imageSize(image) : null;
  if (!size || size.width !== 1536 || size.height !== 1024) return Response.json({ error: "bad_type", message: "The layout must be a 1536×1024 PNG" }, { status: 415 });
  if (inFlight >= MAX_IN_FLIGHT) return Response.json({ error: "rate_limited", message: "A map is already being drawn" }, { status: 429 });

  inFlight++;
  try {
    const provider = imageMock() ? echoProvider : getImageProvider();
    if (!provider.repaintMap) throw new AiError("unsupported", `The ${provider.id} image provider can't repaint a layout`);
    const out = await provider.repaintMap({ image, prompt: guidedMapPrompt({ ...parsed.data, legend: GUIDE_LEGEND }) });
    const mime = isPng(out) ? "image/png" : out.toString("ascii", 0, 4) === "RIFF" ? "image/webp" : null;
    if (!mime) throw new AiError("invalid_output", "The image service returned an unexpected format");
    return Response.json({ image: `data:${mime};base64,${out.toString("base64")}`, provider: provider.id, model: provider.model });
  } catch (err) {
    return aiErrorResponse(err);
  } finally {
    inFlight--;
  }
}
