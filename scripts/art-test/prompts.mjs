// Prompts for the Lantern Room asset test, batch 1 (docs: "Lantern Room asset test: plan and budget").
// One shared style block keeps every image in the same world; each job adds only what it is.
//
// Style references: your approved PLOT TWIST! concept images, saved locally in scripts/art-test/refs/
// as 01-courtyard.png, 02-indoor.png and 03-dialogue.png (git-ignored: they never go to GitHub).
// Eastward guides the WRITTEN direction only: no screenshots of it are ever sent.

export const STYLE = [
  "Original handcrafted pixel art for PLOT TWIST!, a story game that feels like a living pixel storybook.",
  "Use the attached PLOT TWIST! concept images only as the reference for pixel density, palette, lighting, material rendering and overall finish. Do not copy their layout, characters, text or interface.",
  "Crisp hard-edged pixel clusters on one consistent pixel grid: every pixel the same size, no blur, no painterly smudging, no soft gradients (only tiny 2-step dither in light falloff).",
  "Camera: 3/4 top-down view like a classic story RPG; walls face the viewer, the floor recedes with gentle foreshortening; not isometric.",
  "Lighting is painted into the materials, not glowing overlays: warm localized light around lamps and the stove, cooler violet-blue shadows in unlit areas, directional low sunset light through windows falling across the floor and furniture, controlled highlights, 1-2 px contact shadows under every object, subtle atmospheric depth, darker foreground silhouettes at the frame edges.",
  "Materials read clearly and differently: worn wood with irregular grain and knots, rough plaster with patches, stone, woven fabric, brass and glass with sharp small highlights, paper and book spines. Organic, irregular details, no uniformly repeated textures, no large empty areas, no generic box furniture.",
  "Palette family: warm charcoal shadows, warm paper highlights, terracotta, brass, moss green, dusty blue, dusty rose; hue-shifted ramps (shadows lean violet-blue, highlights lean warm gold).",
  "Mood: atmospheric but not too dark, warm but not childish, detailed but not cluttered, nostalgic, sophisticated and a little playful.",
  "No people, no animals, no text, letters, numbers, UI, icons, speech bubbles, watermark or signature.",
].join(" ");

const ROOM_STORY =
  "The Lantern Room on Cloud Island, at dusk: an old harbour signal house that three young friends now use as their shared map room. It has been lived in for years: a racer's dented trophy, a tinkerer's half-repaired radio and tools laid out mid-repair, a pressed-flower logbook, charts pinned with red string, unopened letters, wet boots by the door, a kettle on a cast-iron stove, an empty cat bed.";
const PLAYABLE =
  "This is a playable game background: keep a clear, readable open floor in the lower middle where characters will walk (broken only by light shapes and a faded rug, not by clutter), keep the large interactive pieces (window, door, stove, table) visually distinct from the wall behind them, and keep foreground silhouettes to the very edges of the frame.";

export const JOBS = [
  {
    id: "room-a",
    batch: "room",
    size: "1536x1024",
    background: "opaque",
    refs: ["02-indoor.png", "03-dialogue.png", "01-courtyard.png"],
    prompt: `${STYLE} ${ROOM_STORY} Composition A: a large multi-pane sunset window on the LEFT wall casting long warm light shapes down and to the right across the floorboards; the cast-iron stove at the back left; the focal point is a big chart table centre-left under a hanging brass lamp, covered in rolled sea charts, a compass and a candle; shelves of logbooks and a corkboard of charts on the back wall; a narrow wooden stair rising to a lantern gallery on the right; a half-open balcony door on the right showing a dusk-blue sky. Foreground: a coat rack with a flight jacket and red scarf bottom-left, a potted fern and rope coil bottom-right, a ceiling beam across the top. ${PLAYABLE}`,
  },
  {
    id: "room-b",
    batch: "room",
    size: "1536x1024",
    background: "opaque",
    refs: ["02-indoor.png", "03-dialogue.png", "01-courtyard.png"],
    prompt: `${STYLE} ${ROOM_STORY} Composition B: a tall arched multi-pane window in the CENTRE of the back wall looking out over a harbour and sea at sunset, the main light source, its light falling forward onto the floor; a wooden mezzanine gallery with a railing and a spiral stair on the left, hung with old signal flags and a big brass lantern lens; a workbench with the radio on the right under shelves of jars and logbooks; a cast-iron stove with warm glow at the right wall; the chart table with a hanging lamp in the middle ground, slightly right of centre. Foreground: dark plant leaves bottom-right, crates and a rope coil bottom-left. ${PLAYABLE}`,
  },
  {
    id: "window-closed",
    batch: "window-closed",
    size: "1024x1024",
    background: "transparent",
    refs: ["02-indoor.png"],
    prompt: `${STYLE} A single interactive game object on a fully transparent background, nothing else in the image: a large old wooden multi-pane window (about 4 panes wide and 3 high) set in a thick weathered frame with a deep worn sill, seen front-on in the same 3/4 view, a small potted plant and a brass spyglass on the sill. State: CLOSED. Warm sunset light glows through the glass with a hint of sky and distant sea; the panes have subtle reflections and old glass imperfections. Centred, the whole window visible with even transparent margins, clean edges, no wall around it, no floor, no shadow on a background.`,
  },
  {
    id: "window-open",
    batch: "window-open",
    size: "1024x1024",
    background: "transparent",
    from: "window-closed.png",
    prompt: `${STYLE} Edit this exact window sprite to show its OPEN state. Keep the frame, sill, plant, spyglass, size, position, palette and pixel grid exactly the same so the two states line up pixel for pixel. Change only this: the two central casements are swung open inward at an angle, a light curtain lifts in the breeze, and the opening shows a cooler dusk sky and a sliver of sea. Fully transparent background, nothing else in the image.`,
  },
];
