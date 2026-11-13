import { AiError, aiErrorResponse } from "@/lib/ai/server/claude";
import { getImageProvider, spritePrompt } from "@/lib/ai/server/image";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Detect the real file type from its first bytes (never trust the extension). */
function sniff(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Reference image → generated pixel character (PNG). The original upload is never stored on the server. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "bad_request", message: "Expected a file upload" }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof Blob)) return Response.json({ error: "bad_request", message: "No image attached" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "too_large", message: "Image is larger than 8 MB" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniff(buf);
  if (!mime) return Response.json({ error: "bad_type", message: "Only PNG, JPG or WebP images are supported" }, { status: 415 });
  const appearance = String(form.get("appearance") ?? "").slice(0, 600);
  const world = String(form.get("world") ?? "") || null;
  try {
    const provider = getImageProvider();
    const png = await provider.generateSprite({ image: buf, mime, prompt: spritePrompt({ appearance, world }) });
    if (sniff(png) !== "image/png") throw new AiError("invalid_output", "The image service returned an unexpected format");
    return Response.json({ image: `data:image/png;base64,${png.toString("base64")}`, provider: provider.id, model: provider.model });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
