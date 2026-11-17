/**
 * EDITABLE PORTRAITS (pure, no DOM)
 * --------------------------------------------------------------------------
 * A character's portrait is a small stack of pixel images, never one
 * overwritten file:
 *
 *   originalReferenceImage  the player's upload (a small copy), never edited
 *   generatedPixelPortrait  the AI / converter result: an immutable version
 *   editedPixelPortrait     the latest hand-edited version
 *   activePortraitVersion   the version the game shows (portraitFull)
 *   versions                every saved version, oldest first (capped)
 *
 * The profile avatar is CUT from the full portrait with a crop rectangle in
 * SOURCE pixels (not screen pixels), so it can be re-cut from a later
 * version without the player re-drawing it:
 *
 *   avatarCropRect / avatarCropPreset / avatarSourceVersion
 *   portraitAvatar     the crop, scaled up by a whole number (crisp)
 *   portraitThumbnail  the crop fitted into 32×32, for small lists
 *
 * Portraits belong to ONE character in ONE world (Character.portraits):
 * editing in a world never touches the Character Library original or the
 * same character in other worlds. "Save as new template" copies them.
 */
import { blank, contentBox, downsample, upscale, type Img } from "../sprites/pixelize";

export const PORTRAITS_VERSION = 1;
export const MAX_VERSIONS = 12;
export const AVATAR_TARGET = 96;
export const THUMB_SIZE = 32;
export const MIN_CROP = 4;

export type PortraitKind = "generated" | "converted" | "edited" | "legacy";
export type PortraitVersion = {
  id: string;
  kind: PortraitKind;
  /** PNG data URL at its true pixel resolution (one image pixel = one art pixel). */
  image: string;
  w: number;
  h: number;
  createdAt: number;
  /** The version it was edited from. */
  parentId: string | null;
  /** Small copy of the uploaded reference this version was made from (generated / converted only). */
  reference?: string | null;
};
export type CropRect = { x: number; y: number; w: number; h: number };
export const CROP_PRESETS = ["head", "bust", "square", "custom"] as const;
export type CropPreset = (typeof CROP_PRESETS)[number];

export type CharacterPortraits = {
  v: typeof PORTRAITS_VERSION;
  originalReferenceImage: string | null;
  generatedPixelPortrait: string | null;
  editedPixelPortrait: string | null;
  activePortraitVersion: string;
  versions: PortraitVersion[];
  avatarCropRect: CropRect;
  avatarCropPreset: CropPreset;
  avatarSourceVersion: string;
  portraitAvatar: string;
  avatarW: number;
  avatarH: number;
  portraitThumbnail: string;
};

export type RenderedAvatar = { avatar: Img; thumb: Img };

// ---------------------------------------------------------------- images

const at = (img: Img, x: number, y: number) => (y * img.w + x) * 4;

/**
 * True pixel size of an image that was scaled up by a whole number (a 96×96
 * portrait drawn on a 48×48 grid = 2). Importing at that size means one
 * editor cell is one art pixel, instead of 2×2 blocks.
 */
export function detectScale(img: Img): number {
  for (let k = 8; k >= 2; k--) {
    if (img.w % k || img.h % k) continue;
    let ok = true;
    for (let y = 0; y < img.h && ok; y++)
      for (let x = 0; x < img.w && ok; x++) {
        const a = at(img, x, y);
        const b = at(img, x - (x % k), y - (y % k));
        for (let c = 0; c < 4; c++) if (img.data[a + c] !== img.data[b + c]) { ok = false; break; }
      }
    if (ok) return k;
  }
  return 1;
}

/** Nearest-neighbour reduce by a whole factor (exact inverse of upscale). */
export function downscaleBy(img: Img, k: number): Img {
  if (k <= 1) return img;
  const out = blank(img.w / k, img.h / k);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) out.data.set(img.data.subarray(at(img, x * k, y * k), at(img, x * k, y * k) + 4), at(out, x, y));
  return out;
}

/**
 * Make an image editor-ready: true resolution, hard alpha (0 or 255, so
 * no half-transparent smudges survive), at most 128 px on a side.
 */
export function toEditable(img: Img): Img {
  let out = downscaleBy(img, detectScale(img));
  if (Math.max(out.w, out.h) > 128) {
    const s = 128 / Math.max(out.w, out.h);
    out = downsample(out, { x: 0, y: 0, w: out.w, h: out.h }, Math.max(1, Math.round(out.w * s)), Math.max(1, Math.round(out.h * s)));
  }
  const data = new Uint8ClampedArray(out.data);
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= 128 ? 255 : 0;
  return { w: out.w, h: out.h, data };
}

/** Whole pixels, at least MIN_CROP, inside the image. */
export function clampRect(r: CropRect, w: number, h: number): CropRect {
  const cw = Math.max(Math.min(MIN_CROP, w), Math.min(w, Math.round(r.w)));
  const ch = Math.max(Math.min(MIN_CROP, h), Math.min(h, Math.round(r.h)));
  return { x: Math.max(0, Math.min(w - cw, Math.round(r.x))), y: Math.max(0, Math.min(h - ch, Math.round(r.y))), w: cw, h: ch };
}

export function cropImg(img: Img, r: CropRect): Img {
  const c = clampRect(r, img.w, img.h);
  const out = blank(c.w, c.h);
  for (let y = 0; y < c.h; y++) out.data.set(img.data.subarray(at(img, c.x, c.y + y), at(img, c.x + c.w, c.y + y)), at(out, 0, y));
  return out;
}

const square = (cx: number, top: number, side: number, w: number, h: number) => clampRect({ x: cx - side / 2, y: top, w: side, h: side }, w, h);

/**
 * Crop presets. These are simple geometry from the figure's outline (the
 * opaque pixels), NOT face detection: "head" assumes the head sits at the
 * top of the figure, which suits the game's 2-heads-tall characters. The
 * player can always move or resize the box.
 */
export function presetRect(img: Img, preset: CropPreset): CropRect {
  const box = contentBox(img, 128) ?? { x: 0, y: 0, w: img.w, h: img.h };
  // Centre of the top part of the figure (hair / head), so off-centre poses still frame the face.
  const topRows = Math.max(1, Math.round(box.h * 0.35));
  let sx = 0, n = 0;
  for (let y = box.y; y < box.y + topRows; y++)
    for (let x = box.x; x < box.x + box.w; x++)
      if (img.data[at(img, x, y) + 3] >= 128) {
        sx += x;
        n++;
      }
  const cx = n ? sx / n + 0.5 : box.x + box.w / 2;
  switch (preset) {
    case "head": {
      const side = Math.max(MIN_CROP, Math.min(box.w + 2, Math.round(box.h * 0.48) + 2));
      return square(cx, box.y - 1, side, img.w, img.h);
    }
    case "bust": {
      const side = Math.max(MIN_CROP, Math.min(Math.max(box.w, Math.round(box.h * 0.66)) + 2, img.w, img.h));
      return square(cx, box.y - 1, side, img.w, img.h);
    }
    case "square": {
      const side = Math.min(Math.max(box.w, box.h) + 2, img.w, img.h);
      return square(box.x + box.w / 2, box.y + box.h / 2 - side / 2, side, img.w, img.h);
    }
    default:
      return clampRect({ x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 }, img.w, img.h);
  }
}

/** Avatar = the crop scaled up by a whole number to about 96 px; thumbnail = the crop fitted into 32×32. */
export function renderAvatar(img: Img, r: CropRect): RenderedAvatar {
  const crop = cropImg(img, r);
  const side = Math.max(crop.w, crop.h);
  const avatar = upscale(crop, Math.max(1, Math.round(AVATAR_TARGET / side)));
  let thumb: Img;
  if (side <= THUMB_SIZE) thumb = upscale(crop, Math.max(1, Math.floor(THUMB_SIZE / side)));
  else {
    const s = THUMB_SIZE / side;
    thumb = downsample(crop, { x: 0, y: 0, w: crop.w, h: crop.h }, Math.max(1, Math.round(crop.w * s)), Math.max(1, Math.round(crop.h * s)));
  }
  return { avatar, thumb };
}

// ---------------------------------------------------------------- versions

export const versionById = (p: CharacterPortraits, id: string | null) => (id ? (p.versions.find((v) => v.id === id) ?? null) : null);
export const activeVersion = (p: CharacterPortraits) => versionById(p, p.activePortraitVersion) ?? p.versions[p.versions.length - 1];
/** The full portrait the game shows. */
export const portraitFull = (p: CharacterPortraits) => activeVersion(p).image;
/** The avatar was cut from an older version than the one now shown. */
export const avatarOutdated = (p: CharacterPortraits) => p.avatarSourceVersion !== p.activePortraitVersion;
/** Versions that can never be dropped by the cap or deleted. */
export const isProtected = (p: CharacterPortraits, id: string) => id === p.generatedPixelPortrait || id === p.activePortraitVersion || id === p.avatarSourceVersion;

type AvatarInput = { rect: CropRect; preset: CropPreset; avatar: string; avatarW: number; avatarH: number; thumb: string };

/** First portrait for a character (after Generate / Convert, or from older saved art). */
export function createPortraits(version: PortraitVersion, avatar: AvatarInput): CharacterPortraits {
  const generated = version.kind === "generated" || version.kind === "converted" || version.kind === "legacy";
  return {
    v: PORTRAITS_VERSION,
    originalReferenceImage: version.reference ?? null,
    generatedPixelPortrait: generated ? version.id : null,
    editedPixelPortrait: version.kind === "edited" ? version.id : null,
    activePortraitVersion: version.id,
    versions: [version],
    avatarCropRect: avatar.rect,
    avatarCropPreset: avatar.preset,
    avatarSourceVersion: version.id,
    portraitAvatar: avatar.avatar,
    avatarW: avatar.avatarW,
    avatarH: avatar.avatarH,
    portraitThumbnail: avatar.thumb,
  };
}

/**
 * Add a version. A new generated / converted image becomes the new
 * immutable original (the old one stays in the list, still restorable).
 * The oldest unprotected versions drop off past MAX_VERSIONS.
 */
export function addVersion(p: CharacterPortraits, v: PortraitVersion, makeActive = true): CharacterPortraits {
  const original = v.kind === "generated" || v.kind === "converted";
  let next: CharacterPortraits = {
    ...p,
    versions: [...p.versions, v],
    ...(original ? { generatedPixelPortrait: v.id, originalReferenceImage: v.reference ?? p.originalReferenceImage } : {}),
    ...(v.kind === "edited" ? { editedPixelPortrait: v.id } : {}),
    ...(makeActive ? { activePortraitVersion: v.id } : {}),
  };
  while (next.versions.length > MAX_VERSIONS) {
    const drop = next.versions.find((x) => !isProtected(next, x.id) && x.id !== v.id);
    if (!drop) break;
    next = { ...next, versions: next.versions.filter((x) => x.id !== drop.id) };
  }
  if (next.editedPixelPortrait && !versionById(next, next.editedPixelPortrait)) next = { ...next, editedPixelPortrait: [...next.versions].reverse().find((x) => x.kind === "edited")?.id ?? null };
  return next;
}

/** Replace the pixels of the active edited version in place ("Save changes"). Generated originals are never changed: editing one adds a version. */
export function saveChanges(p: CharacterPortraits, edited: Omit<PortraitVersion, "id" | "kind" | "parentId">, newId: string): CharacterPortraits {
  const cur = activeVersion(p);
  if (cur.kind === "edited" && cur.id !== p.avatarSourceVersion) {
    return { ...p, editedPixelPortrait: cur.id, versions: p.versions.map((v) => (v.id === cur.id ? { ...v, ...edited } : v)) };
  }
  return addVersion(p, { ...edited, id: newId, kind: "edited", parentId: cur.id });
}

export function setActiveVersion(p: CharacterPortraits, id: string): CharacterPortraits {
  return versionById(p, id) ? { ...p, activePortraitVersion: id } : p;
}

export function restoreGenerated(p: CharacterPortraits): CharacterPortraits {
  return p.generatedPixelPortrait ? setActiveVersion(p, p.generatedPixelPortrait) : p;
}

export function deleteVersion(p: CharacterPortraits, id: string): CharacterPortraits {
  if (isProtected(p, id) || p.versions.length <= 1) return p;
  const versions = p.versions.filter((v) => v.id !== id);
  return { ...p, versions, editedPixelPortrait: p.editedPixelPortrait === id ? ([...versions].reverse().find((x) => x.kind === "edited")?.id ?? null) : p.editedPixelPortrait };
}

export function withAvatar(p: CharacterPortraits, sourceId: string, a: AvatarInput): CharacterPortraits {
  return { ...p, avatarSourceVersion: sourceId, avatarCropRect: a.rect, avatarCropPreset: a.preset, portraitAvatar: a.avatar, avatarW: a.avatarW, avatarH: a.avatarH, portraitThumbnail: a.thumb };
}

/** Drop the reference copy (privacy): the pixel versions stay. */
export function forgetReference(p: CharacterPortraits): CharacterPortraits {
  return { ...p, originalReferenceImage: null, versions: p.versions.map((v) => (v.reference ? { ...v, reference: null } : v)) };
}

// ---------------------------------------------------------------- validation

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRect = (r: unknown): r is CropRect => !!r && typeof r === "object" && ["x", "y", "w", "h"].every((k) => num((r as Record<string, unknown>)[k]));

/** Keep a stored portrait set only if it is complete; never "repair" by inventing images. */
export function normalizePortraits(raw: unknown): CharacterPortraits | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.versions)) return null;
  const versions = (r.versions as unknown[]).filter(
    (v): v is PortraitVersion => !!v && typeof v === "object" && str((v as PortraitVersion).id) && str((v as PortraitVersion).image) && num((v as PortraitVersion).w) && num((v as PortraitVersion).h),
  );
  if (!versions.length || !str(r.portraitAvatar) || !isRect(r.avatarCropRect)) return null;
  const has = (id: unknown) => typeof id === "string" && versions.some((v) => v.id === id);
  const active = has(r.activePortraitVersion) ? (r.activePortraitVersion as string) : versions[versions.length - 1].id;
  return {
    v: PORTRAITS_VERSION,
    originalReferenceImage: str(r.originalReferenceImage) ? r.originalReferenceImage : null,
    generatedPixelPortrait: has(r.generatedPixelPortrait) ? (r.generatedPixelPortrait as string) : null,
    editedPixelPortrait: has(r.editedPixelPortrait) ? (r.editedPixelPortrait as string) : null,
    activePortraitVersion: active,
    versions,
    avatarCropRect: r.avatarCropRect as CropRect,
    avatarCropPreset: (CROP_PRESETS as readonly unknown[]).includes(r.avatarCropPreset) ? (r.avatarCropPreset as CropPreset) : "custom",
    avatarSourceVersion: has(r.avatarSourceVersion) ? (r.avatarSourceVersion as string) : active,
    portraitAvatar: r.portraitAvatar as string,
    avatarW: num(r.avatarW) ? r.avatarW : AVATAR_TARGET,
    avatarH: num(r.avatarH) ? r.avatarH : AVATAR_TARGET,
    portraitThumbnail: str(r.portraitThumbnail) ? r.portraitThumbnail : (r.portraitAvatar as string),
  };
}
