import "server-only";
import OpenAI, { toFile } from "openai";
import { IMAGE_MODEL, IMAGE_PROVIDER, imageConfigured } from "./config";
import { AiError } from "./claude";

/**
 * IMAGE GENERATION ADAPTER
 * The sprite route only talks to `ImageProvider`. Today the OpenAI image
 * model is used (it accepts a reference image). Another provider can be added
 * by implementing the same interface and selecting it with IMAGE_PROVIDER.
 */
export interface ImageProvider {
  id: string;
  model: string;
  /** Turn a reference picture into a full-body pixel-art character on a transparent background. Returns PNG bytes. */
  generateSprite(input: { image: Buffer; mime: string; prompt: string }): Promise<Buffer>;
}

const openaiProvider: ImageProvider = {
  id: "openai",
  model: IMAGE_MODEL,
  async generateSprite({ image, mime, prompt }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 150_000, maxRetries: 1 });
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    try {
      const res = await client.images.edit({
        model: IMAGE_MODEL,
        image: await toFile(image, `reference.${ext}`, { type: mime }),
        prompt,
        size: "1024x1024",
        background: "transparent",
        output_format: "png",
        quality: "medium",
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new AiError("invalid_output", "The image service returned no image");
      return Buffer.from(b64, "base64");
    } catch (err) {
      if (err instanceof AiError) throw err;
      if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) throw new AiError("auth", "The OpenAI API key was rejected");
      if (err instanceof OpenAI.RateLimitError) throw new AiError("rate_limited", "Rate limited, try again in a moment");
      if (err instanceof OpenAI.BadRequestError) throw new AiError("refused", "The image service could not use this picture");
      if (err instanceof OpenAI.APIError) throw new AiError("failed", `Image service error ${err.status ?? ""}`.trim());
      throw new AiError("failed", "Could not reach the image service");
    }
  },
};

export function getImageProvider(): ImageProvider {
  if (!imageConfigured()) throw new AiError("not_configured", "No image generation API is configured");
  if (IMAGE_PROVIDER === "openai") return openaiProvider;
  throw new AiError("not_configured", `Unknown IMAGE_PROVIDER "${IMAGE_PROVIDER}"`);
}

const WORLD_STYLE: Record<string, string> = {
  "western-fantasy": "fits a cozy western-fantasy village",
  modern: "fits a cozy modern city",
  "ancient-china": "fits a cozy ancient-Chinese courtyard town",
  otherworld: "fits a whimsical pastel dreamland of floating islands",
};

/** Art direction from docs/DESIGN_SYSTEM.md, so results match the game's sprites. */
export function spritePrompt(opts: { appearance: string; world: string | null }) {
  return [
    "Redraw the person or character in the reference image as a single full-body pixel-art game sprite.",
    "Keep what makes them recognizable: hairstyle and hair color, face shape, skin tone, key clothing pieces and their colors, accessories.",
    opts.appearance.trim() ? `Player's description of their appearance (follow it where it differs): ${opts.appearance.trim().slice(0, 500)}` : "",
    "Style: charming, lighthearted 16-bit pixel art. Chibi proportions about 2 heads tall, big head, simple dot eyes with a small white shine, soft blush.",
    "Standing pose, facing the viewer straight on with a very slight top-down view, arms relaxed at the sides, feet together at the bottom. One character only, centered, filling most of the height.",
    "Large clean pixel clusters on a coarse grid (as if drawn at 32×32 and scaled up), a 1-pixel soft violet outline (#5b4a86) around the silhouette, never pure black.",
    "Soft but colorful pastel palette, at most about 12 colors, 3-tone hue-shifted shading lit from the top-left: shadows cooler, highlights warmer.",
    "No anti-aliasing, no gradients, no blur, no dithering noise, no text, no shadow on the ground, no background: fully transparent background.",
    opts.world ? `The outfit ${WORLD_STYLE[opts.world] ?? "fits the game world"}, but keep the reference's clothing recognizable.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
