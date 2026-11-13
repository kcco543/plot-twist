/**
 * MAP GENERATION — integration point
 * --------------------------------------------------------------------------
 * The World Builder only talks to the `MapGenerator` interface below.
 * Today it uses `placeholderGenerator`, which returns hand-made placeholder
 * art for the chosen environment type. Later, an AI-backed generator can
 * implement the same interface (e.g. call an API route with the description)
 * and be swapped in via `activeMapGenerator` without touching the UI.
 */
import { environmentArt, type ArtAsset } from "@/assets/manifest";
import { getEnvironmentType } from "./environments";
import { getWorld } from "./worlds";
import type { EnvironmentTypeId, WorldId } from "./types";

export type MapRequest = {
  worldId: WorldId | null;
  type: EnvironmentTypeId;
  description: string;
};

export type MapPreview = {
  art: ArtAsset;
  title: string;
  /** Where the preview came from, shown to the user. */
  source: "placeholder" | "generated";
};

export interface MapGenerator {
  generate(request: MapRequest): Promise<MapPreview>;
}

export const placeholderGenerator: MapGenerator = {
  async generate({ worldId, type }) {
    const world = getWorld(worldId);
    const env = getEnvironmentType(type);
    return {
      art: environmentArt[type],
      title: world ? `${world.name} · ${env.name}` : env.name,
      source: "placeholder",
    };
  },
};

export const activeMapGenerator: MapGenerator = placeholderGenerator;
