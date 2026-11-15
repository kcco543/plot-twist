import "server-only";
import type { EnvironmentTypeId, WorldId } from "@/lib/types";

/**
 * MAP ART DIRECTION
 * --------------------------------------------------------------------------
 * Every generated map uses ONE fixed house style (MAP_STYLE). The player's
 * description decides what is in the map; the environment type decides the
 * layout; the world adds a light flavor. None of them can change the style.
 * Edit MAP_STYLE to change how every future map looks.
 */
export const MAP_STYLE = [
  "Art style: a refined, cozy, whimsical top-down pixel-art game map seen from a slight angled bird's-eye view (about 3/4 top-down), like a handcrafted indie game map, not a flat placeholder diagram.",
  "Buildings, paths, plants, fences, props and terrain use rounded, stylized, storybook-like shapes with clear silhouettes and charming proportions.",
  "Clean, deliberate pixel clusters on a consistent pixel grid, as if hand-placed by a pixel artist; no blur, no painterly brush strokes, no photographic detail, no noisy dithering.",
  "Palette: soft, warm and gently fantastical pastels with low contrast: sage green, mint green, olive green, dusty teal, cream, warm beige, pale yellow, muted brown, soft pink and lavender.",
  "Soft, readable shadows falling to the lower right; outlines in darker hue-shifted tones of each color, never heavy pure black outlines; nothing harsh, overly dark or gritty.",
  "Mood: cozy, peaceful, whimsical and lightly magical, like a healing indie game or a fairy-tale village.",
  "Composition: visually rich and detailed but highly readable for gameplay: clear walkable paths, one or two obvious focal points, open floor space for characters to stand, and small props that tell a story (lanterns, crates, flower pots, signposts without writing, laundry lines, little animals).",
  "Polished, cute and atmospheric. It must not look like a generic retro tile mockup, a rigid prototype, or a noisy randomly generated map.",
].join(" ");

export const MAP_RULES = [
  "Fill the whole landscape frame edge to edge with the environment; no border, no frame, no UI, no legend, no compass.",
  "Absolutely no text, letters, numbers, signs with writing, labels or watermarks anywhere in the image.",
  "No people, characters or portraits unless the description explicitly asks for them; if it does, keep them tiny map-scale figures.",
  "The environment and its layout are the subject.",
].join(" ");

/** How each environment type is laid out. Keys match EnvironmentTypeId. */
export const MAP_LAYOUT: Record<EnvironmentTypeId, string> = {
  interior: "Layout: an indoor room or small set of connected rooms shown as a cutaway from above (no roof), walls along the edges, furniture arranged around a clear open floor area, a door or two.",
  street: "Layout: a town street or square with a clear main path running through it, building fronts and rooftops on either side, market stalls or shop corners, benches and street props.",
  wilderness: "Layout: open nature such as a forest clearing, meadow or riverbank, with a winding dirt path, trees and bushes around the edges, water or rocks as a focal point.",
  ruins: "Layout: gentle overgrown ruins: broken stone walls, mossy columns and a courtyard reclaimed by flowers and vines, with paths weaving between the fallen stones. Melancholy but still soft and cozy, never scary.",
  dreamscape: "Layout: a magical dreamlike area: floating islands or soft cloud paths, glowing flowers, gentle sparkles and impossible little details, still with clear walkable paths.",
};

/** Light world flavor. Same style for every world; only the architecture and props change. */
export const MAP_WORLD: Record<WorldId, string> = {
  "western-fantasy": "Setting flavor: a storybook fantasy village with timber-framed cottages, stone wells and mushroom-shaped lamps.",
  modern: "Setting flavor: a cozy small modern neighborhood with cafés, potted plants, bicycles, vending machines and string lights.",
  "ancient-china": "Setting flavor: an ancient Chinese courtyard town with curved tiled roofs, red lanterns, moon gates, bamboo and stone bridges.",
  otherworld: "Setting flavor: a whimsical pastel otherworld with soft rounded houses, crystal flowers and gentle floating lights.",
};

export function mapPrompt(opts: { description: string; type: EnvironmentTypeId; world: WorldId | null }): string {
  const description = opts.description.trim().replace(/\s+/g, " ").slice(0, 600);
  return [
    MAP_STYLE,
    MAP_LAYOUT[opts.type],
    opts.world ? MAP_WORLD[opts.world] : "",
    `What the player wants this place to be (it may be written in Chinese or English; follow its meaning, never write its words into the image): """${description}"""`,
    "Where the description and the art style disagree, keep the art style and adapt the content to it.",
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
  "The repainted area must look like it was always part of this same map: match the existing pixel grid and pixel size, the same slight angled bird's-eye perspective, the same palette, lighting direction, shadow softness and outline treatment.",
  "Blend seamlessly into the surrounding pixels at the edges of the area: continue paths, grass, walls, water and ground textures across the border so no seam or box is visible.",
  "Keep the scale of new objects consistent with nearby buildings, trees and props.",
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
