/**
 * Pixel frames at runtime. The SAME 12×12 construction as
 * scripts/build-frames.mjs (soft outline, 2-step corners, light top-left edge,
 * shaded bottom-right edge), so every world skin keeps identical geometry,
 * border thickness and corner steps. Only the colours change, plus an
 * optional inlay ring (a second, inner line) for themes that use a
 * double-layer border. Used through CSS border-image 9-slice, so frames scale
 * by whole UI pixels and are never stretched as images.
 */

export const FRAME_SIZE = 12;

/** [highlight, face, shade, outline] */
export type FrameColors = [string, string, string, string];
export type FrameStyle = {
  /** Second line one pixel inside the outline (double-layer border). */
  inlay?: string;
};

export function frameGrid([h, f, s, o]: FrameColors, style: FrameStyle = {}): (string | null)[][] {
  const N = FRAME_SIZE;
  const g: (string | null)[][] = Array.from({ length: N }, (_, y) =>
    Array.from({ length: N }, (_, x) => {
      if (y === 0 || x === 0 || y === N - 1 || x === N - 1) return o;
      if (y === N - 2 || x === N - 2) return s;
      if (y === 1 || x === 1) return h;
      return f;
    }),
  );
  if (style.inlay) {
    // Ring 2: inside the highlight / shade, still inside the 4px slice, so content never moves.
    for (let i = 2; i <= N - 3; i++) {
      g[2][i] = style.inlay;
      g[N - 3][i] = style.inlay;
      g[i][2] = style.inlay;
      g[i][N - 3] = style.inlay;
    }
  }
  for (const [cx, cy, dx, dy] of [[0, 0, 1, 1], [N - 1, 0, -1, 1], [0, N - 1, 1, -1], [N - 1, N - 1, -1, -1]]) {
    g[cy][cx] = null;
    g[cy][cx + dx] = null;
    g[cy + dy][cx] = null;
    g[cy + dy][cx + dx] = o;
  }
  return g;
}

/** Grid → compact crisp SVG (horizontal runs merged), as a CSS url(). */
export function gridToCssUrl(g: (string | null)[][]): string {
  const w = g[0].length;
  const h = g.length;
  let rects = "";
  g.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      if (c) rects += `<rect x='${x}' y='${y}' width='${run}' height='1' fill='${c}'/>`;
      x += run;
    }
  });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' width='${w}' height='${h}' shape-rendering='crispEdges'>${rects}</svg>`;
  return `url("data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
}

export const frameUrl = (cols: FrameColors, style?: FrameStyle) => gridToCssUrl(frameGrid(cols, style));
