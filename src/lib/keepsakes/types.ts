/**
 * PERSONAL INTERACTIONS — photos and gifts the player shares with a character.
 * --------------------------------------------------------------------------
 * Every keepsake belongs to exactly one world save (`worldId` = the save's id,
 * from activeWorldId()) and, once shared, to one character in that world.
 * Images are kept in the browser (IndexedDB, see store.ts); nothing is sent
 * anywhere when a photo is shown or a gift is given.
 */

/** A photo the player showed to a character. */
export type PhotoKeepsake = {
  kind: "photo";
  id: string;
  worldId: string;
  characterId: string;
  /** Re-encoded JPEG (max 1280 px, metadata such as location stripped). */
  blob: Blob;
  width: number;
  height: number;
  /** Optional caption / explanation written by the player. */
  caption: string;
  source: "camera" | "upload";
  createdAt: number;
};

/** One time a gift was given. */
export type GiftGiving = { characterId: string; at: number };

/** A gift the player made: saved to the world's gift box, and given to characters. */
export type GiftKeepsake = {
  kind: "gift";
  id: string;
  worldId: string;
  name: string;
  description: string;
  /** 32×32 pixel-art item as a PNG data URL (tiny), or null if not drawn yet. */
  image: string | null;
  /** How the picture was made. "ai" only when a real image model produced it. */
  art: "drawn" | "ai" | null;
  givenTo: GiftGiving[];
  createdAt: number;
  updatedAt: number;
};

export type Keepsake = PhotoKeepsake | GiftKeepsake;

export const GIFT_NAME_MAX = 40;
export const GIFT_DESCRIPTION_MAX = 240;
export const PHOTO_CAPTION_MAX = 200;
/** Gift item size in pixels (same grid as character sprites, so the pixel editor fits it). */
export const GIFT_SIZE = 32;
