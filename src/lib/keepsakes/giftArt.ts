/**
 * Gift pictures are 32×32 pixel art, the same grid the pixel editor uses.
 * A generated picture is turned into one with the sprite converter's steps,
 * centred (items float; characters stand on the bottom row).
 */
import { addOutline, blank, contentBox, downsample, place, quantize, removeFlatBackground, type Img } from "../sprites/pixelize";
import { GIFT_SIZE } from "./types";

export const blankGift = (): Img => blank(GIFT_SIZE, GIFT_SIZE);

export function makeItem(src: Img, colors = 10): Img | null {
  const img = removeFlatBackground(src);
  const box = contentBox(img);
  if (!box) return null;
  const room = GIFT_SIZE - 4; // 1px outline + 1px air on each side
  const s = Math.min(room / box.w, room / box.h);
  const w = Math.max(1, Math.round(box.w * s));
  const h = Math.max(1, Math.round(box.h * s));
  const small = quantize(downsample(img, box, w, h), colors);
  return addOutline(place(small, GIFT_SIZE, GIFT_SIZE, Math.floor((GIFT_SIZE - w) / 2), Math.floor((GIFT_SIZE - h) / 2)));
}

/** True if nothing has been drawn yet. */
export const isEmptyArt = (img: Img) => {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= 128) return false;
  return true;
};
