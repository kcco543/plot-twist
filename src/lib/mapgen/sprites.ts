/**
 * MAP KIT PROPS — every object drawn pixel by pixel on its own sprite.
 * Adventure-RPG shape language (PIXEL_ART_STYLE_GUIDE.md §5–7, §17):
 *   - one three-quarter top-down angle: top faces and front faces both visible
 *   - strong silhouettes: lobed canopies, gnarled trunks with roots, steep
 *     roofs with flared eaves, heavy timber, rounded stones
 *   - hue-shifted ramps (warm lights, brown shadows), light from the upper left
 *   - one dark warm outline around everything solid
 *
 * Each builder returns the sprite plus its BASE (where it touches the ground).
 */
import { Sprite, type RGB, type Rng } from "./canvas";
import type { Palette } from "./palette";

export type Built = { sprite: Sprite; baseX: number; baseY: number };

const hash = (x: number, y: number, s = 0) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Pick a tone from a ramp by a light value (-1 shade … +1 lit). `bias` shifts the whole thing darker (<0). */
function tone(r: RGB[], l: number, bias = 0): RGB {
  const v = l + bias;
  const n = r.length;
  // Hard steps: most of the surface sits in the two middle tones.
  const cuts = n >= 6 ? [-0.62, -0.25, 0.12, 0.45, 0.72] : n === 5 ? [-0.55, -0.15, 0.25, 0.6] : [-0.4, 0.1, 0.5];
  let i = 0;
  while (i < cuts.length && v > cuts[i]) i++;
  return r[Math.min(n - 1, i)];
}

// ---------------------------------------------------------------- foliage

type Clump = { x: number; y: number; r: number };

/**
 * A canopy built from leaf clumps. Each clump has a lobed edge, its own
 * light (so the canopy reads as masses, not one blob), a dark rim where it
 * sits over the clump behind, scalloped leaf marks in the mid tones and a
 * few sunlit tips.
 */
export function canopy(s: Sprite, p: Palette, clumps: Clump[], seed: number, opts: { ramp?: RGB[]; bias?: number } = {}) {
  const R = opts.ramp ?? p.leaf;
  const bias = opts.bias ?? 0;
  // Back clumps (higher on screen) first, front clumps last.
  const order = [...clumps].sort((a, b) => a.y - b.y);
  order.forEach((c, ci) => {
    const lobes = 5 + Math.floor(hash(ci, 1, seed) * 3);
    const phase = hash(ci, 2, seed) * 6.28;
    const rx = c.r;
    const ry = c.r * 0.86;
    for (let y = Math.floor(c.y - ry - 3); y <= c.y + ry + 3; y++)
      for (let x = Math.floor(c.x - rx - 3); x <= c.x + rx + 3; x++) {
        const dx = (x + 0.5 - c.x) / rx;
        const dy = (y + 0.5 - c.y) / ry;
        const a = Math.atan2(dy, dx);
        const edge = 1 + 0.09 * Math.sin(a * lobes + phase) + 0.05 * Math.sin(a * (lobes * 2 + 1) + phase * 1.7);
        const d = Math.hypot(dx, dy);
        if (d > edge) continue;
        // Light from the upper left, evaluated in 2×2 blocks so tones form clusters.
        const bx = ((x >> 1) << 1) + 1 - c.x;
        const by = ((y >> 1) << 1) + 1 - c.y;
        let l = -(bx / rx) * 0.5 - (by / ry) * 0.85;
        l -= Math.max(0, d - 0.75) * 0.6; // the rim turns away from the light
        let col = tone(R, l, bias);
        // Dark rim on the lower half where this clump overlaps what is behind it.
        if (d > edge - 0.12 && dy > -0.1 && s.get(x, y)) col = R[Math.max(0, 1 + Math.round(bias))];
        s.set(x, y, col);
      }
    // Scalloped leaf marks: little dark arcs in the mid tones.
    const marks = Math.round(c.r * 0.45);
    for (let i = 0; i < marks; i++) {
      const mx = Math.round(c.x + (hash(ci, i + 10, seed) - 0.5) * c.r * 1.3);
      const my = Math.round(c.y + (hash(ci, i + 40, seed) - 0.35) * c.r * 1.1);
      const under = s.get(mx, my);
      if (!under || (under !== R[3] && under !== R[2])) continue;
      const d = under === R[3] ? R[2] : R[1];
      s.set(mx, my, d);
      s.set(mx + 1, my + 1, d);
      s.set(mx + 2, my + 1, d);
      s.set(mx + 3, my, d);
    }
    // Sunlit tips on the upper left.
    for (let i = 0; i < 3; i++) {
      const hx = Math.round(c.x - c.r * (0.25 + hash(ci, i + 70, seed) * 0.4));
      const hy = Math.round(c.y - c.r * (0.35 + hash(ci, i + 90, seed) * 0.35));
      if (s.get(hx, hy) === R[4] || s.get(hx, hy) === R[3]) {
        s.set(hx, hy, R[5] ?? R[4]);
        s.set(hx + 1, hy, R[5] ?? R[4]);
        s.set(hx, hy + 1, R[4]);
      }
    }
  });
}

/** Bark: vertical grooves, a lit left edge, dark right edge. */
function barkPixel(p: Palette, x: number, y: number, x0: number, x1: number): RGB {
  const w = x1 - x0;
  const t = (x - x0) / Math.max(1, w);
  const groove = hash(x, Math.floor(y / 5), 7) < 0.18 || (x - x0) % 4 === 3;
  if (t < 0.18) return p.bark[4];
  if (t > 0.78) return p.bark[1];
  if (groove) return p.bark[2];
  return t < 0.45 ? p.bark[3] : p.bark[2];
}

/**
 * A gnarled old tree: a thick trunk that flares into roots, a couple of
 * bare branches showing under a big lobed canopy.
 */
export function gnarledTree(p: Palette, r: Rng, size = 1): Built {
  const R = Math.round(24 * size);
  const W = Math.round(R * 3.1);
  const trunkH = Math.round(24 * size);
  const H = Math.round(R * 2.3) + trunkH;
  const s = new Sprite(W, H);
  const cx = Math.round(W / 2 + r.range(-3, 3));
  const base = H - 1;
  const tw = Math.round(11 * size);
  // Roots: tapering curves spreading out along the ground.
  const roots = [-1, -0.45, 0.5, 1].map((dir) => ({ dir, len: Math.round((10 + r.range(0, 8)) * size) }));
  for (const rt of roots)
    for (let i = 0; i < rt.len; i++) {
      const x = Math.round(cx + rt.dir * (tw / 2 + i));
      const y = Math.round(base - 3 + i * 0.25 + Math.sin(i * 0.5) * 0.6);
      const th = Math.max(1, Math.round(4 * (1 - i / rt.len)));
      for (let k = 0; k < th; k++) s.set(x, y - k, k === th - 1 ? p.bark[3] : k === 0 ? p.bark[1] : p.bark[2]);
    }
  // Trunk: wider at the base, a slight lean.
  const lean = r.range(-0.12, 0.12);
  const top = base - trunkH - Math.round(R * 0.6);
  for (let y = top; y <= base; y++) {
    const t = (y - top) / (base - top);
    const half = tw / 2 + (t > 0.7 ? (t - 0.7) * 14 * size : 0);
    const mid = cx + (base - y) * lean;
    const x0 = Math.round(mid - half);
    const x1 = Math.round(mid + half);
    for (let x = x0; x < x1; x++) s.set(x, y, barkPixel(p, x, y, x0, x1));
  }
  // Two bare branches reaching out under the canopy.
  for (const dir of [-1, 1]) {
    const by = top + Math.round(R * 0.55 + r.range(0, 6));
    for (let i = 0; i < Math.round(R * 0.8); i++) {
      const x = Math.round(cx + dir * (tw / 2 + i));
      const y = Math.round(by - i * 0.55);
      s.set(x, y, p.bark[2]);
      s.set(x, y + 1, p.bark[1]);
      if (i % 5 === 2) s.set(x, y - 1, p.bark[3]);
    }
  }
  // Canopy: one big mass with clumps around and on top of it.
  const cy = Math.round(R * 1.1);
  const clumps: Clump[] = [
    { x: cx, y: cy, r: R },
    { x: cx - R * 0.85, y: cy + R * 0.3, r: R * 0.62 },
    { x: cx + R * 0.9, y: cy + R * 0.25, r: R * 0.64 },
    { x: cx - R * 0.35, y: cy - R * 0.55, r: R * 0.6 },
    { x: cx + R * 0.45, y: cy - R * 0.5, r: R * 0.55 },
    { x: cx - R * 0.15, y: cy + R * 0.6, r: R * 0.58 },
    { x: cx + R * 0.55, y: cy + R * 0.62, r: R * 0.45 },
  ];
  canopy(s, p, clumps, r.int(0, 9999));
  return { sprite: s, baseX: cx, baseY: base };
}

/** A smaller round tree for the edges. `deep` = in the woods behind: darker. */
export function tree(p: Palette, r: Rng, size = 1, deep = 0): Built {
  const R = Math.round(17 * size);
  const W = R * 2 + 16;
  const trunkH = Math.round(12 * size);
  const H = Math.round(R * 2.1) + trunkH + 2;
  const s = new Sprite(W, H);
  const cx = Math.round(W / 2);
  const base = H - 1;
  const tw = Math.max(6, Math.round(8 * size));
  for (let y = base - trunkH - 8; y <= base; y++) {
    const flare = y > base - 3 ? (y - (base - 3)) * 1.5 : 0;
    const x0 = Math.round(cx - tw / 2 - flare);
    const x1 = Math.round(cx + tw / 2 + flare);
    for (let x = x0; x < x1; x++) s.set(x, y, barkPixel(p, x, y, x0, x1));
  }
  const top = R + 1;
  canopy(
    s,
    p,
    [
      { x: cx, y: top + R * 0.1, r: R },
      { x: cx - R * 0.62, y: top + R * 0.45, r: R * 0.6 },
      { x: cx + R * 0.62, y: top + R * 0.4, r: R * 0.62 },
      { x: cx - R * 0.1, y: top - R * 0.5, r: R * 0.6 },
      { x: cx + r.range(-2, 2), y: top + R * 0.72, r: R * 0.55 },
    ],
    r.int(0, 9999),
    deep ? { ramp: p.leaf, bias: -0.45 * deep } : {},
  );
  return { sprite: s, baseX: cx, baseY: base };
}

/** Low leafy shrub with a few ferny fronds. */
export function bush(p: Palette, r: Rng, w = 24): Built {
  const H = Math.round(w * 0.6) + 3;
  const s = new Sprite(w + 6, H);
  const cx = (w + 6) / 2;
  canopy(
    s,
    p,
    [
      { x: cx, y: H * 0.5, r: w * 0.3 },
      { x: cx - w * 0.26, y: H * 0.62, r: w * 0.24 },
      { x: cx + w * 0.27, y: H * 0.6, r: w * 0.25 },
    ],
    r.int(0, 9999),
    { ramp: p.leaf, bias: 0.1 },
  );
  return { sprite: s, baseX: Math.round(cx), baseY: H - 1 };
}

// ---------------------------------------------------------------- architecture

/** Rounded stones in rows (foundations, wells, rims), lit on the upper left of each stone. */
function roundStones(s: Sprite, p: Palette, x0: number, y0: number, w: number, h: number, sw = 7, sh = 5, seed = 0) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const row = Math.floor((y - y0) / sh);
      const off = (row % 2) * Math.floor(sw / 2) + Math.floor(hash(row, 3, seed) * 3);
      const k = Math.floor((x - x0 + off) / sw);
      const xx = (x - x0 + off) % sw;
      const yy = (y - y0) % sh;
      const corner = (xx === 0 || xx === sw - 1) && (yy === 0 || yy === sh - 1);
      let c: RGB;
      if (yy === sh - 1 || xx === sw - 1 || corner) c = p.rock[0];
      else if (yy === 0 || xx === 0) c = p.stone[3];
      else c = hash(k, row, seed) < 0.3 ? p.stone[1] : p.stone[2];
      if (yy === sh - 2 && xx > sw - 4 && c !== p.rock[0]) c = p.stone[1];
      s.set(x, y, c);
    }
}

/** Rounded shingles in rows: a dark gap under each row, a lit top edge on each shingle, moss here and there. */
function shingles(s: Sprite, p: Palette, rows: { y: number; x0: number; x1: number }[], seed: number, mossy = true) {
  rows.forEach(({ y: ry, x0, x1 }, i) => {
    const rowIdx = Math.floor(i / 5);
    const yy = i % 5;
    const off = (rowIdx % 2) * 3;
    for (let x = x0; x < x1; x++) {
      const k = Math.floor((x - x0 + off) / 6);
      const xx = (x - x0 + off) % 6;
      // Shingle bottoms are rounded: the corners of each shingle drop into the gap.
      let c: RGB;
      if (yy === 4 || (yy === 3 && (xx === 0 || xx === 5))) c = p.roof[0];
      else if (yy === 0 && xx > 0 && xx < 4) c = p.roof[4];
      else if (xx === 5) c = p.roof[1];
      else c = hash(k, rowIdx, seed) < 0.22 ? p.roof[2] : p.roof[3];
      // The far end of the roof turns away from the light.
      if (x > x1 - 5 && c === p.roof[3]) c = p.roof[2];
      if (mossy && yy < 3 && hash(k, rowIdx, seed + 5) < 0.07) c = yy === 0 ? p.moss[4] : p.moss[3];
      s.set(x, ry, c);
    }
  });
}

export type CottageParts = { door: { x: number; y: number; w: number; h: number } };

/**
 * A storybook adventure cottage: a steep shingle roof with flared eaves and
 * a dormer, a heavy timber frame over plaster, a rounded-stone foundation,
 * an arched door under a little porch roof with a lit lantern, warm lit
 * windows with a flower box, a stone chimney.
 */
export function cottage(p: Palette, r: Rng, wallW = 100, opts: { windows?: number } = {}): Built & CottageParts {
  const over = 8;
  const FW = wallW + over * 2; // the front, with the eaves' overhang
  const sd = Math.round(wallW * 0.2) + 2; // the side wall, seen at an angle (three-quarter view)
  const W = FW + sd;
  const chim = 14;
  const roofH = Math.round(wallW * 0.5);
  const wallH = 38;
  const H = chim + roofH + wallH;
  const s = new Sprite(W, H);
  const wallTop = chim + roofH;
  const wx0 = over;
  const wx1 = over + wallW;
  const seed = r.int(0, 9999);

  // --- wall: plaster panels inside a heavy timber frame
  for (let y = wallTop; y < H; y++)
    for (let x = wx0; x < wx1; x++) {
      const yy = y - wallTop;
      let c = p.plaster[2];
      if (yy < 5) c = p.plaster[0]; // under the eave
      else if (yy < 7 || x > wx1 - 4) c = p.plaster[1];
      else if (hash(x >> 1, y >> 1, seed) < 0.06) c = p.plaster[1];
      s.set(x, y, c);
    }
  const beamV = (x: number, y0 = wallTop + 3, y1 = H - 6) => {
    for (let y = y0; y < y1; y++) {
      s.set(x, y, p.wood[3]);
      s.set(x + 1, y, p.wood[2]);
      s.set(x + 2, y, p.wood[1]);
    }
  };
  const beamH = (y: number, x0 = wx0, x1 = wx1) => {
    for (let x = x0; x < x1; x++) {
      s.set(x, y, p.wood[3]);
      s.set(x, y + 1, p.wood[2]);
      s.set(x, y + 2, p.wood[1]);
    }
  };
  beamV(wx0);
  beamV(wx1 - 3);
  beamH(wallTop + 4);
  beamH(wallTop + 20);
  // Diagonal braces in the outer panels.
  for (const [x0, dir] of [[wx0 + 3, 1], [wx1 - 4, -1]] as const)
    for (let i = 0; i < 14; i++) {
      s.set(x0 + dir * i, wallTop + 7 + i, p.wood[2]);
      s.set(x0 + dir * i + dir, wallTop + 7 + i, p.wood[1]);
    }
  roundStones(s, p, wx0, H - 6, wallW, 6, 8, 6, seed);

  // --- door with a porch roof and a lantern
  const dw = 18;
  const dh = 27;
  const dx = Math.round(wx0 + wallW / 2 - dw / 2 + r.int(6, 14));
  const dy = H - dh;
  beamV(dx - 4, wallTop + 6, H - 6);
  beamV(dx + dw + 1, wallTop + 6, H - 6);
  for (let y = dy; y < H; y++)
    for (let x = dx; x < dx + dw; x++) {
      const yy = y - dy;
      const xx = x - dx;
      const arch = Math.round(5 - Math.sqrt(Math.max(0, 25 - (xx - dw / 2 + 0.5) ** 2 * (25 / ((dw / 2) ** 2)))));
      if (yy < arch) continue;
      let c = p.wood[2];
      if (yy === arch || xx === 0 || xx === dw - 1) c = p.wood[0];
      else if (xx % 4 === 0) c = p.wood[1];
      else if (xx % 4 === 1) c = p.wood[3];
      if ((yy === 9 || yy === 19) && xx > 1 && xx < 8) c = p.rock[1]; // iron hinges
      s.set(x, y, c);
    }
  s.set(dx + dw - 4, dy + 15, p.glow[2]);
  s.set(dx + dw - 4, dy + 16, p.wood[0]);
  // Porch roof: a short shingle strip on two brackets.
  const porchY = dy - 8;
  const porchRows = Array.from({ length: 7 }, (_, i) => ({ y: porchY + i, x0: dx - 7 + Math.floor(i / 2), x1: dx + dw + 7 - Math.floor(i / 2) + 1 }));
  shingles(s, p, porchRows, seed + 3, false);
  for (let x = dx - 7; x < dx + dw + 8; x++) s.set(x, porchY + 7, p.roof[0]);
  // Lantern hanging at the porch corner.
  const lx = dx + dw + 5;
  s.set(lx, porchY + 8, p.rock[0]);
  s.set(lx, porchY + 9, p.rock[0]);
  s.rect(lx - 2, porchY + 10, 5, 1, p.rock[0]);
  s.rect(lx - 2, porchY + 11, 5, 4, p.glow[2]);
  s.set(lx - 1, porchY + 12, p.glow[3]);
  s.rect(lx - 2, porchY + 15, 5, 1, p.rock[0]);

  // --- warm lit windows with a flower box
  const window = (x0: number) => {
    const y0 = wallTop + 9;
    for (let y = y0; y < y0 + 12; y++)
      for (let x = x0; x < x0 + 14; x++) {
        const xx = x - x0;
        const yy = y - y0;
        let c: RGB = yy < 6 ? p.glow[2] : p.glow[1];
        if (xx + yy < 4) c = p.glow[3];
        if (xx === 0 || yy === 0 || xx === 13 || yy === 11) c = p.wood[1];
        else if (xx === 6 || xx === 7 || yy === 5) c = p.wood[0];
        s.set(x, y, c);
      }
    // Shutters.
    for (let y = y0; y < y0 + 12; y++) {
      s.set(x0 - 3, y, p.wood[3]);
      s.set(x0 - 2, y, p.wood[2]);
      s.set(x0 - 1, y, p.wood[1]);
      s.set(x0 + 14, y, p.wood[2]);
      s.set(x0 + 15, y, p.wood[1]);
      s.set(x0 + 16, y, p.wood[0]);
    }
    for (let x = x0 - 2; x < x0 + 16; x++) {
      s.set(x, y0 + 12, p.wood[2]);
      s.set(x, y0 + 13, p.wood[1]);
    }
    for (let x = x0 - 1; x < x0 + 15; x++) {
      const h = hash(x, y0, seed);
      s.set(x, y0 + 11, h < 0.5 ? p.moss[3] : p.moss[2]);
      if (h < 0.3) s.set(x, y0 + 10, p.cloth[2]);
      else if (h > 0.8) s.set(x, y0 + 10, p.glow[3]);
    }
  };
  if ((opts.windows ?? 2) >= 1) window(wx0 + 12);
  if ((opts.windows ?? 2) >= 2 && dx + dw + 26 < wx1) window(dx + dw + 9);

  // --- roof: steep, flared at the eaves, the ridge sagging a little
  // --- side wall and gable end, in shade (the house has depth: front, side and roof)
  const sideTop = (x: number) => Math.round(wallTop - (x - wx1) * 0.5);
  const sideBot = (x: number) => Math.round(H - 1 - (x - wx1) * 0.5);
  const ridgeEnd = FW - over + Math.round(sd / 2);
  const verge = (x: number) => (x <= ridgeEnd ? chim + 2 : Math.round(chim + 2 + ((x - ridgeEnd) / (W - 1 - ridgeEnd)) * (sideTop(W - 1) - 4 - chim - 2)));
  for (let x = wx1; x < W; x++) {
    const top = verge(x);
    const bot = sideBot(x);
    const wt = sideTop(x);
    for (let y = top; y <= bot; y++) {
      let c: RGB = y < wt + 4 ? p.plaster[0] : p.plaster[1];
      if (y < top + 2) c = y === top ? p.roof[2] : p.roof[1]; // the roof's edge seen from the side
      else if (y === top + 2) c = p.wood[1]; // barge board
      else if (y > bot - 6) c = (x + y) % 7 === 0 || (y - bot + 6) % 3 === 2 ? p.rock[0] : p.rock[2];
      else if (Math.abs(y - (wt + 4)) < 1 || Math.abs(y - (wt + 20)) < 1) c = p.wood[1];
      else if (x >= W - 3) c = x === W - 1 ? p.wood[0] : p.wood[1];
      else if (hash(x >> 1, y >> 1, seed + 2) < 0.05) c = p.plaster[0];
      s.set(x, y, c);
    }
  }
  // A small round vent in the gable.
  const gvx = Math.round((ridgeEnd + W) / 2) - 1;
  const gvy = Math.round((verge(gvx) + sideTop(gvx)) / 2) + 2;
  s.rect(gvx - 1, gvy - 1, 4, 4, p.wood[0]);
  s.set(gvx, gvy, p.glow[1]);
  s.set(gvx + 1, gvy, p.glow[0]);
  // Roof: a parallelogram leaning back to the right (it recedes with the side wall).
  const rows: { y: number; x0: number; x1: number }[] = [];
  for (let ry = 0; ry < roofH; ry++) {
    const t = ry / roofH;
    const lean = Math.round((1 - t) * (sd / 2));
    const flare = t > 0.88 ? Math.round((t - 0.88) * 18) : 0;
    rows.push({ y: chim + ry, x0: Math.max(0, lean + 2 - flare), x1: Math.min(W, FW + lean - 2 + flare) });
  }
  shingles(s, p, rows.slice(3), seed);
  // Ridge cap and the dark eave edge with the shadow it throws.
  const ridge = rows[0];
  for (let i = 0; i < 3; i++) for (let x = rows[i].x0 + 1; x < rows[i].x1 - 1; x++) s.set(x, rows[i].y, i === 0 ? p.roof[1] : i === 1 ? p.roof[4] : p.roof[2]);
  for (let x = ridge.x0; x < ridge.x1; x += 7) s.set(x + 3, ridge.y + 1, p.roof[5]);
  const eave = rows[rows.length - 1];
  for (let x = eave.x0; x < eave.x1; x++) {
    s.set(x, eave.y, p.roof[0]);
    s.set(x, eave.y - 1, p.roof[1]);
  }
  // Dormer window in the roof.
  const dmx = Math.round(wx0 + wallW * 0.28);
  const dmy = chim + Math.round(roofH * 0.32);
  for (let y = dmy; y < dmy + 13; y++)
    for (let x = dmx; x < dmx + 16; x++) {
      const xx = x - dmx;
      const yy = y - dmy;
      const roofLine = Math.abs(xx - 7.5) * 0.8;
      if (yy < roofLine) continue;
      let c: RGB = yy < roofLine + 3 ? (xx < 8 ? p.roof[4] : p.roof[2]) : p.plaster[1];
      if (yy >= 6 && xx >= 4 && xx <= 11) c = yy < 9 ? p.glow[2] : p.glow[1];
      if (yy >= 6 && (xx === 4 || xx === 11 || yy === 12 || xx === 7)) c = p.wood[1];
      s.set(x, y, c);
    }
  // Chimney: rounded stones, a dark mouth.
  const cx0 = Math.round(FW * 0.66);
  roundStones(s, p, cx0, 0, 12, chim + 12, 6, 4, seed + 9);
  for (let x = cx0 - 1; x < cx0 + 13; x++) {
    s.set(x, 0, p.stone[3]);
    s.set(x, 1, p.stone[2]);
    s.set(x, 2, p.rock[0]);
  }
  for (let x = cx0 + 2; x < cx0 + 10; x++) s.set(x, 1, p.rock[0]);
  return { sprite: s, baseX: Math.round(FW / 2), baseY: H - 1, door: { x: dx, y: dy, w: dw, h: dh } };
}

/** Market stall: posts, a striped canvas awning with a zigzag hem, a counter with produce. */
export function stall(p: Palette, r: Rng): Built {
  const W = 50;
  const H = 46;
  const s = new Sprite(W, H);
  // Back posts and counter.
  for (const x of [4, W - 6]) for (let y = 10; y < H; y++) {
    s.set(x, y, p.wood[3]);
    s.set(x + 1, y, p.wood[1]);
  }
  for (let y = 30; y < H; y++)
    for (let x = 2; x < W - 2; x++) {
      const yy = y - 30;
      let c = yy < 3 ? (yy === 0 ? p.wood[4] : p.wood[3]) : x % 7 === 0 ? p.wood[1] : p.wood[2];
      if (yy === 3) c = p.wood[0];
      s.set(x, y, c);
    }
  // Produce on the counter: apples, gourds, a basket.
  for (let i = 0; i < 9; i++) {
    const x = 6 + i * 4 + r.int(0, 1);
    const y = 27 + (i % 2);
    const c = i % 3 === 0 ? p.fallen[2] : p.cloth[2];
    s.rect(x, y, 3, 3, c);
    s.set(x, y, p.fallen[3]);
    s.set(x + 2, y + 2, p.cloth[0]);
  }
  // Awning: stripes, a zigzag hem, sloping toward the viewer.
  for (let y = 2; y < 18; y++)
    for (let x = 0; x < W; x++) {
      const yy = y - 2;
      const stripe = Math.floor((x + yy * 0.3) / 6) % 2 === 0;
      let c: RGB = stripe ? p.cloth[2] : p.cloth[4];
      if (yy < 2) c = stripe ? p.cloth[1] : p.cloth[3];
      if (yy > 11) c = stripe ? p.cloth[1] : p.cloth[3];
      s.set(x, y, c);
    }
  for (let x = 0; x < W; x++) {
    const tip = x % 6 < 3 ? x % 6 : 5 - (x % 6);
    for (let k = 0; k <= tip; k++) s.set(x, 18 + k, Math.floor(x / 6) % 2 === 0 ? p.cloth[2] : p.cloth[4]);
  }
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

export function well(p: Palette, r: Rng): Built {
  const W = 36;
  const H = 46;
  const s = new Sprite(W, H);
  const seed = r.int(0, 999);
  roundStones(s, p, 3, 30, W - 6, H - 31, 7, 5, seed);
  // Rounded bottom corners, moss at the foot.
  for (const x of [3, 4, W - 4, W - 5]) s.set(x, H - 1, null);
  for (let x = 4; x < W - 4; x++) if (hash(x, 1, seed) < 0.3) s.set(x, H - 2, p.moss[2]);
  // Rim and the dark water inside.
  s.ellipse(18, 30, 15.5, 5.5, (_x, _y, nx, ny) => (nx + ny < -0.4 ? p.stone[4] : ny > 0.3 ? p.stone[2] : p.stone[3]));
  s.ellipse(18, 30.5, 11.5, 3.4, p.water[0]);
  s.set(14, 30, p.water[2]);
  s.set(15, 30, p.water[2]);
  // Heavy posts, crossbar, rope and bucket.
  for (let y = 8; y < 30; y++) {
    for (const x of [5, 28]) {
      s.set(x, y, p.wood[3]);
      s.set(x + 1, y, p.wood[2]);
      s.set(x + 2, y, p.wood[1]);
    }
  }
  for (let x = 7; x < 28; x++) {
    s.set(x, 14, p.wood[3]);
    s.set(x, 15, p.wood[1]);
  }
  for (let y = 16; y < 21; y++) s.set(18, y, p.stone[3]);
  s.rect(15, 21, 7, 5, p.wood[2]);
  s.rect(15, 21, 7, 1, p.rock[1]);
  s.rect(15, 25, 7, 1, p.wood[0]);
  // Small shingle roof.
  const rows = Array.from({ length: 11 }, (_, i) => ({ y: i, x0: Math.max(0, 6 - Math.floor(i * 0.6)), x1: Math.min(W, W - 6 + Math.floor(i * 0.6)) }));
  shingles(s, p, rows, seed, true);
  for (let x = rows[10].x0; x < rows[10].x1; x++) s.set(x, 10, p.roof[0]);
  return { sprite: s, baseX: 18, baseY: H - 1 };
}

export function bench(p: Palette): Built {
  const W = 30;
  const H = 18;
  const s = new Sprite(W, H);
  for (let x = 1; x < W - 1; x++) {
    s.set(x, 2, p.wood[4]);
    s.set(x, 3, p.wood[3]);
    s.set(x, 4, p.wood[2]);
    s.set(x, 5, p.wood[1]);
  }
  for (const x of [3, W - 5]) for (let y = 1; y < H; y++) {
    s.set(x, y, p.wood[2]);
    s.set(x + 1, y, p.wood[0]);
  }
  for (let x = 0; x < W; x++) {
    s.set(x, 9, p.wood[4]);
    s.set(x, 10, p.wood[3]);
    s.set(x, 11, x % 9 === 0 ? p.wood[1] : p.wood[3]);
    s.set(x, 12, p.wood[1]);
    s.set(x, 13, p.wood[0]);
  }
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

/** A lamp post with an iron lantern that glows. */
export function lampPost(p: Palette): Built {
  const W = 14;
  const H = 40;
  const s = new Sprite(W, H);
  for (let y = 10; y < H; y++) {
    s.set(6, y, p.wood[3]);
    s.set(7, y, p.wood[1]);
  }
  s.rect(4, H - 3, 6, 3, p.rock[2]);
  s.rect(4, H - 3, 6, 1, p.rock[3]);
  // Bracket and lantern.
  for (let x = 7; x < 12; x++) s.set(x, 10, p.rock[0]);
  s.set(11, 11, p.rock[0]);
  s.rect(1, 2, 9, 1, p.rock[0]);
  s.rect(2, 1, 7, 1, p.rock[1]);
  for (let y = 3; y < 10; y++)
    for (let x = 2; x < 9; x++) s.set(x, y, x === 2 || x === 8 ? p.rock[0] : y < 6 ? p.glow[3] : p.glow[2]);
  s.rect(2, 10, 7, 1, p.rock[0]);
  return { sprite: s, baseX: 6, baseY: H - 1 };
}

export function signpost(p: Palette): Built {
  const W = 26;
  const H = 30;
  const s = new Sprite(W, H);
  for (let y = 6; y < H; y++) {
    s.set(11, y, p.wood[3]);
    s.set(12, y, p.wood[2]);
    s.set(13, y, p.wood[0]);
  }
  // Two blank boards pointing different ways (no writing).
  const board = (y0: number, dir: 1 | -1) => {
    for (let y = y0; y < y0 + 7; y++)
      for (let i = 0; i < 18; i++) {
        const yy = y - y0;
        const tip = i >= 15 ? i - 14 : 0;
        if (yy < tip || yy > 6 - tip) continue;
        const x = dir > 0 ? 5 + i : 20 - i;
        let c = yy === tip ? p.wood[4] : yy === 6 - tip ? p.wood[1] : p.wood[3];
        if (i === 3 && yy === 3) c = p.rock[1];
        s.set(x, y, c);
      }
  };
  board(4, 1);
  board(13, -1);
  return { sprite: s, baseX: 12, baseY: H - 1 };
}

export function barrel(p: Palette): Built {
  const W = 14;
  const H = 17;
  const s = new Sprite(W, H);
  for (let y = 3; y < H; y++)
    for (let x = 1; x < W - 1; x++) {
      if (y === H - 1 && (x === 1 || x === W - 2)) continue;
      const bulge = y > 5 && y < H - 3 ? 0 : 1;
      if (x < 1 + bulge || x > W - 2 - bulge) continue;
      let c = x < 4 ? p.wood[4] : x > W - 5 ? p.wood[1] : (x - 1) % 3 === 0 ? p.wood[2] : p.wood[3];
      if (y === 6 || y === 13) c = x > W - 5 ? p.rock[0] : p.rock[2];
      s.set(x, y, c);
    }
  s.ellipse(7, 3.5, 6, 2.5, p.wood[2]);
  s.ellipse(7, 3.5, 4.5, 1.5, p.wood[1]);
  return { sprite: s, baseX: 7, baseY: H - 1 };
}

export function crate(p: Palette): Built {
  const W = 15;
  const H = 15;
  const s = new Sprite(W, H);
  for (let y = 0; y < 4; y++) for (let x = 0; x < W; x++) s.set(x, y, y === 0 ? p.wood[4] : x % 5 === 4 ? p.wood[2] : p.wood[3]);
  for (let y = 4; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c = p.wood[2];
      if (x === 0 || x === W - 1 || y === 4 || y === H - 1) c = p.wood[1];
      else if (Math.abs(x - 1 - (y - 5) * 1.25) < 1) c = p.wood[1];
      else if (x < 3) c = p.wood[3];
      s.set(x, y, c);
    }
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

/** Round clay pot with a dark mouth. */
export function pot(p: Palette): Built {
  const W = 14;
  const H = 14;
  const s = new Sprite(W, H);
  s.ellipse(7, 8, 6.5, 5.5, (_x, _y, nx, ny) => {
    const l = -(nx * 0.6 + ny * 0.8);
    return l > 0.45 ? p.roof[5] : l > -0.1 ? p.roof[4] : l > -0.55 ? p.roof[3] : p.roof[2];
  });
  s.ellipse(7, 3, 4.5, 1.8, p.roof[3]);
  s.ellipse(7, 3, 3, 1, p.rock[0]);
  return { sprite: s, baseX: 7, baseY: H - 1 };
}

/** A mossy boulder. */
export function rock(p: Palette, r: Rng, w = 16): Built {
  const h = Math.round(w * 0.66);
  const s = new Sprite(w, h + 1);
  const seed = r.int(0, 999);
  s.ellipse(w / 2, h / 2 + 0.5, w / 2, h / 2 + 0.5, (x, y, nx, ny) => {
    const l = -(nx * 0.55 + ny * 0.85) + (hash(x >> 1, y >> 1, seed) - 0.5) * 0.25;
    return l > 0.4 ? p.rock[4] : l > 0 ? p.rock[3] : l > -0.45 ? p.rock[2] : p.rock[1];
  });
  // Moss cap.
  for (let x = Math.round(w * 0.2); x < Math.round(w * 0.75); x++) {
    s.set(x, 1, p.moss[3]);
    if (hash(x, 2, seed) < 0.6) s.set(x, 2, p.moss[2]);
    if (hash(x, 3, seed) < 0.3) s.set(x, 0, p.moss[4]);
  }
  return { sprite: s, baseX: w >> 1, baseY: h };
}

// ---------------------------------------------------------------- props for the other scene kinds
// Same rules as above: three-quarter angle (top and front faces), light from
// the upper left, ramp tones only, one dark warm outline added when stamped.

/** Cut stone block face: lit top facet, mid front, shaded right side, dark seams. */
function blockPixel(p: Palette, xx: number, yy: number, bw: number, bh: number, mossy: number): RGB {
  if (yy === bh - 1 || xx === bw - 1) return p.rock[1];
  if (yy === 0) return p.stone[4];
  if (xx === 0) return p.stone[3];
  if (xx > bw - 3) return p.stone[1];
  if (mossy > 0.7 && yy < 3) return p.moss[3];
  return p.stone[2];
}

/** A curved palm: a ringed, leaning trunk and a crown of drooping fronds. */
export function palm(p: Palette, r: Rng, size = 1): Built {
  const H = Math.round(70 * size);
  const W = Math.round(64 * size);
  const s = new Sprite(W, H);
  const lean = r.chance(0.5) ? 1 : -1;
  const baseX = Math.round(W / 2);
  const topY = Math.round(16 * size);
  const tx = (y: number) => baseX + lean * Math.round(((H - 1 - y) / (H - topY)) ** 2 * 10 * size);
  for (let y = topY; y < H; y++) {
    const c = tx(y);
    for (let k = -3; k <= 3; k++) {
      const ring = (H - y) % 5 === 0;
      s.set(c + k, y, ring ? p.bark[1] : k < -1 ? p.bark[4] : k > 1 ? p.bark[1] : p.bark[3]);
    }
  }
  const cx = tx(topY);
  const cy = topY;
  const fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const a = Math.PI * (1.05 + (f / (fronds - 1)) * 0.9) + (hash(f, 1, 3) - 0.5) * 0.25; // fan over the top
    const len = (20 + hash(f, 2, 3) * 8) * size;
    for (let t = 0; t < len; t++) {
      const k = t / len;
      const x = cx + Math.cos(a) * t;
      const y = cy + Math.sin(a) * t * 0.55 + k * k * 14 * size; // droop
      const w = Math.max(1, Math.round((1 - Math.abs(k - 0.35)) * 4 * size));
      for (let j = -w; j <= w; j++) {
        const lit = Math.sin(a) < -0.3 || Math.cos(a) < 0;
        s.set(x, y + j, j < 0 ? (lit ? p.leaf[4] : p.leaf[3]) : j === w ? p.leaf[1] : p.leaf[2]);
      }
    }
  }
  for (const [dx, dy] of [[-2, 2], [2, 3], [0, 4]]) s.ellipse(cx + dx, cy + dy, 2.2, 2.2, (_x, _y, nx, ny) => (nx + ny < -0.4 ? p.dirt[4] : p.dirt[2]));
  return { sprite: s, baseX, baseY: H - 1 };
}

/** A carved column, standing (`broken` snaps its top off) in three-quarter view. */
export function column(p: Palette, r: Rng, broken = false): Built {
  const W = 20;
  const H = broken ? 34 : 54;
  const s = new Sprite(W, H);
  const seed = r.int(0, 999);
  const top = broken ? 6 : 8;
  // Capital and base slabs (top face visible).
  const slab = (y0: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = 0; x < W; x++) s.set(x, y, y === y0 ? p.stone[5] : y === y0 + 1 ? p.stone[4] : x > W - 4 ? p.stone[1] : p.stone[2]);
  };
  if (!broken) slab(0, 7);
  slab(H - 6, 6);
  // Fluted shaft.
  for (let y = top; y < H - 6; y++)
    for (let x = 3; x < W - 3; x++) {
      const xx = x - 3;
      let c = xx < 3 ? p.stone[4] : xx > W - 10 ? p.stone[1] : xx % 4 === 3 ? p.stone[2] : p.stone[3];
      if (hash(x >> 1, y >> 2, seed) < 0.08) c = p.moss[2];
      s.set(x, y, c);
    }
  if (broken) {
    // Jagged break, lit on top.
    for (let x = 3; x < W - 3; x++) {
      const cut = top + Math.round(Math.abs(Math.sin(x * 1.3 + seed)) * 4);
      for (let y = 0; y < cut; y++) s.set(x, y, null);
      s.set(x, cut, p.stone[5]);
    }
  }
  // Ivy climbing the shaft.
  for (let y = H - 8; y > H * 0.4; y--) if (hash(y, 3, seed) < 0.6) s.set(4 + Math.round(Math.sin(y * 0.5) * 2) + 2, y, y % 3 ? p.moss[3] : p.moss[2]);
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

/** A fallen column lying on its side: a seat in the ruins. */
export function fallenColumn(p: Palette, r: Rng): Built {
  const W = 46;
  const H = 16;
  const s = new Sprite(W, H);
  const seed = r.int(0, 999);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W - 8; x++) {
      const ny = (y - H / 2) / (H / 2);
      let c = ny < -0.5 ? p.stone[4] : ny < 0.1 ? p.stone[3] : ny < 0.6 ? p.stone[2] : p.stone[1];
      if (x % 7 === 6) c = ny < 0 ? p.stone[2] : p.rock[1];
      if (hash(x >> 1, y >> 1, seed) < 0.07) c = p.moss[2];
      s.set(x + 4, y, c);
    }
  // The round end facing us, showing its section.
  s.ellipse(W - 6, H / 2, 5, H / 2, (_x, _y, nx, ny) => (nx * nx + ny * ny < 0.35 ? p.stone[3] : nx + ny < 0 ? p.stone[4] : p.stone[2]));
  for (let x = 4; x < W - 10; x++) if (hash(x, 9, seed) < 0.35) s.set(x, 0, p.moss[3]);
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

/** A broken length of old wall: cut blocks, a jagged top, ivy and moss. */
export function ruinWall(p: Palette, r: Rng, w = 60): Built {
  const H = 40;
  const s = new Sprite(w, H);
  const seed = r.int(0, 9999);
  // Broken top in block steps (whole stones missing), higher at one end, crumbling toward the other.
  const tall = hash(1, 2, seed) < 0.5;
  const topAt = (x: number) => {
    const k = Math.floor(x / 7);
    const slope = (tall ? x / w : 1 - x / w) * 16;
    return 2 + Math.round(slope + hash(k, 1, seed) * 8 - (hash(k, 3, seed) < 0.2 ? 4 : 0) / 1) - (Math.round(slope + hash(k, 1, seed) * 8) % 4);
  };
  for (let x = 0; x < w; x++) {
    const t = topAt(x);
    for (let y = t; y < H; y++) {
      // A 4 px top face (the wall's thickness seen from above), then the front face.
      if (y < t + 4) {
        s.set(x, y, y === t ? p.stone[4] : hash(x >> 1, y, seed) < 0.35 ? p.moss[3] : p.stone[3]);
        continue;
      }
      const yy = y - t - 4;
      const row = Math.floor((y - 4) / 8);
      const off = (row % 2) * 7;
      const bw = 14;
      s.set(x, y, blockPixel(p, (x + off) % bw, (y - 4) % 8, bw, 8, hash(Math.floor((x + off) / bw), row, seed)));
      if (yy === 0) s.set(x, y, p.rock[1]); // shade under the top face's lip
    }
  }
  // Hanging ivy curtains.
  for (let k = 0; k < 3; k++) {
    const ix = Math.round(hash(k, 5, seed) * (w - 8)) + 4;
    const len = 10 + Math.round(hash(k, 6, seed) * 14);
    for (let i = 0; i < len; i++)
      for (let j = -1; j <= 1; j++) {
        const y = topAt(ix) + 3 + i;
        if (s.get(ix + j, y) && hash(ix + j, y, seed) < 0.75) s.set(ix + j + Math.round(Math.sin(i * 0.6)), y, i > len - 3 ? p.moss[2] : j < 0 ? p.moss[4] : p.moss[3]);
      }
  }
  return { sprite: s, baseX: w >> 1, baseY: H - 1 };
}

/** A tall ruined archway: two block piers and a round arch with a keystone. */
export function archway(p: Palette, r: Rng): Built {
  const W = 76;
  const H = 74;
  const s = new Sprite(W, H);
  const seed = r.int(0, 999);
  const pier = 16;
  const cx = W / 2;
  const ro = W / 2;
  const ri = W / 2 - pier;
  const springY = 34;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - springY;
      let inside = false;
      if (y >= springY) inside = x < pier || x >= W - pier;
      else {
        const d = Math.hypot(dx, dy * 1.05);
        inside = d <= ro && d >= ri;
      }
      if (!inside) continue;
      const row = Math.floor(y / 8);
      const off = (row % 2) * 6;
      let c = blockPixel(p, (x + off) % 12, y % 8, 12, 8, hash(Math.floor((x + off) / 12), row, seed));
      if (y < springY) {
        // Voussoirs: seams run toward the arch's centre.
        const a = Math.atan2(dy, dx);
        const seam = Math.abs(((a / Math.PI) * 11) % 1) < 0.1;
        const d = Math.hypot(dx, dy * 1.05);
        c = seam ? p.rock[1] : d > ro - 2 ? p.stone[4] : d < ri + 2 ? p.stone[1] : dx < 0 ? p.stone[3] : p.stone[2];
      }
      s.set(x, y, c);
    }
  // Keystone, and a missing chunk on one side.
  s.rect(cx - 4, 0, 8, pier, p.stone[3]);
  s.rect(cx - 4, 0, 8, 1, p.stone[5]);
  s.rect(cx + 3, 1, 1, pier - 1, p.stone[1]);
  for (let y = 4; y < 14; y++) for (let x = W - 14; x < W - 14 + (14 - y); x++) s.set(x, y, null);
  // Ivy over the top.
  for (let x = 6; x < W - 16; x++) {
    const a = Math.acos(Math.max(-1, Math.min(1, (x - cx) / ro)));
    const y = Math.round(springY - Math.sin(a) * ro / 1.05);
    if (hash(x, 1, seed) < 0.7) for (let k = 0; k < 2 + Math.round(hash(x, 2, seed) * 6); k++) if (s.get(x, y + k)) s.set(x, y + k, k % 3 === 0 ? p.moss[4] : p.moss[3]);
  }
  // Base blocks darker, a step.
  for (let x = 0; x < W; x++) if (s.get(x, H - 1)) s.set(x, H - 1, p.rock[1]);
  return { sprite: s, baseX: Math.round(cx), baseY: H - 1 };
}

/** A standing stone with carved runes that glow (enchanted palettes make the glow cool). */
export function standingStone(p: Palette, r: Rng, h = 30): Built {
  const W = Math.round(h * 0.5);
  const s = new Sprite(W, h);
  const seed = r.int(0, 999);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const half = (W / 2) * (0.6 + 0.4 * Math.min(1, t * 2.2));
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2;
      if (Math.abs(dx) > half) continue;
      const l = -dx / half;
      let c = y < 3 ? p.rock[4] : l > 0.45 ? p.rock[4] : l > -0.2 ? p.rock[3] : l > -0.7 ? p.rock[2] : p.rock[1];
      if (hash(x >> 1, y >> 1, seed) < 0.06) c = p.moss[3];
      s.set(x, y, c);
    }
  }
  // Runes: a few small marks down the middle.
  const mx = Math.round(W / 2) - 1;
  for (let k = 0; k < 3; k++) {
    const y = Math.round(h * 0.3) + k * 6;
    s.set(mx, y, p.glow[2]);
    s.set(mx + 1, y + 1, p.glow[2]);
    s.set(mx, y + 2, p.glow[1]);
    if (k % 2) s.set(mx + 1, y, p.glow[3]);
  }
  for (let x = 1; x < W - 1; x++) if (hash(x, 7, seed) < 0.6) s.set(x, h - 1, p.moss[2]);
  return { sprite: s, baseX: W >> 1, baseY: h - 1 };
}

/** A fallen log with a cut, ringed end and a mossy top: a seat on a forest path. */
export function log(p: Palette, r: Rng): Built {
  const W = 44;
  const H = 15;
  const s = new Sprite(W, H);
  const seed = r.int(0, 999);
  for (let y = 0; y < H; y++)
    for (let x = 3; x < W - 6; x++) {
      const ny = (y - H / 2) / (H / 2);
      let c = ny < -0.55 ? p.bark[4] : ny < 0 ? p.bark[3] : ny < 0.55 ? p.bark[2] : p.bark[1];
      if (hash(x, Math.floor(y / 3), seed) < 0.12) c = p.bark[1];
      if (ny < -0.5 && hash(x >> 1, 1, seed) < 0.45) c = p.moss[3];
      s.set(x, y, c);
    }
  s.ellipse(W - 6, H / 2, 5, H / 2, (_x, _y, nx, ny) => {
    const d = Math.hypot(nx, ny);
    return d > 0.8 ? p.bark[2] : Math.round(d * 4) % 2 ? p.wood[3] : p.wood[4];
  });
  // A broken branch stub and a little fungus shelf.
  s.rect(14, -1, 3, 4, p.bark[3]);
  s.rect(24, H - 5, 4, 2, p.fallen[3]);
  s.rect(24, H - 4, 4, 1, p.fallen[1]);
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

/** A tree stump with roots and rings on top. */
export function stump(p: Palette, r: Rng): Built {
  const W = 24;
  const H = 18;
  const s = new Sprite(W, H);
  r.int(0, 1);
  for (let y = 5; y < H; y++) {
    const flare = y > H - 5 ? (y - (H - 5)) * 1.3 : 0;
    const x0 = Math.round(5 - flare);
    const x1 = Math.round(W - 5 + flare);
    for (let x = x0; x < x1; x++) s.set(x, y, barkPixel(p, x, y, x0, x1));
  }
  s.ellipse(W / 2, 5, 7, 4, (_x, _y, nx, ny) => {
    const d = Math.hypot(nx, ny);
    return d > 0.82 ? p.bark[3] : Math.round(d * 5) % 2 ? p.wood[3] : p.wood[4];
  });
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

/** A stone lantern shrine with a warm (or cool, when enchanted) light inside. */
export function shrine(p: Palette, r: Rng): Built {
  const W = 22;
  const H = 40;
  const s = new Sprite(W, H);
  const seed = r.int(0, 999);
  // Base, post, light box, cap.
  for (let y = H - 6; y < H; y++) for (let x = 2; x < W - 2; x++) s.set(x, y, blockPixel(p, x - 2, y - (H - 6), W - 4, 6, hash(x, y, seed)));
  for (let y = 20; y < H - 6; y++) for (let x = 7; x < W - 7; x++) s.set(x, y, x === 7 ? p.stone[4] : x > W - 9 ? p.stone[1] : p.stone[2]);
  for (let y = 10; y < 20; y++)
    for (let x = 4; x < W - 4; x++) {
      const inner = x > 6 && x < W - 7 && y > 11 && y < 18;
      s.set(x, y, inner ? (y < 14 ? p.glow[3] : p.glow[2]) : x === 4 ? p.stone[4] : x > W - 6 ? p.stone[1] : p.stone[3]);
    }
  for (let y = 2; y < 10; y++) {
    const inset = Math.max(0, 8 - y);
    for (let x = inset; x < W - inset; x++) s.set(x, y, y === 2 + 0 ? p.stone[5] : y > 7 ? p.rock[1] : x < W / 2 ? p.stone[4] : p.stone[2]);
  }
  s.rect(W / 2 - 1, 0, 3, 2, p.stone[3]);
  for (let x = 3; x < W - 3; x++) if (hash(x, 3, seed) < 0.4) s.set(x, H - 6, p.moss[3]);
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

/** A cluster of mushrooms with glowing caps (decorative, not solid). */
export function mushrooms(p: Palette, r: Rng): Built {
  const W = 22;
  const H = 16;
  const s = new Sprite(W, H);
  const caps: [number, number, number][] = [[6, 9, 4], [14, 6, 5], [18, 11, 3]];
  for (const [cx, cy, rr] of caps) {
    for (let y = cy; y < H; y++) {
      s.set(cx, y, p.plaster[3]);
      s.set(cx + 1, y, p.plaster[2]);
    }
    s.ellipse(cx + 0.5, cy, rr, rr * 0.7, (_x, _y, nx, ny) => (ny > 0.45 ? p.glow[0] : nx + ny < -0.5 ? p.glow[3] : p.glow[2]));
    if (r.chance(0.7)) s.set(cx - 1, cy - 1, p.glow[3]);
  }
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}
