"use client";

/**
 * This device's side of a world bundle: read a world (localStorage data +
 * IndexedDB maps and keepsakes) into a bundle, and write a bundle back.
 *
 * Writing is ordered so a failure part-way never leaves a world pointing at
 * images it doesn't have: new images are stored first, then the world data
 * and its list entry, and only then images the new version no longer uses
 * are removed.
 */
import { listWorldKeepsakes, putKeepsakes, removeKeepsakes } from "../keepsakes/store";
import type { Keepsake } from "../keepsakes/types";
import { deleteMaps, listMaps, putMap } from "../mapLibrary";
import { reloadMapStudio } from "../mapGenerator";
import { LEGACY_SAVE_KEY, summarize, type WorldSave } from "../saves/format";
import { mapOwner, type OwnedMap } from "../saves/worldMaps";
import { allWorlds, getIndex, putWorldFromSync, readWorldText, removeWorldFromSync } from "../saves/worldSaves";
import { bundleAssets, contentHash, normalizeBundle, type AssetRef, type BundleKeepsake, type BundleMap, type WorldBundle } from "./bundle";
import { sha256Blob } from "./sha256";

export type LocalBundle = { bundle: WorldBundle; hash: string; blobs: Map<string, Blob> };

/** Blob hashes by record id (map and photo images never change once stored). */
const hashCache = new Map<string, string>();
async function assetOf(id: string, blob: Blob): Promise<{ ref: AssetRef; blob: Blob }> {
  const key = `${id}:${blob.size}:${blob.type}`;
  let hash = hashCache.get(key);
  if (!hash) {
    hash = await sha256Blob(blob);
    hashCache.set(key, hash);
  }
  return { ref: { hash, type: blob.type || "image/png", size: blob.size }, blob };
}

function parseData(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const p = JSON.parse(text);
    return p && typeof p === "object" && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

function sceneMapIds(data: Record<string, unknown> | null): Set<string> {
  const ids = new Set<string>();
  const env = data?.environment as { mapId?: unknown } | undefined;
  if (typeof env?.mapId === "string") ids.add(env.mapId);
  const list = (data?.scenes as { list?: unknown } | undefined)?.list;
  if (Array.isArray(list)) for (const s of list) if (s && typeof s.mapId === "string") ids.add(s.mapId);
  return ids;
}

/** The maps that belong to a world: the ones it made, plus any its scenes use. */
async function worldMaps(id: string, data: Record<string, unknown> | null): Promise<OwnedMap[]> {
  const legacy = getIndex().migration?.worldId ?? null;
  const used = sceneMapIds(data);
  return ((await listMaps()) as OwnedMap[]).filter((m) => mapOwner(m, legacy) === id || used.has(m.id));
}

export function localWorld(id: string): WorldSave | null {
  return allWorlds().find((w) => w.id === id) ?? null;
}

/** Read one world into a bundle (null if it doesn't exist here). Never changes anything. */
export async function readLocalBundle(id: string): Promise<LocalBundle | null> {
  const w = localWorld(id);
  if (!w) return null;
  const data = parseData(readWorldText(id));
  const blobs = new Map<string, Blob>();
  const maps: BundleMap[] = [];
  for (const m of await worldMaps(id, data)) {
    const { blob, saveId: _owner, ...rest } = m;
    void _owner;
    const a = await assetOf(m.id, blob);
    blobs.set(a.ref.hash, blob);
    maps.push({ ...rest, asset: a.ref });
  }
  const keepsakes: BundleKeepsake[] = [];
  for (const k of await listWorldKeepsakes(id)) {
    if (k.kind === "photo") {
      const { blob, worldId: _w, ...rest } = k;
      void _w;
      const a = await assetOf(k.id, blob);
      blobs.set(a.ref.hash, blob);
      keepsakes.push({ ...rest, asset: a.ref });
    } else {
      const { worldId: _w, ...rest } = k;
      void _w;
      keepsakes.push(rest);
    }
  }
  const bundle = normalizeBundle({
    format: "plot-twist-world",
    v: 1,
    id,
    meta: { name: w.name, theme: w.theme, number: w.number, createdAt: w.createdAt, lastPlayedAt: w.lastPlayedAt, updatedAt: w.updatedAt, ...(w.copiedFrom ? { copiedFrom: w.copiedFrom } : {}) },
    data,
    maps,
    keepsakes,
  });
  return { bundle, hash: await contentHash(bundle), blobs };
}

export async function localHash(id: string): Promise<string | null> {
  return (await readLocalBundle(id))?.hash ?? null;
}

/**
 * Write a bundle as this device's copy of the world (creating it if needed).
 * `blobs` must hold every image the bundle needs that this device doesn't
 * already have; nothing is changed if one is missing.
 */
export async function writeLocalBundle(bundle: WorldBundle, blobs: ReadonlyMap<string, Blob>, owner: string | undefined): Promise<WorldSave> {
  const id = bundle.id;
  const before = await readLocalBundle(id);
  const have = new Map<string, Blob>(before?.blobs ?? []);
  for (const [h, b] of blobs) have.set(h, b);
  const missing = bundleAssets(bundle).filter((a) => !have.has(a.hash));
  if (missing.length) throw new Error(`missing images: ${missing.length}`);

  // 1. Images and keepsakes of the new version (ids are global: never take over another world's record).
  const others = new Set<string>();
  for (const m of (await listMaps()) as OwnedMap[]) if (m.saveId && m.saveId !== id) others.add(m.id);
  for (const m of bundle.maps) {
    if (others.has(m.id)) continue;
    const { asset, ...rest } = m;
    await putMap({ ...rest, blob: have.get(asset.hash)!, saveId: id } as OwnedMap);
  }
  const keeps: Keepsake[] = bundle.keepsakes.map((k) => {
    if (k.kind === "photo") {
      const { asset, ...rest } = k;
      return { ...rest, worldId: id, blob: have.get(asset.hash)! };
    }
    return { ...k, worldId: id };
  });
  await putKeepsakes(keeps);

  // 2. The world itself.
  const saved = putWorldFromSync(
    {
      id,
      name: bundle.meta.name,
      theme: bundle.meta.theme,
      createdAt: bundle.meta.createdAt,
      lastPlayedAt: Math.max(bundle.meta.lastPlayedAt, localWorld(id)?.lastPlayedAt ?? 0),
      updatedAt: bundle.meta.updatedAt,
      characterCount: 0,
      envType: "interior",
      mapId: null,
      ...(bundle.meta.copiedFrom ? { copiedFrom: bundle.meta.copiedFrom } : {}),
      ...(owner ? { owner } : {}),
    },
    bundle.data,
  );

  // 3. What the new version no longer has.
  if (before) {
    const keepMaps = new Set(bundle.maps.map((m) => m.id));
    const stillUsed = legacyMapIds();
    for (const w of allWorlds()) if (w.id !== id) for (const m of sceneMapIds(parseData(readWorldText(w.id)))) stillUsed.add(m);
    const dropMaps = before.bundle.maps.filter((m) => !keepMaps.has(m.id) && !stillUsed.has(m.id)).map((m) => m.id);
    if (dropMaps.length) await deleteMaps(dropMaps);
    const keepK = new Set(bundle.keepsakes.map((k) => k.id));
    const dropK = before.bundle.keepsakes.filter((k) => !keepK.has(k.id)).map((k) => k.id);
    if (dropK.length) await removeKeepsakes(dropK);
  }
  reloadMapStudio();
  return saved;
}

function legacyMapIds(): Set<string> {
  const out = new Set<string>();
  try {
    const m = summarize(JSON.parse(window.localStorage.getItem(LEGACY_SAVE_KEY) ?? "null")).mapId;
    if (m) out.add(m);
  } catch {}
  return out;
}

/** Remove a world from this device only: its entry, data, maps and keepsakes (never the cloud copy). */
export async function removeLocalWorld(id: string): Promise<void> {
  const before = await readLocalBundle(id);
  removeWorldFromSync(id);
  if (!before) return;
  const stillUsed = legacyMapIds();
  for (const w of allWorlds()) for (const m of sceneMapIds(parseData(readWorldText(w.id)))) stillUsed.add(m);
  const drop = before.bundle.maps.filter((m) => !stillUsed.has(m.id)).map((m) => m.id);
  if (drop.length) await deleteMaps(drop);
  const dropK = before.bundle.keepsakes.map((k) => k.id);
  if (dropK.length) await removeKeepsakes(dropK);
  reloadMapStudio();
}
