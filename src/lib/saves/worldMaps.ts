"use client";

/**
 * Which world owns which generated map. Maps are stored in IndexedDB
 * (mapLibrary.ts); each one made from v1.2 on carries `saveId`. Maps made
 * before world saves existed belong to the world the old save was migrated into.
 */
import { deleteMaps, listMaps, putMap, type StoredMap } from "../mapLibrary";
import { makeId } from "../id";
import { remapIds } from "./remap";

export type OwnedMap = StoredMap & { saveId?: string };

export function mapOwner(m: OwnedMap, legacyOwner: string | null): string | null {
  return m.saveId ?? legacyOwner;
}

/** Tag a new map with the world it is made in. */
export function tagMap(m: StoredMap, worldId: string | null): void {
  if (worldId) (m as OwnedMap).saveId = worldId;
}

/** Copy a world's maps for its duplicate. Returns old → new map ids (the copies are new, independent images). */
export async function copyWorldMaps(fromId: string, toId: string, legacyOwner: string | null): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const maps = ((await listMaps()) as OwnedMap[]).filter((m) => mapOwner(m, legacyOwner) === fromId);
  for (const m of maps) ids.set(m.id, makeId("map"));
  for (const { blob, ...m } of maps) {
    // Links between maps (an edited map's parentId) point at the copies too.
    const copy: OwnedMap = { ...remapIds(m, ids), blob, id: ids.get(m.id)!, saveId: toId };
    await putMap(copy);
  }
  return ids;
}

/** Delete a world's maps, except any map another save still uses. */
export async function deleteWorldMaps(worldId: string, legacyOwner: string | null, stillUsed: Set<string>): Promise<void> {
  const maps = (await listMaps()) as OwnedMap[];
  const drop = maps.filter((m) => mapOwner(m, legacyOwner) === worldId && !stillUsed.has(m.id)).map((m) => m.id);
  if (drop.length) await deleteMaps(drop);
}

export async function removeMapCopies(ids: Iterable<string>): Promise<void> {
  const list = [...ids];
  if (list.length) await deleteMaps(list).catch(() => {});
}
