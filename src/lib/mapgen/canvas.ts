/**
 * PIXEL CANVAS for the map kit (pure: no DOM, runs in the browser, Node and tests).
 * --------------------------------------------------------------------------
 * Everything is drawn one art pixel at a time on the map's native grid
 * (480×320, PIXEL_ART_STYLE_GUIDE.md §3), so every pixel is a deliberate
 * square of one palette colour: no filters, no resampling, no anti-aliasing.
 *
 * Objects are drawn on their own `Sprite` first (so they can get a 1 px
 * outline around their silhouette and a solid cast shadow), then stamped onto
 * the map in depth order.
 */
import type { Img } from "../sprites/pixelize";

export type RGB = readonly [number, number, number];

export const hex = (h: string): RGB => {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** Seeded random numbers (mulberry32): the same seed always draws the same map. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    int: (lo: number, hi: number) => Math.floor(lo + next() * (hi - lo + 1)),
    pick: <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length) % list.length],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

/** A string → 32-bit seed (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Smooth value noise in 0..1 (lattice every `cell` px), for big, calm terrain shapes. */
export function valueNoise(seed: number) {
  const lattice = (x: number, y: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, cell: number) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = fade(gx - x0);
    const ty = fade(gy - y0);
    const a = lattice(x0, y0) + (lattice(x0 + 1, y0) - lattice(x0, y0)) * tx;
    const b = lattice(x0, y0 + 1) + (lattice(x0 + 1, y0 + 1) - lattice(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

export class Canvas {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x: number, y: number, c: RGB) {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }
  get(x: number, y: number): RGB {
    const i = ((y | 0) * this.w + (x | 0)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  toImg(): Img {
    return { w: this.w, h: this.h, data: this.data };
  }
}

/**
 * An object drawn on its own, then stamped onto the map. `ox, oy` is where
 * its top-left lands on the map. Empty pixels are null.
 */
export class Sprite {
  readonly px: (RGB | null)[];
  constructor(
    readonly w: number,
    readonly h: number,
    public ox = 0,
    public oy = 0,
  ) {
    this.px = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: RGB | null) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x];
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
  /** Filled ellipse (pixel centres inside). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB | ((x: number, y: number, nx: number, ny: number) => RGB | null)) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const col = typeof c === "function" ? c(x, y, nx, ny) : c;
        if (col) this.set(x, y, col);
      }
  }
  /**
   * 1 px outline around the silhouette, drawn OUTSIDE the shape. `below`
   * (optional) is used on the lower and right edges, so the outline is a
   * touch heavier on the shadow side, as in hand-drawn sprites.
   */
  outline(c: RGB, below?: RGB) {
    const add: [number, number, RGB][] = [];
    for (let y = -1; y <= this.h; y++)
      for (let x = -1; x <= this.w; x++) {
        if (this.get(x, y)) continue;
        const l = this.get(x - 1, y), r = this.get(x + 1, y), u = this.get(x, y - 1), d = this.get(x, y + 1);
        if (!(l || r || u || d)) continue;
        add.push([x, y, below && (u || l) && !(d || r) ? below : c]);
      }
    // The sprite grows by one pixel on each side to make room.
    return add;
  }
}

/** Draw a sprite (with optional outline pixels from `Sprite.outline`) onto the map. */
export function stamp(cv: Canvas, s: Sprite, outline?: [number, number, RGB][]) {
  if (outline) for (const [x, y, c] of outline) cv.set(s.ox + x, s.oy + y, c);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const c = s.px[y * s.w + x];
      if (c) cv.set(s.ox + x, s.oy + y, c);
    }
}
