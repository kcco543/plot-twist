/**
 * PIXEL CONVERSION (pure, no DOM)
 * Turns any picture (an AI result or an uploaded drawing) into game-ready
 * pixel art that meets docs/DESIGN_SYSTEM.md:
 *   sprite 32×32, character inside ~28 px tall, feet on row 30, 1px outline
 *   portrait 96×96 (drawn on a 48×48 grid, shown at 2×), head and shoulders
 *   hard edges only (no anti-aliasing), limited palette.
 */
export type Img = { w: number; h: number; data: Uint8ClampedArray };
export type Box = { x: number; y: number; w: number; h: number };

export const SPRITE_SIZE = 32;
export const PORTRAIT_SIZE = 96;
export const OUTLINE = [0x5b, 0x4a, 0x86] as const;

export type ConvertOptions = { colors: number; outline: boolean; removeBackground: boolean };
export const DEFAULT_CONVERT: ConvertOptions = { colors: 12, outline: true, removeBackground: true };

export const blank = (w: number, h: number): Img => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
const idx = (img: Img, x: number, y: number) => (y * img.w + x) * 4;

export function transparentShare(img: Img): number {
  let t = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) t++;
  return t / (img.w * img.h);
}

const dist2 = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) =>
  (a[ai] - b[bi]) ** 2 + (a[ai + 1] - b[bi + 1]) ** 2 + (a[ai + 2] - b[bi + 2]) ** 2;

/**
 * Photos and drawings on a plain backdrop: clear the backdrop by flood-filling
 * from the edges with colors close to the corner colors. Skipped when the
 * image already has transparency.
 */
export function removeFlatBackground(img: Img, tolerance = 42): Img {
  if (transparentShare(img) > 0.02) return img;
  const out: Img = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  const corners = [idx(img, 0, 0), idx(img, img.w - 1, 0), idx(img, 0, img.h - 1), idx(img, img.w - 1, img.h - 1)];
  const tol2 = tolerance * tolerance;
  const seen = new Uint8Array(img.w * img.h);
  const stack: number[] = [];
  for (let x = 0; x < img.w; x++) stack.push(x, (img.h - 1) * img.w + x);
  for (let y = 0; y < img.h; y++) stack.push(y * img.w, y * img.w + img.w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!corners.some((c) => dist2(img.data, i, img.data, c) <= tol2)) continue;
    out.data[i + 3] = 0;
    const x = p % img.w;
    const y = (p - x) / img.w;
    if (x > 0) stack.push(p - 1);
    if (x < img.w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - img.w);
    if (y < img.h - 1) stack.push(p + img.w);
  }
  return out;
}

export function contentBox(img: Img, alphaMin = 64): Box | null {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[idx(img, x, y) + 3] >= alphaMin) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Shrink `box` of `img` to outW×outH. Each output pixel takes the MOST COMMON
 * color in its cell (not the average), so edges stay hard and colors stay
 * true. Cells that are mostly transparent become transparent.
 */
export function downsample(img: Img, box: Box, outW: number, outH: number): Img {
  const out = blank(outW, outH);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const sx0 = box.x + Math.floor((ox * box.w) / outW);
      const sx1 = Math.max(sx0 + 1, box.x + Math.floor(((ox + 1) * box.w) / outW));
      const sy0 = box.y + Math.floor((oy * box.h) / outH);
      const sy1 = Math.max(sy0 + 1, box.y + Math.floor(((oy + 1) * box.h) / outH));
      const buckets = new Map<number, [number, number, number, number]>();
      let total = 0, opaque = 0;
      for (let y = sy0; y < sy1; y++)
        for (let x = sx0; x < sx1; x++) {
          total++;
          const i = idx(img, x, y);
          if (img.data[i + 3] < 128) continue;
          opaque++;
          const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
          const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          const e = buckets.get(key);
          if (e) {
            e[0] += r; e[1] += g; e[2] += b; e[3]++;
          } else buckets.set(key, [r, g, b, 1]);
        }
      if (opaque / total < 0.45) continue;
      let best: [number, number, number, number] | null = null;
      for (const e of buckets.values()) if (!best || e[3] > best[3]) best = e;
      const o = idx(out, ox, oy);
      out.data[o] = Math.round(best![0] / best![3]);
      out.data[o + 1] = Math.round(best![1] / best![3]);
      out.data[o + 2] = Math.round(best![2] / best![3]);
      out.data[o + 3] = 255;
    }
  }
  return out;
}

/** Reduce to at most k colors (k-means seeded with the most common colors). Alpha becomes 0 or 255. */
export function quantize(img: Img, k: number): Img {
  const px: number[] = [];
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] >= 128) px.push(i);
  const out: Img = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = out.data[i] >= 128 ? 255 : 0;
  if (px.length === 0) return out;
  const counts = new Map<string, number>();
  for (const i of px) {
    const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size <= k) return out;
  let centers = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .reduce<number[][]>((acc, [key]) => {
      const c = key.split(",").map(Number);
      if (acc.length < k && acc.every((a) => (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2 > 300)) acc.push(c);
      return acc;
    }, []);
  if (centers.length === 0) centers = [[img.data[px[0]], img.data[px[0] + 1], img.data[px[0] + 2]]];
  const assign = new Int32Array(px.length);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    px.forEach((i, n) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, ci) => {
        const d = (img.data[i] - c[0]) ** 2 + (img.data[i + 1] - c[1]) ** 2 + (img.data[i + 2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = ci; }
      });
      assign[n] = best;
      const s = sums[best];
      s[0] += img.data[i]; s[1] += img.data[i + 1]; s[2] += img.data[i + 2]; s[3]++;
    });
    centers = centers.map((c, ci) => (sums[ci][3] ? [sums[ci][0] / sums[ci][3], sums[ci][1] / sums[ci][3], sums[ci][2] / sums[ci][3]] : c));
  }
  px.forEach((i, n) => {
    const c = centers[assign[n]];
    out.data[i] = Math.round(c[0]);
    out.data[i + 1] = Math.round(c[1]);
    out.data[i + 2] = Math.round(c[2]);
  });
  return out;
}

/** 1px soft-violet outline around the silhouette (on transparent pixels touching it). */
export function addOutline(img: Img, color: readonly number[] = OUTLINE): Img {
  const out: Img = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < img.w && y < img.h && img.data[idx(img, x, y) + 3] >= 128;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        const o = idx(out, x, y);
        out.data[o] = color[0]; out.data[o + 1] = color[1]; out.data[o + 2] = color[2]; out.data[o + 3] = 255;
      }
    }
  return out;
}

/** Copy `src` onto a new w×h canvas at (dx, dy). */
export function place(src: Img, w: number, h: number, dx: number, dy: number): Img {
  const out = blank(w, h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      out.data.set(src.data.subarray(idx(src, x, y), idx(src, x, y) + 4), idx(out, tx, ty));
    }
  return out;
}

export function upscale(img: Img, s: number): Img {
  const out = blank(img.w * s, img.h * s);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) out.data.set(img.data.subarray(idx(img, (x / s) | 0, (y / s) | 0), idx(img, (x / s) | 0, (y / s) | 0) + 4), idx(out, x, y));
  return out;
}

function fit(box: Box, maxW: number, maxH: number) {
  const scale = Math.min(maxW / box.w, maxH / box.h);
  return { w: Math.max(1, Math.round(box.w * scale)), h: Math.max(1, Math.round(box.h * scale)) };
}

/** Standing sprite: 32×32, feet on row 30, centered. */
export function makeSprite(src: Img, opts: ConvertOptions = DEFAULT_CONVERT): Img | null {
  const img = opts.removeBackground ? removeFlatBackground(src) : src;
  const box = contentBox(img);
  if (!box) return null;
  const pad = opts.outline ? 1 : 0;
  const { w, h } = fit(box, SPRITE_SIZE - 2 - pad * 2, 30 - pad * 2 - 1);
  let small = quantize(downsample(img, box, w, h), opts.colors);
  const bottom = 30 - pad; // last content row
  let out = place(small, SPRITE_SIZE, SPRITE_SIZE, Math.floor((SPRITE_SIZE - w) / 2), bottom - h + 1);
  if (opts.outline) out = addOutline(out);
  small = out;
  return small;
}

/** Portrait: head and shoulders from the top of the figure, 48×48 grid shown at 2× (96×96). */
export function makePortrait(src: Img, opts: ConvertOptions = DEFAULT_CONVERT): Img | null {
  const img = opts.removeBackground ? removeFlatBackground(src) : src;
  const full = contentBox(img);
  if (!full) return null;
  const side = Math.min(full.w, Math.max(Math.round(full.h * 0.55), Math.round(full.w * 0.6)));
  const crop: Box = {
    x: Math.max(0, Math.round(full.x + full.w / 2 - side / 2)),
    y: full.y,
    w: Math.min(side, img.w),
    h: Math.min(side, full.h),
  };
  const pad = opts.outline ? 1 : 0;
  const { w, h } = fit(crop, 46 - pad * 2, 46 - pad * 2);
  let grid = place(quantize(downsample(img, crop, w, h), Math.min(16, opts.colors + 4)), 48, 48, Math.floor((48 - w) / 2), 48 - h - pad);
  if (opts.outline) grid = addOutline(grid);
  return upscale(grid, 2);
}

/** Distinct opaque colors (for the pixel editor palette). */
export function paletteOf(img: Img, max = 24): string[] {
  const seen = new Map<string, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue;
    const hex = "#" + [img.data[i], img.data[i + 1], img.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    seen.set(hex, (seen.get(hex) ?? 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([h]) => h);
}

/** Checks that a sprite meets the game's spec. */
export function checkSprite(img: Img): { ok: boolean; issues: ("size" | "empty" | "softEdges" | "tooManyColors")[] } {
  const issues: ("size" | "empty" | "softEdges" | "tooManyColors")[] = [];
  if (img.w !== SPRITE_SIZE || img.h !== SPRITE_SIZE) issues.push("size");
  let opaque = 0, soft = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] === 255) opaque++;
    else if (img.data[i] > 0) soft++;
  }
  if (opaque < 20) issues.push("empty");
  if (soft > 0) issues.push("softEdges");
  if (paletteOf(img, 64).length > 24) issues.push("tooManyColors");
  return { ok: issues.length === 0, issues };
}
