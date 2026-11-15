# PLOT TWIST!

> You create the characters. They create the chaos.
> 角色由你创造，混乱由他们制造。

A pixel-art storytelling sandbox for original character creators. Pick a world, build a cast, set the scene, and watch personality-driven stories unfold. It runs in English and Simplified Chinese, works on phones and desktop, and can be installed as an app.

**v0.4 · prototype**: a deeper Character Studio (written profile + 10 personality sliders), personality-driven events with memory and bonds, optional Claude-written dialogue, a Sprite Studio that turns an uploaded image into a pixel character, and a wider Play Mode layout. Built on v0.3's pastel design, the bilingual UI (English / 简体中文), mobile-first layout and PWA support.

Where things live:

- **Design system:** tokens in `src/app/globals.css`, pixel frames in `scripts/build-frames.mjs` (generates `src/app/frames.css`), components in `src/components/ui/`, rules in `docs/DESIGN_SYSTEM.md`.
- **Translations:** `src/i18n/locales/en.json` and `src/i18n/locales/zh-CN.json`, loaded by `src/i18n/index.ts`.
- **Art:** `scripts/generate-placeholders.mjs` and `scripts/otherworld.mjs` (run `node scripts/generate-placeholders.mjs`), wired up in `src/assets/manifest.ts`.

## Run it locally

Requires Node.js 18.18 or newer.

```bash
npm install
npm run dev          # http://localhost:3000
```

To test the production build and the installable app or offline mode (the service worker only runs in production):

```bash
npm run build
npm run start        # http://localhost:3000
```

### AI features (optional)

Everything works without keys: the game uses its built-in analysis and story writer. To turn on the AI parts, copy `.env.example` to `.env.local` and fill in:

| Variable | Used for | Where to get it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Personality analysis and AI-written dialogue/events (Claude) | console.anthropic.com → API Keys |
| `OPENAI_API_KEY` | "Generate Pixel Character" in the Sprite Studio and "Generate Map" and "Edit Selected Area" in the World Builder (OpenAI Images) | platform.openai.com → API keys |

Restart `npm run dev` afterwards. Settings → AI services shows what is connected. Keys are read only by the server routes in `src/app/api/ai/`, never sent to the browser. On Vercel, add the same variables under Project → Settings → Environment Variables.

### Tests

```bash
npm test             # unit tests (character model, behavior, story engine, API routes, pixel conversion)
npm run typecheck
npm run lint
```

To try it on your phone, connect it to the same Wi-Fi and open `http://<your-computer's-ip>:3000`. Offline caching and the install prompt need HTTPS (or localhost), so test those on a deployed copy, for example on Vercel.

## Screens

| Screen | Route | What works |
| --- | --- | --- |
| Title screen | `/` | Start Game, Load Game, Settings, language switch |
| Load game | `/load` | Save slot summary and Continue |
| World select | `/worlds` | Four worlds, each with its own accent and art |
| Character studio | `/studio` | Tabs: **Profile** (14 written fields, lock any as canon) · **Personality** (10 sliders, conflict review) · **Behavior** (AI or built-in analysis, approve before use) · **Look** (Sprite Studio) |
| World builder | `/builder` | Description, 5 environment types, **Generate Map** (AI map in one fixed cozy pixel-art style, edit and regenerate, version history, download), and **Edit region**: drag a box over part of the map, describe the change and repaint only that area (undo, every edit is a new version). Built-in art until a map is generated. |
| Play mode | `/play` | Wide stage + sidebar (About / Mood & bonds / Memories), dialogue (Talk / Observe / Wait / Twist!), story log, pause menu, touch pad, keyboard controls. On phones the character info opens as a bottom sheet. |

Saves live in the browser's `localStorage` and survive refreshes, language switches and going offline.

### Controls in Play Mode
- **Keyboard:** ← → (or A / D) choose a character · Z / Enter / Space talk · X observe · C wait · V twist · L story log · Esc / P pause
- **Touch:** the ◀ ▶ pad chooses a character, **A** talks, and the four big dialogue buttons do the rest. You can also tap a character in the scene.
- **Photo & Gift:** click or tap a character to open a small menu with **Photo** (take or upload a photo, add a caption, show it to them) and **Gift** (name, describe and draw a gift in the pixel editor, or generate its picture when `OPENAI_API_KEY` is set; save it to the world's gift box and give it). Photos and gifts are kept in this browser, per world and per character. Drag a character (mouse) or touch-and-hold then drag (touch) to start a walk & talk as before.

## Emotions and movement (Step 2)

Characters have a **current emotion** (neutral, happy, excited, affectionate, embarrassed, angry, frustrated, sad, anxious, surprised, confused) stored in the story state, separate from their permanent personality. Story events change it; small pixel effects show it above the character, and characters walk, turn, step back and fidget according to personality, emotion, bond and context.

- Emotions + rules: `src/lib/emotion/emotions.ts` · effect library (add new emotions here): `src/lib/emotion/effects.ts`
- Rooms (floor + furniture footprints): `src/lib/stage/room.ts` · pathfinding: `src/lib/stage/path.ts`
- State machine (idle → moving → interacting → speaking → reacting): `src/lib/stage/sim.ts`
- Movement rules: `src/lib/stage/behavior.ts`
- Action interface for future AI events (`approach`, `retreat`, `face_target`, `idle_reaction`, `show_emotion`), validated before anything moves: `src/lib/stage/actions.ts`

## Behavior engine (Step 3)

Characters choose reactions from personality (sliders + written profile), several feelings at once, directional relationships (A→B differs from B→A), memories, place and distance. Hard limits (locked canon, player control, unreachable targets) are applied before a weighted random choice; the result drives movement, the pixel emotion effect (which can be hidden by reserved characters) and the reply, built-in or AI-written. Details, data shapes and how to tune: `docs/BEHAVIOR_ENGINE.md`. Code: `src/lib/mind/`.

**Behavior debug panel (developers):** run `npm run dev`, or open `/play?dev=1` once on a deployed copy, then Settings → *Behavior debug panel*.

**Test panel:** Settings → *Emotion & movement test panel* → On. In Play Mode it appears beside the stage on desktop and under the dialogue on phones (the stage stays pinned at the top while you scroll it).

## Walk & talk (drag-to-interact)

Drag a character onto another one (phones: touch and hold, then drag). While dragging, a dotted route and a green frame show who they'd talk to; red means there's no way there. Let go and they **walk** over (same pathfinding and collision as everything else), stop at a comfortable distance, face each other, and a conversation panel opens with the relationship, the listener's visible mood, 2–3 suggested topics and **Ask Something Else**. A plain click / tap still selects. Without dragging: select someone, press **Talk to…** and tap a name or a character. Esc or Cancel stops a walk or ends a conversation.

- Flow (SELECT_TARGET → MOVE_TO_TARGET → FACE_TARGET → SHOW_OPTIONS → SPEAK → WAIT_FOR_RESPONSE → CONTINUE_OR_EXIT): `src/lib/talk/flow.ts`, driven by `src/lib/talk/useTalk.ts`
- Click vs drag rules and hit-testing: `src/lib/talk/drag.ts` · pointer handling + preview: `src/components/game/CharacterDrag.tsx`
- Topic library (16 rule-based topics, no AI): `src/lib/talk/topics.ts`, wording under `talk.*` in both locale files. The listener's answer comes from the behavior engine with the topic's trigger.
- Custom messages: `src/lib/talk/customReply.ts` (length limit + cleanup). With AI conversations on, the listener answers them (below); with AI off the game says plainly that nobody can answer typed messages.
- Tests: `tests/talk.test.ts`

## AI conversations (Step 4)

With an `ANTHROPIC_API_KEY` set and **AI story writing** on (Settings), the listener in a walk-and-talk answers suggested topics, AI suggestions and typed messages in character, written by Claude from their profile, sliders, mood, relationship, memories and the recent exchange. The reply also proposes an emotion, a movement, small relationship changes, a memory and 2–3 next lines for the speaker; the game validates all of it before anything changes. Full design: `docs/AI_CONVERSATIONS.md`.

- Contract (request + structured reply): `src/lib/talk/ai/contract.ts` · server route: `src/app/api/ai/talk/route.ts` · prompt: `src/lib/ai/server/talk.ts`
- Server checks (character, language, repeats, one retry): `src/lib/talk/ai/checks.ts` · usage limits: `src/lib/ai/server/limits.ts`
- Game-engine validation + memory: `src/lib/talk/ai/apply.ts` · request building: `src/lib/talk/ai/request.ts` · flow: `src/lib/talk/useTalk.ts`
- Memory inspector: Play Mode → character → **Memories** (correct, resolve, forget)
- No characters yet? **Add the sample cast** on the Play screen (Mira, Wren, Tobi).
- Tests: `tests/aiTalk.test.ts`; live model checks (cost a few cents): `RUN_LIVE_AI=1 npx vitest run tests/live`

## AI photo reactions

Click a character → **Photo** → take or upload a photo (optional caption) → **Show** → **Send**. Show first explains that the photo goes to Anthropic's Claude; nothing leaves the device before Send. The character looks at the photo through Claude (the same model as conversations, `ANTHROPIC_TALK_MODEL` → `ANTHROPIC_MODEL` → `claude-opus-5-5`; the route checks the model accepts images) and reacts in the speech bubble, with an emotion, a small validated movement and sometimes a follow-up question.

- What the AI sees: the re-encoded JPEG (≤1280 px, no metadata), the caption, the character's profile, emotion, how they feel about the player ("the visitor" in-world), a few memories and their last photo reactions. Rules: only what is visible, uncertainty allowed, never identify people or infer sensitive traits.
- Nothing is stored unless the player presses **Save as memory**. Then the photo goes to IndexedDB (this world, this character) and the memory (story state) keeps the AI's short description, why it mattered, the caption and what was said, linked to the photo by id. **Delete photo** in the memory inspector removes the file and the link (the memory stays); **Forget** removes both. The server never stores or logs the image.
- Code: `src/lib/photo/` (contract, checks, apply, request) · route `src/app/api/ai/photo/route.ts` · prompt `src/lib/ai/server/photo.ts` · UI `src/components/keepsakes/` (PhotoPanel, PhotoMomentCard, usePhotoMoment)
- Tests: `tests/aiPhoto.test.ts`; live: `RUN_LIVE_AI=1 npx vitest run tests/live/photo.live.test.ts` (downloads 3 public-domain sample photos, or put your own in `tests/live/photos/`). `AI_TALK_MOCK=1` (dev only) gives TEST reactions without a key; they don't look at the photo.

## Design system

See **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)** for the palette, fonts, frames, components, motion and pixel-art standards.

- Tokens: `src/app/globals.css`
- Pixel frames: `src/app/frames.css`, generated by `node scripts/build-frames.mjs`
- UI components: `src/components/ui/`, game components: `src/components/game/`

## Languages (EN / 简体中文)

```
src/i18n/
  index.ts            ← useI18n() → { locale, setLocale, t, tl }, plus the saved language
  Rich.tsx            ← fills {placeholders} with styled elements
  locales/
    en.json           ← source of truth (every key)
    zh-CN.json        ← same keys, Simplified Chinese
```

- Keys are type-checked against `en.json`, so a typo is a TypeScript error.
- To add a string, add it to **both** JSON files with the same key, then use `t("section.key")`.
- Switching language never reloads the page or touches save data.
- **Your own writing is never translated.** Character names, bios and descriptions stay in the language you wrote them in.
- Predefined story lines (Play Mode narration, demo characters) exist in both languages. The story log stores lines as keys, so it re-renders when you switch.
- AI analysis and dialogue are written in the active language. Text already written stays as it was written; only built-in lines re-render on a language switch.

## Installable app (PWA)

- Manifest: `src/app/manifest.ts`. Name, colors, standalone display and icons.
- Service worker: `public/sw.js`, registered in production builds only.
- **Works offline after one online visit:** every screen, all art, fonts and your saves.
- **Needs internet:** the AI features (analysis, AI dialogue, sprite generation). Offline, the game falls back to its built-in writer.
- Icons in `public/icons/` are placeholders.

## Art: what to replace

All art is **placeholder**, generated by `scripts/generate-placeholders.mjs`, tagged "Placeholder" in the UI, and listed in `src/assets/manifest.ts`.

| Folder | Files | Size |
| --- | --- | --- |
| `public/assets/characters/` | `portrait-01…06.png`, `sprite-01…06.png` | 96×96, 32×32 |
| `public/assets/environments/<world>/` | `interior`, `street`, `wilderness`, `ruins`, `dreamscape` `.png` × 4 worlds | 320×192 |
| `public/assets/ui/` | `title-background.png` | 320×180 |
| `public/icons/` | `icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon` | as named |
| `src/app/icon.png` | browser tab icon | 192×192 |

Replace a file with the same name and size, or point the manifest at a new one, then set `placeholder: false`.

## How the story works

- **Game rules decide, the writer words it.** `src/lib/story/engine.ts` picks the event (15 types), who reacts and how, and updates moods, bonds (affinity/trust, capped per step) and memories. The choice is weighted by the approved behavior profile, so an impulsive extrovert and a guarded introvert react differently to the same moment.
- **Variety:** cooldowns per event, penalties for recently used events, reactions, approaches and topics, rotating template variants, and a near-duplicate check on AI lines. Settings → Event frequency sets how often waiting turns into an event.
- **Writers:** the built-in writer (`src/lib/story/localWriter.ts`) always works. With a Claude key, the AI writer gets the same outcome and only writes the lines; its output is validated against a schema and falls back to the built-in writer on any error.
- **Canon:** locked fields, world rules and written relationships are sent as fixed and the AI never edits character fields. Bond numbers change; your written relationships text does not.

## Map generation

- **Flow:** World Builder button → `src/lib/mapGenerator.ts` (browser: one job at a time, history) → `POST /api/ai/map` (`src/app/api/ai/map/route.ts`, validates input, max 2 at once) → `src/lib/ai/server/mapPrompt.ts` (adds the fixed art style, environment layout and world flavor) → `src/lib/ai/server/image.ts` (OpenAI Images, 1536×1024 WebP).
- **Style:** edit `MAP_STYLE` in `mapPrompt.ts` to change how every future map looks. The player's text decides the content, never the style.
- **Storage:** maps are kept in the browser's IndexedDB (last 24, edits included), not in the save, so they don't fill `localStorage`. The save remembers which map is in use.

## Region editing (local map edits)

- **Selecting:** `src/components/game/RegionSelector.tsx` is the overlay on the preview (draw, move, resize by corner, keyboard; mouse and touch). The box is kept as fractions of the map (`src/lib/mapSelection.ts`), so it means the same thing at any screen size.
- **Panel + state:** `src/components/game/MapEditPanel.tsx` (Edit region button, instruction box, Edit Selected Area, Clear, Undo, Done).
- **Request:** `editMapRegion()` in `src/lib/mapGenerator.ts` sends the version on screen + the box + the instruction to `POST /api/ai/map/edit` (`src/app/api/ai/map/edit/route.ts`). The server builds the PNG mask from the box (`src/lib/ai/server/mapMask.ts`, transparent = repaint, grown by 2% so the change can blend), adds the same house style plus "match the surrounding pixels" rules (`mapEditPrompt` in `mapPrompt.ts`), and calls OpenAI Images `images.edit` with the image and mask.
- **Keeping the rest intact:** image models redraw the whole picture even with a mask, so the browser pastes back only the selected rectangle of the result onto the original with a thin soft border inside the box (`src/lib/mapComposite.ts`). Outside the box every pixel is the original's. Edited maps are stored as lossless PNG so repeated edits never wear down the rest.
- **History:** each edit is a new version that remembers its parent and instruction; **Undo edit** goes back to the parent, and older versions stay in "Your maps".
- **Other providers:** `editMap` on `ImageProvider` is optional. A provider without inpainting leaves it out and the route answers `unsupported`, which the UI explains.

## Not built yet

- **Walking animations and free movement.** Sprites are single standing frames. The touch pad and arrow keys choose characters.
- **Generated maps in Play Mode.** Generated maps are saved (World Builder history + download), but Play Mode still uses the built-in side-view scenes.
- **Cloud saves.** Everything (including custom sprites) lives in this browser's `localStorage`, which holds about 5 MB.
