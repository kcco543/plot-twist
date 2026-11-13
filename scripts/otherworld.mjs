// Otherworld: the hero world. Hand-tuned pastel scenes (320x192) built from
// small reusable pixel props: floating islands, mushroom houses, crystals,
// lantern strings, critters and sparkles. Original art; no references copied.
import { Canvas, rng } from "./pixel.mjs";

export const W = 320, H = 192;

// ---------------------------------------------------------------- PALETTE
export const OL = "#5b4a86"; // soft outline (never black)
const P = {
  sky: ["#b9a6ec", "#cdb8f2", "#e3c6f0", "#f6c9dc", "#ffd6c6", "#ffe9d4"],
  dusk: ["#6f5ab8", "#8a6fd0", "#a98ae0", "#cba2e6", "#eab3d6", "#ffc9cf"],
  cloud: ["#e4d6f6", "#f4ecfd", "#ffffff"],
  far: ["#c2b0ee", "#d3c3f4"],
  grass: ["#5fb39a", "#8fd9b9", "#c9f2df"],
  grassDeep: "#4f9c88",
  earth: ["#8a6fb8", "#b49be6", "#d9caf7"],
  stem: ["#e6d3c3", "#fff6ea", "#ffffff"],
  pink: ["#d97aa2", "#f5a8c5", "#ffe0ec"],
  peach: ["#e98a6a", "#ffc3a0", "#ffe6d8"],
  peri: ["#7f8fe0", "#aab8f5", "#e6ebff"],
  lav: ["#977ed8", "#c3b2f0", "#efe8ff"],
  mint: ["#62bf9f", "#9de3c8", "#dcfaee"],
  butter: ["#e8b85a", "#ffe08a", "#fff6d2"],
  teal: ["#4fb3c4", "#8fd8e6", "#dff7fb"],
  water: ["#86b8ec", "#b2d8f7", "#eaf7ff"],
  wood: ["#a0766a", "#c99a82", "#ead0b8"],
  stone: ["#a99cc9", "#cfc4e8", "#f1ecfb"],
  cobble: ["#d8c9ea", "#ece2f6", "#fbf7ff"],
  glow: "#fff1a8",
};

// ---------------------------------------------------------------- HELPERS
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** Vertical gradient through `cols`, ordered-dithered between steps (pixel-art friendly). */
function gradient(c, y0, y1, cols, x0 = 0, x1 = W) {
  for (let y = y0; y < y1; y++) {
    const t = ((y - y0) / Math.max(1, y1 - y0 - 1)) * (cols.length - 1);
    const i = Math.min(cols.length - 2, Math.floor(t)), f = t - i;
    for (let x = x0; x < x1; x++) c.set(x, y, f * 16 > BAYER[y & 3][x & 3] + 0.5 ? cols[i + 1] : cols[i]);
  }
}
function sparkle(c, x, y, col = "#ffffff", big = false) {
  c.set(x, y, col); c.set(x - 1, y, col); c.set(x + 1, y, col); c.set(x, y - 1, col); c.set(x, y + 1, col);
  if (big) { c.set(x - 2, y, col); c.set(x + 2, y, col); c.set(x, y - 2, col); c.set(x, y + 2, col); c.set(x, y, P.butter[2]); }
}
function sparkles(c, n, y0, y1, seed, cols = ["#ffffff", P.butter[2], P.pink[2]]) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = 4 + Math.floor(r() * (W - 8)), y = y0 + Math.floor(r() * (y1 - y0)), col = cols[i % cols.length];
    if (r() > 0.7) sparkle(c, x, y, col, r() > 0.6); else c.set(x, y, col);
  }
}
function cloud(c, x, y, w, cols = P.cloud) {
  const h = Math.max(5, Math.round(w / 4));
  const puffs = [[0, 0, w / 2, h], [-w / 4, -h * 0.5, w / 4, h * 0.8], [w / 6, -h * 0.8, w / 3.2, h], [w / 2.8, -h * 0.2, w / 4.5, h * 0.7]];
  for (const [dx, dy, rx, ry] of puffs) c.ellipse(x + dx, y + dy, rx, ry, cols[1]);
  for (const [dx, dy, rx, ry] of puffs) c.ellipse(x + dx - 1, y + dy - 1, rx * 0.7, ry * 0.6, cols[2], (_, yy) => yy < y + dy);
  c.rect(Math.round(x - w / 2 + 2), Math.round(y + h - 2), Math.round(w - 4), 2, cols[0]);
}
function ridge(c, base, amp, freq, col, seed, toY = H) {
  const r = rng(seed); const ph = r() * 6;
  for (let x = 0; x < W; x++) {
    const top = Math.round(base - amp * (0.55 + 0.45 * Math.sin(x * freq + ph)) - amp * 0.25 * Math.sin(x * freq * 2.3 + ph * 2));
    c.rect(x, top, 1, toY - top, col);
  }
}
/** Floating island: grass cap, lavender rock underside, dangling roots, optional waterfall. */
function island(c, cx, top, w, { depth = Math.round(w * 0.45), seed = 1, fall = 0, outline = OL, grass = P.grass, earth = P.earth } = {}) {
  const r = rng(seed);
  c.object((L) => {
    for (let i = 0; i <= depth; i++) {
      const k = i / depth, half = (w / 2) * (1 - Math.pow(k, 1.3)) + (r() - 0.5) * 2;
      const col = k < 0.25 ? earth[2] : k < 0.65 ? earth[1] : earth[0];
      L.rect(Math.round(cx - half), top + 5 + i, Math.max(1, Math.round(half * 2)), 1, col);
      if (k < 0.7 && i % 5 === 2) L.set(Math.round(cx - half * 0.3), top + 5 + i, earth[0]);
    }
    L.ellipse(cx, top + 3, w / 2 + 1, 4, grass, (_, yy) => yy <= top + 6);
    L.rect(Math.round(cx - w / 2), top + 4, Math.round(w), 3, grass[1]);
    for (let x = Math.round(cx - w / 2) + 1; x < cx + w / 2 - 1; x += 3) if (r() > 0.35) L.rect(x, top + 7, 1, 1 + Math.floor(r() * 3), grass[0]);
  }, outline);
  // highlight tufts on the grass
  for (let x = Math.round(cx - w / 2) + 3; x < cx + w / 2 - 3; x += 5 + Math.floor(r() * 4)) { c.set(x, top + 1, P.grass[2]); c.set(x + 1, top, P.grass[2]); }
  if (fall) waterfall(c, Math.round(cx + w * 0.22), top + 6, fall);
}
function waterfall(c, x, y, len) {
  for (let yy = y; yy < Math.min(H, y + len); yy++) {
    c.rect(x, yy, 4, 1, P.water[1]); c.set(x, yy, P.water[2]); c.set(x + 3, yy, P.water[0]);
    if ((yy * 7) % 11 < 2) c.set(x + 1 + (yy % 2), yy, "#ffffff");
  }
  const by = Math.min(H - 2, y + len);
  c.ellipse(x + 2, by, 6, 2, P.cloud[2]); c.set(x - 3, by - 2, "#ffffff"); c.set(x + 7, by - 3, "#ffffff");
}
function mushroomHouse(c, x, base, s, cap, { lit = true, chimney = false, seed = 1 } = {}) {
  const r = rng(seed);
  const sw = Math.round(s * 0.9), sh = Math.round(s * 1.15), capY = base - sh;
  c.object((L) => {
    // stem with a little flare at the foot
    L.rect(x - sw / 2, capY, sw, sh, P.stem[1]);
    L.rect(x - sw / 2 - 1, base - 3, sw + 2, 3, P.stem[1]);
    L.rect(x - sw / 2, capY, 2, sh, P.stem[2]); L.rect(x + sw / 2 - 3, capY, 3, sh, P.stem[0]);
    // arched door
    const dw = Math.max(6, Math.round(s * 0.34)), dh = Math.round(s * 0.55), dx = Math.round(x - dw / 2);
    L.rect(dx, base - dh, dw, dh, P.wood[1]); L.ellipse(x, base - dh, dw / 2, dw / 2.4, P.wood[1], (_, yy) => yy <= base - dh);
    L.rect(dx + 1, base - dh + 1, 1, dh - 1, P.wood[2]); L.rect(dx + dw - 2, base - dh, 1, dh, P.wood[0]);
    L.set(dx + dw - 3, base - Math.round(dh / 2), P.butter[1]);
    // round window
    const wx = Math.round(x + sw * 0.25), wy = Math.round(capY + sh * 0.32);
    if (sw > 14) { L.ellipse(wx, wy, 3, 3, P.wood[0]); L.ellipse(wx, wy, 2, 2, lit ? P.glow : P.peri[1]); L.set(wx - 1, wy - 1, "#ffffff"); }
    // cap
    if (chimney) { L.rect(x + s * 0.35, capY - s * 0.75, 4, 8, P.stone[1]); L.rect(x + s * 0.35, capY - s * 0.75, 4, 1, P.stone[2]); }
    L.ellipse(x, capY + 1, s, s * 0.62, cap, (_, yy) => yy <= capY + 2);
    L.rect(x - s + 2, capY + 2, s * 2 - 3, 2, cap[0]);
    // spots
    for (let i = 0; i < 4; i++) {
      const a = -2.6 + i * 0.75 + r() * 0.2, sx = x + Math.cos(a) * s * 0.6, sy = capY - Math.sin(-a) * s * 0.35 - 1;
      L.ellipse(sx, sy, 1.6 + (i % 2), 1.2 + (i % 2) * 0.6, cap[2]);
    }
  }, OL);
  if (lit) c.set(x + Math.round(sw * 0.25) + 3, Math.round(capY + sh * 0.32) - 3, P.butter[2]);
}
function crystal(c, x, base, h, ramp, w = Math.max(3, Math.round(h / 3))) {
  c.object((L) => {
    const tip = Math.round(h * 0.35);
    for (let i = 0; i < h; i++) {
      const y = base - i, half = i > h - tip ? Math.max(0, Math.round((w / 2) * ((h - i) / tip))) : Math.round(w / 2);
      for (let dx = -half; dx <= half; dx++) L.set(x + dx, y, dx < 0 ? ramp[2] : dx === half && half > 0 ? ramp[0] : ramp[1]);
    }
    L.set(x - Math.round(w / 4), base - Math.round(h * 0.5), "#ffffff");
  }, OL);
}
function crystalCluster(c, x, base, s, ramp) {
  crystal(c, x - s * 0.55, base, Math.round(s * 0.7), ramp);
  crystal(c, x + s * 0.55, base, Math.round(s * 0.8), ramp);
  crystal(c, x, base, s, ramp, Math.max(4, Math.round(s / 2.6)));
}
function lanternString(c, x0, y0, x1, y1, sag, cols, every = 14) {
  let last = -99;
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (x1 - x0), y = Math.round(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t));
    c.set(x, y, "#8a7ab0");
    if (x - last >= every && x > x0 + 3 && x < x1 - 3) {
      last = x;
      const col = cols[Math.floor(x / every) % cols.length];
      c.object((L) => { L.rect(x - 1, y + 1, 3, 4, col[1]); L.set(x - 1, y + 1, col[2]); L.set(x, y + 5, col[0]); }, OL);
      c.set(x, y + 2, "#ffffff");
    }
  }
}
function bunting(c, x0, x1, y, sag, cols) {
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (x1 - x0), yy = Math.round(y + sag * 4 * t * (1 - t));
    c.set(x, yy, "#8a7ab0");
    if ((x - x0) % 9 === 3) { const col = cols[Math.floor((x - x0) / 9) % cols.length]; for (let k = 0; k < 4; k++) c.rect(x - 3 + k, yy + 1 + k, 7 - k * 2, 1, col); }
  }
}
function flower(c, x, y, col) {
  c.set(x, y + 1, P.grass[0]); c.set(x, y + 2, P.grass[0]);
  c.set(x - 1, y, col); c.set(x + 1, y, col); c.set(x, y - 1, col); c.set(x, y + 1, col); c.set(x, y, P.butter[1]);
}
function meadow(c, n, y0, y1, seed) {
  const r = rng(seed), cols = [P.pink[1], P.peach[1], P.butter[2], P.peri[1], "#ffffff"];
  for (let i = 0; i < n; i++) flower(c, 3 + Math.floor(r() * (W - 6)), y0 + Math.floor(r() * (y1 - y0)), cols[i % cols.length]);
}
function tufts(c, n, y0, y1, seed, col = P.grass[2]) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) { const x = Math.floor(r() * W), y = y0 + Math.floor(r() * (y1 - y0)); c.set(x, y, col); c.set(x + 1, y - 1, col); c.set(x + 2, y, col); }
}
/** Tiny round critter (a "puff"). */
function puff(c, x, y, ramp, dir = 1) {
  c.object((L) => { L.ellipse(x, y, 5, 4, ramp); L.set(x - 4 * dir, y - 4, ramp[1]); L.set(x - 3 * dir, y - 5, ramp[1]); }, OL);
  c.set(x + dir, y - 1, OL); c.set(x + 3 * dir, y - 1, OL); c.set(x + 2 * dir, y + 1, P.pink[0]);
  c.set(x - 1 * dir, y - 2, "#ffffff");
}
function grassGround(c, top, seed) {
  gradient(c, top, H, [P.grass[1], P.grass[1], "#7fcfae", P.grass[0]]);
  c.rect(0, top, W, 1, P.grass[2]);
  tufts(c, 70, top + 3, H, seed);
  tufts(c, 30, top + 10, H, seed + 1, P.grassDeep);
}
function cobblePath(c, yTop, seed) {
  const r = rng(seed);
  c.rect(0, yTop, W, H - yTop, P.cobble[0]);
  for (let y = yTop + 1, row = 0; y < H; row++) {
    const h = 5 + Math.min(4, row);
    for (let x = (row % 2) * -6 - 2; x < W; ) {
      const w = 9 + Math.floor(r() * 6) + row;
      c.rect(x + 1, y, w - 2, h - 1, r() > 0.8 ? P.pink[2] : P.cobble[1]);
      c.rect(x + 1, y, w - 2, 1, P.cobble[2]);
      x += w;
    }
    y += h;
  }
  c.rect(0, yTop, W, 2, P.stone[0]);
}

// ---------------------------------------------------------------- SCENES
export const OTHERWORLD = {
  wilderness(c) {
    gradient(c, 0, 132, P.sky);
    c.ellipse(250, 30, 15, 15, P.butter[2]); c.ellipse(250, 30, 11, 11, "#fffbe8");
    for (let a = 0; a < 8; a++) { const x = 250 + Math.round(Math.cos(a * 0.785) * 20), y = 30 + Math.round(Math.sin(a * 0.785) * 20); c.set(x, y, P.butter[2]); }
    cloud(c, 60, 34, 52); cloud(c, 196, 20, 36); cloud(c, 300, 58, 40);
    sparkles(c, 14, 4, 70, 3);
    // far islands
    for (const [x, y, w] of [[34, 62, 26], [124, 46, 34], [292, 92, 22]]) island(c, x, y, w, { seed: x, outline: "#9a86cf", grass: [P.far[0], P.far[1], "#ece2fb"], earth: ["#b8a6e6", "#c9b9ef", "#ddd1f7"] });
    // main floating island with waterfall + mushroom house
    island(c, 196, 62, 70, { seed: 7, depth: 30, fall: 70 });
    mushroomHouse(c, 186, 66, 13, P.pink, { chimney: true, seed: 2 });
    crystal(c, 216, 66, 10, P.teal);
    c.object((L) => { L.ellipse(168, 60, 5, 5, P.mint); L.rect(167, 60, 2, 6, P.wood[0]); }, OL);
    // rolling hills
    ridge(c, 128, 14, 0.028, P.far[1], 4);
    ridge(c, 138, 10, 0.045, "#b6dfcf", 9);
    ridge(c, 146, 8, 0.06, "#a4dcc4", 12);
    grassGround(c, 146, 5);
    // pond
    c.object((L) => { L.ellipse(82, 170, 34, 9, P.water); }, OL);
    c.ellipse(82, 169, 26, 6, P.water[1]); c.rect(66, 167, 8, 1, P.water[2]); c.rect(86, 171, 12, 1, P.water[2]);
    c.object((L) => { L.ellipse(70, 172, 4, 2, P.mint); }, OL); c.set(71, 171, P.pink[1]);
    // path
    for (let y = 146; y < H; y++) { const w = 10 + (y - 146) * 0.8, cx = 214 + Math.sin(y * 0.06) * 10; c.rect(Math.round(cx - w / 2), y, Math.round(w), 1, P.cobble[1]); c.set(Math.round(cx - w / 2), y, P.stone[0]); c.set(Math.round(cx + w / 2), y, P.stone[0]); if (y % 6 === 0) c.rect(Math.round(cx - 2), y, 3, 1, P.cobble[2]); }
    // big mushrooms & crystals on the ground
    mushroomHouse(c, 30, 158, 15, P.peri, { seed: 3, lit: true });
    crystalCluster(c, 286, 170, 18, P.lav);
    crystalCluster(c, 150, 182, 10, P.teal);
    for (const [x, y, cap, s] of [[120, 160, P.peach, 5], [130, 163, P.pink, 3], [262, 182, P.butter, 4]]) c.object((L) => { L.rect(x - 1, y - s, 2, s, P.stem[1]); L.ellipse(x, y - s, s, s * 0.6, cap, (_, yy) => yy <= y - s + 1); }, OL);
    meadow(c, 34, 150, 190, 11);
    puff(c, 246, 176, P.peach, -1); puff(c, 112, 184, P.lav, 1);
    sparkles(c, 10, 140, 188, 17, [P.butter[2], "#ffffff"]);
  },

  street(c) {
    gradient(c, 0, 120, P.sky);
    cloud(c, 40, 24, 44); cloud(c, 170, 14, 30); cloud(c, 280, 30, 50);
    sparkles(c, 10, 4, 50, 8);
    island(c, 236, 40, 30, { seed: 4, outline: "#9a86cf", grass: [P.far[0], P.far[1], "#ece2fb"], earth: ["#b8a6e6", "#c9b9ef", "#ddd1f7"], fall: 30 });
    ridge(c, 112, 12, 0.03, P.far[1], 2);
    ridge(c, 124, 8, 0.05, "#b6dfcf", 6);
    c.rect(0, 124, W, 22, P.grass[1]); tufts(c, 30, 126, 144, 3);
    // houses
    mushroomHouse(c, 40, 142, 22, P.pink, { chimney: true, seed: 11 });
    mushroomHouse(c, 116, 142, 17, P.peri, { seed: 12 });
    mushroomHouse(c, 196, 142, 24, P.peach, { chimney: true, seed: 13 });
    mushroomHouse(c, 280, 142, 18, P.mint, { seed: 14 });
    lanternString(c, 46, 98, 112, 104, 10, [P.pink, P.butter, P.mint]);
    lanternString(c, 120, 104, 192, 92, 12, [P.peri, P.peach, P.butter]);
    lanternString(c, 200, 92, 276, 104, 10, [P.butter, P.pink, P.teal]);
    // flower boxes & signpost
    c.object((L) => { L.rect(150, 116, 2, 26, P.wood[0]); L.rect(140, 112, 22, 7, P.wood[1]); L.rect(140, 112, 22, 1, P.wood[2]); L.rect(144, 115, 14, 1, P.wood[0]); }, OL);
    for (const x of [70, 236]) c.object((L) => { L.rect(x, 134, 14, 7, P.wood[1]); L.rect(x, 134, 14, 1, P.wood[2]); }, OL);
    for (const x of [72, 76, 80, 84, 238, 242, 246, 250]) flower(c, x, 131, [P.pink[1], P.butter[1], "#ffffff", P.peri[1]][x % 4]);
    cobblePath(c, 146, 21);
    crystalCluster(c, 12, 150, 12, P.teal);
    crystalCluster(c, 308, 152, 14, P.lav);
    puff(c, 224, 186, P.mint, -1);
    sparkles(c, 6, 150, 188, 25, [P.butter[2], "#ffffff"]);
  },

  interior(c) {
    // curved plaster wall with a lavender wainscot
    gradient(c, 0, 112, ["#fff3e6", "#fdeee6", "#f8e4ee"]);
    for (let x = 0; x < W; x++) { const k = Math.abs(x - 160) / 160, t = Math.round(10 * k * k); c.rect(x, 0, 1, t, P.lav[1]); c.set(x, t, P.lav[0]); }
    c.rect(0, 84, W, 28, P.lav[1]); c.rect(0, 84, W, 2, P.lav[2]); c.rect(0, 110, W, 2, P.lav[0]);
    for (let x = 6; x < W; x += 14) { c.rect(x, 90, 8, 16, P.lav[0]); c.rect(x + 1, 91, 6, 14, P.lav[1]); c.rect(x + 1, 91, 6, 1, P.lav[2]); }
    bunting(c, 0, 320, 14, 8, [P.pink[1], P.butter[1], P.mint[1], P.peri[1]]);
    // round window with a sky view
    c.object((L) => { L.ellipse(70, 46, 25, 25, P.wood[1]); }, OL);
    { const v = new Canvas(W, H); gradient(v, 22, 70, P.sky, 46, 94); cloud(v, 62, 52, 18); island(v, 82, 38, 14, { seed: 9, outline: "#9a86cf", grass: [P.far[0], P.far[1], "#ece2fb"], earth: ["#b8a6e6", "#c9b9ef", "#ddd1f7"], fall: 14 });
      for (let y = 22; y < 70; y++) for (let x = 46; x < 94; x++) { const dx = x + 0.5 - 70, dy = y + 0.5 - 46; if (dx * dx + dy * dy <= 20 * 20) { const i = (y * W + x) * 4; if (v.d[i + 3]) c.d.set(v.d.subarray(i, i + 4), i); } } }
    c.rect(69, 26, 2, 40, P.wood[0]); c.rect(50, 45, 40, 2, P.wood[0]);
    c.object((L) => { L.rect(40, 70, 60, 4, P.wood[1]); L.rect(40, 70, 60, 1, P.wood[2]); }, OL);
    for (const [x, cap] of [[48, P.pink], [92, P.peach]]) c.object((L) => { L.rect(x - 4, 63, 8, 7, P.peri[1]); L.rect(x - 4, 63, 8, 1, P.peri[2]); L.ellipse(x, 60, 5, 4, P.mint); L.set(x + 1, 57, cap[1]); }, OL);
    // shelf with potions and crystals
    c.object((L) => { L.rect(136, 50, 72, 4, P.wood[1]); L.rect(136, 50, 72, 1, P.wood[2]); L.rect(140, 54, 3, 4, P.wood[0]); L.rect(201, 54, 3, 4, P.wood[0]); }, OL);
    for (const [x, ramp, h] of [[144, P.pink, 10], [156, P.mint, 13], [170, P.butter, 9], [184, P.peri, 12]]) c.object((L) => { L.ellipse(x, 50 - h / 2, 4, h / 2, ramp); L.rect(x - 1, 50 - h - 3, 2, 3, P.wood[2]); L.set(x - 2, 50 - h / 2 - 1, "#ffffff"); }, OL);
    crystal(c, 198, 49, 11, P.teal);
    // hanging plant
    c.set(232, 0, "#8a7ab0"); c.rect(232, 0, 1, 20, "#8a7ab0");
    c.object((L) => { L.ellipse(232, 26, 9, 6, P.peach); L.ellipse(232, 20, 8, 5, P.mint); for (const [vx, vl] of [[226, 14], [230, 20], [236, 12], [239, 17]]) L.rect(vx, 26, 1, vl, P.mint[0]); }, OL);
    // door
    c.object((L) => { L.rect(262, 40, 38, 72, P.wood[1]); L.ellipse(281, 40, 19, 12, P.wood[1], (_, yy) => yy <= 40); L.rect(266, 34, 30, 78, P.wood[0]); L.rect(268, 36, 26, 76, P.wood[1]); L.ellipse(281, 54, 6, 6, P.glow); L.rect(280, 48, 2, 12, P.wood[0]); L.rect(275, 53, 12, 2, P.wood[0]); L.rect(290, 80, 3, 3, P.butter[0]); }, OL);
    // floor: warm boards
    for (let y = 112; y < H; y += 8) { c.rect(0, y, W, 8, (y / 8) % 2 ? "#e9c9b4" : "#efd3bf"); c.rect(0, y + 7, W, 1, "#d7ae96"); for (let x = ((y / 8) % 3) * 22; x < W; x += 66) c.rect(x, y, 1, 7, "#d7ae96"); }
    c.rect(0, 112, W, 2, "#c99a82");
    // round rug, table with tea
    c.object((L) => L.ellipse(160, 164, 76, 20, P.pink), OL);
    c.ellipse(160, 164, 64, 15, P.pink[2]); c.ellipse(160, 164, 58, 12, P.pink[1]);
    for (let a = 0; a < 16; a++) c.set(160 + Math.round(Math.cos(a * 0.39) * 70), 164 + Math.round(Math.sin(a * 0.39) * 17.5), P.butter[1]);
    c.object((L) => { L.rect(144, 128, 4, 24, P.wood[0]); L.rect(172, 128, 4, 24, P.wood[0]); L.ellipse(160, 126, 28, 7, P.wood); L.ellipse(156, 117, 7, 6, P.peri); L.rect(150, 116, 2, 3, P.peri[1]); L.rect(155, 109, 3, 2, P.peri[0]); L.rect(167, 115, 6, 6, P.stem[1]); L.rect(173, 116, 2, 3, P.stem[1]); }, OL);
    for (let i = 0; i < 3; i++) c.set(170 + (i % 2), 111 - i * 2, "#ffffff");
    // floor cushion, lantern, plant, sleepy puff
    c.object((L) => { L.ellipse(92, 170, 16, 6, P.peri); L.ellipse(92, 166, 14, 5, P.peri[2]); }, OL);
    c.object((L) => { L.rect(30, 140, 2, 6, P.wood[0]); L.rect(25, 146, 12, 16, P.butter[1]); L.rect(25, 146, 12, 2, P.butter[2]); L.rect(28, 149, 6, 10, P.glow); L.rect(24, 162, 14, 2, P.wood[0]); }, OL);
    c.object((L) => { L.rect(222, 150, 18, 14, P.peach[0]); L.rect(222, 150, 18, 3, P.peach[1]); L.ellipse(231, 138, 13, 13, P.mint); L.ellipse(222, 144, 7, 6, P.mint); L.ellipse(241, 144, 6, 5, P.mint); }, OL);
    c.set(228, 134, P.pink[1]); c.set(236, 140, P.butter[1]); c.set(226, 142, "#ffffff");
    puff(c, 92, 160, P.lav, 1);
    sparkles(c, 8, 120, 150, 31, [P.butter[2], "#ffffff"]);
  },

  ruins(c) {
    gradient(c, 0, 140, ["#c5b4f0", "#d8c4f3", "#f0cde6", "#ffdcd0", "#fff0dc"]);
    cloud(c, 54, 42, 50); cloud(c, 262, 26, 44);
    sparkles(c, 12, 4, 80, 41);
    ridge(c, 120, 14, 0.025, P.far[1], 14);
    // big broken arch with a glowing crystal heart
    c.object((L) => {
      L.rect(118, 38, 18, 96, P.stone[1]); L.rect(184, 52, 18, 82, P.stone[1]);
      L.ellipse(160, 46, 42, 30, P.stone, (x, y) => y < 46 && x < 186);
      L.rect(118, 38, 4, 96, P.stone[2]); L.rect(132, 38, 4, 96, P.stone[0]); L.rect(184, 52, 4, 82, P.stone[2]); L.rect(198, 52, 4, 82, P.stone[0]);
      for (let y = 46; y < 134; y += 10) { L.rect(118, y, 18, 1, P.stone[0]); L.rect(184, y + 5, 18, 1, P.stone[0]); }
    }, OL);
    c.ellipse(160, 50, 24, 18, "#fff0dc", (x, y) => y < 50 && x > 136 && x < 184);
    for (let i = 0; i < 4; i++) c.object((L) => L.rect(186 + i * 5, 38 - i * 4 - (i % 2) * 3, 5, 4, P.stone[1 + (i % 2)]), OL);
    crystal(c, 160, 128, 34, P.teal, 12);
    c.ellipse(160, 112, 22, 26, "#dff7fb", (x, y) => !(x > 152 && x < 168 && y > 94)); // halo
    crystal(c, 160, 128, 34, P.teal, 12);
    crystal(c, 146, 130, 14, P.lav); crystal(c, 175, 130, 16, P.pink);
    // side columns, one with a flower crown
    for (const [x, h, broken, seed] of [[40, 84, 0, 1], [80, 56, 1, 2], [246, 64, 1, 3], [288, 90, 0, 4]]) {
      const r = rng(seed);
      c.object((L) => {
        L.rect(x - 9, 134 - h, 18, h, P.stone[1]); L.rect(x - 9, 134 - h, 3, h, P.stone[2]); L.rect(x + 6, 134 - h, 3, h, P.stone[0]);
        for (let y = 134 - h + 6; y < 132; y += 7) L.rect(x - 3, y, 1, 4, P.stone[0]);
        if (!broken) { L.rect(x - 12, 130 - h, 24, 5, P.stone[2]); L.rect(x - 12, 134 - h, 24, 1, P.stone[0]); } else { L.rect(x - 9, 132 - h, 5, 2, P.stone[1]); L.rect(x + 1, 131 - h, 8, 3, P.stone[1]); }
      }, OL);
      for (let y = 136 - h; y < 128; y += 3) if (r() > 0.4) c.set(x - 9 + Math.floor(r() * 3), y, P.grass[0]);
      for (let i = 0; i < 5; i++) c.set(x - 8 + i * 4, 131 - h + (broken ? 2 : 0), [P.pink[1], P.butter[1], "#ffffff"][i % 3]);
      c.rect(x - 9, 134 - h + 1, 18, 1, P.grass[1]);
    }
    // floating rubble
    for (const [x, y, s] of [[104, 56, 6], [222, 30, 5], [62, 34, 4], [268, 80, 5]]) c.object((L) => { L.rect(x, y, s * 2, s, P.stone[1]); L.rect(x, y, s * 2, 1, P.stone[2]); L.set(x + s, y + s, P.stone[0]); }, OL);
    // mossy flagstones with steps
    c.rect(0, 134, W, 58, P.grass[1]); tufts(c, 20, 136, 150, 41);
    c.object((L) => { for (let i = 0; i < 3; i++) L.rect(120 - i * 10, 134 + i * 4, 80 + i * 20, 4, P.stone[i % 2 ? 1 : 2]); }, OL);
    for (let y = 150, row = 0; y < H; row++, y += 10) for (let x = (row % 2) * 13 - 13; x < W; x += 26) { c.rect(x + 1, y + 1, 24, 8, P.stone[1]); c.rect(x + 1, y + 1, 24, 1, P.stone[2]); if ((x + row) % 3 === 0) c.rect(x + 4, y + 8, 6, 2, P.grass[1]); }
    c.rect(0, 150, W, 1, P.grass[0]);
    crystalCluster(c, 22, 180, 12, P.lav); crystalCluster(c, 300, 176, 14, P.teal);
    meadow(c, 16, 138, 148, 44);
    puff(c, 230, 160, P.peri, -1);
    sparkles(c, 14, 90, 188, 47, [P.teal[2], "#ffffff", P.butter[2]]);
  },

  dreamscape(c) {
    gradient(c, 0, 130, P.dusk);
    sparkles(c, 46, 2, 110, 51, ["#ffffff", P.butter[2], P.teal[2], P.pink[2]]);
    // crescent moon with soft halo
    c.ellipse(64, 34, 22, 22, "#b99be6"); c.ellipse(64, 34, 16, 16, P.butter[2]); c.ellipse(71, 29, 13, 13, "#b99be6");
    // a ringed planet
    c.object((L) => { L.ellipse(266, 26, 9, 9, P.peach); L.rect(250, 26, 33, 2, P.butter[1]); }, OL);
    cloud(c, 140, 70, 40, ["#d9b8e8", "#f2dcf2", "#ffffff"]); cloud(c, 290, 92, 36, ["#d9b8e8", "#f2dcf2", "#ffffff"]);
    // floating islands with a staircase of cloud steps up to a door
    island(c, 236, 46, 48, { seed: 31, depth: 22, fall: 0 });
    c.object((L) => { L.rect(226, 22, 20, 28, P.stem[1]); L.ellipse(236, 22, 10, 8, P.stem[1], (_, y) => y <= 22); L.rect(229, 22, 14, 28, P.peri[1]); L.ellipse(236, 22, 7, 5, P.peri[1], (_, y) => y <= 22); L.rect(229, 22, 14, 2, P.peri[2]); L.set(240, 36, P.butter[1]); }, OL);
    c.ellipse(236, 30, 3, 3, P.glow);
    for (let i = 0; i < 6; i++) { const x = 98 + i * 20, y = 116 - i * 11; c.object((L) => { L.ellipse(x, y, 9, 3, P.cloud[1]); L.rect(x - 8, y, 16, 2, P.cloud[2]); }, "#c5a9e6"); }
    island(c, 40, 82, 40, { seed: 32, fall: 40 });
    mushroomHouse(c, 40, 86, 10, P.pink, { seed: 33 });
    // cloud-checker floor
    for (let row = 0, y = 130; y < H; row++) { const h = 5 + row * 3; for (let x = (row % 2) * 18 - 36; x < W; x += 36) { c.rect(x, y, 18, h, "#f3dcf3"); c.rect(x + 18, y, 18, h, "#dcc8f4"); } y += h; }
    c.rect(0, 130, W, 2, "#ffffff");
    // dream props
    crystalCluster(c, 284, 176, 20, P.pink);
    mushroomHouse(c, 26, 180, 14, P.teal, { seed: 34 });
    c.object((L) => { L.ellipse(118, 176, 7, 7, P.butter); L.rect(117, 162, 2, 8, P.wood[0]); }, OL);
    c.object((L) => { L.ellipse(196, 170, 5, 5, P.peri); L.rect(195, 158, 2, 7, P.wood[0]); }, OL);
    puff(c, 150, 182, P.pink, 1); puff(c, 240, 184, P.mint, -1);
    for (const [x, y] of [[100, 150], [170, 146], [220, 160], [60, 156], [262, 148]]) sparkle(c, x, y, "#ffffff", true);
  },
};

/** Pastel title background, 320x180. */
export function otherworldTitle(c) {
  gradient(c, 0, 150, P.sky);
  c.ellipse(258, 36, 14, 14, P.butter[2]); c.ellipse(258, 36, 10, 10, "#fffbe8");
  cloud(c, 48, 30, 56); cloud(c, 170, 18, 34); cloud(c, 300, 70, 44);
  sparkles(c, 26, 4, 110, 61);
  island(c, 56, 78, 46, { seed: 61, depth: 20, fall: 46 });
  mushroomHouse(c, 52, 82, 12, P.pink, { chimney: true, seed: 62 });
  island(c, 268, 98, 38, { seed: 63, depth: 16 });
  crystalCluster(c, 268, 101, 12, P.teal);
  ridge(c, 140, 14, 0.026, P.far[1], 65);
  ridge(c, 150, 10, 0.045, "#b6dfcf", 66);
  gradient(c, 156, 180, [P.grass[1], "#7fcfae"]); c.rect(0, 156, W, 1, P.grass[2]); tufts(c, 30, 158, 180, 67);
  for (const [x, cap, s] of [[22, P.pink, 12], [40, P.butter, 6], [298, P.lav, 13], [280, P.mint, 6]]) c.object((L) => { L.rect(x - s / 4, 168 - s, s / 2, s, P.stem[1]); L.ellipse(x, 168 - s, s, s * 0.6, cap, (_, yy) => yy <= 168 - s + 1); L.set(x - s / 2, 168 - s - 2, cap[2]); }, OL);
  meadow(c, 18, 160, 178, 68);
}
