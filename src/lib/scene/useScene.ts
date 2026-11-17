"use client";

/**
 * THE SCENE PLAY MODE SHOWS — one place decides it.
 * --------------------------------------------------------------------------
 * The single source of truth is the active world save's `environment.mapId`
 * (set in World Builder when a map is generated or picked, cleared by "Use
 * built-in picture"). Each world save has its own, so different saves can
 * use different maps, and it survives reloads because the save is written to
 * localStorage and the image itself to IndexedDB (mapLibrary.ts).
 *
 *   mapId set + map found   → the generated picture, with its play area
 *   mapId set + not found   → built-in room, with a notice (the reference is
 *                             kept, so nothing is reset behind the player's back)
 *   no mapId                → the built-in room for the world + place type
 *   map library still loading → "loading", so Play never flashes the wrong room
 */
import { useMemo } from "react";
import { environmentArt, type ArtAsset } from "@/assets/manifest";
import { currentMap, useMapStudio, type GeneratedMap } from "../mapGenerator";
import { roomFor, type RoomLayout } from "../stage/room";
import type { EnvironmentTypeId, WorldId } from "../types";
import { isNativeSize } from "../pixelArt/mapPixels";
import { buildScene, nameFromDescription, readLayout, type BuiltScene, type SceneLayout } from "./layout";

export type ActiveScene =
  | { kind: "loading"; key: string; place: EnvironmentTypeId }
  | {
      kind: "builtin";
      key: string;
      place: EnvironmentTypeId;
      art: ArtAsset;
      room: RoomLayout;
      /** The save points at a map that is no longer in this browser. */
      missingMapId: string | null;
    }
  | {
      kind: "map";
      key: string;
      place: EnvironmentTypeId;
      art: ArtAsset;
      room: RoomLayout;
      map: GeneratedMap;
      name: string;
      layout: SceneLayout;
      built: BuiltScene;
    };

export const mapDisplayName = (m: Pick<GeneratedMap, "name" | "description">) => m.name?.trim() || nameFromDescription(m.description);

export function sceneForMap(map: GeneratedMap): Extract<ActiveScene, { kind: "map" }> {
  const layout = readLayout(map.scene, map.width, map.height);
  const built = buildScene(layout, map.width, map.height, map.type);
  return {
    kind: "map",
    key: `map:${map.id}`,
    place: map.type,
    art: { src: map.url, width: built.size.width, height: built.size.height, placeholder: false, smooth: !isNativeSize(map.width) },
    room: built.room,
    map,
    name: mapDisplayName(map),
    layout,
    built,
  };
}

export function useActiveScene(worldId: WorldId | null, envType: EnvironmentTypeId, mapId: string | null | undefined): ActiveScene {
  const studio = useMapStudio();
  const w = worldId ?? "otherworld";
  const map = mapId ? currentMap(studio.maps, mapId) : null;
  return useMemo<ActiveScene>(() => {
    if (map) return sceneForMap(map);
    if (mapId && !studio.loaded) return { kind: "loading", key: `loading:${mapId}`, place: envType };
    return { kind: "builtin", key: `${w}:${envType}`, place: envType, art: environmentArt[w][envType], room: roomFor(w, envType), missingMapId: mapId ?? null };
  }, [map, mapId, studio.loaded, w, envType]);
}
