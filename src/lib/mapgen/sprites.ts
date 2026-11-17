/**
 * MAP KIT PROPS — every object is drawn here, pixel by pixel, on its own
 * sprite (canvas.ts). Rules (PIXEL_ART_STYLE_GUIDE.md §5–7):
 *   - one three-quarter top-down angle for everything (top faces and front faces both visible)
 *   - 3–5 flat tones per material, light from the upper left, no gradients
 *   - a 1 px dark warm outline around props and buildings (dark green on foliage)
 *   - sizes on the native grid: a character is ~28 px tall, a door 18×28, a bench ~28 wide
 *
 * Each builder returns the sprite plus where its BASE is (the point that
 * touches the ground), so the caller can place it by its feet.
 */
import { Sprite, type RGB, type Rng } from "./canvas";
import type { Palette } from "./palette";

export type Built = { sprite: Sprite; baseX: number; baseY: number };

/** Canopy tones from a direction: lit from the upper left, darker to the lower right and at the bottom rim. */
function leafTone(p: Palette, nx: number, ny: number, deep = 0): RGB {
  const light = -(nx * 0.55 + ny * 0.85);
  const i = light > 0.5 ? 3 : light > -0.05 ? 2 : light > -0.6 ? 1 : 0;
  return p.leaf[Math.max(0, i - deep)];
}

/** Round foliage made of a few overlapping clumps (trees, bushes, hedges). */
function foliage(s: Sprite, p: Palette, r: Rng, clumps: { x: number; y: number; r: number }[], deep = 0) {
  // Big clumps first, then the clumps on top so their lit side overlaps the one behind.
  const order = [...clumps].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const c of order.reverse())
    s.ellipse(c.x, c.y, c.r, c.r * 0.9, (x, y, nx, ny) => {
      // 2×2 blocks keep the leaf texture in clusters.
      const bx = (x >> 1) * 2;
      const by = (y >> 1) * 2;
      const jitter = (((bx * 73856093) ^ (by * 19349663)) >>> 0) % 7 === 0 ? -0.25 : 0;
      return leafTone(p, nx, ny + jitter, deep);
    });
  // A few highlight clusters on the lit side of the top clumps.
  for (const c of clumps) {
    if (r.next() < 0.35) continue;
    const hx = Math.round(c.x - c.r * 0.35);
    const hy = Math.round(c.y - c.r * 0.45);
    if (deep) continue;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [2, 0]]) if (s.get(hx + dx, hy + dy)) s.set(hx + dx, hy + dy, p.leaf[4]);
  }
  // Leaf notches: little dark "u" marks inside the mid tone, sparse.
  for (let i = 0; i < clumps.length * 2; i++) {
    const c = clumps[i % clumps.length];
    const x = Math.round(c.x + r.range(-c.r * 0.6, c.r * 0.5));
    const y = Math.round(c.y + r.range(-c.r * 0.2, c.r * 0.6));
    if (s.get(x, y) === p.leaf[2 - deep] || s.get(x, y) === p.leaf[Math.max(0, 2 - deep)]) {
      s.set(x, y, p.leaf[Math.max(0, 1 - deep)]);
      s.set(x + 1, y + 1, p.leaf[Math.max(0, 1 - deep)]);
      s.set(x + 2, y, p.leaf[Math.max(0, 1 - deep)]);
    }
  }
}

export function tree(p: Palette, r: Rng, size = 1, deep = 0): Built {
  const R = Math.round(17 * size);
  const W = R * 2 + 12;
  const trunkH = Math.round(10 * size);
  const H = Math.round(R * 2.1) + trunkH + 2;
  const s = new Sprite(W, H);
  const cx = W / 2;
  const canopyBottom = H - trunkH;
  // Trunk with a root flare.
  const tw = Math.max(6, Math.round(7 * size));
  for (let y = canopyBottom - 6; y < H; y++) {
    const flare = y >= H - 3 ? H - 3 - y + 3 : 0;
    const x0 = Math.round(cx - tw / 2 - flare / 2);
    const x1 = Math.round(cx + tw / 2 + flare / 2);
    for (let x = x0; x < x1; x++) s.set(x, y, x === x0 ? p.wood[2] : x >= x1 - 2 ? p.wood[0] : p.wood[1]);
  }
  // Canopy: one big clump with smaller ones around it.
  const top = R + 1;
  const clumps = [
    { x: cx, y: top + R * 0.15, r: R },
    { x: cx - R * 0.55, y: top + R * 0.45, r: R * 0.62 },
    { x: cx + R * 0.58, y: top + R * 0.42, r: R * 0.64 },
    { x: cx - R * 0.1, y: top - R * 0.45, r: R * 0.62 },
    { x: cx + r.range(-2, 2), y: top + R * 0.7, r: R * 0.58 },
  ];
  foliage(s, p, r, clumps, deep);
  return { sprite: s, baseX: Math.round(cx), baseY: H - 1 };
}

export function bush(p: Palette, r: Rng, w = 22): Built {
  const H = Math.round(w * 0.62) + 2;
  const s = new Sprite(w + 4, H);
  const cx = (w + 4) / 2;
  foliage(s, p, r, [
    { x: cx, y: H * 0.55, r: w * 0.32 },
    { x: cx - w * 0.24, y: H * 0.64, r: w * 0.24 },
    { x: cx + w * 0.25, y: H * 0.62, r: w * 0.25 },
  ]);
  return { sprite: s, baseX: Math.round(cx), baseY: H - 1 };
}

/** Roof tiles in rows: a lit top edge on each tile, a shadow line under each row. */
function roofTiles(s: Sprite, p: Palette, x0: number, y0: number, w: number, h: number, inset: (row: number) => number) {
  for (let ry = 0; ry < h; ry++) {
    const ins = inset(ry);
    for (let x = x0 + ins; x < x0 + w - ins; x++) {
      const row = Math.floor(ry / 6);
      const yy = ry % 6;
      const tx = (x - x0 + (row % 2) * 4) % 8;
      let c = p.roof[2];
      if (ry < 3) c = ry === 0 ? p.roof[1] : ry === 1 ? p.roof[3] : p.roof[2];
      else if (ry >= h - 2) c = ry === h - 1 ? p.roof[0] : p.roof[1];
      else if (yy === 5) c = p.roof[1];
      else if (tx === 0 && yy > 0) c = p.roof[1];
      else if (yy === 0 && tx >= 1 && tx <= 4) c = p.roof[3];
      // The far right of the roof turns a little away from the light.
      if (c === p.roof[2] && x > x0 + w - ins - 4) c = p.roof[1];
      s.set(x, y0 + ry, c);
    }
  }
}

/** Stone blocks in rows (foundations, well walls, chimneys). */
function stoneBlocks(s: Sprite, p: Palette, x0: number, y0: number, w: number, h: number, bw = 6, bh = 4) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const row = Math.floor((y - y0) / bh);
      const yy = (y - y0) % bh;
      const xx = (x - x0 + (row % 2) * (bw >> 1)) % bw;
      let c = p.stone[2];
      if (yy === bh - 1 || xx === bw - 1) c = p.stone[1];
      else if (yy === 0 && xx < bw - 3) c = p.stone[3];
      s.set(x, y, c);
    }
}

export function cottage(p: Palette, r: Rng, wallW = 96, opts: { windows?: number; flowers?: boolean } = {}): Built & { door: { x: number; y: number; w: number; h: number } } {
  const over = 6;
  const W = wallW + over * 2;
  const chim = 12;
  const roofH = 42;
  const wallH = 36;
  const H = chim + roofH + wallH;
  const s = new Sprite(W, H);
  const wallTop = chim + roofH;
  const wx0 = over;
  // Wall: plaster, the eave's shadow along its top, a stone foundation.
  for (let y = wallTop; y < H; y++)
    for (let x = wx0; x < wx0 + wallW; x++) {
      const yy = y - wallTop;
      s.set(x, y, yy < 4 ? p.plaster[0] : x > wx0 + wallW - 3 ? p.plaster[0] : p.plaster[1]);
    }
  // A soft lit patch on the plaster (upper left), in clusters.
  for (let y = wallTop + 6; y < wallTop + 14; y++) for (let x = wx0 + 6; x < wx0 + 22; x++) if ((x + y) % 5 !== 0) s.set(x, y, p.plaster[2]);
  stoneBlocks(s, p, wx0, H - 5, wallW, 5, 7, 5);
  // Timber frame: corner posts, a beam under the eave, one middle post.
  const post = (x: number) => {
    for (let y = wallTop + 3; y < H - 5; y++) {
      s.set(x, y, p.wood[2]);
      s.set(x + 1, y, p.wood[1]);
      s.set(x + 2, y, p.wood[1]);
    }
  };
  post(wx0);
  post(wx0 + wallW - 3);
  for (let x = wx0; x < wx0 + wallW; x++) {
    s.set(x, wallTop + 4, p.wood[2]);
    s.set(x, wallTop + 5, p.wood[1]);
  }
  // Door, a little right of centre.
  const dw = 18;
  const dh = 28;
  const dx = Math.round(wx0 + wallW / 2 - dw / 2 + r.int(4, 12));
  const dy = H - dh;
  for (let y = dy; y < H; y++)
    for (let x = dx; x < dx + dw; x++) {
      const yy = y - dy;
      const xx = x - dx;
      // Rounded top.
      if (yy < 3 && (xx < 3 - yy || xx >= dw - (3 - yy))) continue;
      let c = p.wood[2];
      if (xx === 0 || xx === dw - 1 || yy === 0 || (yy < 3 && (xx === 3 - yy || xx === dw - 1 - (3 - yy)))) c = p.wood[0];
      else if ((xx - 1) % 5 === 4) c = p.wood[1];
      else if (xx === 1) c = p.wood[3];
      s.set(x, y, c);
    }
  s.set(dx + dw - 5, dy + 15, p.flower[1]);
  s.set(dx + dw - 5, dy + 16, p.wood[0]);
  post(dx - 3);
  post(dx + dw);
  // Windows with a flower box.
  const win = (x0: number) => {
    const y0 = wallTop + 11;
    for (let y = y0; y < y0 + 12; y++)
      for (let x = x0; x < x0 + 16; x++) {
        const xx = x - x0;
        const yy = y - y0;
        let c: RGB = xx + yy < 12 ? p.glass[1] : p.glass[0];
        if (xx === 0 || yy === 0 || xx === 15 || yy === 11 || xx === 7 || xx === 8 || yy === 5) c = p.wood[1];
        else if ((xx === 2 && yy < 4) || (yy === 1 && xx < 5)) c = p.glass[2];
        s.set(x, y, c);
      }
    if (opts.flowers !== false) {
      for (let x = x0 - 1; x < x0 + 17; x++) {
        s.set(x, y0 + 12, p.wood[2]);
        s.set(x, y0 + 13, p.wood[1]);
      }
      for (let x = x0; x < x0 + 16; x += 3) {
        s.set(x, y0 + 11, p.leaf[3]);
        s.set(x + 1, y0 + 11, x % 2 ? p.flower[0] : p.flower[2]);
        s.set(x + 1, y0 + 10, p.leaf[3]);
      }
    }
  };
  const nWin = opts.windows ?? 2;
  if (nWin >= 1) win(wx0 + 10);
  if (nWin >= 2 && dx + dw + 22 < wx0 + wallW) win(dx + dw + 6);
  // Roof (a little narrower at the ridge) and its shadow on the wall.
  roofTiles(s, p, 0, chim, W, roofH, (ry) => Math.round((1 - ry / roofH) * 9));
  // Chimney.
  const cx0 = Math.round(W * 0.7);
  stoneBlocks(s, p, cx0, 0, 10, chim + 10, 5, 4);
  for (let x = cx0 - 1; x < cx0 + 11; x++) {
    s.set(x, 0, p.stone[3]);
    s.set(x, 1, p.stone[1]);
  }
  return { sprite: s, baseX: Math.round(W / 2), baseY: H - 1, door: { x: dx, y: dy, w: dw, h: dh } };
}

export function well(p: Palette): Built {
  const W = 34;
  const H = 42;
  const s = new Sprite(W, H);
  // Stone wall (a short cylinder: lit on the left, shadowed on the right).
  for (let y = 27; y < H; y++)
    for (let x = 3; x < W - 3; x++) {
      const row = Math.floor((y - 27) / 4);
      const xx = (x + (row % 2) * 3) % 6;
      let c = x < 9 ? p.stone[3] : x > W - 10 ? p.stone[1] : p.stone[2];
      if ((y - 27) % 4 === 3 || xx === 5) c = p.stone[x > W - 10 ? 0 : 1];
      // Rounded bottom corners.
      if (y >= H - 2 && (x < 5 || x > W - 6)) continue;
      s.set(x, y, c);
    }
  // Rim and the dark water inside.
  s.ellipse(17, 27, 14.5, 5, p.stone[3]);
  s.ellipse(17, 27.5, 11, 3.2, p.water[0]);
  s.set(13, 27, p.water[1]);
  s.set(14, 27, p.water[1]);
  // Posts and a little roof.
  for (let y = 9; y < 27; y++) {
    s.set(5, y, p.wood[2]);
    s.set(6, y, p.wood[1]);
    s.set(27, y, p.wood[2]);
    s.set(28, y, p.wood[1]);
  }
  for (let x = 6; x < 28; x++) s.set(x, 15, p.wood[1]);
  s.set(17, 16, p.rock[1]);
  s.set(17, 17, p.rock[1]);
  s.rect(15, 18, 5, 4, p.wood[2]);
  s.rect(15, 21, 5, 1, p.wood[1]);
  roofTiles(s, p, 1, 0, 32, 11, (ry) => Math.round((1 - ry / 11) * 5));
  return { sprite: s, baseX: 17, baseY: H - 1 };
}

export function bench(p: Palette): Built {
  const W = 30;
  const H = 17;
  const s = new Sprite(W, H);
  // Back rest.
  for (let x = 1; x < W - 1; x++) {
    s.set(x, 2, p.wood[3]);
    s.set(x, 3, p.wood[2]);
    s.set(x, 4, p.wood[2]);
    s.set(x, 5, p.wood[1]);
  }
  for (const x of [3, W - 5]) for (let y = 1; y < H; y++) {
    s.set(x, y, p.wood[1]);
    s.set(x + 1, y, p.wood[0]);
  }
  // Seat: top face, then its front edge.
  for (let x = 0; x < W; x++) {
    s.set(x, 9, p.wood[3]);
    s.set(x, 10, p.wood[3]);
    s.set(x, 11, p.wood[2]);
    s.set(x, 12, p.wood[1]);
  }
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

export function signpost(p: Palette): Built {
  const W = 24;
  const H = 27;
  const s = new Sprite(W, H);
  for (let y = 8; y < H; y++) {
    s.set(10, y, p.wood[2]);
    s.set(11, y, p.wood[1]);
    s.set(12, y, p.wood[0]);
  }
  // A blank board pointing along the road (no writing).
  for (let y = 2; y < 12; y++)
    for (let x = 1; x < 21; x++) {
      const yy = y - 2;
      const tip = x >= 18 ? x - 17 : 0;
      if (yy < tip || yy > 9 - tip) continue;
      let c = p.wood[2];
      if (yy === tip) c = p.wood[3];
      else if (yy === 9 - tip) c = p.wood[1];
      else if (x === 4 || x === 15) c = p.wood[1];
      s.set(x, y, c);
    }
  return { sprite: s, baseX: 11, baseY: H - 1 };
}

export function barrel(p: Palette): Built {
  const W = 13;
  const H = 16;
  const s = new Sprite(W, H);
  for (let y = 3; y < H; y++)
    for (let x = 1; x < W - 1; x++) {
      if (y === H - 1 && (x === 1 || x === W - 2)) continue;
      let c = x < 4 ? p.wood[3] : x > W - 5 ? p.wood[1] : p.wood[2];
      if (x === 6) c = p.wood[1];
      if (y === 5 || y === 12) c = x > W - 5 ? p.rock[0] : p.rock[1];
      s.set(x, y, c);
    }
  s.ellipse(6.5, 3, 5.5, 2.3, p.wood[1]);
  s.ellipse(6.5, 3, 4, 1.4, p.wood[0]);
  return { sprite: s, baseX: 6, baseY: H - 1 };
}

export function crate(p: Palette): Built {
  const W = 14;
  const H = 14;
  const s = new Sprite(W, H);
  for (let y = 0; y < 4; y++) for (let x = 0; x < W; x++) s.set(x, y, y === 0 ? p.wood[3] : x % 5 === 4 ? p.wood[2] : p.wood[3]);
  for (let y = 4; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c = p.wood[2];
      if (x === 0 || x === W - 1 || y === 4 || y === H - 1) c = p.wood[1];
      else if (Math.abs((x - 1) - (y - 5) * 1.2) < 1) c = p.wood[1];
      s.set(x, y, c);
    }
  return { sprite: s, baseX: W >> 1, baseY: H - 1 };
}

export function rock(p: Palette, r: Rng, w = 14): Built {
  const h = Math.round(w * 0.62);
  const s = new Sprite(w, h + 1);
  s.ellipse(w / 2, h / 2 + 0.5, w / 2, h / 2 + 0.5, (x, y, nx, ny) => {
    const l = -(nx * 0.6 + ny * 0.8);
    return l > 0.35 ? p.stone[3] : l > -0.35 ? p.stone[2] : p.stone[1];
  });
  if (r.chance(0.6)) for (let x = Math.round(w * 0.3); x < Math.round(w * 0.6); x++) s.set(x, 1, p.leaf[3]);
  return { sprite: s, baseX: w >> 1, baseY: h };
}
