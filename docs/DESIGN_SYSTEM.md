# PLOT TWIST! design system — "Pastel daylight" (v0.3)

> You create the characters. They create the chaos.

v0.3 keeps the v0.2 layout and components but moves from a dark plum theme to a light, pastel one. Deep plum is now only a supporting color (modal scrim, outlines). Otherworld is the **hero world**: it has fully illustrated scenes, and the other three worlds keep simpler art for now.

This document is the single reference for how PLOT TWIST! looks, reads and moves. Tokens live in `src/app/globals.css`, frames in `src/app/frames.css` (generated), components in `src/components/ui/`.

## 1. What the six references share

The references were used for **principles only**. No characters, compositions or game-specific looks are copied.

| Principle | What it means for PLOT TWIST! |
| --- | --- |
| **Chubby, expressive characters** | Characters are about 2 heads tall, with big heads, simple dot eyes with a white shine, and blush marks. The silhouette must read at 32×32. |
| **Colored outlines, never black** | Art outlines are soft violet `#5b4a86`; UI frame outlines are lighter still (`#b8a8dc`). No pure `#000` anywhere in art or UI. |
| **Hue-shifted shading** | Every material uses a 3-tone ramp. Shadows shift cooler (toward purple or blue-green) and highlights shift warmer (toward yellow or cream). There are no gradients, no anti-aliasing and no blur. |
| **Clear pixel clusters** | Shapes are simple and rounded, with no noise or single stray pixels. Props are a little odd: mushrooms, floating islands, crooked windows. |
| **Calm back, bright front** | Backgrounds are paler and less saturated. Characters and interactive things are the most saturated colors on screen. |
| **Busy, lived-in rooms** | Scenes are layered (sky, far hills, midground, floor, props, characters). Every room should hint at a story. |
| **Retro game UI** | Framed windows, nameplate tabs, speech boxes, portrait badges, candy buttons. |

## 2. Color

### Ink and surfaces
| Token | Hex | Use |
| --- | --- | --- |
| `ink` | `#3d3060` | Main text, text on candy buttons |
| `ink-soft` | `#66598a` | Secondary text |
| `ink-mute` | `#958ab4` | Placeholders, disabled text, hints |
| `outline` | `#5b4a86` | Pixel-art outlines, strong borders (use `/40` for soft ones) |
| `label` | `#7653c2` | Field labels, active step, accents in text |
| `rose` / `mint-deep` / `coral-deep` | `#c4507c` / `#2a8a6d` / `#c2573f` | Text-safe pink, green and red |
| `bg` | `#eee8f9` | Page background (with a faint sparkle pattern) |
| `surface` | `#fffaf3` | Cream panels, top bar, bottom bar |
| `well` | `#f3edfc` | Chips, sunken areas |
| `line` | `#e0d5f1` | Dividers, subtle borders |
| `plum` | `#3a2d55` | **Supporting dark only**: modal scrim |

### Pastel ramps (`-lo` / base / `-hi`)
| Ramp | lo | base | hi | Role |
| --- | --- | --- | --- | --- |
| lavender | `#977ed8` | `#c3b2f0` | `#efe8ff` | Magic, secondary actions (Load, Observe), panel tabs |
| periwinkle | `#7f8fe0` | `#aab8f5` | `#e6ebff` | Calm actions (`calm` button), water, sky |
| pink | `#d97aa2` | `#f5a8c5` | `#ffe0ec` | **Primary** actions, brand, kicker pills |
| peach | `#e98a6a` | `#ffc3a0` | `#ffe6d8` | Warm accents, danger button |
| mint | `#62bf9f` | `#9de3c8` | `#dcfaee` | Success, saved, "on", grass |
| butter | `#e8b85a` | `#ffe08a` | `#fff6d2` | Selection, "current step", sparkles |

Contrast: `ink` on `surface` is about 11:1, `ink-soft` on `surface` about 6:1, and `ink` on every candy base color is above 7:1.

### Worlds
Every world keeps the same UI. Only the environment art, rim frame and accent change.

| World | Accent (text-safe) | Rim frame | Art status |
| --- | --- | --- | --- |
| Otherworld | `#8457d1` | lavender | **Hero world**: detailed pastel scenes (`scripts/otherworld.mjs`) |
| Western Fantasy | `#b27a14` | gold | Simple placeholder scenes |
| Modern | `#cf5f45` | peach | Simple placeholder scenes |
| Ancient China | `#2e8a68` | jade | Simple placeholder scenes |

### Why Otherworld is the hero world
Its palette (lavender sky, pink and peach light, mint grass) is the same as the UI palette, and its props (floating islands, mushroom houses, crystals, small creatures) carry the "whimsical, slightly odd" tone of the references best. Polishing one world end to end gives a reference for the other three.

## 3. Typography

| Role | Token | Latin | Chinese | Use |
| --- | --- | --- | --- | --- |
| Shout | `font-shout` | Press Start 2P | ZCOOL QingKe HuangYou | Logo and big moments only |
| Display | `font-display` | Pixelify Sans | ZCOOL QingKe HuangYou | Screen titles (h1), logo subtitle |
| Heading / UI | `font-head` | Pixelify Sans 600–700 | Noto Sans SC 700 | Buttons, card titles, names |
| Body | `font-body` | Pixelify Sans 400 | Noto Sans SC 400 | Paragraphs, inputs, dialogue |
| Label | `font-label` | Silkscreen | Noto Sans SC | Small caps labels, eyebrows, tags |

Each stack lists the Latin pixel face first and the CJK face next. Mixed text (for example a Chinese UI with an English character name) renders each glyph in the right font. Chinese fonts load on demand by unicode range. ZCOOL has a single weight, so it is never fake-bolded. Chinese gets slightly taller line height.

Scale (px): 10 · 12 label, 14 · 15 small, 17 · 18 body, 20 lead, 22 · 24 card title, 28 → 40 h1, 42 → 96 logo. Body text is never smaller than 16px on phones, which also stops iOS from zooming in on focus.

## 4. The pixel unit and frames

- **1 UI pixel = `--u`**, which is 2px on phones and 3px from 640px up. Borders, offsets and shadows are multiples of it.
- **Frames** are 9-slice images, 12×12 art pixels each: a soft outline, 2-step rounded corners, a light edge on the top-left and a shaded edge on the bottom-right. They are generated by `scripts/build-frames.mjs` into CSS variables (`--frame-panel`, `--frame-pink`, ...).
- Use `.px-frame` with `--frame: var(--frame-<name>)`. `.px-shadow` adds a soft lavender drop shadow. `.px-lift` lifts a card on hover and `.px-selected` adds a butter halo.

| Frame | Use |
| --- | --- |
| `panel` | Main windows |
| `card` | Items inside panels (roster, environment types) |
| `gold`, `gold-card` | Selected item, portrait badge |
| `cream` | Dialogue box |
| `inset`, `inset-focus` | Text fields (focused = violet rim) |
| `tab` | Lavender nameplate tabs on panels |
| `world-*` | World cards, game stage rim |
| button frames | `pink`, `butter`, `mint`, `lavender`, `periwinkle`, `plum` (soft neutral), `ghost`, `coral`, each with a `-pressed` twin, plus `disabled` |

## 5. Components (`src/components/ui`)

| Component | Rules |
| --- | --- |
| **PixelButton / PixelLink** | Variants: `primary` (pink), `accent` (butter), `success` (mint), `magic` (lavender), `calm` (periwinkle), `secondary` (soft neutral), `ghost`, `danger` (coral). Sizes sm 44px, md 48px, lg 56px min height, so every one is touch-sized. **Hover** lifts 1u (pointer devices only, never needed to use the app). **Active** presses down 1u and swaps to the pressed frame. **Focus** shows a dashed violet ring. **Disabled** uses a flat pale frame and muted text. **Loading** shows stepped dots and sets `aria-busy`. |
| **Panel** | Cream framed window. `title` becomes a lavender nameplate tab with a sparkle. `sparkles` adds twinkling corner sparkles (use on one panel per screen at most). |
| **Nameplate tab** (`.px-tab`) | Shared by panels (lavender), dialogue speaker (pink) and modal titles (pink). |
| **Modal** | A centered window on desktop and a bottom sheet on phones. Esc and the backdrop close it, focus returns to where it was, and the page behind doesn't scroll. |
| **Field** | Label in butter caps with a character counter. The input uses the sunken `inset` frame. It is a plain controlled input, so Chinese IME composition works. |
| **Choice / Toggle** | Segmented radio and on/off switch built from candy buttons. |
| **ArtImage** | Shows pixel art with nearest-neighbor scaling, keeping the art's own aspect ratio. `contain` letterboxes, `cover` crops, and `native` draws at 1 art pixel per CSS pixel cropped around `focus` (used for crisp thumbnails); it never stretches. Placeholder art gets a small tag. |
| **PixelStage** (`components/game`) | The game screen. It scales a 320×192 room by a **whole number** (1×, 2×, 3×), so pixels stay square. On screens narrower than the art it falls back to a uniform scale. Readable labels sit in an unscaled overlay. |
| **LoadingDots / LoadingState** | Stepped "..." with a status label. |
| **Deco** | `Sparkle`, `Gem`, `PixelDivider` and `CornerSparkles`: small ornaments, all `aria-hidden`, all tinted by `currentColor`. |
| **ScreenHeader / ActionBar** | Kicker pill + title with a soft lavender shadow + pixel divider. The bottom bar is cream with a scalloped top edge. |
| **PixelIcon** | 7×7 pixel icons drawn in `currentColor`. No emoji anywhere. |

Game pieces (`src/components/game`): WorldCard, CharacterRoster, CharacterEditor, PortraitSlot, PixelStage, SceneSprites / SceneLabels, DialogueBox, ControlPad, CharacterInfoPanel.

## 6. Layout and spacing

- Spacing follows a 4px scale (Tailwind's default): 4, 8, 12, 16, 24, 32, 40.
- Side gutters are `max(16px, safe-area-inset)`. The top bar, bottom action bar, modals and title screen all clear the notch and home indicator.
- Breakpoints: phones up to 639px, tablets 640–1023px, desktop 1024px and up. The step navigation in the top bar appears from 1024px. Below that, a compact step strip is shown.
- When a text field is focused on a phone or tablet, the sticky bottom bar becomes static so the keyboard never hides the field.
- Content max width is 1152px. Running text stays under about 65 characters.

## 7. Motion

All motion is stepped (`steps()`), with no smooth easing.

| Name | Spec | Where |
| --- | --- | --- |
| Snap | 80ms, 2 steps, 1u | Button hover and press |
| Screen in | 240ms, 4 steps, 12px rise | Every page change |
| Pop | 160ms, 3 steps | Modals |
| Bob | 1s, 2 frames, 1u | Selected character, empty-state icons |
| Blink | Off for about 7% of a 3.2s loop | "Press start" |
| Twinkle | 2.4s, stepped scale and fade | Sparkles on headers, selected cards, title |
| Lift | 100ms, 2 steps, 1u | Card hover |
| Cursor | 1s on/off | Typewriter cursor |

"Reduce motion" in Settings, or the operating system's setting, turns all of it off.

## 8. Pixel-art standards

| Asset | Size | Notes |
| --- | --- | --- |
| Map tile | 16×16 | Rooms are 20×12 tiles = **320×192** |
| Character sprite | **32×32** | Character about 20×28 inside, feet on row 30, 1px outline |
| Portrait | **96×96** | Head and shoulders, transparent background, same palette as the sprite |
| Title background | 320×180 | Cropped to fit, never stretched |
| PWA icons | 192, 512, maskable 512, apple 180 | `public/icons` |

- Draw at 1× and export PNG with transparency. Don't pre-scale.
- One light direction everywhere: top-left.
- Use at most 3 tones per material, taken from the ramps above, and up to about 12 colors per sprite.
- Keep the same perspective (straight-on, slightly top-down floor) and the same character proportions in every world.
- The app scales with `image-rendering: pixelated`. Never use `next/image` for pixel art, because it resamples.

## 9. Placeholder art

Everything in `public/assets` is **placeholder** art, generated by `scripts/generate-placeholders.mjs` (Otherworld scenes and the title background come from `scripts/otherworld.mjs`) from the ramps above, and tagged "Placeholder" in the UI. To use your own art, replace a file (same name and size) or update `src/assets/manifest.ts`, then set `placeholder: false`.
