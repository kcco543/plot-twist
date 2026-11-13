# PLOT TWIST!

> You create the characters. They create the chaos.

A pixel-art storytelling sandbox for original character creators. Pick a world, build a cast, set the scene, and watch personality-driven stories unfold.

This is **v0.1, the first prototype**: the foundation, design system and core user flows. AI generation, a pixel editor and autonomous NPC behavior come later.

## Run it locally

Requires Node.js 18.18 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Other scripts: `npm run build` (production build + type check), `npm run start` (serve the build), `npm run lint`.

## What's in the prototype

| Screen | Route | What works |
| --- | --- | --- |
| Title screen | `/` | Start Game, Load Game, Settings |
| Load game | `/load` | Shows your save slot and continues where you left off |
| World select | `/worlds` | Four worlds, each with its own accent, icon and art |
| Character studio | `/studio` | Create, edit and delete multiple characters (10 fields + portrait) |
| World builder | `/builder` | Environment description, 5 environment types, live preview |
| Play mode | `/play` | Viewport with characters, info panel, dialogue (Talk / Observe / Wait), story log, pause menu |

Everything saves to the browser's `localStorage` automatically, so it survives a refresh. Settings (text speed, CRT scanlines, reduce motion, erase save) live in the settings menu.

## Project structure

```
public/assets/          ← all placeholder art (replace with your own)
src/assets/manifest.ts  ← the one list of every art file the app uses
src/app/                ← pages (Next.js App Router)
  page.tsx              ← title screen
  (game)/               ← in-game screens sharing the top bar
src/components/ui/      ← design-system building blocks (buttons, panels, icons, modal, fields)
src/components/game/    ← game-specific pieces (world card, roster, viewport, dialogue...)
src/lib/                ← data, save system, settings, map generator interface
src/app/globals.css     ← design tokens (colors, fonts, motion) + pixel component styles
```

## Replacing the placeholder art

All art lives in `public/assets/` and is listed in `src/assets/manifest.ts`.

1. Overwrite a file with your own image using the **same filename**, or add a new file and update its path in the manifest. PNG, GIF, WEBP and SVG all work.
2. Set `placeholder: false` for that entry so the "PLACEHOLDER" tag disappears.

Pixel art is scaled with crisp edges (`image-rendering: pixelated`). Suggested aspect ratios: worlds and environments 8:5, portraits 1:1, sprites 2:3.

## Design system

Colors, fonts and animation timings are tokens in `src/app/globals.css` (`@theme`). Components use them through Tailwind classes such as `bg-ink-800`, `text-twist` or `font-display`, and through the pixel classes `.px-panel`, `.px-btn`, `.px-frame` and `.px-input`. Change a token and every screen follows.

Fonts: Press Start 2P (headings, buttons) and Pixelify Sans (body text), both from Google Fonts.

## Ready for later

- **AI map generation:** `src/lib/mapGenerator.ts` defines a `MapGenerator` interface. The World Builder only calls `activeMapGenerator`, so an AI-backed version can be swapped in without UI changes.
- **Portraits:** `src/components/game/PortraitSlot.tsx` is the frame a pixel editor or AI portrait generator will render into.
- **Story events:** Play Mode lines come from `src/lib/scenes.ts`, built from what you wrote about each character. This is where smarter story logic will plug in.
