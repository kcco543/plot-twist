import "server-only";
import OpenAI, { toFile } from "openai";
import { IMAGE_MODEL, IMAGE_PROVIDER, imageConfigured } from "./config";
import { AiError } from "./claude";

/**
 * IMAGE GENERATION ADAPTER
 * The sprite and map routes only talk to `ImageProvider`. Today the OpenAI
 * image model is used (it accepts a reference image for sprites and plain text
 * for maps). Another provider can be added by implementing the same interface
 * and selecting it with IMAGE_PROVIDER.
 */
export interface ImageProvider {
  id: string;
  model: string;
  /** Turn a reference picture into a full-body pixel-art character on a transparent background. Returns PNG bytes. */
  generateSprite(input: { image: Buffer; mime: string; prompt: string }): Promise<Buffer>;
  /** Text prompt → landscape (3:2) environment map. Returns WebP bytes. */
  generateMap(input: { prompt: string }): Promise<Buffer>;
  /** Text prompt → a single item (gift) on a transparent background. Returns PNG bytes. */
  generateItem(input: { prompt: string }): Promise<Buffer>;
  /**
   * Region edit (inpainting): repaint only where `mask` is transparent and keep
   * the rest of `image`. `mask` is a PNG the same size as `image`. Returns PNG
   * bytes. Optional: a provider without inpainting leaves it out, and the edit
   * route answers "unsupported" so the UI can say so.
   */
  editMap?(input: { image: Buffer; mime: string; mask: Buffer; width: number; height: number; prompt: string }): Promise<Buffer>;
}

/** Sizes the OpenAI image model accepts; anything else is left to "auto". */
const OPENAI_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);

/** Turn SDK errors into the app's error codes (the route turns those into HTTP statuses). */
function imageError(err: unknown, refusedMessage: string): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return new AiError("auth", "The OpenAI API key was rejected");
  if (err instanceof OpenAI.APIError && isBillingError(err)) return new AiError("billing", "The OpenAI account has no credits or has hit its spending limit");
  if (err instanceof OpenAI.RateLimitError) return new AiError("rate_limited", "Rate limited, try again in a moment");
  if (err instanceof OpenAI.BadRequestError) return new AiError("refused", refusedMessage);
  if (err instanceof OpenAI.APIError) return new AiError("failed", `Image service error ${err.status ?? ""}`.trim());
  return new AiError("failed", "Could not reach the image service");
}

/**
 * Out of credits / over the spending limit. OpenAI sends these as 429s too, but
 * waiting won't help, so they get their own code ("billing") and message.
 */
export function isBillingError(err: { status?: number; code?: string | null; type?: string | null; message?: string }): boolean {
  if (err.status === 402) return true;
  const text = `${err.code ?? ""} ${err.type ?? ""} ${err.message ?? ""}`.toLowerCase();
  return /insufficient_quota|credit_balance|billing_hard_limit|billing|exceeded your current quota|quota/.test(text);
}

const openai = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 150_000, maxRetries: 1 });

const openaiProvider: ImageProvider = {
  id: "openai",
  model: IMAGE_MODEL,
  async generateSprite({ image, mime, prompt }) {
    const client = openai();
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
      throw imageError(err, "The image service could not use this picture");
    }
  },
  async generateMap({ prompt }) {
    try {
      const res = await openai().images.generate({
        model: IMAGE_MODEL,
        prompt,
        size: "1536x1024",
        background: "opaque",
        output_format: "webp",
        output_compression: 92,
        quality: "medium",
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new AiError("invalid_output", "The image service returned no image");
      return Buffer.from(b64, "base64");
    } catch (err) {
      throw imageError(err, "The image service declined this description");
    }
  },
  async generateItem({ prompt }) {
    try {
      const res = await openai().images.generate({
        model: IMAGE_MODEL,
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
      throw imageError(err, "The image service declined this gift description");
    }
  },
  async editMap({ image, mime, mask, width, height, prompt }) {
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const size = OPENAI_SIZES.has(`${width}x${height}`) ? `${width}x${height}` : "auto";
    try {
      const res = await openai().images.edit({
        model: IMAGE_MODEL,
        image: await toFile(image, `map.${ext}`, { type: mime }),
        mask: await toFile(mask, "mask.png", { type: "image/png" }),
        prompt,
        size,
        background: "opaque",
        output_format: "png",
        quality: "medium",
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new AiError("invalid_output", "The image service returned no image");
      return Buffer.from(b64, "base64");
    } catch (err) {
      throw imageError(err, "The image service declined this edit");
    }
  },
};

export function getImageProvider(): ImageProvider {
  if (!imageConfigured()) throw new AiError("not_configured", "No image generation API is configured");
  if (IMAGE_PROVIDER === "openai") return openaiProvider;
  throw new AiError("not_configured", `Unknown IMAGE_PROVIDER "${IMAGE_PROVIDER}"`);
}

const WORLD_STYLE: Record<string, string> = {
  "western-fantasy": "fits a storybook western-fantasy adventure (tunics, cloaks, leather boots and belts)",
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
    ...(opts.world === "western-fantasy"
      ? [
          // Matches the Western Fantasy map kit (PIXEL_ART_STYLE_GUIDE.md §17) and the default cast.
          "Style: handcrafted adventure-RPG pixel art in a three-quarter top-down view. Chibi proportions about 2.5 heads tall, small dark eyes with a warm highlight.",
          "Standing pose, facing the viewer with a slight top-down view, arms relaxed at the sides, feet together at the bottom. One character only, centered, filling most of the height.",
          "Large clean pixel clusters on a coarse grid (as if drawn at 32×32 and scaled up), a 1-pixel dark warm brown outline (#24180f) around the silhouette, never pure black.",
          "Earthy adventurer palette (cloth, leather, wool: teal, crimson, olive, ochre, warm browns), at most about 12 colors, 3-tone hue-shifted shading lit from the top-left: shadows deep and warm, highlights golden.",
        ]
      : [
          "Style: charming, lighthearted 16-bit pixel art. Chibi proportions about 2 heads tall, big head, simple dot eyes with a small white shine, soft blush.",
          "Standing pose, facing the viewer straight on with a very slight top-down view, arms relaxed at the sides, feet together at the bottom. One character only, centered, filling most of the height.",
          "Large clean pixel clusters on a coarse grid (as if drawn at 32×32 and scaled up), a 1-pixel soft violet outline (#5b4a86) around the silhouette, never pure black.",
          "Soft but colorful pastel palette, at most about 12 colors, 3-tone hue-shifted shading lit from the top-left: shadows cooler, highlights warmer.",
        ]),
    "No anti-aliasing, no gradients, no blur, no dithering noise, no text, no shadow on the ground, no background: fully transparent background.",
    opts.world ? `The outfit ${WORLD_STYLE[opts.world] ?? "fits the game world"}, but keep the reference's clothing recognizable.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** A gift item in the game's pixel style. The player's words are quoted as data, never as instructions. */
export function giftPrompt(opts: { name: string; description: string; world: string | null }) {
  return [
    "Draw ONE small object as a pixel-art game inventory item, centered, filling most of the square.",
    `The item is a gift called: "${opts.name.trim().slice(0, 40)}".`,
    opts.description.trim() ? `The player describes it as: "${opts.description.trim().slice(0, 240)}".` : "",
    "Style: charming, cozy 16-bit pixel art, as if drawn at 32×32 and scaled up: large clean pixel clusters, a 1-pixel soft violet outline (#5b4a86), never pure black.",
    "Soft pastel palette, at most about 10 colors, simple 3-tone shading lit from the top-left.",
    "No characters or people, no hands, no text or letters, no ground shadow, no background: fully transparent background.",
    opts.world ? `It ${WORLD_STYLE[opts.world] ?? "fits the game world"}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
