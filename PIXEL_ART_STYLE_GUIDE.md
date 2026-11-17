# PLOT TWIST! — Pixel Art Style Guide

This is the shared visual specification for every environment, map and prop in the game. Map prompts (`src/lib/ai/server/mapPrompt.ts`) and the map pixel pipeline (`src/lib/pixelArt/mapPixels.ts`) implement it; change them together with this file.

The references were used for **principles only**. No characters, layouts or assets from any existing game are copied.

---

## 1. Overall visual direction

Handcrafted, moderately detailed, low-to-medium-density pixel art in a consistent three-quarter top-down RPG view, with warm colours, strong silhouettes and environments that read at a glance.

In priority order:

1. **The ground reads first.** The player knows where they can walk before they notice anything else.
2. **The characters are the focus.** The environment frames conversations. It does not compete with them.
3. **Every pixel is the same size.** Map, props and characters share one pixel grid.
4. **Detail is used on purpose.** Open space is a design element, not something left unfinished.

## 2. Reference image analysis

Three reference sheets (a village courtyard, a four-panel set of beach, village, forest and desert scenes, and a three-panel town, lake and forest set). Their shared traits, turned into rules:

| What the references do | Measured / observed | Rule for PLOT TWIST! |
| --- | --- | --- |
| **Pixel density** | The courtyard image is 640×360 drawn at exactly 2× from a 320×180 canvas. The other sheets use a similar density (pixels 2–3 screen px wide). | Native canvas ≈ 320–480 px wide. We use **480×320** for maps (§3). |
| **Pixel clusters** | Shapes are built from clusters of 3+ same-coloured pixels. Single stray pixels appear only as deliberate highlights (eye shine, a flower centre). | No isolated pixels. Texture = a few small clusters, not noise. |
| **Character scale** | Characters are 24–28 native px tall (head ≈ 40% of height), about **1/7–1/8 of the view height**. Doors are just taller than a character. | Characters are 32 px sprites, ≈ 28 px of figure. Doors ≈ 18×28 px. |
| **Perspective** | Every scene is a three-quarter top-down view: ground seen from about 60°, front faces of walls, roofs and props visible. No mixing of side view and isometric. | One camera angle for everything in a scene. |
| **Outlines** | Dark warm-brown outlines (never black) on characters, props and architecture. Ground details and far scenery are outlined in a darker shade of their own colour, or not at all. | Selective outlines: strong on actors and props, soft on terrain. |
| **Shading** | 3–5 flat tones per material (e.g. grass: shadow, base, light, highlight). Crisp steps, light from the upper left, cast shadows as solid shapes to the lower right. | No gradients, glow, airbrush or blur. |
| **Palette** | Warm, saturated but controlled: moss/olive/lime greens, honey ochre, terracotta, warm stone, teal water. Value contrast separates ground (light, calm) from obstacles (darker, busier). | 32–40 colours per map, warm bias, clear material contrast. |
| **Terrain** | Large regions first: a stone plaza, a grass field, a sand beach, one dirt path. Texture inside them is sparse (a crack, a tuft, a plank seam). Transitions use a 1–2 px edge, not a noisy blend. | Big shapes, then a few clusters of variation. |
| **Distribution** | Buildings, rock walls and tree masses sit along the top and sides. Props come in small groups near landmarks. The middle stays open. | Obstacles at the edges, props grouped, centre open. |
| **Depth layers** | Background (cliffs, roofs, canopy at the top) is darker and calmer. The middle ground is the open floor where characters stand. Foreground objects (bottom edge) are few and small. | Max one or two small foreground objects, never over paths. |
| **Detail vs readability** | Busy detail is concentrated in buildings and edges. Walking surfaces are the calmest areas on screen. | Walking surfaces must be the quietest texture in the picture. |

## 3. Native resolution and pixel scale

| Thing | Native size (art px) | Notes |
| --- | --- | --- |
| Generated map | **480 × 320** (3:2) | Snapped onto this grid in the browser (`snapMapToGrid`). |
| Character sprite | 32 × 32 (figure ≈ 28 px tall) | `lib/sprites/pixelize.ts` |
| Play view at "normal" zoom | ≈ 330–480 × 180–290 art px | Close to the references' 320×180 framing. |

**One map pixel = one character pixel.** The map is played at its own size (`lockedStageWidth`), so the character-size option does not apply to pixel-grid maps.

**Scaling.** Play draws the world at a **whole number of device pixels per art pixel** (`camera.ts snapScale`): 3× on a normal desktop, 5 device px per art px on 3× phones, 6 on 2× tablets. Images use `image-rendering: pixelated` (nearest neighbour). There is never smooth or fractional scaling of a pixel-grid map in Play. The World Builder preview and Play area editor fit the picture to the panel width, but still with nearest neighbour, so pixels stay hard-edged (possibly a little uneven in width) and never blurry.

**How a generated picture gets onto the grid** (`src/lib/pixelArt/mapPixels.ts`):

1. Downsample 1536×1024 → 480×320. Each pixel takes the **most common** colour of its cell, not the average, so edges stay hard.
2. Quantise to 40 colours (k-means), which gives deliberate tonal steps.
3. `despeckle` removes isolated pixels. Thin lines survive.
4. `calmTexture` merges low-contrast speckle into its surrounding cluster. Outlines and high-contrast features stay.

Higher-resolution generation is **not** a way to add detail. The image service is asked for medium quality, because finer detail is thrown away by the snap anyway.

## 4. Character and environmental proportions

All values are in art px on the native grid.

| Element | Size |
| --- | --- |
| Standing character | 28 tall, ~16–18 wide |
| Doorway | ~18 wide × 28 tall |
| Table | ~30 wide |
| Bench / sofa | ~24–40 wide |
| Chair / stool | ~10–12 wide |
| Path / road | ≥ 40 wide (2+ characters side by side) |
| Tree canopy | ≤ ~70 wide |
| Single-storey building front | ~60–120 wide, roof ≤ 1/4 of map height |
| Play-area grid cell | 5 × 5 (96 × 64 cells) |

## 5. Perspective rules

- Three-quarter top-down, ground at about 60°. The top faces of tables and the front faces of walls, counters and cliffs are both visible.
- Every object in a scene uses the same angle. No flat side views next to angled props, and no true isometric diamond tiles.
- Interiors are cutaways: back wall along the top, side walls optional, no front wall over the floor.
- Vertical things (walls, shelves, trees) are drawn upright. Their base is where the footprint is (`footprintOf` uses the lower 45% of an object's box for angled maps).

## 6. Outline rules

- **Characters:** a 1 px outline, the strongest on screen (existing sprites use a dark violet `#5b4a86`; new environment art pairs with it via dark warm browns).
- **Props, furniture, architecture:** a 1 px dark warm-brown outline (about `#3b2a20`–`#5a3b2a`), never pure black.
- **Terrain details and distant scenery:** a colour-based outline (a darker shade of the local colour), or none.
- Outline thickness is always 1 art px. It is never thicker at larger zooms.

## 7. Shading and lighting rules

- 3–5 tones per material. Hard steps between them.
- Light from the upper left. Cast shadows are solid darker shapes to the lower right, one tone darker than the ground they fall on.
- No gradients, airbrush, glow halos, soft brushes, blur, anti-aliasing or dithering noise.
- Highlights are small clusters, used on landmarks and interactive props more than on terrain.

## 8. Colour palette principles

- Warm, inviting and richly but not over-saturated. About 32–40 colours per map.
- Every terrain material has its own hue and value: grass, dirt, sand, stone, wood floor and water must be distinguishable in greyscale.
- **Walkable ground is lighter and calmer** than the obstacles around it.
- The background (top of the map) is calmer than the middle. Characters and interactive props hold the most saturated accents.
- Worlds change the palette, never the rendering language:

| World | Palette flavour |
| --- | --- |
| Western Fantasy | warm greens, honey ochre, terracotta roofs, warm grey stone |
| Modern | warm brick, sage, cream paving, teal accents |
| Ancient China | vermilion, jade, warm grey tiles, pale stone |
| Otherworld | warm mint and moss, cream, peach, lavender accents |

## 9. Terrain construction rules

1. **Big shapes first.** A scene has 2–4 terrain regions (for example a plaza, a field and a path joining them). Each one reads as a single shape.
2. **Then a little variation.** Add 3–6 small clusters per region: a crack, a flower patch, a tuft, a plank seam. Never hundreds of patches.
3. **Consistent texture scale.** The same material uses the same cluster size everywhere.
4. **Clean transitions.** Materials meet along a 1–2 px edge (a lip, a border stone, a darker rim), not a noisy scatter.
5. **Walking surfaces are the quietest texture in the scene.**

## 10. Environmental density rules

The visual hierarchy is, in order:

1. Large terrain shapes
2. One or two landmarks (a building, a well, a big tree, a counter)
3. 2–4 interactive objects
4. Limited decoration in 3–5 small groups near landmarks and edges

Obstacles sit along the top and sides. Decoration is **never** spread evenly across the map. No large canopies, roofs or foreground objects over the centre or over paths.

## 11. Ground visibility requirements

- **Target: about 65–75% of the main playable view is visibly unobstructed ground.** This is a guideline, not a rule for every biome. A dense forest edge can go lower, but there should always be one large connected open area.
- Walkable areas are large and connected: courtyards, wide roads, clearings, open floors. No 1-character-wide paths unless they lead somewhere.
- The Play area editor shows the floor share and the target. New maps get a first-guess floor from their open, calm, connected ground (`guessWalkable`), which the player reviews.
- Foreground occlusion: an object marked "Hide characters standing behind it" turns **45% transparent** while a character is behind it, so characters never disappear (`SceneFronts`).

## 12. Interactive object readability

- Interactive props stand **on open ground** with at least a character's width of free floor in front of them.
- They get the strongest outline and a local highlight. They are never hidden in a decoration cluster.
- Each one is boxed in the Play area editor as an object (table, counter, seat, door…). Solid objects block walking by their footprint, and every object has reachable "use" spots. The editor flags unreachable ones.

## 13. UI consistency

- The UI frames the game. It does not decorate over it. The play view and the dialogue dock stay visible together (side by side on wide screens, stacked on phones).
- UI pixel art (frames, icons) uses the same hard-edged, nearest-neighbour rendering as the world.
- Name tags and bubbles sit above characters and never cover the floor where the player is about to drag.
- No decorative UI inside the play view except the zoom/follow controls in the corner.

## 14. Negative visual constraints

Never:

- high-resolution painting with a pixel filter, or detail smaller than one art pixel
- gradients, airbrush, glow, blur, soft brush strokes, anti-aliasing, dithering noise
- pure black outlines, or thick outlines everywhere
- mixed perspectives in one scene
- hundreds of tiny terrain patches, evenly sprinkled decoration
- large canopies, roofs or foreground objects over the middle of the map or over paths
- narrow, constantly interrupted walkways
- text, letters, numbers, labels, watermarks, UI, frames
- people or creatures painted into the map (the game draws its own characters)
- copies of characters, layouts or assets from existing games

## 15. Asset generation prompt templates

The live prompt is built by `mapPrompt()` from these blocks (see `mapPrompt.ts` for the exact text):

```
MAP_STYLE        handcrafted three-quarter top-down pixel art; drawn on a 480×320 canvas with big
                 square pixels; a person is 28 px tall; doors 18×28, tables 30, canopies ≤ 70,
                 paths ≥ 40; selective 1 px dark warm-brown outlines; 3–5 flat tones per material,
                 light upper left; warm, rich-but-controlled 32–40 colour palette; ground lighter
                 and calmer than obstacles.
MAP_COMPOSITION  ~2/3 open walkable ground in big connected shapes (middle and lower part);
                 big terrain regions first, then a few clusters of variation; obstacles at the
                 top and sides; 1–2 landmarks; 2–4 interactive props on open ground; decoration
                 in 3–5 small groups; nothing large over the centre or paths.
MAP_LAYOUT[type] interior / street / wilderness / ruins / dreamscape arrangement
MAP_WORLD[world] architecture + palette flavour
description      the player's words, quoted as data
MAP_RULES        no text, no frame or UI, no people or creatures
```

**Region edit:** `MAP_EDIT_CONSISTENCY` (same pixel size and grid, same angle, palette, flat shading, outlines; fewer and larger additions; keep ground open) + the instruction + `MAP_STYLE`.

**Prop / gift item** (existing `giftPrompt`): one object, 32×32-style big pixels, 1 px outline, ≤ 10 colours, 3 tones, transparent background.

**Character sprite** (existing `spritePrompt`): chibi ~2 heads tall, drawn as if 32×32, 1 px outline, ≤ 12 colours, 3-tone shading lit from the top left, transparent background.

## 16. Quality assurance checklist

Run it on every new environment and on the test scene. A failed check is fixed before the work counts as done.

**Pixel authenticity**
- [ ] Map is 480 px wide (or the native width for its aspect) and played at its own size
- [ ] Pixels are visibly square and the same size as the characters' pixels
- [ ] No blur: `image-rendering: pixelated` on the map and its front cut-outs; whole device pixels per art pixel in Play
- [ ] ≤ 40 colours; no isolated stray pixels

**Map readability**
- [ ] One large connected walkable area; about 65–75% open ground in the playable view
- [ ] Paths at least 40 px wide; obstacles at the edges
- [ ] No large foreground object over the centre or paths
- [ ] Walking surfaces are the calmest texture

**Visual consistency**
- [ ] One perspective throughout
- [ ] Door, table and tree sizes match §4 against a 28 px character
- [ ] Palette fits the world (§8) and keeps material contrast

**Gameplay**
- [ ] Characters stay visible (front cut-outs fade when someone is behind them)
- [ ] Play area floor and objects line up with the picture at every screen size
- [ ] Every interactive object is reachable
- [ ] Play uses the map selected in World Builder; it reloads after a refresh

**Responsive**
- [ ] Desktop 1440×900, tablet 810×1080, phone 390×844: map crisp, characters readable, dialogue controls usable without hiding the scene

### Assets that don't fit yet

| Asset | Problem | Recommendation |
| --- | --- | --- |
| Maps generated before this guide (1536×1024) | Painted density about 3× finer than the characters, smooth-scaled in Play, often cluttered | **Revise:** use *Pixel-grid copy* in World Builder (free, keeps the original). If the layout itself is cluttered, **regenerate** with the new prompt. |
| Built-in placeholder rooms (`public/assets`) | Flat side-view rooms, a different perspective from generated maps | **Keep** as placeholders for now; **replace** with generated three-quarter maps per world over time. |
| Character sprites | Fit the grid (32 px, 1 px outline, flat shading). Outline is violet rather than brown. | **Keep.** Optionally move the default outline to a dark warm brown in a later pass (it changes every existing sprite's look, so it should be a separate decision). |

## 17. The pixel map kit (layout first)

For **Western Fantasy street and wilderness** places, *Generate Map* no longer asks the image service. `src/lib/mapgen/` plans the map, then draws it one art pixel at a time on the 480×320 grid, then takes the play area from the same plan. Other worlds and place types still use the image service until they have a kit.

1. **Plan** (`village.ts → planVillage`): a woodland hedge along the top, high ground with a boulder cliff on one side, a stone plaza in front of the house, one road 46 px wide from a side edge to the bottom edge, an optional pond in a far corner. Obstacles only along the edges; 2–4 props on open ground (well, bench, signpost, plus a door per house); decoration in 4–8 small groups. The description picks features in English or Chinese (pond, well, a second house, more or fewer trees, flowers); a seed picks the variation, mirrored left↔right half the time (light always from the upper left).
2. **Pixels** (`village.ts → paintVillage`, `sprites.ts`, `palette.ts`), in the references' adventure-RPG manner rather than a flat tilemap: warm, high-contrast hue-shifted ramps (deep warm-brown shadows, mustard and cream lights; 78 palette colours, about 80 per map); grass as overlapping rounded clumps with sunlit lips and dark crescents (scalloped light and shade, never flat colour fields); irregular cobbles and boulder cliffs (jittered stones, lit upper-left lip, shaded lower-right edge); worn roads with ruts and pressed-in stones; three-quarter houses with a shaded side wall and gable, timber frame, stone foundation, porch, lantern and lit windows; lobed canopies lit from the upper left; ground shade under crowns with sunflecks, ragged lantern glows, two-step vignette and foliage framing the edges so the open centre reads as a lit glade; one dark warm outline (#24180f).
4. **Characters in the same world**: the default cast (`scripts/generate-placeholders.mjs`) uses earthy cloth and leather, a belt and satchel strap and the same #24180f outline; Western Fantasy custom sprites get the same outline (`WARM_OUTLINE`) and an adventure-RPG sprite prompt.
3. **Play area** (`index.ts → layoutFromBlueprint`): a 5 px cell is floor only if at least 80% of it is open ground (never water, cliff, hedge or a house). Only the largest connected floor is kept. Solid props become objects at the exact place they were drawn.
4. **Checks before use** (`KIT_LIMITS`): floor ≥ 55% of the map, ≥ 97% of the floor in one connected area, ≥ 88% of the open ground not covered by any drawn object, ≤ 3% of it under objects drawn over characters. A plan that misses them is replaced by the next variation. `tests/mapKit.test.ts` also walks from every start spot to every object and exit with the game's own pathfinding.

Kit maps are stored like any other map (map library, play area marked as reviewed), so the editor, Save, Load and Play treat them the same way.
