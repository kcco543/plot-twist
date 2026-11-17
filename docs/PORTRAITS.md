# Editable portraits and avatar crops

Code: `src/lib/portraits/model.ts` (pure, tested in `tests/portraits.test.ts`),
`src/lib/portraits/browser.ts`, `src/components/portraits/`.

## Flow

Character Studio → **Look & sprite**: upload a reference → **Generate**
(image API) or **Quick pixel conversion** → **Save to character**. The
result becomes the first portrait version, and **Portrait & avatar** opens:

- **Edit portrait** opens the game's own pixel editor (the same surface as
  sprite and gift editing) on the real pixels, with pencil, eraser, fill,
  eyedropper, the full colour picker (HEX / RGB / HSL), undo / redo, zoom,
  pan and mirror drawing. Keyboard: B E G I H M, + −, Ctrl/Cmd+Z.
- **Save changes** updates the current edited version. **Save as new
  version** adds one. The generated original is never changed: editing it
  always adds a version.
- **Choose avatar** opens the crop editor: Head only, Bust, Square avatar,
  Custom (draw, drag, resize, arrow keys), zoom, live avatar and list-icon
  previews. **Auto head crop** is a simple box at the top of the figure's
  outline, not face detection, and says so.
- **Restore generated version**, **Use** any earlier version, delete
  unprotected ones.
- After the full portrait changes, the avatar is **not** re-cut silently: a
  note offers **Update avatar from saved crop**, **Re-crop** or **Keep
  current avatar**.

Characters with older art (or a placeholder) can start editing with **Make
current portrait editable**; the old 96×96 portrait is detected as 48×48 art
at 2× and imported at its true size.

## Data (`Character.portraits`)

| Field | Meaning |
| --- | --- |
| `originalReferenceImage` | Small copy (≤192 px JPEG) of the upload the current original came from. Each generated version keeps its own. **Forget reference** removes them. |
| `generatedPixelPortrait` | Id of the immutable original (AI or converted). |
| `editedPixelPortrait` | Id of the latest edited version. |
| `activePortraitVersion` | Id of the version shown (`portraitFull()`). |
| `versions` | Up to 12, true resolution PNG (64×64 for new ones). The original, the active version and the avatar's source are never dropped. |
| `avatarCropRect`, `avatarCropPreset` | Crop in source pixels, whole pixels only. |
| `avatarSourceVersion` | The version the avatar was cut from. |
| `portraitAvatar` (+ `avatarW`, `avatarH`) | The crop scaled up by a whole number to about 96 px. |
| `portraitThumbnail` | The crop fitted into 32×32. |

The avatar is what the game shows as the portrait (`artFor()`): the Play
sidebar, Studio, Character Library cards. All images use nearest-neighbour
scaling; imported pixels get hard alpha (0 or 255).

## Worlds and the Character Library

Portraits belong to one character in one world. Editing them never changes
the library original or the same character in other worlds. **Save as new
template** copies the character, portraits included, into the library.
World skins only frame the portrait (brass, digital card, jade and paper,
starry pastel); they never recolour or regenerate character art.
