"use client";

/**
 * PASTE-BACK AFTER A REGION EDIT
 * --------------------------------------------------------------------------
 * Image models redraw the whole picture even when given a mask, so small
 * changes can creep in outside the selection. To keep the rest of the map
 * exactly as it was, only the selected rectangle of the edited image is
 * pasted onto the original. A thin soft border just inside the selection
 * blends the two, so there is no hard seam; outside the selection every
 * pixel is the original's.
 */
import { featherFor, regionPixels, type Region } from "./mapSelection";

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  return { c, ctx };
}

function toBlob(c: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => c.toBlob(resolve, type));
}

export async function compositeRegion(original: Blob, edited: Blob, region: Region): Promise<{ blob: Blob; width: number; height: number }> {
  const [base, next] = await Promise.all([createImageBitmap(original), createImageBitmap(edited)]);
  try {
    const { width, height } = base;
    const sel = regionPixels(region, width, height);
    const feather = featherFor(sel.width, sel.height);

    // The edited image scaled to the original's size, cut to the selection with soft edges.
    const patch = canvas(width, height);
    patch.ctx.imageSmoothingEnabled = true;
    patch.ctx.imageSmoothingQuality = "high";
    patch.ctx.drawImage(next, 0, 0, width, height);
    const fade = canvas(width, height);
    // Nested rectangles, each a little more opaque: alpha ramps 0→1 over `feather` px inside the edge.
    for (let i = 0; i < feather; i++) {
      fade.ctx.fillStyle = `rgba(0,0,0,${(i + 1) / feather})`;
      fade.ctx.clearRect(sel.left + i, sel.top + i, sel.width - 2 * i, sel.height - 2 * i);
      fade.ctx.fillRect(sel.left + i, sel.top + i, sel.width - 2 * i, sel.height - 2 * i);
    }
    patch.ctx.globalCompositeOperation = "destination-in";
    patch.ctx.drawImage(fade.c, 0, 0);

    const out = canvas(width, height);
    out.ctx.drawImage(base, 0, 0);
    out.ctx.drawImage(patch.c, 0, 0);

    // Lossless PNG, so repeated edits never wear down the untouched parts of the map.
    const blob = await toBlob(out.c, "image/png");
    if (!blob) throw new Error("Could not encode the edited map");
    return { blob, width, height };
  } finally {
    base.close();
    next.close();
  }
}
