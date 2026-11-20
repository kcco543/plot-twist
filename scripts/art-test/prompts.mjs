// Prompts for the Lantern Room asset test (docs: "Lantern Room asset test: plan and budget").
// One shared style block keeps every image in the same world; each job adds only what it is.
// Your approved PLOT TWIST! concept images go in scripts/art-test/refs/ and are sent as style references.
// Eastward guides the WRITTEN direction only: no screenshots of it are ever sent.

export const STYLE = [
  "Original handcrafted pixel art for an indie story game called PLOT TWIST!, a living pixel storybook.",
  "Every pixel is a deliberate choice: crisp hard-edged pixel clusters on one consistent pixel grid, no anti-aliasing blur, no painterly smudges, no gradients except tiny 2-step dither in light falloff.",
  "Camera: 3/4 oblique top-down view; walls face the viewer, the floor recedes with gentle foreshortening; no isometric angle.",
  "Palette: warm charcoal shadows (#25242B, #343039), warm paper highlights (#F0DFC5), terracotta (#B96858), brass (#C7A06A), moss (#66745B), dusty blue (#71818B), dusty rose (#C98283). Hue-shifted ramps: shadows lean violet-blue, highlights lean warm gold.",
  "Lighting is painted into the materials: a low sunset key light from the left window (warm orange-pink) casting long shapes down and to the right, warm local light from a cast-iron stove and a candle, cool dusk-blue fill from a balcony door on the right, 1-2 px contact shadows under every object.",
  "Materials read clearly: worn wood planks with irregular grain, soft two-tone plaster, irregular stone, folded fabric, brass and glass with sharp 1-2 px highlights. No black outlines on the environment; edges come from value contrast.",
  "Mood: atmospheric but not too dark, warm but not childish, detailed but not cluttered, nostalgic but not dated, sophisticated and a little playful.",
  "Do not copy any existing game's characters, maps, logos or assets. No text, letters, numbers, UI, watermark or signature.",
].join(" ");

const ROOM = [
  "The Lantern Room: an old harbour signal house on Cloud Island, now three friends' shared map room, lived in for years. Dusk.",
  "Focal point: a large chart table centre-left under a hanging brass lamp, covered in rolled sea charts, a candle and a compass.",
  "Background wall: a large multi-pane sunset window on the left, a cast-iron stove with a kettle at the back left, shelves of logbooks, a corkboard of charts joined with red string, a narrow wooden stair rising to a lantern gallery on the right, a half-open balcony door showing dusk-blue sky.",
  "Middle ground: mismatched chairs, a small workbench with a half-repaired radio and tools laid out, a cat bed by the stove, mail sacks, a dented storm-race trophy, a pressed-flower logbook, wet boots by the door.",
  "Foreground silhouettes kept to the edges: a coat rack with a flight jacket and red scarf bottom-left, a potted fern and rope coil bottom-right, a ceiling beam across the top edge.",
  "Leave a clear, readable open floor in the lower middle where characters will walk, broken by the light shapes from the window and a faded rug, not by clutter.",
  "No people, no animals except the empty cat bed, no UI.",
].join(" ");

const CAST = {
  mira: "Mira: the quiet observer, about 20. Long dark hair with a side braid, moss-green cardigan over a pale blouse, teal skirt, leather satchel, small notebook. Posture slightly inward, gentle small gestures. Colour key moss and teal.",
  wren: "Wren: the bold racer, about 20, secretly fond of Mira. Cropped copper hair with a cowlick, navy flight jacket with small patches, red scarf, dark trousers, boots. Wide confident stance. Colour key copper and navy.",
  tobi: "Tobi: the anxious tinkerer, about 19, wary of Wren since the storm race. Curly brown hair, brass goggles pushed up on the forehead, mustard work apron with tools, rolled sleeves, denim trousers. Slight hunch, hands busy. Colour key mustard and denim.",
};
const PROPORTION = "Natural, slightly stylised young-adult proportions: head about one fifth of body height, readable hands, appealing to teens and adults, not chibi, not a children's game.";

/** Every planned job. `refs` = also send the approved concept images; `from` = edit an earlier output (passed with --from). */
export const JOBS = [
  ...[1, 2, 3, 4].map((i) => ({ id: `room-probe-${i}`, batch: "room", size: "1536x1024", background: "opaque", prompt: `${STYLE} ${ROOM}`, refs: true })),
  ...[1, 2].map((i) => ({ id: `room-unlit-${i}`, batch: "unlit", size: "1536x1024", background: "opaque", from: true, prompt: `${STYLE} Repaint this exact room with identical layout, objects and pixel clusters, but with flat neutral even lighting: no sunset beam, no lamp, stove or candle glow, no cast shadows except 1 px contact shadows. This is the unlit base colour pass.` })),
  ...["closed", "open"].flatMap((s) => [1, 2].map((i) => ({ id: `window-${s}-${i}`, batch: "window", size: "1024x1024", background: "transparent", refs: true, prompt: `${STYLE} A single game object sprite on a fully transparent background: the Lantern Room's large multi-pane wooden sunset window with a worn sill holding a small plant and a brass spyglass, seen front-on in the same 3/4 view. State: ${s === "closed" ? "closed, warm sunset glow through the glass" : "both casements swung open, curtain lifting in the breeze, dusk sky and a sliver of sea visible"}. Object only, centred, nothing else.` }))),
  ...Object.entries(CAST).flatMap(([id, desc]) => [1, 2, 3].map((i) => ({ id: `${id}-turnaround-${i}`, batch: "turnaround", size: "1536x1024", background: "transparent", refs: true, prompt: `${STYLE} Character turnaround sheet on a fully transparent background: the same character shown three times side by side at identical scale, front view, side view, back view, standing neutral. ${desc} ${PROPORTION}` }))),
  ...Object.entries(CAST).flatMap(([id, desc]) => [1, 2].map((i) => ({ id: `${id}-sprite-${i}`, batch: "sprite", size: "1024x1024", background: "transparent", from: true, prompt: `${STYLE} The same character as the reference, drawn as a small in-game sprite at true game scale (about 40 pixels tall on the pixel grid), front three-quarter standing pose, clear silhouette, centred on a fully transparent background, feet on one baseline. ${desc} ${PROPORTION}` }))),
  ...Object.entries(CAST).flatMap(([id, desc]) => [1, 2].map((i) => ({ id: `${id}-expressions-${i}`, batch: "expressions", size: "1536x1024", background: "transparent", from: true, prompt: `${STYLE} Expression sheet on a fully transparent background: six bust portraits of the same character from the reference, in a 3 by 2 grid at identical scale and framing: neutral, gentle smile, angry, worried, surprised, shy and blushing. Expressions are clear but not exaggerated. ${desc}` }))),
];
