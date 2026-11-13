// Tiny pixel-art toolkit used by generate-placeholders.mjs.
// Draws into an RGBA buffer and writes PNG files with no dependencies.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const hex = (c) => {
  if (!c) return null;
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
  }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    const [r, g, b, a] = hex(c);
    const i = (y * this.w + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a;
  }
  filled(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.d[(y * this.w + x) * 4 + 3] > 0;
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }
  /** Filled ellipse. `c` is a color or a ramp [lo, base, hi] shaded with light from the top-left. */
  ellipse(cx, cy, rx, ry, c, clip = () => true) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1 || !clip(x, y)) continue;
        this.set(x, y, Array.isArray(c) ? shade(c, nx, ny) : c);
      }
  }
  /** Draw `fn` on its own layer, give it a 1px outline, then paste it here. */
  object(fn, outline) {
    const L = new Canvas(this.w, this.h);
    fn(L);
    if (outline) L.outline(outline);
    this.paste(L);
    return this;
  }
  outline(c) {
    const add = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!this.filled(x, y) && (this.filled(x - 1, y) || this.filled(x + 1, y) || this.filled(x, y - 1) || this.filled(x, y + 1))) add.push([x, y]);
    add.forEach(([x, y]) => this.set(x, y, c));
  }
  paste(L, ox = 0, oy = 0) {
    for (let y = 0; y < L.h; y++)
      for (let x = 0; x < L.w; x++) {
        const i = (y * L.w + x) * 4;
        if (L.d[i + 3] === 0) continue;
        const tx = x + ox, ty = y + oy;
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        const j = (ty * this.w + tx) * 4;
        this.d.set(L.d.subarray(i, i + 4), j);
      }
  }
  /** Paint a grid of letters using a palette map. */
  grid(rows, pal, ox = 0, oy = 0) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => pal[ch] && this.set(ox + x, oy + y, pal[ch])));
  }
  savePNG(file, scale = 1) {
    const w = this.w * scale, h = this.h * scale;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const s = (Math.floor(y / scale) * this.w + Math.floor(x / scale)) * 4;
        raw.set(this.d.subarray(s, s + 4), y * (w * 4 + 1) + 1 + x * 4);
      }
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
    ]));
  }
}

export function shade([lo, base, hi], nx, ny) {
  const d = nx * 0.55 + ny * 0.75;
  if (d > 0.42) return lo;
  if (d < -0.62 && hi) return hi;
  return base;
}

const T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = T[(c ^ b) & 255] ^ (c >>> 8); return c ^ -1; }

/** Deterministic random numbers so regenerated art is identical. */
export function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
