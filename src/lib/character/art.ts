import { getCharacterArt, type ArtAsset } from "@/assets/manifest";
import type { Character } from "../types";

/** The art a character shows everywhere: their custom sprite if they have one, else the placeholder they picked. */
export function artFor(c: Pick<Character, "portrait" | "art" | "portraits">): { portrait: ArtAsset; sprite: ArtAsset; custom: boolean; thumbnail?: ArtAsset } {
  // The player's own avatar crop wins wherever a portrait is shown (sidebar, cards, dialogue).
  if (c.portraits) {
    const p = c.portraits;
    const base = c.art ? { src: c.art.sprite, width: 32, height: 32, placeholder: false } : getCharacterArt(c.portrait).sprite;
    return {
      portrait: { src: p.portraitAvatar, width: p.avatarW, height: p.avatarH, placeholder: false },
      sprite: base,
      thumbnail: { src: p.portraitThumbnail, width: p.avatarW, height: p.avatarH, placeholder: false },
      custom: true,
    };
  }
  if (c.art) {
    return {
      portrait: { src: c.art.portrait, width: 96, height: 96, placeholder: false },
      sprite: { src: c.art.sprite, width: 32, height: 32, placeholder: false },
      custom: true,
    };
  }
  return { ...getCharacterArt(c.portrait), custom: false };
}
