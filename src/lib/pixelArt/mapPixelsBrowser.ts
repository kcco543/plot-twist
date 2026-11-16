"use client";

/**
 * Browser glue for mapPixels.ts: Blob ⇄ pixels, and the three places a map
 * goes through the pixel grid (a new generation, an edit of a native map,
 * and "Pixel-grid copy" of an older map). The maths lives in mapPixels.ts.
 */
import type { Img } from "../sprites/pixelize";
import { enlarge, guessWalkable, snapMapToGrid } from "./mapPixels";
import { regionPixels, type Region } from "../mapSelection";
import { defaultLayout, type SceneLayout } from "../scene/layout";

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is not available");
  return { c, ctx };
}

export async function blobToImg(blob: Blob): Promise<Img> {
  const bmp = await createImageBitmap(blob);
  try {
    const { c, ctx } = canvas(bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { w: d.width, h: d.height, data: d.data };
  } finally {
    bmp.close();
  }
}

export async function imgToPng(img: Img): Promise<Blob> {
  const { c, ctx } = canvas(img.w, img.h);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode the map");
  return blob;
}

/** A first-guess play area for a snapped map: its calm, connected ground, with characters on the map's own pixel grid. */
export function firstLayout(img: Img): SceneLayout {
  const base = defaultLayout(img.w, img.h);
  const floor = guessWalkable(img, base.cols, base.rows);
  return floor ? { ...base, floor } : base;
}

/** A freshly generated picture → native pixel-art map (PNG) and its first-guess play area. */
export async function snapGenerated(blob: Blob): Promise<{ blob: Blob; width: number; height: number; scene: SceneLayout }> {
  const src = await blobToImg(blob);
  const img = snapMapToGrid(src);
  return { blob: await imgToPng(img), width: img.w, height: img.h, scene: firstLayout(img) };
}

/** The image service works on 1536×1024: a native map is enlarged (nearest neighbour) before an edit. */
export async function enlargeForEdit(blob: Blob, width: number, height: number): Promise<Blob> {
  const img = await blobToImg(blob);
  const big = width >= height ? { w: 1536, h: Math.round((1536 * height) / width) } : { w: Math.round((1024 * width) / height), h: 1024 };
  return imgToPng(enlarge(img, big.w, big.h));
}

/**
 * Paste the selected area of an edited picture onto a native map. The edit
 * is snapped to the same grid first; the paste has a hard edge (a soft one
 * would invent in-between colours) and every pixel outside the selection
 * stays exactly the original's.
 */
export async function compositeNative(original: Blob, edited: Blob, region: Region): Promise<{ blob: Blob; width: number; height: number }> {
  const [base, next] = await Promise.all([blobToImg(original), blobToImg(edited)]);
  const patch = snapMapToGrid(next, { width: base.w, height: base.h });
  const sel = regionPixels(region, base.w, base.h);
  const out: Img = { w: base.w, h: base.h, data: new Uint8ClampedArray(base.data) };
  for (let y = sel.top; y < Math.min(base.h, sel.top + sel.height); y++) {
    const i = (y * base.w + sel.left) * 4;
    const n = Math.max(0, Math.min(sel.width, base.w - sel.left)) * 4;
    out.data.set(patch.data.subarray(i, i + n), i);
  }
  return { blob: await imgToPng(out), width: base.w, height: base.h };
}
