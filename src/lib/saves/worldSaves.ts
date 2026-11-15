"use client";

/**
 * WORLD SAVES — browser side
 * --------------------------------------------------------------------------
 * Keeps the list of world saves, knows which world this tab is playing
 * (activeWorldId), and provides the store gameStore.ts uses for the active
 * world's data. Storage layout and migration: see format.ts.
 *
 * Rules that keep worlds apart:
 * - Each world's data is its own storage entry; the game only ever reads and
 *   writes the active one. There is no shared, all-worlds character list.
 * - Entering a different world reloads the page, so nothing from the previous
 *   world survives in memory: no half-finished AI reply, no stage or
 *   conversation state, no cached map list, no stale character references.
 * - Every save is written immediately, so there is never anything pending
 *   when the player switches.
 */
import { useSyncExternalStore } from "react";
import { makeId } from "../id";
import { INDEX_KEY, LEGACY_SAVE_KEY, SESSION_ACTIVE_KEY, WORLD_KEY_PREFIX, cleanWorldName, emptyIndex, openIndex, summarize, worldKey, type KV, type SaveIndex, type WorldSave } from "./format";
import { characterIdMap, remapIds } from "./remap";
import { copyWorldMaps, deleteWorldMaps, removeMapCopies } from "./worldMaps";
import { copyWorldKeepsakes, deleteWorldKeepsakes } from "../keepsakes/store";

export type { WorldSave, SaveIndex } from "./format";

export class WorldSaveError extends Error {
  constructor(public code: "not_found" | "unreadable" | "storage_full") {
    super(code);
  }
}

const SERVER_INDEX = emptyIndex();
let index: SaveIndex | null = null;
/** This tab's world. undefined = not worked out yet. */
let current: string | null | undefined;
/** Set while the page is leaving for another world: late writes from the old world are dropped. */
let leaving = false;

const listeners = new Set<() => void>();
const invalidators = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const local = (): KV | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};
const session = (): KV | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export function getIndex(): SaveIndex {
  if (index) return index;
  const kv = local();
  if (!kv) return SERVER_INDEX;
  const opened = openIndex(kv, Date.now(), () => makeId("world"));
  index = opened.index;
  if (opened.changed) persistIndex(index);
  return index;
}

function persistIndex(next: SaveIndex) {
  try {
    local()?.setItem(INDEX_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: keep it in memory for this visit */
  }
}

function writeIndex(next: SaveIndex) {
  index = next;
  persistIndex(next);
  emit();
}

const findWorld = (id: string | null | undefined) => (id ? (getIndex().worlds.find((w) => w.id === id) ?? null) : null);
const legacyOwner = () => getIndex().migration?.worldId ?? null;

/** The world this tab is playing, or null. */
export function activeWorldId(): string | null {
  if (typeof window === "undefined") return null;
  if (current !== undefined) {
    if (current !== null && !findWorld(current)) {
      // Deleted in another tab: stop saving here rather than write into some other world.
      current = null;
      leaving = true;
    }
    return current;
  }
  const idx = getIndex();
  let id: string | null = null;
  try {
    id = session()?.getItem(SESSION_ACTIVE_KEY) ?? null;
  } catch {}
  if (!findWorld(id)) id = findWorld(idx.activeWorldId) ? idx.activeWorldId : null;
  current = id;
  return id;
}

function setCurrent(id: string | null) {
  current = id;
  try {
    if (id) session()?.setItem(SESSION_ACTIVE_KEY, id);
    else session()?.removeItem(SESSION_ACTIVE_KEY);
  } catch {}
  invalidators.forEach((f) => f());
}

let listening = false;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    // Another tab changed something: re-read what changed.
    window.addEventListener("storage", (e) => {
      if (e.key === INDEX_KEY || e.key === null) index = null;
      const mine = findWorld(activeWorldId());
      if (e.key === null || (mine && e.key === mine.storageKey)) invalidators.forEach((f) => f());
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useWorldIndex(): SaveIndex {
  return useSyncExternalStore(subscribe, getIndex, () => SERVER_INDEX);
}

export function useActiveWorld(): WorldSave | null {
  const idx = useWorldIndex();
  const id = useSyncExternalStore(subscribe, activeWorldId, () => null);
  return idx.worlds.find((w) => w.id === id) ?? null;
}

/** Raw data of any world (for cards and duplicates), or null. Never changes anything. */
export function peekWorld(id: string): unknown {
  const w = findWorld(id);
  if (!w) return null;
  try {
    const raw = local()?.getItem(w.storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the active world's data

/**
 * Store for the ACTIVE world's data (used by gameStore.ts). Same interface as
 * createPersistentStore, but the storage entry is the active world's. Saving
 * with no world yet (e.g. picking a theme straight away) creates one.
 */
export function createActiveWorldStore<T extends object>(defaults: T, normalize: (raw: unknown) => T) {
  let cache: { id: string | null; data: T } | null = null;
  invalidators.add(() => (cache = null));

  const read = (): T => {
    if (typeof window === "undefined") return defaults;
    const id = activeWorldId();
    if (cache && cache.id === id) return cache.data;
    let data = defaults;
    const w = findWorld(id);
    if (w) {
      try {
        const raw = local()?.getItem(w.storageKey);
        data = raw ? normalize(JSON.parse(raw)) : defaults;
      } catch {
        data = defaults;
      }
    }
    cache = { id, data };
    return data;
  };

  const set = (update: T | ((prev: T) => T)) => {
    if (leaving) return;
    let id = activeWorldId();
    if (!id) {
      id = createWorld().id;
      setCurrent(id);
    }
    const w = findWorld(id);
    if (!w) return;
    const next = typeof update === "function" ? (update as (p: T) => T)(read()) : update;
    cache = { id, data: next };
    try {
      local()?.setItem(w.storageKey, JSON.stringify(next));
    } catch {
      /* storage full or blocked: keep in memory */
    }
    const now = Date.now();
    const idx = getIndex();
    writeIndex({ ...idx, activeWorldId: id, worlds: idx.worlds.map((x) => (x.id === id ? { ...x, ...summarize(next), updatedAt: now, lastPlayedAt: now } : x)) });
  };

  const useStore = () => useSyncExternalStore(subscribe, read, () => defaults);
  return { useStore, set, get: read };
}

// ---------------------------------------------------------------- managing worlds

/** A new, empty world save (not entered yet). */
export function createWorld(): WorldSave {
  const idx = getIndex();
  const now = Date.now();
  const id = makeId("world");
  const w: WorldSave = {
    id,
    name: "",
    theme: null,
    number: idx.nextNumber,
    createdAt: now,
    lastPlayedAt: now,
    updatedAt: now,
    characterCount: 0,
    envType: "interior",
    mapId: null,
    storageKey: worldKey(id),
  };
  writeIndex({ ...idx, nextNumber: idx.nextNumber + 1, worlds: [...idx.worlds, w] });
  return w;
}

/**
 * Play a world. Returns true when the caller can simply navigate (it is
 * already this tab's world); otherwise the page is reloaded at `href` so the
 * previous world leaves nothing behind in memory.
 */
export function enterWorld(id: string, href: string): boolean {
  const w = findWorld(id);
  if (!w) return false;
  const same = activeWorldId() === id;
  const idx = getIndex();
  try {
    session()?.setItem(SESSION_ACTIVE_KEY, id);
  } catch {}
  writeIndex({ ...idx, activeWorldId: id, worlds: idx.worlds.map((x) => (x.id === id ? { ...x, lastPlayedAt: Date.now() } : x)) });
  if (same) return true;
  leaving = true;
  window.location.assign(href);
  return false;
}

/** Rename a world. Only the name changes: id, theme, characters and progress are untouched. */
export function renameWorld(id: string, name: string): boolean {
  const clean = cleanWorldName(name);
  const idx = getIndex();
  if (!clean || !idx.worlds.some((w) => w.id === id)) return false;
  writeIndex({ ...idx, worlds: idx.worlds.map((w) => (w.id === id ? { ...w, name: clean } : w)) });
  return true;
}

/**
 * Copy a world into a new, independent save: new world id, new character
 * ids, copies of its maps, and every reference inside rewritten to the new
 * ids. Later changes to either world never reach the other.
 */
export async function duplicateWorld(id: string, name: string): Promise<WorldSave> {
  const src = findWorld(id);
  if (!src) throw new WorldSaveError("not_found");
  const kv = local();
  let raw: string | null = null;
  try {
    raw = kv?.getItem(src.storageKey) ?? null;
  } catch {}
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new WorldSaveError("unreadable");
    }
  }
  const newId = makeId("world");
  const mapIds = await copyWorldMaps(id, newId, legacyOwner()).catch(() => new Map<string, string>());
  const charIds = characterIdMap(parsed, () => makeId("char"));
  // Photos and gifts follow the copied characters (new ids), independent of the original's;
  // memories in the copy are pointed at the copied photos.
  const keepIds = await copyWorldKeepsakes(id, newId, charIds).catch(() => new Map<string, string>());
  const ids = new Map([...charIds, ...mapIds, ...keepIds]);
  const data = parsed ? remapIds(parsed, ids) : null;
  const key = worldKey(newId);
  if (data) {
    try {
      kv?.setItem(key, JSON.stringify(data));
    } catch {
      await removeMapCopies(mapIds.values());
      await deleteWorldKeepsakes(newId).catch(() => {});
      throw new WorldSaveError("storage_full");
    }
  }
  const now = Date.now();
  const idx = getIndex(); // re-read: it may have changed while maps were copied
  const from = idx.worlds.find((w) => w.id === id) ?? src;
  const copy: WorldSave = {
    ...from,
    ...summarize(data),
    id: newId,
    name: cleanWorldName(name),
    number: idx.nextNumber,
    createdAt: now,
    lastPlayedAt: now,
    updatedAt: now,
    storageKey: key,
    copiedFrom: id,
  };
  const at = idx.worlds.findIndex((w) => w.id === id);
  const worlds = [...idx.worlds];
  worlds.splice(at < 0 ? worlds.length : at + 1, 0, copy);
  writeIndex({ ...idx, nextNumber: idx.nextNumber + 1, worlds });
  return copy;
}

/**
 * Delete one world save: its entry, its data and the maps only it uses.
 * Other worlds, the original pre-v1.2 backup and any map another save still
 * uses are never touched. Deleting the world this tab is playing reloads the
 * page so none of it stays in memory.
 */
export async function deleteWorld(id: string): Promise<void> {
  const w = findWorld(id);
  if (!w) return;
  const wasCurrent = activeWorldId() === id;
  const idx = getIndex();
  const rest = idx.worlds.filter((x) => x.id !== id);
  writeIndex({ ...idx, worlds: rest, activeWorldId: idx.activeWorldId === id ? null : idx.activeWorldId });
  if (w.storageKey !== LEGACY_SAVE_KEY) {
    try {
      local()?.removeItem(w.storageKey);
    } catch {}
  }
  if (wasCurrent) {
    leaving = true;
    setCurrent(null);
  }
  const stillUsed = new Set<string>();
  for (const x of rest) {
    const m = summarize(peekWorld(x.id)).mapId;
    if (m) stillUsed.add(m);
  }
  try {
    const legacy = local()?.getItem(LEGACY_SAVE_KEY);
    const m = legacy ? summarize(JSON.parse(legacy)).mapId : null;
    if (m) stillUsed.add(m);
  } catch {}
  await deleteWorldMaps(id, legacyOwner(), stillUsed).catch(() => {});
  await deleteWorldKeepsakes(id).catch(() => {});
  if (wasCurrent) window.location.reload();
}

export function markMigrationNoticeSeen() {
  const idx = getIndex();
  if (idx.migration && !idx.migration.noticeSeen) writeIndex({ ...idx, migration: { ...idx.migration, noticeSeen: true } });
}

/** "Erase all data" in Settings: every world save and the old single save. */
export function eraseAllWorlds() {
  const kv = local();
  const idx = getIndex();
  const keys = new Set<string>([LEGACY_SAVE_KEY, ...idx.worlds.map((w) => w.storageKey)]);
  try {
    for (let i = 0; kv && typeof kv.length === "number" && kv.key && i < kv.length; i++) {
      const k = kv.key(i);
      if (k?.startsWith(WORLD_KEY_PREFIX)) keys.add(k);
    }
    keys.forEach((k) => kv?.removeItem(k));
  } catch {}
  const empty = emptyIndex();
  empty.migration = { from: 1, at: Date.now(), status: "empty", worldId: null, backupKey: LEGACY_SAVE_KEY, verified: true, noticeSeen: true };
  setCurrent(null);
  writeIndex(empty);
}

/** Tests only: forget everything cached in memory, as if the page had reloaded. */
export function __resetForTests() {
  index = null;
  current = undefined;
  leaving = false;
  invalidators.forEach((f) => f());
}
