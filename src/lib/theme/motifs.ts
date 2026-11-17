/**
 * Decorative pixel motifs for world skins: 7×7 one-colour glyphs, drawn on
 * the same art-pixel grid as frames and icons (so pixel density matches
 * everywhere). Purely ornamental: never used to carry meaning.
 */

const G = (rows: string) => rows.trim().split(/\s+/);

export const MOTIFS = {
  // Western Fantasy · storybook
  leaf: G(`....##. ...###. ..####. .####.. .###... #.#.... #......`),
  vine: G(`.##.... #..#... ...#.#. ..#.### .#...#. #...... .......`),
  book: G(`##...## #.#.#.# #..#..# #..#..# #..#..# ##.#.## ..###..`),
  key: G(`.###... #...#.. #...#.. .###... ..#.... ..##... ..#.#..`),
  potion: G(`..###.. ...#... ..#.#.. .#...#. #.###.# ####### .#####.`),
  quill: G(`......# ....### ...###. ..###.. .###... .#..... #......`),
  crest: G(`####### #..#..# #.###.# #..#..# .#...#. ..#.#.. ...#...`),
  // Modern · urban diary
  raindrop: G(`...#... ...#... ..###.. .#####. .##.##. .#####. ..###..`),
  window: G(`####### #..#..# #..#..# ####### #..#..# #..#..# #######`),
  camera: G(`....... .##.... ####### #..#..# #.#.#.# #..#..# #######`),
  message: G(`####### #.....# #.#.#.# #.....# ####### .##.... .#.....`),
  folder: G(`###.... #..#### ####### #.....# #.....# #.....# #######`),
  pin: G(`..###.. .#...#. .#.#.#. .#...#. ..#.#.. ...#... .......`),
  citylight: G(`..###.. .#####. ..###.. ...#... ...#... ...#... ..###..`),
  // Ancient China · ink scroll
  cloud: G(`....... ...##.. .##..#. #....## #.....# .#####. .......`),
  lantern: G(`...#... .#####. #.....# #..#..# #.....# .#####. ...#...`),
  bamboo: G(`..#.... ..#..#. .###.#. ..#.##. ..#..#. .###.#. ..#....`),
  seal: G(`####### #.###.# #.#.#.# #.###.# #..#..# #.#.#.# #######`),
  mountain: G(`....... ..#.... .#.#.#. #...#.# #.....# ####### .......`),
  fan: G(`....... #.#.#.# .#####. ..###.. ...#... ...#... .......`),
  scroll: G(`####### .#...#. .#.#.#. .#...#. .#.#.#. .#...#. #######`),
  jade: G(`..###.. .#...#. #..#..# #.#.#.# #..#..# .#...#. ..###..`),
  // Otherworld · lucid dream
  star: G(`...#... ...#... .#####. ..###.. ..#.#.. .#...#. .......`),
  mushroom: G(`..###.. .#####. ##.#.## ####### ..#.#.. ..#.#.. ..###..`),
  moon: G(`..###.. .##.... ##..... ##..... ##..... .##.... ..###..`),
  crystal: G(`...#... ..#.#.. .#.#.#. .#.#.#. .#.#.#. ..#.#.. ...#...`),
  bubble: G(`..###.. .#...#. #.#...# #.....# #.....# .#...#. ..###..`),
  sparkle: G(`...#... ...#... ....... ##...## ....... ...#... ...#...`),
} as const satisfies Record<string, readonly string[]>;

export type MotifId = keyof typeof MOTIFS;
export const MOTIF_IDS = Object.keys(MOTIFS) as MotifId[];
export const isMotifId = (v: unknown): v is MotifId => typeof v === "string" && v in MOTIFS;

/** One glyph as a crisp SVG data URL (for CSS backgrounds). */
export function motifSvg(id: MotifId, color: string): string {
  const rows = MOTIFS[id];
  let rects = "";
  rows.forEach((r, y) => [...r].forEach((c, x) => c === "#" && (rects += `<rect x='${x}' y='${y}' width='1' height='1'/>`)));
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 7 7' width='7' height='7' shape-rendering='crispEdges'><g fill='${color}'>${rects}</g></svg>`;
}

export const svgUrl = (svg: string) => `url("data:image/svg+xml,${svg.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/"/g, "'")}")`;

/**
 * Background tile: up to three motifs scattered on a 48×48 art-pixel tile
 * (shown at 2×), in a colour barely darker than the page. Light enough that
 * text and controls over it are never harder to read.
 */
export function patternSvg(ids: MotifId[], color: string): string {
  const spots: [number, number][] = [[5, 7], [30, 27], [17, 40]];
  let body = "";
  ids.slice(0, 3).forEach((id, i) => {
    const [ox, oy] = spots[i];
    MOTIFS[id].forEach((r, y) => [...r].forEach((c, x) => c === "#" && (body += `<rect x='${ox + x}' y='${oy + y}' width='1' height='1'/>`)));
  });
  return `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 48 48' shape-rendering='crispEdges'><g fill='${color}'>${body}</g></svg>`;
}
