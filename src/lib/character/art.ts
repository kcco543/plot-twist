import { getCharacterArt, type ArtAsset } from "@/assets/manifest";
import type { Character } from "../types";

/** The art a character shows everywhere: their custom sprite if they have one, else the placeholder they picked. */
export function artFor(c: Pick<Character, "portrait" | "art">): { portrait: ArtAsset; sprite: ArtAsset; custom: boolean } {
  if (c.art) {
    return {
      portrait: { src: c.art.portrait, width: 96, height: 96, placeholder: false },
      sprite: { src: c.art.sprite, width: 32, height: 32, placeholder: false },
      custom: true,
    };
  }
  return { ...getCharacterArt(c.portrait), custom: false };
}
