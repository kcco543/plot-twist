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
import { AiRequestError, requestGuidedMap, requestMap, requestMapEdit, type AiErrorCode } from "./ai/client";
import { gameActions, getSave } from "./gameStore";
import { makeId } from "./id";
import { MAP_HISTORY_LIMIT, clearAllMaps, deleteMaps, listMaps, patchMap, putMap, type StoredMap } from "./mapLibrary";
import { compositeRegion } from "./mapComposite";
import { regionIsUsable, type Region } from "./mapSelection";
import type { EnvironmentTypeId, WorldId } from "./types";
import { activeWorldId, getIndex } from "./saves/worldSaves";
import { mapOwner, tagMap, type OwnedMap } from "./saves/worldMaps";
import { enlarge, isNativeSize, snapMapToGrid } from "./pixelArt/mapPixels";
import { blobToImg, compositeNative, enlargeForEdit, firstLayout, imgToPng, snapGenerated } from "./pixelArt/mapPixelsBrowser";
import { readLayout } from "./scene/layout";
import { KIT_ID, checkAlignment, generateKitMap, guideFromPlan, kitSupports, type Alignment, type KitReport, type LabelKey } from "./mapgen";
import { currentLocale, translate } from "@/i18n";

/** Only the active world's maps (each world save keeps its own map history). */
const inActiveWorld = (m: OwnedMap) => mapOwner(m, getIndex().migration?.worldId ?? null) === activeWorldId() || m.id === getSave().environment.mapId || sceneMapIds().has(m.id);
/** Maps any scene of the active world uses: never dropped from the history while a scene needs them. */
function sceneMapIds(): Set<string> {
  const ids = new Set<string>();
  for (const s of getSave().scenes?.list ?? []) if (s.mapId) ids.add(s.mapId);
  return ids;
}

export type GeneratedMap = Omit<StoredMap, "blob"> & { url: string; ext: "png" | "webp" };

export type MapRequest = { worldId: WorldId | null; type: EnvironmentTypeId; description: string };

type MapStudioState = {
  /** Newest first. Empty until loaded. */
  maps: GeneratedMap[];
  loaded: boolean;
  working: MapRequest | null;
  error: AiErrorCode | null;
  /** A region edit in progress (see editMapRegion). */
  editing: MapEditJob | null;
  editError: AiErrorCode | null;
};

export type MapEditJob = { mapId: string; region: Region; instruction: string };

let state: MapStudioState = { maps: [], loaded: false, working: null, error: null, editing: null, editError: null };
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

/** Re-read the map list (after cloud sync or an import replaced this world's maps). */
export function reloadMapStudio() {
  loading = null;
  if (listeners.size) void load();
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

/**
 * A new picture from the image service → a map on the game's pixel grid
 * (PIXEL_ART_STYLE_GUIDE.md §3) with a first-guess play area from its open
 * ground. If the browser can't do the conversion, the picture is kept as it
 * came (still playable, just not on the grid).
 */
async function toPixelMap(dataUrl: string): Promise<{ blob: Blob; width: number; height: number; scene?: unknown }> {
  const raw = await decode(dataUrl);
  try {
    return await snapGenerated(raw.blob);
  } catch {
    return raw;
  }
}

/**
 * The pixel map kit (lib/mapgen): for the worlds and place types it covers,
 * the map is planned and drawn here, in the browser, with its play area
 * taken from the same plan. Free, instant, and no AI service is involved.
 * Every click gives a new variation of the same description.
 */
async function kitMap(req: MapRequest, nonce?: number): Promise<DrawnMap> {
  const locale = currentLocale();
  const label = (k: LabelKey) => translate(locale, `mapKit.labels.${k}`);
  const { img, scene, report } = generateKitMap({ description: req.description.trim(), type: req.type, nonce: nonce ?? Date.now() % 1_000_000_007, label });
  return { blob: await imgToPng(img), width: img.w, height: img.h, scene, model: `${KIT_ID}#${report.seed}`, report };
}

export type DrawnMap = {
  blob: Blob;
  width: number;
  height: number;
  scene?: unknown;
  model: string;
  report?: KitReport;
  /** Guided art only: the layout block-out that was sent, and how closely the picture kept to it. */
  guided?: { guide: Blob; alignment: Alignment; provider: string };
};

/**
 * GUIDED MAP ART (trial, Map Lab only; PIXEL_ART_STYLE_GUIDE.md §18).
 * Gameplay first: the kit plans the place (floor, obstacles, spawns, objects,
 * exits, occlusion) exactly as for a kit map. Then the image service repaints
 * a flat block-out of that plan, and the result is snapped onto the 480×320
 * pixel grid like every generated map. The play area is the PLAN's, never a
 * guess from the picture; the alignment check reports where they disagree.
 * One image-service call per click.
 */
export async function drawGuidedMap(req: MapRequest, nonce?: number): Promise<DrawnMap> {
  const locale = currentLocale();
  const label = (k: LabelKey) => translate(locale, `mapKit.labels.${k}`);
  const kit = generateKitMap({ description: req.description.trim(), type: req.type, nonce: nonce ?? Date.now() % 1_000_000_007, label });
  const { guide, classes } = guideFromPlan(kit.plan.bp, kit.plan.props);
  const guideBlob = await imgToPng(guide);
  const out = await requestGuidedMap(await imgToPng(enlarge(guide, 1536, 1024)), { description: req.description.trim(), type: req.type, world: req.worldId });
  const art = snapMapToGrid(await blobToImg(await (await fetch(out.image)).blob()), { width: guide.w, height: guide.h });
  const alignment = checkAlignment(art, classes, kit.scene);
  return {
    blob: await imgToPng(art),
    width: art.w,
    height: art.h,
    scene: kit.scene,
    model: `guided/${out.model}#${kit.report.seed}`,
    report: kit.report,
    guided: { guide: guideBlob, alignment, provider: out.provider },
  };
}

/**
 * A new map for a request: the pixel map kit where it applies, otherwise the image service.
 * THE production path: World Builder, new scenes from Play and the Map Lab all call this.
 * `nonce` (kit only) picks the variation; left out, every call is a new one.
 */
export async function drawMap(req: MapRequest, nonce?: number): Promise<DrawnMap> {
  if (kitSupports(req.worldId, req.type)) return kitMap(req, nonce);
  const out = await requestMap({ description: req.description.trim(), type: req.type, world: req.worldId });
  return { ...(await toPixelMap(out.image)), model: out.model };
}

/** Map Lab → "Use this map": store a preview exactly as Generate Map would have, and put it in use. */
export async function adoptMap(req: MapRequest, drawn: DrawnMap): Promise<void> {
  const { blob, width, height, scene, model } = drawn;
  const stored: StoredMap = { id: makeId("map"), blob, width, height, description: req.description.trim(), type: req.type, worldId: req.worldId, model, createdAt: Date.now(), ...(scene ? { scene } : {}) };
  await addMap(stored);
}

/** Store a new version, make it the map in use (unless `activate` is false), and drop the oldest beyond the history limit. */
async function addMap(stored: StoredMap, activate = true) {
  tagMap(stored, activeWorldId()); // each world save keeps its own maps
  await load();
  await putMap(stored);
  const all = [toGenerated(stored), ...state.maps];
  const keep = new Set([stored.id, getSave().environment.mapId, ...sceneMapIds()]);
  const dropped = all.slice(MAP_HISTORY_LIMIT).filter((m) => !keep.has(m.id));
  if (dropped.length) {
    await deleteMaps(dropped.map((m) => m.id));
    release(dropped.map((m) => m.id));
  }
  set({ maps: all.filter((m) => !dropped.includes(m)) });
  if (activate) gameActions.updateEnvironment({ mapId: stored.id });
}

/**
 * Draw the map for a NEW scene (Play → leave the area → Create new scene).
 * Same server route, art style and world theme as World Builder, but the map
 * is only stored, not put in use: the scene picks it up once it exists.
 * Throws an AiRequestError when generation isn't available or fails, so the
 * caller can offer Retry / placeholder / Cancel (never a fake success).
 */
export async function generateSceneMap(req: MapRequest, signal?: AbortSignal): Promise<GeneratedMap> {
  if (!req.description.trim()) throw new AiRequestError("invalid_output", "No description");
  const { blob, width, height, scene, model } = await drawMap(req);
  if (signal?.aborted) throw new AiRequestError("failed", "Cancelled");
  const stored: StoredMap = { id: makeId("map"), blob, width, height, description: req.description.trim(), type: req.type, worldId: req.worldId, model, createdAt: Date.now(), ...(scene ? { scene } : {}) };
  await addMap(stored, false);
  return toGenerated(stored);
}

/** Start drawing a map. Ignored while another one is in progress. */
export async function generateMap(req: MapRequest): Promise<void> {
  if (state.working || !req.description.trim()) return;
  set({ working: req, error: null });
  try {
    const { blob, width, height, scene, model } = await drawMap(req);
    const stored: StoredMap = { id: makeId("map"), blob, width, height, description: req.description.trim(), type: req.type, worldId: req.worldId, model, createdAt: Date.now(), ...(scene ? { scene } : {}) };
    await addMap(stored);
    set({ working: null });
  } catch (e) {
    set({ working: null, error: e instanceof AiRequestError ? e.code : "failed" });
  }
}

/**
 * REGION EDIT — "Edit Selected Area"
 * Sends the map version on screen, the selected rectangle and the instruction
 * to /api/ai/map/edit (the server builds the mask and calls the image
 * service), pastes only the selected area of the result back onto the
 * original (see mapComposite.ts), and saves that as a new version whose
 * parent is the one that was edited, so Undo can go back to it.
 */
export async function editMapRegion(job: MapEditJob): Promise<boolean> {
  if (state.working || state.editing || !job.instruction.trim() || !regionIsUsable(job.region)) return false;
  const source = state.maps.find((m) => m.id === job.mapId);
  if (!source) return false;
  set({ editing: job, editError: null });
  try {
    const original = await (await fetch(source.url)).blob();
    // Maps on the pixel grid are enlarged for the image service, and its answer is snapped back onto the grid.
    const native = isNativeSize(source.width);
    const out = await requestMapEdit(native ? await enlargeForEdit(original, source.width, source.height) : original, {
      instruction: job.instruction.trim(),
      region: job.region,
      description: source.description,
      type: source.type,
      world: source.worldId,
    });
    const edited = await (await fetch(out.image)).blob();
    const { blob, width, height } = await (native ? compositeNative(original, edited, job.region) : compositeRegion(original, edited, job.region)).catch(() => {
      throw new AiRequestError("invalid_output", "The edited image could not be read");
    });
    const stored: StoredMap = {
      id: makeId("map"),
      description: source.description,
      type: source.type,
      worldId: source.worldId,
      blob,
      width,
      height,
      model: out.model,
      createdAt: Date.now(),
      parentId: source.id,
      edit: { instruction: job.instruction.trim(), region: job.region },
      // Same picture with one area repainted: keep its name and play area (the player can adjust it).
      ...(source.name ? { name: source.name } : {}),
      ...(source.scene ? { scene: source.scene } : {}),
    };
    await addMap(stored);
    set({ editing: null });
    return true;
  } catch (e) {
    set({ editing: null, editError: e instanceof AiRequestError ? e.code : "failed" });
    return false;
  }
}

/**
 * PIXEL-GRID COPY — for maps made before the pixel-art style guide.
 * Converts the picture onto the game's pixel grid and saves it as a NEW
 * version (the original is never changed; Undo / the history goes back to
 * it). The play area comes along: objects and start spots are stored as
 * fractions of the picture, so they still line up. A floor the player has
 * reviewed is kept; an unreviewed guess is replaced by a guess from the new
 * picture's open ground. No image service is involved, so it costs nothing.
 */
export async function makePixelGridCopy(mapId: string): Promise<boolean> {
  if (state.working || state.editing) return false;
  const source = state.maps.find((m) => m.id === mapId);
  if (!source || isNativeSize(source.width)) return false;
  try {
    const img = snapMapToGrid(await blobToImg(await (await fetch(source.url)).blob()));
    const blob = await imgToPng(img);
    const guess = firstLayout(img);
    const old = source.scene ? readLayout(source.scene, source.width, source.height) : null;
    const scene = old ? { ...old, stageWidth: guess.stageWidth, floor: old.reviewed && old.cols === guess.cols && old.rows === guess.rows ? old.floor : guess.floor } : guess;
    const stored: StoredMap = {
      id: makeId("map"),
      description: source.description,
      type: source.type,
      worldId: source.worldId,
      blob,
      width: img.w,
      height: img.h,
      model: source.model,
      createdAt: Date.now(),
      parentId: source.id,
      pixelGridFrom: source.id,
      ...(source.name ? { name: source.name } : {}),
      scene,
    };
    await addMap(stored);
    return true;
  } catch {
    return false;
  }
}

/** Save a map's name and/or play area (World Builder → Play area). The change shows everywhere at once. */
export async function updateMapDetails(id: string, patch: { name?: string; scene?: unknown }): Promise<boolean> {
  const ok = await patchMap(id, patch);
  if (ok) set({ maps: state.maps.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  return ok;
}

/** Map library finished loading (Play waits for it before deciding the selected map is missing). */
export function mapsLoaded(): Promise<void> {
  return load();
}

export function dismissMapEditError() {
  set({ editError: null });
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
  set({ maps: [], error: null, editError: null });
}
