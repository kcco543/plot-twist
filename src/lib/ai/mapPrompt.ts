import type { EnvironmentTypeId, WorldId } from "@/lib/types";

/**
 * MAP ART DIRECTION — the prompt side of PIXEL_ART_STYLE_GUIDE.md
 * (shared: the server sends it to the image service; the Map Lab shows the
 * exact same text, so what you read there is what the model receives)
 * --------------------------------------------------------------------------
 * Every generated map uses ONE fixed house style (MAP_STYLE) and ONE set of
 * composition rules (MAP_COMPOSITION). The player's description decides what
 * is in the map; the environment type decides the layout; the world adds a
 * palette and architecture flavour. None of them can change the style.
 *
 * The numbers here are the style guide's: the map is drawn for a 480×320
 * art-pixel canvas (the browser snaps the result onto exactly that grid,
 * see lib/pixelArt/mapPixels.ts), a standing character is 28 of those pixels
 * tall, and about two thirds of the picture is open, walkable ground.
 * Change the guide and these lines together.
 */
export const MAP_STYLE = [
  "Art style: handcrafted pixel art for a top-down RPG, low-to-medium detail, in a consistent three-quarter top-down view (the ground seen from about 60 degrees; walls, cliff faces and the front sides of objects are visible; every building, prop and tree uses the same camera angle).",
  "Pixel scale: the whole scene is drawn on a 480 by 320 pixel canvas and enlarged with hard square pixels, so every pixel is a clearly visible square block of the same size everywhere. Build shapes from deliberate clusters of these big pixels. Do not add detail smaller than one of these pixels; it must not look like a high-resolution digital painting with a pixel filter.",
  "Scale on that canvas: a standing person would be about 28 pixels tall (about one eleventh of the image height). Doorways are about 18 pixels wide and 28 tall, a table about 30 pixels wide, a bench about 24, a tree canopy at most about 70 pixels wide, a path at least 40 pixels wide.",
  "Outlines: selective dark warm-brown outlines one pixel thick around buildings, props and objects (never pure black); softer outlines in a darker shade of the local colour on ground details and distant scenery.",
  "Shading: three to five flat tones per material with crisp steps between light and shadow, light from the upper left, cast shadows to the lower right as solid darker shapes. No gradients, no blur, no airbrush, no glow, no soft brush strokes, no anti-aliasing, no dithering noise.",
  "Colour: warm, inviting and richly but not overly saturated, about 32 to 40 colours in total. Each terrain material has a clearly different colour and value (grass, dirt, sand, stone, wood floor, water). Walkable ground is lighter and calmer than the obstacles around it, and the background is calmer than the foreground.",
].join(" ");

export const MAP_COMPOSITION = [
  "Composition for play: about two thirds of the picture is open, walkable ground (floor, plaza, clearing, road) in large continuous connected shapes, mostly in the middle and lower part, with plenty of empty space for characters to stand and talk.",
  "Terrain is organised into a few big readable regions first (for example one grass field, one stone plaza, one wide path joining them); only then add a few small clusters of variation such as a flower patch, a few tufts or a crack. No hundreds of tiny patches, no noisy texture, no busy transitions; walking surfaces stay visually quiet.",
  "Obstacles (buildings, walls, shelves, cliffs, dense trees, water) sit around the edges, mostly along the top and the sides, with clear boundaries where the ground ends.",
  "One or two landmarks give the place its identity. Two to four separate interactive props (for example a bench, a well, a table, a chest, a signpost without writing) each stand on open ground with space around them.",
  "Decoration is limited and grouped in three to five small clusters near the landmarks and edges, never sprinkled evenly over the whole map. No large tree canopies, roofs or foreground objects over the middle of the map or over paths; at most small foreground details in the bottom corners.",
].join(" ");

export const MAP_RULES = [
  "Fill the whole landscape frame edge to edge with the environment; no border, no frame, no UI, no legend, no compass.",
  "Absolutely no text, letters, numbers, signs with writing, labels or watermarks anywhere in the image.",
  "No people, characters, animals or creatures standing on the ground unless the description explicitly asks for them; the game draws its own characters on top.",
  "The environment and its layout are the subject.",
].join(" ");

/** How each environment type is laid out. Keys match EnvironmentTypeId. */
export const MAP_LAYOUT: Record<EnvironmentTypeId, string> = {
  interior: "Layout: an indoor room shown as a cutaway from above (no roof): walls only along the top and sides, a door in a wall, furniture placed against the walls and in one or two small groups, and a large open floor in the middle.",
  street: "Layout: a town square or wide street: one broad paved road or plaza crossing the picture, building fronts with doors along the top edge and maybe one side, a market stall or a well as the landmark, a few benches and crates at the edges.",
  wilderness: "Layout: open nature: a large grass clearing joined to one wide dirt path, trees and bushes grouped along the edges, one landmark such as a pond, a big rock or an old tree at one side.",
  ruins: "Layout: gentle overgrown ruins: a large open stone courtyard, broken walls and fallen columns around its edges, a few patches of moss and flowers. Melancholy but warm, never scary.",
  dreamscape: "Layout: a dreamlike place: one or two large floating islands or wide cloud terraces with flat open ground, joined by broad paths or bridges, a few glowing flowers and crystals grouped at the edges.",
};

/** Light world flavor. Same style for every world; only the architecture and props change. */
export const MAP_WORLD: Record<WorldId, string> = {
  "western-fantasy": "Setting flavor: a storybook fantasy village with timber-framed cottages, stone wells and lanterns. Palette: warm greens, honey ochre, terracotta roofs, warm grey stone.",
  modern: "Setting flavor: a cozy small modern neighborhood with cafés, potted plants, bicycles, vending machines and string lights. Palette: warm brick, sage green, cream paving, teal accents.",
  "ancient-china": "Setting flavor: an ancient Chinese courtyard town with curved tiled roofs, red lanterns, moon gates, bamboo and stone bridges. Palette: vermilion, jade green, warm grey tiles, pale stone.",
  otherworld: "Setting flavor: a whimsical otherworld with soft rounded houses, crystal flowers and gentle floating lights. Palette: warm mint and moss greens, cream, peach, lavender accents.",
};

export function mapPrompt(opts: { description: string; type: EnvironmentTypeId; world: WorldId | null }): string {
  const description = opts.description.trim().replace(/\s+/g, " ").slice(0, 600);
  return [
    MAP_STYLE,
    MAP_COMPOSITION,
    MAP_LAYOUT[opts.type],
    opts.world ? MAP_WORLD[opts.world] : "",
    `What the player wants this place to be (it may be written in Chinese or English; follow its meaning, never write its words into the image): """${description}"""`,
    "Where the description and the art style or composition disagree, keep the art style and the open ground, and adapt the content to them (fewer, larger things rather than many small ones).",
    MAP_RULES,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * REGION EDIT
 * Used when the player selects part of a generated map and asks for a change
 * there. The image service receives the whole map plus a mask, and this text.
 * The same house style is repeated so the new part can't drift from the rest.
 */
export const MAP_EDIT_CONSISTENCY = [
  "This is a local edit of an existing game map. Only repaint the masked (transparent) area; everything outside it must stay exactly as it is.",
  "The repainted area must look like it was always part of this same map: match its big square pixels exactly (the same pixel size and grid), the same three-quarter top-down perspective, the same palette, lighting direction, flat shading steps and outline treatment.",
  "Blend seamlessly into the surrounding pixels at the edges of the area: continue paths, grass, walls, water and ground textures across the border so no seam or box is visible.",
  "Keep the scale of new objects consistent with nearby buildings, trees and props, and keep walkable ground open: add fewer, larger things rather than many small ones.",
].join(" ");

export function mapEditPrompt(opts: { instruction: string; description?: string; type?: EnvironmentTypeId | null; world?: WorldId | null }): string {
  const instruction = opts.instruction.trim().replace(/\s+/g, " ").slice(0, 300);
  const description = (opts.description ?? "").trim().replace(/\s+/g, " ").slice(0, 600);
  return [
    MAP_EDIT_CONSISTENCY,
    `The change the player wants in this area (it may be written in Chinese or English; follow its meaning, never write its words into the image): """${instruction}"""`,
    description ? `For context, the whole map shows: """${description}"""` : "",
    opts.world ? MAP_WORLD[opts.world] : "",
    MAP_STYLE,
    "Where the requested change and the art style disagree, keep the art style and adapt the change to it.",
    "Absolutely no text, letters, numbers, labels or watermarks. Do not add a frame, border or UI.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
