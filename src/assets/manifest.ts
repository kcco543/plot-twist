/**
 * ASSET MANIFEST
 * --------------------------------------------------------------------------
 * Every piece of game art the app shows is listed here, and nowhere else.
 * The files live in /public/assets. To use your own illustrations, either:
 *   1. Overwrite a file in /public/assets with yours (same filename), or
 *   2. Drop a new file in /public/assets and change its path below.
 * Then set `placeholder: false` so the "PLACEHOLDER" tag disappears.
 * PNG, GIF, WEBP and SVG all work. Pixel art is scaled with crisp edges.
 */
import type { EnvironmentTypeId, WorldId } from "@/lib/types";

export type ArtAsset = {
  src: string;
  /** Native pixel size of the art; used for aspect ratio. */
  width: number;
  height: number;
  placeholder: boolean;
};

export const titleArt: ArtAsset = {
  src: "/assets/ui/title-background.svg",
  width: 128,
  height: 72,
  placeholder: true,
};

export const worldArt: Record<WorldId, ArtAsset> = {
  "western-fantasy": { src: "/assets/worlds/western-fantasy.svg", width: 64, height: 40, placeholder: true },
  modern: { src: "/assets/worlds/modern.svg", width: 64, height: 40, placeholder: true },
  "ancient-china": { src: "/assets/worlds/ancient-china.svg", width: 64, height: 40, placeholder: true },
  otherworld: { src: "/assets/worlds/otherworld.svg", width: 64, height: 40, placeholder: true },
};

export const environmentArt: Record<EnvironmentTypeId, ArtAsset> = {
  interior: { src: "/assets/environments/interior.svg", width: 64, height: 40, placeholder: true },
  street: { src: "/assets/environments/street.svg", width: 64, height: 40, placeholder: true },
  wilderness: { src: "/assets/environments/wilderness.svg", width: 64, height: 40, placeholder: true },
  ruins: { src: "/assets/environments/ruins.svg", width: 64, height: 40, placeholder: true },
  dreamscape: { src: "/assets/environments/dreamscape.svg", width: 64, height: 40, placeholder: true },
};

/** Portrait + in-game sprite pairs. A character stores the index it uses. */
export const characterArt: { portrait: ArtAsset; sprite: ArtAsset }[] = [1, 2, 3, 4, 5, 6].map((n) => {
  const id = String(n).padStart(2, "0");
  return {
    portrait: { src: `/assets/characters/portrait-${id}.svg`, width: 32, height: 32, placeholder: true },
    sprite: { src: `/assets/characters/sprite-${id}.svg`, width: 16, height: 24, placeholder: true },
  };
});

export function getCharacterArt(index: number) {
  const len = characterArt.length;
  return characterArt[((index % len) + len) % len];
}
