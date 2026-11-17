/**
 * MAP PIXEL GRID (pure, no DOM, unit-tested)
 * --------------------------------------------------------------------------
 * Image models draw a 1536×1024 "pixel-art-looking" illustration whose
 * pixels are 2–5 px wide and never line up with a grid. Shown in the game,
 * that reads as a high-resolution painting next to 32 px characters
 * (see PIXEL_ART_STYLE_GUIDE.md §3).
 *
 * `snapMapToGrid` turns such a picture into REAL pixel art at the game's
 * native resolution, the same grid the characters are drawn on:
 *   1. downsample to the native size, each pixel taking the most common
 *      colour of its cell (not the average, so edges stay hard);
 *   2. reduce to a limited palette (deliberate colour clusters, 3–5 tones
 *      per material instead of hundreds of near-identical shades);
 *   3. remove stray single pixels and low-contrast speckle (organised
 *      clusters and quiet walking surfaces, not noise).
 * The result is drawn with nearest-neighbour scaling at whole-pixel zooms.
 *
 * `guessWalkable` makes the first-guess floor for the Play area editor from
 * the snapped picture: the large, calm, connected ground regions.
 */
import { blank, downsample, quantize, type Img } from "../sprites/pixelize";

/** Native map size (art px). One map pixel = one character-sprite pixel at the default character size. */
export const MAP_NATIVE_WIDTH = 480;
/** Colours in a snapped map. Rich enough for 4–6 materials × 3–5 tones, few enough to read as pixel art. */
export const MAP_PALETTE = 40;
/** A stored map this narrow (or narrower) is already on the art-pixel grid. */
export const NATIVE_MAX_WIDTH = 800;

export const isNativeSize = (width: number) => width <= NATIVE_MAX_WIDTH;

/** Native size for a picture of this aspect ratio. */
export function nativeSize(width: number, height: number, nativeWidth = MAP_NATIVE_WIDTH) {
  return { width: nativeWidth, height: Math.max(1, Math.round((nativeWidth * height) / Math.max(1, width))) };
}

const at = (img: Img, x: number, y: number) => (y * img.w + x) * 4;
const key = (d: Uint8ClampedArray, i: number) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];

/**
 * Replace isolated pixels: a pixel none of whose 4 neighbours share its
 * colour, while at least 5 of its 8 neighbours agree on another colour,
 * takes that colour. Thin lines (outlines, fence rails) survive because
 * they always have a same-coloured neighbour along the line.
 */
export function despeckle(img: Img): Img {
  const out: Img = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  const d = img.data;
  for (let y = 1; y < img.h - 1; y++)
    for (let x = 1; x < img.w - 1; x++) {
      const i = at(img, x, y);
      const k = key(d, i);
      if (k === key(d, at(img, x - 1, y)) || k === key(d, at(img, x + 1, y)) || k === key(d, at(img, x, y - 1)) || k === key(d, at(img, x, y + 1))) continue;
      const counts = new Map<number, number>();
      let best = -1;
      let bestN = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = key(d, at(img, x + dx, y + dy));
          const c = (counts.get(n) ?? 0) + 1;
          counts.set(n, c);
          if (c > bestN) {
            bestN = c;
            best = n;
          }
        }
      if (bestN >= 5) {
        out.data[i] = (best >> 16) & 255;
        out.data[i + 1] = (best >> 8) & 255;
        out.data[i + 2] = best & 255;
      }
    }
  return out;
}

/**
 * Quiet the texture without touching the drawing: a pixel that is only a
 * little different from the colour most of its 3×3 neighbours share takes
 * that colour. Low-contrast speckle on floors, grass and plaster becomes
 * calm clusters; outlines, edges and real features (high contrast) stay.
 */
export function calmTexture(img: Img, maxDist = 34): Img {
  const out: Img = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  const d = img.data;
  const max2 = maxDist * maxDist;
  for (let y = 1; y < img.h - 1; y++)
    for (let x = 1; x < img.w - 1; x++) {
      const i = at(img, x, y);
      const counts = new Map<number, number>();
      let best = -1;
      let bestN = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = key(d, at(img, x + dx, y + dy));
          const c = (counts.get(n) ?? 0) + 1;
          counts.set(n, c);
          if (c > bestN) {
            bestN = c;
            best = n;
          }
        }
      if (bestN < 5 || best === key(d, i)) continue;
      const r = (best >> 16) & 255, g = (best >> 8) & 255, b = best & 255;
      if ((d[i] - r) ** 2 + (d[i + 1] - g) ** 2 + (d[i + 2] - b) ** 2 > max2) continue;
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
    }
  return out;
}

/** Big generated picture → native-resolution pixel art (opaque). */
export function snapMapToGrid(src: Img, opts: { width?: number; height?: number; colors?: number } = {}): Img {
  const size = opts.width && opts.height ? { width: opts.width, height: opts.height } : nativeSize(src.w, src.h);
  // Maps are opaque: treat any transparency as solid so no hole appears.
  const solid: Img = { w: src.w, h: src.h, data: new Uint8ClampedArray(src.data) };
  for (let i = 3; i < solid.data.length; i += 4) solid.data[i] = 255;
  const small = size.width >= src.w ? solid : downsample(solid, { x: 0, y: 0, w: src.w, h: src.h }, size.width, size.height);
  return calmTexture(despeckle(quantize(small, opts.colors ?? MAP_PALETTE)));
}

/** Nearest-neighbour enlargement to an exact size (for sending a native map to the image service). */
export function enlarge(img: Img, width: number, height: number): Img {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.h - 1, Math.floor((y * img.h) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.w - 1, Math.floor((x * img.w) / width));
      const s = at(img, sx, sy);
      out.data.set(img.data.subarray(s, s + 4), (y * width + x) * 4);
    }
  }
  return out;
}

/** Share of distinct colours (a quick "is this real pixel art" check for tests and the QA checklist). */
export function colorCount(img: Img): number {
  const s = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] >= 128) s.add(key(img.data, i));
  return s.size;
}

// ---------------------------------------------------------------- first-guess floor

/** Squared colour distance that counts as an edge (≈ 48 RGB steps). */
const EDGE2 = 48 * 48;
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Water and deep shadow are never floor, however calm they look. */
function neverFloor(r: number, g: number, b: number): boolean {
  if (luma(r, g, b) < 55) return true;
  const water = b > r + 25 && b >= g - 12 && b > 90;
  return water;
}

/**
 * First guess at where characters can walk, as a `cols × rows` floor string
 * ("1" = floor), or null when nothing convincing was found (the caller then
 * uses the simple shape guess). It looks for the big, calm, connected
 * regions of a few ground colours, favouring the middle and lower part of
 * the picture where the style guide puts the playable ground. It is only a
 * first guess: the player reviews it in the Play area editor.
 */
export function guessWalkable(img: Img, cols: number, rows: number): string | null {
  const { w, h } = img;
  const coarse = quantize(img, 8);
  const d = coarse.data;
  const index = new Map<number, number>();
  const ci = new Int16Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const k = key(d, p * 4);
    let n = index.get(k);
    if (n === undefined) index.set(k, (n = index.size));
    ci[p] = n;
  }
  const colors = [...index.keys()];

  // Busy pixels: a clearly different colour to the right or below. Ground is calm (plank lines and grass
  // tufts are low-contrast); outlines of furniture, foliage, walls and props are strong.
  const src = img.data;
  const far = (a: number, b: number) => (src[a] - src[b]) ** 2 + (src[a + 1] - src[b + 1]) ** 2 + (src[a + 2] - src[b + 2]) ** 2 > EDGE2;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if ((x + 1 < w && far(p * 4, (p + 1) * 4)) || (y + 1 < h && far(p * 4, (p + w) * 4))) edge[p] = 1;
    }
  // Integral image of busy pixels → density in a 7×7 window.
  const sum = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += edge[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const R = 3;
  const density = (x: number, y: number) => {
    const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(w, x + R + 1), y1 = Math.min(h, y + R + 1);
    const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
    return s / ((x1 - x0) * (y1 - y0));
  };
  const dens = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dens[y * w + x] = density(x, y);

  // Score each colour by how much calm area it covers where the ground usually is.
  const score = new Float64Array(colors.length);
  const total = new Float64Array(colors.length);
  const calm = new Float64Array(colors.length);
  for (let y = 0; y < h; y++) {
    const fy = y / h;
    const wy = fy < 0.15 ? 0.2 : fy < 0.3 ? 0.6 : 1;
    for (let x = 0; x < w; x++) {
      const fx = x / w;
      const wx = fx < 0.08 || fx > 0.92 ? 0.5 : 1;
      const p = y * w + x;
      total[ci[p]]++;
      if (dens[p] < 0.22) {
        calm[ci[p]]++;
        score[ci[p]] += wx * wy;
      }
    }
  }
  const order = colors.map((_, i) => i).filter((i) => {
    const c = colors[i];
    return !neverFloor((c >> 16) & 255, (c >> 8) & 255, c & 255) && total[i] > 0 && calm[i] / total[i] >= 0.25;
  });
  order.sort((a, b) => score[b] - score[a]);
  if (!order.length) return null;
  const all = order.reduce((s, i) => s + score[i], 0);
  const ground = new Set<number>();
  let acc = 0;
  for (const i of order) {
    if (ground.size && (acc >= all * 0.85 || score[i] < score[order[0]] * 0.12)) break;
    ground.add(i);
    acc += score[i];
  }

  // Cells: mostly ground colour and mostly calm.
  let cells = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      const y0 = Math.floor((r * h) / rows), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
      let g = 0, n = 0, dsum = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const p = y * w + x;
          n++;
          if (ground.has(ci[p])) g++;
          dsum += dens[p];
        }
      cells[r * cols + c] = g / n >= 0.6 && dsum / n < 0.3 ? 1 : 0;
    }

  // Smooth: a cell follows the majority of its 3×3 block (fills specks, trims slivers).
  const smooth = (src: Uint8Array) => {
    const out = new Uint8Array(src.length);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let on = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
            n++;
            on += src[rr * cols + cc];
          }
        out[r * cols + c] = on * 2 > n ? 1 : 0;
      }
    return out;
  };
  cells = smooth(smooth(cells));

  // Keep the connected regions that matter: the biggest one and any other over 4% of the map.
  const label = new Int32Array(cells.length).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < cells.length; s++) {
    if (!cells[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const c = p % cols, r = (p - c) / cols;
      const next = [c > 0 ? p - 1 : -1, c < cols - 1 ? p + 1 : -1, r > 0 ? p - cols : -1, r < rows - 1 ? p + cols : -1];
      for (const q of next)
        if (q >= 0 && cells[q] && label[q] < 0) {
          label[q] = id;
          stack.push(q);
        }
    }
    sizes.push(n);
  }
  if (!sizes.length) return null;
  const biggest = Math.max(...sizes);
  const keep = new Set(sizes.map((n, i) => (n === biggest || n >= cells.length * 0.04 ? i : -1)).filter((i) => i >= 0));
  let on = 0;
  const floor = Array.from(cells, (v, i) => {
    const k = v && keep.has(label[i]);
    if (k) on++;
    return k ? "1" : "0";
  }).join("");
  return on / cells.length >= 0.08 ? floor : null;
}
