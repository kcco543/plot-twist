"use client";

/** Browser glue for portraits: data URLs ↔ pixel buffers, the avatar render and the reference copy. */
import { dataURLToImg, imgToDataURL, loadImage } from "../sprites/canvas";
import type { Img } from "../sprites/pixelize";
import { makeId } from "../id";
import { presetRect, renderAvatar, toEditable, type CropPreset, type CropRect, type PortraitKind, type PortraitVersion } from "./model";

/** Load a stored version exactly (no resampling: max side is far above any portrait). */
export const loadPixels = (url: string) => dataURLToImg(url, 4096);

export function versionFromImg(img: Img, kind: PortraitKind, parentId: string | null, reference: string | null = null): PortraitVersion {
  return { id: makeId("pv"), kind, image: imgToDataURL(img), w: img.w, h: img.h, createdAt: Date.now(), parentId, ...(reference ? { reference } : {}) };
}

export function avatarFromImg(img: Img, rect: CropRect, preset: CropPreset) {
  const { avatar, thumb } = renderAvatar(img, rect);
  return { rect, preset, avatar: imgToDataURL(avatar), avatarW: avatar.w, avatarH: avatar.h, thumb: imgToDataURL(thumb) };
}

export const autoAvatar = (img: Img, preset: CropPreset = "head") => avatarFromImg(img, presetRect(img, preset), preset);

/** Older art (96×96 portrait = 48×48 grid at 2×) → editable pixels at their true size. */
export async function editableFromUrl(url: string): Promise<Img> {
  return toEditable(await loadPixels(url));
}

/**
 * A small copy of the uploaded reference (longest side 192 px, JPEG), kept
 * with the generated version so the original upload is never lost or
 * changed. The player's file itself is never modified or re-uploaded.
 */
export async function referenceCopy(src: string): Promise<string | null> {
  try {
    const el = await loadImage(src);
    const s = Math.min(1, 192 / Math.max(el.naturalWidth, el.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(el.naturalWidth * s));
    c.height = Math.max(1, Math.round(el.naturalHeight * s));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(el, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}
