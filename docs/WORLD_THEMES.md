# World skins (world-reactive UI)

Every world wears its own skin, but it is always PLOT TWIST!. A skin changes
colours, frame materials, small motifs and the flavour of a few animations.
It never changes layout, sizes, fonts, spacing or how anything behaves.

Code: `src/lib/theme/` (pure, tested in `tests/theme.test.ts`),
`src/components/theme/`, the `WORLD SKINS` block at the end of `src/app/globals.css`.

## Layers

| Layer | Where | What it controls |
| --- | --- | --- |
| A · Brand | `globals.css`, `frames.css` | Typography, the `--u` pixel unit, 12×12 frame geometry and corner steps, spacing, button sizes, hover / press / focus / disabled / loading states, 240 ms stepped motion, reduced motion. **Never changed by a skin.** |
| B · Base world | `BASES` in `themes.ts` | Palette (from the brief), frame inlay (double border), motif vocabulary, corner ornaments, motion flavour, Chinese serif display headings (Ancient China only). |
| C · Mood | `MOOD_SPECS` | Colour temperature, a light surface tint, saturation, accent pull, default decoration density. Bounded so the base always stays recognisable. |
| D · Motifs | `decorativeMotifIds` | Up to 3 validated motif ids (from `motifs.ts`) in the page pattern and the second corner. Never free-form CSS, HTML or images. |

## How a skin is applied

`buildThemeVars(theme)` returns CSS custom properties: the brand colour tokens
every component already uses (`--color-ink`, `--color-pink`, …), the semantic
tokens (`--pt-background`, `--pt-surface`, `--pt-panel`, `--pt-primary`,
`--pt-secondary`, `--pt-accent`, `--pt-text`, `--pt-muted-text`, `--pt-border`,
`--pt-border-highlight`, `--pt-shadow`, `--pt-focus`, `--pt-hover`,
`--pt-selected`, `--pt-disabled`, `--pt-error`, `--pt-success`), re-coloured
9-slice frames, the portrait frame, motif images and the page pattern.
`WorldThemeApplier` puts them on `<html>` (plus `data-world-theme`,
`data-mood`, `data-density`, `data-motion-preset`) on world screens
(`/studio`, `/builder`, `/play`) and removes them everywhere else, so the
title screen, My Worlds and the Character Library wear the brand theme.
Entering another world reloads the page, so a skin can't leak between saves.
A tiny inline script re-applies the last skin before hydration to avoid a
flash of the brand theme on reload.

Frames are generated at runtime by `frames.ts` with **the same 12×12
construction** as `scripts/build-frames.mjs` (a test checks the geometry is
identical), drawn crisp and used through `border-image` 9-slice, so border
thickness and corner steps match at every screen size.

Readability is enforced, not hoped for: `themePalette()` darkens text tokens
until they pass (ink ≥ 7:1 on surfaces, secondary text, labels and coloured
text ≥ 4.5:1, ink on every button face ≥ 4.5:1, focus ring ≥ 3:1). The test
checks every base × mood × approved colour.

## The four skins

| | Western Fantasy | Modern | Ancient China | Otherworld |
| --- | --- | --- | --- | --- |
| Feel | Enchanted storybook | Urban digital diary | Living ink scroll | Lucid dream playground |
| Colours | parchment, sage, brass | cool grey-white, blue, pink | rice paper, jade, vermilion | lilac, lavender, candy pink |
| Frames | brass inlay (double border) | clean single line | thin ink line, jade portrait frame | pastel inlay, star corners |
| Tab detail | bookmark ribbon | folder status light | small red seal | sticker star |
| Motifs | leaf, vine, book, key, potion, quill, crest | window, raindrop, camera, message, folder, pin, city light | cloud, lantern, bamboo, seal, mountain, fan, scroll, jade | star, mushroom, moon, crystal, bubble, cloud, sparkle |
| Page reveal (240 ms) | paper reveal | short slide | scroll opening | float up |
| Ambient (wide screens only) | drifting leaves | blinking status lights | slow clouds | bobbing stars |

## Mood suggestions

`suggestTheme(description, worldId)` is a local keyword match in English and
Simplified Chinese (no AI call, nothing sent anywhere). It suggests a mood and
up to three motifs and shows which words matched. Vague text suggests
nothing. If the words point to a different world type it only says so; the
world type stays the base. The player confirms in **World Builder → Look &
feel**, with a live preview (panel, tab, dialogue frame, primary and
secondary buttons, motifs). Changing the skin never regenerates maps or art.

## Saved data

`SaveData.uiTheme` (per world save):

```ts
{ baseTheme, moodVariant, approvedAccentOverrides: { primary?, accent? },
  decorativeMotifIds, decorationDensity, themeVersion: 1, confirmed, updatedAt }
```

Validated on every load (`sanitizeUiTheme`): unknown moods, unapproved
colours and unknown motif ids are dropped. A world without a saved skin
(every save made before this version) shows its world type's default skin;
nothing is rewritten until the player confirms a look. A skin saved for a
different world type is ignored.
