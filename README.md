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

The two keys are separate: an Anthropic key can't stand in for an OpenAI one. Paste them into `.env.local` in your own editor (it is git-ignored); never share them in chat.

Restart `npm run dev` afterwards. Settings → AI services shows what is set up, and **Test connections** there checks each key against its provider (it never shows the key). An empty credit balance only shows up when something is actually generated, and is reported as a billing problem, not as "rate limited". Live checks that spend a few cents: `RUN_LIVE_IMAGES=1 npx vitest run tests/live/image.live.test.ts` (character from a reference image, map from text) and `RUN_LIVE_AI=1 npx vitest run tests/live/refine.live.test.ts`. Keys are read only by the server routes in `src/app/api/ai/`, never sent to the browser. On Vercel, add the same variables under Project → Settings → Environment Variables.

### AI costs, modes and the usage dashboard

The game only calls Claude when you do something: send a message, show a photo, give a gift, run or refine an analysis, or press **Talk** / **Twist!** with AI story writing on. Idle screens, walking and characters acting on their own never call it (checked by `scripts/usage-check/`). Details and numbers: `docs/AI_COSTS.md`.

- **AI mode** (default **Balanced**): *Offline* sends nothing; *Balanced* uses AI only for what you start (Observe/Wait beats use built-in lines); *Full AI* also words Observe/Wait. Switch it on the dashboard below, or set `AI_MODE` in `.env.local`.
- **Models**: conversations, photo and gift reactions use `claude-sonnet-5-5` (`ANTHROPIC_TALK_MODEL`); story-beat wording uses `claude-haiku-5-5` (`ANTHROPIC_STORY_MODEL`); personality analysis and refinement use `claude-opus-5-5` (`ANTHROPIC_MODEL`).
- **API Usage dashboard** (development only): open <http://localhost:3000/dev/usage> (or Settings → *Open the API usage dashboard*). It shows requests, tokens, cache use, estimated cost and time per feature, lets you switch the mode, and set limits: requests per minute, requests at once, max output tokens, and a spending budget per session. When a limit is reached the request is refused before anything is sent. The budget is the app's own estimate, not a billing cap: set a real monthly limit in the Anthropic Console (Settings → Limits).

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

### Drag onto objects and the floor

Dropping a character on an **object** (bookshelf, door, rug, window…) makes them walk to its interaction point and use it (read, open, sit, look out…). Dropping on the **floor** makes them walk there; a blocked spot is moved to the nearest reachable one ("going as close as possible"), and an unreachable one is explained instead of attempted. Objects come from a hand-written annotation layer per room (`src/lib/stage/objects.ts`: id, type, bounds, collider, interaction anchors outside colliders, radius, actions, tags, world), never from the image's pixels; collision is the room's floor rectangle + obstacle list (`src/lib/stage/room.ts`) turned into an A* grid (`src/lib/stage/path.ts`). Settings → test panel draws the walk area, obstacles, objects and anchors on the stage. Generated maps get the same kind of layer from the player instead (see *Playing inside generated maps*). Tests: `tests/objects.test.ts`.

## Characters acting on their own

`src/lib/autonomy/`. A character's own action is a structured **intent** (approach, move away, go to a place, look at / use / sit on an object, turn away, leave a conversation…), never free text and never a direct position change. Every intent goes proposed → validated → queued → executing → completed / interrupted / failed (`lifecycle.ts`) and runs only through the stage's validated actions, so pathfinding, collision and priorities always apply.

- **Planner** (`planner.ts`): plain rules, no AI. Feelings × personality × relationships × what's in the room decide what (if anything) someone does; the same feeling leads different people to different things, and gender is never an input. Each character thinks at most every ~9 s and acts at most every ~14 s; at most two autonomous walks at once; repeats are discouraged.
- **Priorities:** the player can interrupt any autonomous walk; autonomy never overrides a player command; nobody can override a character's boundary.
- **Ending a conversation** (`convoBoundary.ts`): the listener turns away and walks to a quiet spot or away, and a boundary is recorded. Trying again too soon is refused (and recorded as a boundary push, which costs a little trust and makes the wait longer); retrying can't get round it. Talking again needs **all** of: the cooldown has passed (longer for a more serious ending, each push, and a character who holds on to things), they've calmed down, a repair after an upset ending (an apology, help, a gift… or a long trusting history after a severity-2 ending, never after severity 3), trust above −40 and no fear.
- **Plans said out loud** (`goals.ts`): "I'm heading to the window" / "我去书架那边看看" becomes a destination after the conversation only if it's a genuine intention; hypotheticals, past events, jokes, questions and negations are ignored. A place that isn't in the room is reported ("there's no such place here"), never faked.
- **Saved per world** in `StoryState.agency`: intents, boundaries, goals and where everyone stands (restored on reload). The test panel shows a live view of all of it.
- Tests: `tests/autonomy.test.ts`

## Gender and pronouns

Character Studio → Identity: gender (unspecified, female, male, non-binary, self-described) and pronouns (unspecified, she/her, he/him, they/them, custom) are separate settings, saved on each world's own copy of the character. Older characters load as unspecified. They are only used to refer to the character (built-in English narration uses the chosen pronouns; unspecified uses "they"); the AI is told never to infer personality or behavior from them. `src/lib/character/gender.ts`, tests in `tests/gender.test.ts`.

## Refining an analysis with feedback

Character Studio → Behavior → **Refine This Analysis**: write what the analysis got wrong ("reserved with strangers, playful with close friends; not timid") and press **Apply Feedback**. The AI proposes a revised profile with a list of every change, what it kept, anything it read more than one way (confirm before accepting) and anything that contradicts locked canon (resolve before accepting). Nothing changes until you **Accept**; **Reject** keeps the old one; **Restore previous version** and the history undo any accepted change. Locked canon is quoted word for word, enforced in code (`pinLockedCanon`), even when the feedback is in another language. Only the active world's copy changes; dialogue uses the latest accepted version. `src/lib/behavior/refine.ts`, `src/app/api/ai/refine/route.ts`, tests in `tests/refine.test.ts`.

## Pixel editor colour picker

Hue strip + saturation/value square (mouse, touch, keyboard), HEX / RGB / HSL, current vs previous colour, canvas eyedropper (and screen eyedropper in browsers that support it), limited-palette mode, recent colours and saved swatches (remembered in this browser), Undo and Redo. `src/components/game/ColorPicker.tsx`, `src/lib/color/color.ts`.

**Pantone:** the game ships no Pantone data and never invents codes; without a licensed library it says so. With a licence, register a provider in `src/lib/color/pantone.ts`; an unofficial approximation is always labelled "unverified".

## AI conversations (Step 4)

With an `ANTHROPIC_API_KEY` set and **AI story writing** on (Settings), the listener in a walk-and-talk answers suggested topics, AI suggestions and typed messages in character, written by Claude from their profile, sliders, mood, relationship, memories and the recent exchange. The reply also proposes an emotion, a movement, small relationship changes, a memory and 2–3 next lines for the speaker; the game validates all of it before anything changes. Full design: `docs/AI_CONVERSATIONS.md`.

Relationships develop gradually and are enforced by game rules, not the AI: every change is scored, capped and checked against stage milestones, and characters keep hard and soft boundaries (Character Studio) that repeated asking never wears down. Design and tuning: `docs/RELATIONSHIPS.md`.

- Contract (request + structured reply): `src/lib/talk/ai/contract.ts` · server route: `src/app/api/ai/talk/route.ts` · prompt: `src/lib/ai/server/talk.ts`
- Server checks (character, language, repeats, one retry): `src/lib/talk/ai/checks.ts` · usage limits: `src/lib/ai/server/limits.ts`
- Game-engine validation + memory: `src/lib/talk/ai/apply.ts` · request building: `src/lib/talk/ai/request.ts` · flow: `src/lib/talk/useTalk.ts`
- Memory inspector: Play Mode → character → **Memories** (correct, resolve, forget)
- No characters yet? **Add the sample cast** on the Play screen (Mira, Wren, Tobi).
- Tests: `tests/aiTalk.test.ts`; live model checks (cost a few cents): `RUN_LIVE_AI=1 npx vitest run tests/live`

## AI photo reactions

Click a character → **Photo** → take or upload a photo (optional caption) → **Show** → **Send**. Show first explains that the photo goes to Anthropic's Claude; nothing leaves the device before Send. The character looks at the photo through Claude (the same model as conversations, `ANTHROPIC_TALK_MODEL`, default `claude-sonnet-5-5`; the route checks the model accepts images) and reacts in the speech bubble, with an emotion, a small validated movement and sometimes a follow-up question.

- What the AI sees: the re-encoded JPEG (≤1280 px, no metadata), the caption, the character's profile, emotion, how they feel about the player ("the visitor" in-world), a few memories and their last photo reactions. Rules: only what is visible, uncertainty allowed, never identify people or infer sensitive traits.
- Nothing is stored unless the player presses **Save as memory**. Then the photo goes to IndexedDB (this world, this character) and the memory (story state) keeps the AI's short description, why it mattered, the caption and what was said, linked to the photo by id. **Delete photo** in the memory inspector removes the file and the link (the memory stays); **Forget** removes both. The server never stores or logs the image.
- Code: `src/lib/photo/` (contract, checks, apply, request) · route `src/app/api/ai/photo/route.ts` · prompt `src/lib/ai/server/photo.ts` · UI `src/components/keepsakes/` (PhotoPanel, PhotoMomentCard, usePhotoMoment)
- Tests: `tests/aiPhoto.test.ts`; live: `RUN_LIVE_AI=1 npx vitest run tests/live/photo.live.test.ts` (downloads 3 public-domain sample photos, or put your own in `tests/live/photos/`). `AI_TALK_MOCK=1` (dev only) gives TEST reactions without a key; they don't look at the photo.

## Gifts

Click a character → **Gift** → draw a 32×32 picture (or load one from this world's Gift Box), name it, describe it → **Give**. The character's reaction comes from Claude (same model and image check as photos); the drawing goes with the request as a small PNG.

- **Item vs. instance.** The Gift Box item (IndexedDB, this world only) is the design you can reuse. Giving creates a gift *instance* in the world's story state (`story.gifts`): owner, recipient, creator (the visitor), when it was received, what the character thinks it is, why it matters, where it is kept, who knows about it, and a history of every move. The instance keeps its own copy of the small icon, so editing or deleting the box item never rewrites what was given. The Character Library is never touched.
- **Reactions.** The AI returns accept / refuse / shrug, an interpretation, a line, emotion, movement, where to keep it, a memory and an optional question. The game engine has the last word: canon rules can force a refusal, a shrug is never put on display, reserved or secretive characters keep things private, there are only 3 display spots (on furniture, never where people walk) and 3 carried things per character, and relationship changes are capped. Refused gifts go back to the visitor.
- **Keeping places:** On display · Carried · Kept privately · Hidden · Stored · Refused. Displayed gifts are drawn on the stage; the **Things** tab in the character panel lists them all.
- **Rules, not AI, move gifts later** (once per story turn, at most one move per character, 3-turn cooldown): put away when they cool on the visitor, hidden when trust drops, brought out when trust grows, shown off when they're fond of the visitor, carried when it's treasured.
- **Knowledge.** Everyone present sees a displayed gift; hidden and private gifts are known only to the owner. Later conversations get a gift only when it is relevant (asked about, named, or on display where the speaker saw it), and the prompt says plainly when the speaker doesn't know about it.
- Code: `src/lib/gifts/` · route `src/app/api/ai/gift-reaction/route.ts` · prompt `src/lib/ai/server/giftReaction.ts` · UI `GiftCreator`, `GiftMomentCard`, `useGiftMoment` · tests `tests/gifts.test.ts`. In `AI_TALK_MOCK=1` the TEST reply refuses when the description contains "refuse" (拒绝) and hides it for "secret" (秘密).
- **AI pictures** in the Gift Creator need `OPENAI_API_KEY` (image generation). Without it the AI picture tab says it's unavailable and drawing works as usual.

## Design system

See **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)** for the palette, fonts, frames, components, motion and pixel-art standards.

Each world wears its own skin (Western Fantasy storybook, Modern urban diary, Ancient China ink scroll, Otherworld lucid dream) on the same components, with a mood suggested from the world description and a live preview in World Builder → Look & feel: **[docs/WORLD_THEMES.md](docs/WORLD_THEMES.md)**. Generated portraits stay editable, keep their version history and let you crop the profile avatar: **[docs/PORTRAITS.md](docs/PORTRAITS.md)**.

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

## Playing inside generated maps

The map shown in World Builder is the map Play Mode uses. The single source of truth is the active world save's `environment.mapId` (set when a map is generated or picked, cleared by "Use built-in picture"); the image itself is kept in IndexedDB (`src/lib/mapLibrary.ts`), so it survives reloads, and every world save keeps its own selection. `src/lib/scene/useScene.ts` decides what Play shows: the generated picture when the map is found, the built-in room when no map is selected, and the built-in room with a notice (without clearing the reference) when the selected map is missing from this browser.

A generated picture says nothing about where the floor or the furniture is, so each map carries a **play area** (`src/lib/scene/layout.ts`), stored with the map and edited under **Play area** in World Builder or Play Mode:

- **Floor**: a 96-column grid painted with the Floor / Not floor brushes. Feet must be on painted cells, so any floor shape works (the diamond floor of an angled room too). Until it is saved the floor is a rough guess, and Play says so.
- **Objects**: boxes the player names (bar counter, Christmas tree…) with a type that sets the action (sit, read, open, examine…). Solid objects block walking (the lower part of the box is the footprint) and can hide characters standing behind them: that part of the picture is drawn again over sprites whose feet are behind its base. Every object is a drag target, and its anchors are worked out automatically on reachable floor; unreachable ones are flagged.
- **Start spots**: where characters appear; spots inside furniture move to the nearest free floor.
- **Character size**: sets the stage width in art px (characters are always 32 px), so characters match the scale of the picture. The stage height follows the image's aspect ratio; nothing is stretched or cropped.

Everything is stored as fractions of the image, then turned into the stage's units by `buildScene()` for the same A* planner, simulation, drag-to-talk, objects, autonomy and gifts the built-in rooms use. Region edits keep the parent map's play area; duplicated worlds copy it. Tests: `tests/scene.test.ts`.

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
