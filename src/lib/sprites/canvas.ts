"use client";

/** Browser glue for the pixel converter: files ↔ images ↔ RGBA buffers ↔ PNG data URLs. */
import { DEFAULT_CONVERT, makePortrait, makeSprite, type ConvertOptions, type Img } from "./pixelize";

export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export type FileProblem = "type" | "size" | null;
export function checkFile(file: File): FileProblem {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) return "type";
  if (file.size > MAX_FILE_BYTES) return "size";
  return null;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = src;
  });
}

export const readAsDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Draw an image into RGBA pixels, scaled down so the longest side is at most `maxSide`. */
export function toImg(el: HTMLImageElement, maxSide = 512): Img {
  const s = Math.min(1, maxSide / Math.max(el.naturalWidth, el.naturalHeight));
  const w = Math.max(1, Math.round(el.naturalWidth * s));
  const h = Math.max(1, Math.round(el.naturalHeight * s));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(el, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

export function imgToDataURL(img: Img): string {
  const c = document.createElement("canvas");
  c.width = img.w;
  c.height = img.h;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  return c.toDataURL("image/png");
}

export async function dataURLToImg(url: string, maxSide = 512): Promise<Img> {
  return toImg(await loadImage(url), maxSide);
}

/**
 * Re-encode an upload for sending: at most 1024 px, PNG. This also strips
 * photo metadata (location etc.). The player's original file is untouched.
 */
export async function prepareUpload(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const el = await loadImage(url);
    const s = Math.min(1, 1024 / Math.max(el.naturalWidth, el.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(el.naturalWidth * s);
    c.height = Math.round(el.naturalHeight * s);
    c.getContext("2d")!.drawImage(el, 0, 0, c.width, c.height);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Source picture → { sprite 32×32, portrait 96×96 } as PNG data URLs. */
export async function convertToGameArt(srcUrl: string, opts: ConvertOptions = DEFAULT_CONVERT): Promise<{ sprite: string; portrait: string; spriteImg: Img } | null> {
  const src = await dataURLToImg(srcUrl, 512);
  const sprite = makeSprite(src, opts);
  const portrait = makePortrait(src, opts);
  if (!sprite || !portrait) return null;
  return { sprite: imgToDataURL(sprite), portrait: imgToDataURL(portrait), spriteImg: sprite };
}
