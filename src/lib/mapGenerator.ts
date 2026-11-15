"use client";

/**
 * MAP GENERATION — browser side
 * --------------------------------------------------------------------------
 * The World Builder's "Generate Map" button calls `generateMap()`. It sends
 * the description, environment type and world to /api/ai/map (the server
 * adds the fixed art style and calls the image service), stores the result
 * in the map library (IndexedDB) and makes it the map in use.
 *
 * The job lives here, not in the page, so a map that is still being drawn
 * is kept even if the player leaves the page, and a second click while one
 * is running does nothing. Until a map exists, the built-in placeholder art
 * for the world + environment type is shown.
 */
import { useSyncExternalStore } from "react";
import { defaultWorld, environmentArt, type ArtAsset } from "@/assets/manifest";
import { AiRequestError, requestMap, type AiErrorCode } from "./ai/client";
import { gameActions, getSave } from "./gameStore";
import { makeId } from "./id";
import { MAP_HISTORY_LIMIT, clearAllMaps, deleteMaps, listMaps, putMap, type StoredMap } from "./mapLibrary";
import type { EnvironmentTypeId, WorldId } from "./types";
import { activeWorldId, getIndex } from "./saves/worldSaves";
import { mapOwner, tagMap, type OwnedMap } from "./saves/worldMaps";

/** Only the active world's maps (each world save keeps its own map history). */
const inActiveWorld = (m: OwnedMap) => mapOwner(m, getIndex().migration?.worldId ?? null) === activeWorldId() || m.id === getSave().environment.mapId;

export type GeneratedMap = Omit<StoredMap, "blob"> & { url: string; ext: "png" | "webp" };

export type MapRequest = { worldId: WorldId | null; type: EnvironmentTypeId; description: string };

type MapStudioState = {
  /** Newest first. Empty until loaded. */
  maps: GeneratedMap[];
  loaded: boolean;
  working: MapRequest | null;
  error: AiErrorCode | null;
};

let state: MapStudioState = { maps: [], loaded: false, working: null, error: null };
const listeners = new Set<() => void>();
const SERVER_STATE: MapStudioState = state;
const urls = new Map<string, string>();

function set(patch: Partial<MapStudioState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const toGenerated = ({ blob, ...m }: StoredMap): GeneratedMap => {
  let url = urls.get(m.id);
  if (!url) urls.set(m.id, (url = URL.createObjectURL(blob)));
  return { ...m, url, ext: blob.type === "image/png" ? "png" : "webp" };
};

function release(ids: string[]) {
  for (const id of ids) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
  }
}

let loading: Promise<void> | null = null;
function load() {
  loading ??= listMaps()
    .then((maps) => set({ maps: maps.filter(inActiveWorld).map(toGenerated), loaded: true }))
    .catch(() => set({ loaded: true }));
  return loading;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  void load();
  return () => listeners.delete(l);
};

export function useMapStudio(): MapStudioState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** The map the World Builder shows, or null for the built-in art. */
export function currentMap(maps: GeneratedMap[], mapId: string | null | undefined) {
  return (mapId && maps.find((m) => m.id === mapId)) || null;
}

/** Built-in art for a world + environment type (shown before anything is generated). */
export function placeholderArt(worldId: WorldId | null, type: EnvironmentTypeId): ArtAsset {
  return environmentArt[worldId ?? defaultWorld][type];
}

/** True when the inputs no longer match the map's, so "Generate" would give something new. */
export function mapIsOutdated(map: GeneratedMap, req: MapRequest) {
  return map.description.trim() !== req.description.trim() || map.type !== req.type || map.worldId !== req.worldId;
}

async function decode(dataUrl: string): Promise<{ blob: Blob; width: number; height: number }> {
  const blob = await (await fetch(dataUrl)).blob();
  try {
    const bmp = await createImageBitmap(blob);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return { blob, ...size };
  } catch {
    throw new AiRequestError("invalid_output", "The image could not be read");
  }
}

/** Start drawing a map. Ignored while another one is in progress. */
export async function generateMap(req: MapRequest): Promise<void> {
  if (state.working || !req.description.trim()) return;
  set({ working: req, error: null });
  try {
    const out = await requestMap({ description: req.description.trim(), type: req.type, world: req.worldId });
    const { blob, width, height } = await decode(out.image);
    const stored: StoredMap = { id: makeId("map"), blob, width, height, description: req.description.trim(), type: req.type, worldId: req.worldId, model: out.model, createdAt: Date.now() };
    tagMap(stored, activeWorldId());
    await load();
    await putMap(stored);
    const all = [toGenerated(stored), ...state.maps];
    const dropped = all.slice(MAP_HISTORY_LIMIT).filter((m) => m.id !== getSave().environment.mapId);
    if (dropped.length) {
      await deleteMaps(dropped.map((m) => m.id));
      release(dropped.map((m) => m.id));
    }
    set({ maps: all.filter((m) => !dropped.includes(m)), working: null });
    gameActions.updateEnvironment({ mapId: stored.id });
  } catch (e) {
    set({ working: null, error: e instanceof AiRequestError ? e.code : "failed" });
  }
}

export function selectMap(id: string | null) {
  gameActions.updateEnvironment({ mapId: id });
}

export async function removeMap(id: string) {
  await deleteMaps([id]);
  release([id]);
  set({ maps: state.maps.filter((m) => m.id !== id) });
  if (getSave().environment.mapId === id) gameActions.updateEnvironment({ mapId: state.maps[0]?.id ?? null });
}

export function dismissMapError() {
  set({ error: null });
}

/** Part of "Erase all data". */
export async function eraseMaps() {
  await clearAllMaps();
  release([...urls.keys()]);
  set({ maps: [], error: null });
}
