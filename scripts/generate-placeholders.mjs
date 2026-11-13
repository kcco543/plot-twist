// Generates every PLACEHOLDER image in public/assets (and the PWA icons).
// Run: node scripts/generate-placeholders.mjs
// All colors come from the PLOT TWIST! ramps (see docs/DESIGN_SYSTEM.md).
// Replace any output with your own art: keep the filename, or edit src/assets/manifest.ts.
import { Canvas, rng } from "./pixel.mjs";

const OUT = new URL("../public/", import.meta.url).pathname;
const R = {
  ink: "#1b1526",
  plum: ["#231c30", "#30273f", "#4e4266"],
  plumHi: "#66588a",
  cream: ["#e6d2b5", "#fff0d5", "#ffffff"],
  lavender: ["#6a55a6", "#9d86ce", "#d2c4f2"],
  pink: ["#c0507f", "#f48db5", "#ffc7dc"],
  mint: ["#3b9a8a", "#72d9b7", "#c4f5df"],
  butter: ["#d29a45", "#f8d77c", "#fff3c4"],
  teal: ["#2b7d8c", "#4fc3cc", "#aef0ee"],
  coral: ["#b8494a", "#f07a62", "#ffb59c"],
  vermilion: ["#8f2b2b", "#d9473a", "#ff8f6b"],
  jade: ["#255b4d", "#3f8f74", "#8fd1ac"],
  forest: ["#24493f", "#3c7a52", "#7fbf6a"],
  wood: ["#5a3a36", "#8c5a45", "#c08a5f"],
  stone: ["#4a4560", "#6f6a8a", "#a19bbd"],
  skin: [
    ["#d9937e", "#ffd2b5", "#fff0e0"],
    ["#a8644e", "#d99a74", "#f2c29e"],
    ["#6e3f36", "#a86a4e", "#d1906c"],
  ],
};

// ---------------------------------------------------------------- WORLD PALETTES
const WORLD = {
  "western-fantasy": {
    ruin: "#26342f", pillar: R.stone,
    sky: ["#7fc4d9", "#a9dde6", "#e0f4ee"], wall: R.wood, wall2: R.stone, floor: R.wood, accent: R.butter, accent2: R.lavender,
    foliage: R.forest, ground: R.forest, glow: "#ffe9a3", far: "#8fb8b0", flavor: "fantasy",
  },
  modern: {
    ruin: "#2b3040", pillar: ["#4e5a70", "#7c89a3", "#b3bfd6"],
    sky: ["#4e5f8f", "#e38a7a", "#ffd2a8"], wall: ["#8a7d78", "#c9b8a6", "#ece0d0"], wall2: ["#3e5170", "#5f7aa0", "#9bb5d6"], floor: ["#7a6a66", "#a8958a", "#cdbbad"],
    accent: R.coral, accent2: R.teal, foliage: R.jade, ground: ["#3e4a5c", "#55627a", "#7c89a3"], glow: "#ffe2a0", far: "#7d6f96", flavor: "modern",
  },
  "ancient-china": {
    ruin: "#33241f", pillar: R.vermilion,
    sky: ["#c9d9cc", "#f0e3cc", "#fff6e6"], wall: R.cream, wall2: R.vermilion, floor: ["#4a2f2b", "#6e4436", "#9a6a52"], accent: R.vermilion, accent2: R.jade,
    foliage: R.jade, ground: R.jade, glow: "#ffd98a", far: "#a9c4b4", flavor: "china",
  },
  otherworld: {
    ruin: "#241d45", pillar: R.lavender,
    sky: ["#2a2350", "#5a3f8f", "#b28ad9"], wall: R.lavender, wall2: R.teal, floor: ["#4b3a7a", "#7a5fb8", "#b49be6"], accent: R.pink, accent2: R.teal,
    foliage: R.mint, ground: ["#3e2f6b", "#5c4a99", "#8b78c9"], glow: "#aef0ee", far: "#6b5aa6", flavor: "other",
  },
};

const W = 320, H = 192, TILE = 16;

function skyBands(c, sky, h = 120) {
  const bands = [sky[0], sky[1], sky[2]];
  const step = Math.ceil(h / 3);
  bands.forEach((col, i) => c.rect(0, i * step, W, step, col));
}
function stars(c, n, col, maxY, seed = 3) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) { const x = Math.floor(r() * W), y = Math.floor(r() * maxY); c.set(x, y, col); if (r() > 0.85) { c.set(x + 1, y, col); c.set(x - 1, y, col); c.set(x, y + 1, col); c.set(x, y - 1, col); } }
}
function hills(c, base, color, amp, freq, seed) {
  const r = rng(seed); const ph = r() * 6;
  for (let x = 0; x < W; x++) { const top = Math.round(base - amp * (0.6 + 0.4 * Math.sin(x * freq + ph)) - amp * 0.3 * Math.sin(x * freq * 2.7 + ph)); c.rect(x, top, 1, H - top, color); }
}
function tree(c, x, y, P, size = 14) {
  c.object((L) => {
    L.rect(x - 2, y, 4, size, R.wood[0]); L.rect(x - 1, y, 1, size, R.wood[1]);
    L.ellipse(x, y - size * 0.3, size * 0.9, size * 0.75, P.foliage);
    L.ellipse(x - size * 0.6, y + size * 0.05, size * 0.55, size * 0.45, P.foliage);
    L.ellipse(x + size * 0.6, y + size * 0.05, size * 0.55, size * 0.45, P.foliage);
  }, R.ink);
}
function mushroom(c, x, y, cap, s = 8) {
  c.object((L) => {
    L.rect(x - Math.ceil(s / 4), y - s, Math.ceil(s / 2), s, R.cream[1]); L.rect(x + Math.ceil(s / 4) - 1, y - s, 1, s, R.cream[0]);
    L.ellipse(x, y - s, s, s * 0.6, cap, (_, yy) => yy <= y - s + 1);
    L.set(x - s / 2, y - s - 2, cap[2]); L.set(x + s / 3, y - s - 3, cap[2]); L.set(x + s / 3 + 1, y - s - 3, cap[2]);
  }, R.ink);
}
function flowers(c, n, y0, y1, cols, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) { const x = Math.floor(r() * W), y = y0 + Math.floor(r() * (y1 - y0)); const col = cols[i % cols.length]; c.set(x, y, col); c.set(x + 1, y, col); c.set(x, y - 1, col); c.set(x + 1, y - 1, col); }
}
function tiles(c, y0, P, kind) {
  for (let ty = y0; ty < H; ty += TILE)
    for (let tx = 0; tx < W; tx += TILE) {
      const alt = ((tx + ty) / TILE) % 2 === 0;
      if (kind === "plank") {
        c.rect(tx, ty, TILE, TILE, P.floor[1]); c.rect(tx, ty + 7, TILE, 1, P.floor[0]); c.rect(tx, ty + 15, TILE, 1, P.floor[0]);
        c.rect(alt ? tx : tx + 8, ty, 1, 7, P.floor[0]); c.rect(alt ? tx + 8 : tx, ty + 8, 1, 7, P.floor[0]); c.rect(tx + 2, ty + 1, 3, 1, P.floor[2]);
      } else if (kind === "check") {
        c.rect(tx, ty, TILE, TILE, alt ? P.floor[1] : P.floor[0]); c.rect(tx + 1, ty + 1, 3, 1, P.floor[2]);
      } else if (kind === "stone") {
        c.rect(tx, ty, TILE, TILE, R.stone[1]); c.rect(tx, ty, TILE, 1, R.stone[0]); c.rect(tx, ty, 1, TILE, R.stone[0]); c.rect(tx + 2, ty + 2, 4, 1, R.stone[2]);
        if (alt) { c.rect(tx + 9, ty + 9, 3, 2, R.stone[0]); }
      }
    }
}
function windowFrame(c, x, y, w, h, P, view = "day") {
  c.object((L) => {
    L.rect(x, y, w, h, R.wood[1]);
    const gx = x + 3, gy = y + 3, gw = w - 6, gh = h - 6;
    if (view === "night") { L.rect(gx, gy, gw, gh, "#2a2350"); for (let i = 0; i < 6; i++) L.set(gx + 3 + ((i * 7) % gw), gy + 2 + ((i * 5) % gh), "#fff3c4"); }
    else { L.rect(gx, gy, gw, gh, P.sky[2]); L.rect(gx, gy, gw, Math.floor(gh / 2), P.sky[1]); L.rect(gx + 2, gy + 2, 2, 4, "#ffffff"); }
    L.rect(x + Math.floor(w / 2) - 1, y, 2, h, R.wood[0]); L.rect(x, y + Math.floor(h / 2) - 1, w, 2, R.wood[0]);
    L.rect(x, y, w, 1, R.wood[2]);
  }, R.ink);
}

// ---------------------------------------------------------------- ENVIRONMENTS
const SCENES = {
  interior(c, P) {
    // back wall
    c.rect(0, 0, W, 104, P.wall[1]);
    for (let x = 8; x < W; x += 16) c.rect(x, 0, 1, 92, P.wall[0]);
    c.rect(0, 0, W, 6, P.wall[0]); c.rect(0, 6, W, 2, P.wall[2]);
    c.rect(0, 88, W, 16, R.wood[1]); c.rect(0, 88, W, 2, R.wood[2]); c.rect(0, 102, W, 2, R.wood[0]);
    tiles(c, 104, P, P.flavor === "other" ? "check" : P.flavor === "china" ? "plank" : "plank");
    // window(s)
    if (P.flavor === "china") {
      c.object((L) => { L.ellipse(70, 46, 26, 26, R.wood[1]); L.ellipse(70, 46, 22, 22, P.sky[2]); for (let i = -22; i <= 22; i += 8) { L.rect(70 + i, 24, 1, 44, R.wood[0]); L.rect(48, 46 + i, 44, 1, R.wood[0]); } }, R.ink);
    } else windowFrame(c, 44, 22, 52, 44, P, P.flavor === "other" ? "night" : "day");
    // curtains
    c.object((L) => { L.rect(38, 18, 8, 54, P.accent[1]); L.rect(94, 18, 8, 54, P.accent[1]); L.rect(38, 18, 2, 54, P.accent[2]); L.rect(100, 18, 2, 54, P.accent[0]); L.rect(34, 16, 72, 4, R.wood[0]); }, R.ink);
    // door
    c.object((L) => { L.rect(244, 30, 44, 74, R.wood[1]); L.rect(248, 34, 36, 70, R.wood[0]); L.rect(252, 38, 12, 26, R.wood[1]); L.rect(268, 38, 12, 26, R.wood[1]); L.rect(276, 70, 4, 4, R.butter[1]); }, R.ink);
    // shelf + books
    c.object((L) => { L.rect(140, 40, 60, 4, R.wood[1]); L.rect(140, 44, 60, 1, R.wood[0]); [[144, P.accent2[1]], [150, P.accent[1]], [156, R.butter[1]], [162, R.mint[1]], [170, P.accent2[0]]].forEach(([x, col], i) => L.rect(x, 26 + (i % 2) * 2, 5, 14 - (i % 2) * 2, col)); L.ellipse(188, 34, 7, 6, P.foliage); }, R.ink);
    // rug + table
    c.object((L) => L.ellipse(160, 158, 70, 18, P.accent2), R.ink);
    c.ellipse(160, 158, 56, 12, P.accent2[2]); c.ellipse(160, 158, 50, 10, P.accent2[1]);
    c.object((L) => { L.rect(140, 120, 4, 22, R.wood[0]); L.rect(176, 120, 4, 22, R.wood[0]); L.ellipse(160, 118, 30, 7, R.wood); L.rect(154, 104, 10, 12, R.cream[1]); L.rect(154, 104, 10, 2, R.cream[2]); L.ellipse(168, 112, 4, 3, P.accent); }, R.ink);
    // plant
    c.object((L) => { L.rect(20, 120, 16, 14, P.accent[0]); L.rect(20, 120, 16, 3, P.accent[1]); L.ellipse(28, 108, 12, 12, P.foliage); L.ellipse(20, 114, 7, 6, P.foliage); }, R.ink);
    // flavor props
    if (P.flavor === "fantasy") c.object((L) => { L.rect(214, 30, 14, 26, R.lavender[1]); L.rect(214, 30, 14, 3, R.lavender[2]); L.rect(218, 38, 6, 6, R.butter[1]); L.rect(214, 56, 4, 4, R.lavender[1]); L.rect(224, 56, 4, 4, R.lavender[1]); }, R.ink);
    if (P.flavor === "modern") c.object((L) => { L.rect(208, 26, 24, 30, R.cream[1]); L.rect(211, 29, 18, 18, R.teal[1]); L.ellipse(220, 38, 5, 5, R.coral); L.ellipse(126, 24, 8, 8, R.cream); L.rect(126, 18, 1, 6, R.ink); L.rect(126, 24, 4, 1, R.ink); }, R.ink);
    if (P.flavor === "china") for (const lx of [126, 220]) c.object((L) => { L.rect(lx, 6, 1, 12, R.ink); L.ellipse(lx, 26, 8, 10, R.vermilion); L.rect(lx - 4, 15, 9, 2, R.butter[1]); L.rect(lx - 4, 35, 9, 2, R.butter[1]); L.rect(lx, 37, 1, 6, R.butter[0]); }, R.ink);
    if (P.flavor === "other") { c.object((L) => L.ellipse(220, 40, 9, 9, R.teal), R.ink); c.set(217, 37, "#ffffff"); c.object((L) => L.ellipse(126, 60, 5, 5, R.pink), R.ink); }
  },

  street(c, P) {
    skyBands(c, P.sky, 90);
    if (P.flavor === "other" || P.flavor === "modern") stars(c, 30, "#fff3c4", 40, 9);
    hills(c, 96, P.far, 18, 0.03, 4);
    const fronts = [[0, 30, 84, P.wall], [84, 18, 76, P.wall2], [160, 36, 80, P.accent], [240, 24, 80, P.wall]];
    for (const [x, top, w, ramp] of fronts) {
      c.object((L) => {
        L.rect(x, top + 10, w, 140 - top - 10, ramp[1]); L.rect(x, top + 10, 3, 140 - top - 10, ramp[2]); L.rect(x + w - 3, top + 10, 3, 140 - top - 10, ramp[0]);
        if (P.flavor === "china") { L.rect(x - 4, top + 4, w + 8, 8, R.ink); L.rect(x - 8, top + 2, 6, 4, R.ink); L.rect(x + w + 2, top + 2, 6, 4, R.ink); L.rect(x - 2, top + 6, w + 4, 4, R.jade[0]); }
        else if (P.flavor === "fantasy") { for (let i = 0; i < w / 2; i++) L.rect(x + i, top + 10 - Math.floor(i / 2), w - i * 2, 1, R.coral[0]); }
        else L.rect(x, top + 6, w, 4, ramp[0]);
        for (let wy = top + 20; wy < 112; wy += 24) for (let wx = x + 10; wx < x + w - 16; wx += 22) { L.rect(wx, wy, 12, 14, R.ink); L.rect(wx + 1, wy + 1, 10, 12, (wx + wy) % 3 ? P.glow : P.sky[0]); L.rect(wx + 1, wy + 7, 10, 1, R.ink); }
        L.rect(x + Math.floor(w / 2) - 8, 114, 16, 26, R.wood[0]); L.rect(x + Math.floor(w / 2) - 6, 116, 12, 24, R.wood[1]);
        if (P.flavor === "fantasy") { L.rect(x, top + 30, w, 2, R.wood[0]); L.rect(x + 20, top + 10, 2, 120 - top, R.wood[0]); }
      }, R.ink);
    }
    // awnings
    c.object((L) => { for (let i = 0; i < 9; i++) L.rect(166 + i * 8, 106, 8, 8, i % 2 ? R.cream[1] : P.accent2[1]); L.rect(166, 114, 72, 2, P.accent2[0]); }, R.ink);
    // sidewalk + road
    c.rect(0, 140, W, 14, R.stone[1]); for (let x = 0; x < W; x += 16) c.rect(x, 140, 1, 14, R.stone[0]); c.rect(0, 140, W, 2, R.stone[2]);
    c.rect(0, 154, W, 38, P.flavor === "china" || P.flavor === "fantasy" ? R.wood[0] : "#3a3350");
    if (P.flavor === "modern" || P.flavor === "other") for (let x = 6; x < W; x += 32) c.rect(x, 172, 16, 2, R.butter[1]);
    else for (let x = 0; x < W; x += 12) for (let y = 156; y < H; y += 8) c.rect(x + ((y / 8) % 2) * 6, y, 10, 6, R.wood[1]);
    // lamp posts / lanterns
    for (const lx of [70, 250]) c.object((L) => {
      L.rect(lx, 96, 3, 46, R.ink); L.rect(lx - 4, 90, 11, 8, P.flavor === "china" ? R.vermilion[1] : R.ink);
      L.rect(lx - 2, 92, 7, 4, P.glow);
    }, R.ink);
    if (P.flavor === "modern") c.object((L) => { L.rect(96, 52, 52, 14, R.ink); L.rect(98, 54, 48, 10, R.pink[1]); L.rect(102, 57, 40, 4, R.pink[2]); }, R.ink);
    if (P.flavor === "other") for (const [x, y] of [[40, 20], [290, 30], [200, 14]]) c.object((L) => { L.ellipse(x, y, 8, 5, R.stone); L.rect(x - 2, y - 7, 4, 4, R.teal[1]); }, R.ink);
  },

  wilderness(c, P) {
    skyBands(c, P.sky, 100);
    if (P.flavor === "other") stars(c, 40, "#fff3c4", 60, 2);
    c.object((L) => L.ellipse(262, 26, 12, 12, [P.glow, P.glow, "#ffffff"]), null);
    hills(c, 92, P.far, 22, 0.022, 7);
    if (P.flavor === "fantasy") c.object((L) => { L.rect(120, 40, 34, 40, R.stone[1]); L.rect(114, 30, 10, 50, R.stone[2]); L.rect(150, 30, 10, 50, R.stone[2]); L.rect(132, 24, 10, 56, R.stone[2]); L.rect(136, 12, 1, 12, R.ink); L.rect(137, 12, 8, 5, R.coral[1]); L.rect(133, 60, 8, 20, R.ink); for (const x of [114, 118, 122, 150, 154, 158]) L.rect(x, 26, 2, 4, R.stone[2]); }, R.ink);
    if (P.flavor === "china") c.object((L) => { for (let i = 0; i < 4; i++) { const w = 34 - i * 7, y = 74 - i * 14; L.rect(140 - w / 2, y, w, 10, R.vermilion[1]); L.rect(140 - w / 2 - 6, y - 3, w + 12, 4, R.ink); } L.rect(139, 14, 2, 8, R.butter[1]); }, R.ink);
    if (P.flavor === "modern") for (let x = 100; x < 220; x += 14) c.rect(x, 50 + ((x * 7) % 30), 12, 80, "#6e6488");
    hills(c, 112, P.foliage[0], 10, 0.05, 11);
    for (let i = 0; i < 9; i++) tree(c, 12 + i * 38 + (i % 2) * 8, 98 + (i % 3) * 3, P, 12 + (i % 3) * 2);
    c.rect(0, 118, W, 74, P.ground[1]);
    for (let y = 118; y < H; y += 6) for (let x = (y / 6) % 2 ? 0 : 5; x < W; x += 10) c.set(x, y, P.ground[2]);
    c.rect(0, 118, W, 2, P.ground[2]);
    // path
    for (let y = 118; y < H; y++) { const w = 12 + (y - 118) * 0.9, cx = 160 + Math.sin(y * 0.05) * 18; c.rect(Math.round(cx - w / 2), y, Math.round(w), 1, R.wood[2]); c.set(Math.round(cx - w / 2), y, R.wood[1]); c.set(Math.round(cx + w / 2), y, R.wood[1]); }
    mushroom(c, 60, 172, P.accent, 10); mushroom(c, 78, 176, P.accent2, 6); mushroom(c, 268, 168, P.accent, 8);
    if (P.flavor === "other") { mushroom(c, 30, 140, R.pink, 22); mushroom(c, 296, 146, R.teal, 18); }
    c.object((L) => { L.ellipse(240, 182, 22, 12, P.foliage); L.ellipse(20, 186, 18, 10, P.foliage); }, R.ink);
    flowers(c, 26, 126, 188, [P.accent[1], R.butter[1], R.cream[1]], 5);
  },

  ruins(c, P) {
    c.rect(0, 0, W, 112, P.ruin);
    for (let y = 0; y < 104; y += 12) for (let x = (y / 12) % 2 ? -12 : 0; x < W; x += 24) { c.rect(x + 1, y + 1, 22, 10, P.pillar[0]); c.rect(x + 1, y + 1, 22, 1, P.pillar[1]); }
    // arch with glow
    c.object((L) => { L.ellipse(160, 50, 38, 38, R.stone, (_, y) => y < 104); L.rect(122, 50, 76, 54, R.stone[1]); L.ellipse(160, 56, 24, 24, R.ink, (_, y) => y < 104); L.rect(136, 56, 48, 48, R.ink); }, R.ink);
    c.ellipse(160, 80, 14, 22, [P.accent2[0], P.accent2[1], P.accent2[2]]); c.ellipse(160, 82, 6, 12, "#ffffff");
    for (const [x, h, broken] of [[40, 76, 0], [86, 52, 1], [234, 60, 1], [276, 80, 0]]) c.object((L) => {
      L.rect(x - 9, 104 - h, 18, h, P.pillar[1]); L.rect(x - 9, 104 - h, 3, h, P.pillar[2]); L.rect(x + 6, 104 - h, 3, h, P.pillar[0]);
      if (!broken) L.rect(x - 12, 100 - h, 24, 6, P.pillar[2]); else { L.rect(x - 9, 102 - h, 6, 3, P.pillar[1]); L.rect(x + 2, 101 - h, 7, 2, P.pillar[1]); }
      for (let y = 104 - h + 8; y < 100; y += 14) L.rect(x - 9 + ((y >> 2) % 3) * 4, y, 2, 8, P.foliage[1]);
    }, R.ink);
    tiles(c, 104, P, "stone");
    for (const [x, y, s] of [[26, 168, 7], [292, 160, 9], [210, 178, 5]]) c.object((L) => { for (let i = 0; i < s; i++) L.rect(x - (s - i) / 2, y - i * 2, s - i, 2, i % 3 ? P.accent[1] : P.accent[2]); }, R.ink);
    c.object((L) => { L.rect(110, 150, 12, 8, R.stone[1]); L.rect(196, 138, 16, 10, R.stone[1]); L.rect(60, 128, 10, 6, R.stone[2]); }, R.ink);
  },

  dreamscape(c, P) {
    skyBands(c, [R.plum[0], "#3e2f6b", "#6b4f9e"], 120);
    stars(c, 70, "#fff3c4", 110, 13);
    c.object((L) => { L.ellipse(56, 30, 16, 16, R.cream); L.ellipse(62, 26, 13, 13, "#3e2f6b"); }, null);
    // floor checker with perspective-ish rows
    for (let row = 0, y = 120; y < H; row++) { const h = 6 + row * 3; for (let x = (row % 2) * 16 - 16; x < W; x += 32) { c.rect(x, y, 16, h, P.floor[1]); c.rect(x + 16, y, 16, h, P.floor[0]); } y += h; }
    c.rect(0, 120, W, 2, P.floor[2]);
    for (const [x, y, w] of [[70, 74, 40], [250, 56, 52], [170, 30, 30]]) c.object((L) => {
      L.rect(x - w / 2, y, w, 6, R.mint[1]); L.rect(x - w / 2, y, w, 2, R.mint[2]);
      for (let i = 0; i < 4; i++) L.rect(x - w / 2 + 3 + i * 3, y + 6 + i * 4, w - 6 - i * 6, 4, R.stone[i % 2]);
    }, R.ink);
    c.object((L) => { L.rect(150, 58, 30, 62, R.cream[1]); L.rect(154, 62, 22, 58, P.accent2[1]); L.rect(154, 62, 22, 3, P.accent2[2]); L.rect(170, 92, 3, 3, R.butter[1]); }, R.ink);
    mushroom(c, 40, 160, R.pink, 18); mushroom(c, 290, 170, R.teal, 14); mushroom(c, 100, 178, R.butter, 7);
    c.object((L) => { L.ellipse(250, 46, 6, 6, R.pink); L.rect(244, 52, 13, 4, R.mint[0]); }, R.ink);
    for (const [x, y] of [[220, 110], [118, 100], [300, 96]]) { c.set(x, y, R.teal[2]); c.set(x + 1, y, R.teal[1]); c.set(x, y + 1, R.teal[1]); }
  },
};

const ENV_TYPES = ["interior", "street", "wilderness", "ruins", "dreamscape"];
for (const [worldId, P] of Object.entries(WORLD)) {
  for (const t of ENV_TYPES) {
    const c = new Canvas(W, H);
    SCENES[t](c, P);
    c.savePNG(`${OUT}assets/environments/${worldId}/${t}.png`);
  }
}

// ---------------------------------------------------------------- TITLE BACKGROUND (320x180)
{
  const c = new Canvas(320, 180);

  for (let i = 0; i < 6; i++) c.rect(0, i * 22, 320, 22, ["#1b1526", "#231c30", "#30273f", "#3e2f6b", "#5a3f8f", "#7a5fb8"][i]);
  stars(c, 90, "#fff3c4", 110, 21); stars(c, 20, "#aef0ee", 90, 22);
  c.object((L) => { L.ellipse(258, 36, 16, 16, R.cream); L.ellipse(252, 32, 4, 4, R.cream[0]); L.ellipse(264, 42, 3, 3, R.cream[0]); }, null);
  hills(c, 132, "#4b3a7a", 20, 0.02, 31);
  hills(c, 146, "#3e2f6b", 14, 0.035, 32);
  for (const [x, y, w, cap] of [[56, 70, 44, R.pink], [270, 92, 36, R.teal]]) c.object((L) => {
    L.rect(x - w / 2, y, w, 6, R.mint[1]); L.rect(x - w / 2, y, w, 2, R.mint[2]);
    for (let i = 0; i < 4; i++) L.rect(x - w / 2 + 3 + i * 3, y + 6 + i * 4, w - 6 - i * 6, 4, R.stone[i % 2]);
    L.ellipse(x + 2, y - 10, 12, 8, cap, (_, yy) => yy <= y - 8); L.rect(x - 2, y - 8, 8, 8, R.cream[1]); L.rect(x + 1, y - 4, 2, 4, R.wood[0]);
  }, R.ink);
  c.rect(0, 156, 320, 24, "#231c30"); c.rect(0, 156, 320, 1, "#4e4266");
  for (const [x, cap, s] of [[24, R.pink, 12], [42, R.butter, 7], [296, R.lavender, 14], [278, R.mint, 6]]) mushroom(c, x, 160, cap, s);
  c.savePNG(`${OUT}assets/ui/title-background.png`);
}

// ---------------------------------------------------------------- CHARACTERS
// 20x28 chibi body template on a 32x32 sprite canvas. Letters map to palette roles.
const BODY = [
  "......oooooooo......",
  "....ooLLHHHHHHoo....",
  "...oLLHHHHHHHHHHo...",
  "..oLHHHHHHHHHHHHho..",
  "..oHHHHHHHHHHHHHho..",
  ".oHHHHHHHHHHHHHHHho.",
  ".oHHHhHHHHHhHHHHhho.",
  ".oHHhSShHHhSSSShhho.",
  ".oHhSSSSSSSSSSSShho.",
  ".ohSSEESSSSSSEESSho.",
  ".ohSSEwSSSSSSEwSSho.",
  ".ohSBBSSSssSSSBBSho.",
  "..oSSSSSSSSSSSSSso..",
  "...ossSSSSSSSSsso...",
  "....ooYYYYYYYYoo....",
  "...oYYYYYYYYYYYYo...",
  "..oTTyyYYYYYYyTTto..",
  ".oUTTTTyYYYYtTTTtto.",
  ".oUTTTTTyYYtTTTTtto.",
  ".oSoTTTTTTTTTTTtoSo.",
  ".ossoTTTTTTTTTtosso.",
  "..oo.oTTTTTTTTto.oo.",
  ".....oPPPPPPPPpo....",
  ".....oPPPppPPPpo....",
  ".....oPPpooPPPpo....",
  ".....oKKko.oKKko....",
  "....oKKKko.oKKKko...",
  ".....oooo...oooo....",
];
const CAST = [
  { hair: ["#4f2e3a", "#8a4f4a", "#c47a5e"], skin: 0, top: R.pink, scarf: R.butter, pants: [R.plum[1], R.plum[2]], shoes: R.lavender, style: "short" },
  { hair: ["#1b1526", "#30273f", "#5c4a7a"], skin: 1, top: R.mint, scarf: R.pink, pants: ["#3e2f6b", "#5c4a99"], shoes: R.coral, style: "long" },
  { hair: ["#c98f3c", "#f8d77c", "#fff3c4"], skin: 0, top: R.lavender, scarf: R.mint, pants: [R.wood[0], R.wood[1]], shoes: R.pink, style: "buns" },
  { hair: ["#6a55a6", "#9d86ce", "#d2c4f2"], skin: 2, top: R.butter, scarf: R.teal, pants: [R.plum[1], R.plum[2]], shoes: R.mint, style: "short" },
  { hair: ["#a8a0c0", "#f1ecf7", "#ffffff"], skin: 1, top: R.teal, scarf: R.coral, pants: ["#24493f", "#3c7a52"], shoes: R.butter, style: "long" },
  { hair: ["#5a3a36", "#8c5a45", "#c08a5f"], skin: 2, top: R.coral, scarf: R.lavender, pants: ["#3e2f6b", "#5c4a99"], shoes: R.teal, style: "buns" },
];
CAST.forEach((p, i) => {
  const n = String(i + 1).padStart(2, "0");
  const sk = R.skin[p.skin];
  const pal = { o: R.ink, E: R.ink, w: "#ffffff", H: p.hair[1], h: p.hair[0], L: p.hair[2], S: sk[1], s: sk[0], B: R.pink[1],
    T: p.top[1], t: p.top[0], U: p.top[2], Y: p.scarf[1], y: p.scarf[0], P: p.pants[1], p: p.pants[0], K: p.shoes[1], k: p.shoes[0] };
  // ---- sprite 32x32
  const sp = new Canvas(32, 32);
  sp.object((L) => {
    L.grid(BODY, pal, 6, 3);
    if (p.style === "long") for (let y = 10; y < 22; y++) { L.set(6 + 1, y, p.hair[y > 18 ? 0 : 1]); L.set(6 + 2, y, p.hair[0]); L.set(6 + 17, y, p.hair[0]); L.set(6 + 18, y, p.hair[y > 18 ? 0 : 1]); }
    if (p.style === "buns") { L.ellipse(6 + 3, 4, 3, 3, p.hair); L.ellipse(6 + 16, 4, 3, 3, p.hair); }
  }, R.ink);
  sp.savePNG(`${OUT}assets/characters/sprite-${n}.png`);

  // ---- portrait 96x96
  const pt = new Canvas(96, 96);
  const cx = 48;
  pt.object((L) => {
    if (p.style === "long") L.ellipse(cx, 54, 31, 36, p.hair, (_, y) => y < 92);
    L.ellipse(cx, 100, 36, 28, p.top, (_, y) => y < 96);
    L.rect(cx - 7, 62, 14, 14, sk[0]);
    L.ellipse(cx, 76, 20, 7, p.scarf);
    L.ellipse(22, 50, 5, 6, sk); L.ellipse(74, 50, 5, 6, sk);
    L.ellipse(cx, 46, 26, 24, sk);
    if (p.style === "buns") { L.ellipse(22, 16, 10, 10, p.hair); L.ellipse(74, 16, 10, 10, p.hair); }
    // hair cap with zig-zag bangs
    L.ellipse(cx, 34, 30, 22, p.hair, (x, y) => y < 33 + ((Math.floor((x + 3) / 8) % 2) ? 7 : 1) || x < 25 || x > 71);
    for (let x = 30; x < 66; x++) { const yb = 33 + ((Math.floor((x + 3) / 8) % 2) ? 7 : 1); L.set(x, yb, p.hair[0]); }
    // side locks
    L.rect(20, 32, 6, p.style === "long" ? 40 : 22, p.hair[1]); L.rect(70, 32, 6, p.style === "long" ? 40 : 22, p.hair[0]);
    // shine on hair
    for (let i = 0; i < 12; i++) L.set(32 + i, 20 + Math.round(Math.abs(i - 6) / 2), p.hair[2]);
    // eyes
    for (const ex of [37, 59]) { L.ellipse(ex, 51, 4, 6, R.ink); L.rect(ex - 2, 47, 2, 3, "#ffffff"); L.set(ex + 1, 54, "#ffffff"); L.rect(ex - 3, 54, 7, 2, p.top[0]); }
    L.rect(33, 42, 7, 2, p.hair[0]); L.rect(56, 42, 7, 2, p.hair[0]);
    L.ellipse(30, 59, 4, 2, R.pink[1]); L.ellipse(66, 59, 4, 2, R.pink[1]);
    L.rect(45, 61, 6, 1, R.ink); L.set(44, 60, R.ink); L.set(51, 60, R.ink); L.rect(46, 62, 4, 1, R.pink[0]);
  }, R.ink);
  pt.savePNG(`${OUT}assets/characters/portrait-${n}.png`);
});

// ---------------------------------------------------------------- PWA ICONS
const ICON = [
  "................",
  "......oooo......",
  ".....oPPPPo.....",
  ".....oPPPpo.....",
  ".....oPPPpo.....",
  ".....oPPPpo.....",
  "......oPpo......",
  "......oPpo......",
  "......oPpo......",
  ".......oo.......",
  "................",
  "......oooo......",
  ".....oYYYyo.....",
  ".....oYYyyo.....",
  "......oooo......",
  "................",
];
const ipal = { o: R.ink, P: R.pink[1], p: R.pink[0], Y: R.butter[1], y: R.butter[0] };
function icon(file, size, pad) {
  const c = new Canvas(size, size);
  c.rect(0, 0, size, size, R.plum[1]);
  const s = Math.floor((size * (1 - pad * 2)) / 16);
  const g = new Canvas(16, 16); g.grid(ICON, ipal);
  const off = Math.floor((size - s * 16) / 2);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (g.filled(x, y)) { const i = (y * 16 + x) * 4; const col = "#" + [...g.d.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, "0")).join(""); c.rect(off + x * s, off + y * s, s, s, col); }
  c.savePNG(file);
}
icon(`${OUT}icons/icon-192.png`, 192, 0.08);
icon(`${OUT}icons/icon-512.png`, 512, 0.08);
icon(`${OUT}icons/icon-maskable-512.png`, 512, 0.2);
icon(`${OUT}icons/apple-touch-icon.png`, 180, 0.12);
console.log("Placeholders generated.");
