/**
 * MAP GENERATION — integration point
 * --------------------------------------------------------------------------
 * The World Builder only talks to the `MapGenerator` interface below.
 * Today `placeholderGenerator` returns hand-made placeholder art for the
 * chosen world + environment type. An AI-backed generator can implement the
 * same interface later (e.g. POST the description to an API route) and be
 * swapped in via `activeMapGenerator`. `locale` is passed so generated text
 * (room names, captions) comes back in the player's language.
 */
import { defaultWorld, environmentArt, type ArtAsset } from "@/assets/manifest";
import type { Locale } from "@/i18n";
import type { EnvironmentTypeId, WorldId } from "./types";

export type MapRequest = {
  worldId: WorldId | null;
  type: EnvironmentTypeId;
  description: string;
  locale: Locale;
};

export type MapPreview = {
  art: ArtAsset;
  /** Where the preview came from, shown to the user. */
  source: "placeholder" | "generated";
};

export interface MapGenerator {
  generate(request: MapRequest): Promise<MapPreview>;
}

export const placeholderGenerator: MapGenerator = {
  async generate({ worldId, type }) {
    return { art: environmentArt[worldId ?? defaultWorld][type], source: "placeholder" };
  },
};

export const activeMapGenerator: MapGenerator = placeholderGenerator;
