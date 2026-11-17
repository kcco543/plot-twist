import { z } from "zod";
import { AiError, aiErrorResponse } from "@/lib/ai/server/claude";
import { betaGuard } from "@/lib/ai/server/beta";
import { logImageUsage } from "@/lib/ai/server/usage";
import { getImageProvider } from "@/lib/ai/server/image";
import { buildMask, imageSize } from "@/lib/ai/server/mapMask";
import { mapEditPrompt } from "@/lib/ai/server/mapPrompt";
import { MIN_REGION } from "@/lib/mapSelection";

export const runtime = "nodejs";
export const maxDuration = 180;

/** A lossless 1536×1024 map is usually 2–4 MB. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const fraction = z.coerce.number().min(0).max(1);
const EditSchema = z
  .object({
    instruction: z.string().trim().min(1).max(300),
    x: fraction,
    y: fraction,
    w: fraction.min(MIN_REGION),
    h: fraction.min(MIN_REGION),
    description: z.string().max(600).default(""),
    type: z.enum(["interior", "street", "wilderness", "ruins", "dreamscape"]).nullable().default(null),
    world: z.enum(["western-fantasy", "modern", "ancient-china", "otherworld"]).nullable().default(null),
  })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "Selection is outside the map");

let inFlight = 0;
const MAX_IN_FLIGHT = 2;
const FEATURE = "map_edit";

const sniff = (b: Buffer) =>
  b.length >= 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG" ? "image/png" : b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;

/**
 * Region edit: current map + selected rectangle + instruction → repainted map.
 * The mask is built here from the rectangle; the API key never leaves the server.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "bad_request", message: "Expected form data" }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof Blob)) return Response.json({ error: "bad_request", message: "No map attached" }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "too_large", message: "Map image is too large" }, { status: 413 });
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const parsed = EditSchema.safeParse({
    instruction: text("instruction") ?? "",
    x: text("x"),
    y: text("y"),
    w: text("w"),
    h: text("h"),
    description: text("description"),
    type: text("type") ?? null,
    world: text("world") ?? null,
  });
  if (!parsed.success) return Response.json({ error: "bad_request", message: "Select an area and write what to change (up to 300 characters)" }, { status: 400 });

  const image = Buffer.from(await file.arrayBuffer());
  const mime = sniff(image);
  const size = mime ? imageSize(image) : null;
  if (!mime || !size || size.width < 64 || size.height < 64 || size.width > 4096 || size.height > 4096) {
    return Response.json({ error: "bad_type", message: "The map must be a PNG or WebP image" }, { status: 415 });
  }
  if (inFlight >= MAX_IN_FLIGHT) return Response.json({ error: "rate_limited", message: "An edit is already being drawn" }, { status: 429 });
  const g = await betaGuard(req, FEATURE, { image: true });
  if (!g.ok) return g.response;
  const started = Date.now();
  if (inFlight >= MAX_IN_FLIGHT) {
    await g.refund();
    return Response.json({ error: "rate_limited", message: "An edit is already being drawn" }, { status: 429 });
  }

  inFlight++;
  try {
    const provider = getImageProvider();
    if (!provider.editMap) throw new AiError("unsupported", `The ${provider.id} image provider can't edit part of an image`);
    const { x, y, w, h, instruction, description, type, world } = parsed.data;
    const mask = buildMask(size.width, size.height, { x, y, w, h });
    const out = await provider.editMap({ image, mime, mask, ...size, prompt: mapEditPrompt({ instruction, description, type, world }) });
    const outMime = sniff(out);
    if (!outMime) throw new AiError("invalid_output", "The image service returned an unexpected format");
    logImageUsage(FEATURE, true, started);
    return Response.json({ image: `data:${outMime};base64,${out.toString("base64")}`, provider: provider.id, model: provider.model });
  } catch (err) {
    await g.refundIf(err);
    logImageUsage(FEATURE, false, started);
    return aiErrorResponse(err);
  } finally {
    inFlight--;
  }
}
