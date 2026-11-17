"use client";

/**
 * Generated maps are a few hundred KB each, too big for the localStorage save,
 * so they live in the browser's IndexedDB. The save only remembers which map
 * is in use (environment.mapId). If IndexedDB is unavailable (some private
 * windows), maps are kept in memory for this visit.
 */
import type { EnvironmentTypeId, WorldId } from "./types";

export type StoredMap = {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  /** What it was generated from, so the UI can say when the inputs changed. */
  description: string;
  type: EnvironmentTypeId;
  worldId: WorldId | null;
  model: string;
  createdAt: number;
  /** Set when this version came from editing part of another one (Undo goes back to it). */
  parentId?: string;
  edit?: { instruction: string; region: { x: number; y: number; w: number; h: number } };
  /** Set on a pixel-grid copy of an older high-resolution map (the id it was converted from). */
  pixelGridFrom?: string;
  /** The player's name for this map (missing = made from the description). */
  name?: string;
  /** Where characters can walk on it, its objects and spawn points (scene/layout.ts). Missing = not set up yet. */
  scene?: unknown;
};

const DB = "plot-twist-maps";
const STORE = "maps";
/** Oldest maps beyond this are dropped. */
export const MAP_HISTORY_LIMIT = 24;

let memory: StoredMap[] = [];
const changeListeners = new Set<() => void>();
const changed = () => changeListeners.forEach((l) => l());
/** Called after any map is added, changed or removed (cloud sync watches this). */
export function subscribeMaps(l: () => void) {
  changeListeners.add(l);
  return () => void changeListeners.delete(l);
}
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Newest first. */
export async function listMaps(): Promise<StoredMap[]> {
  const db = await open();
  if (!db) return [...memory];
  const stored = ((await run<StoredMap[]>(db, "readonly", (s) => s.getAll()).catch(() => [])) ?? []) as StoredMap[];
  const ids = new Set(stored.map((m) => m.id));
  return [...stored, ...memory.filter((m) => !ids.has(m.id))].sort((a, b) => b.createdAt - a.createdAt);
}

export async function putMap(map: StoredMap): Promise<void> {
  const db = await open();
  if (!db) {
    memory = [map, ...memory.filter((m) => m.id !== map.id)].slice(0, MAP_HISTORY_LIMIT);
    return changed();
  }
  try {
    await run(db, "readwrite", (s) => s.put(map));
  } catch {
    memory = [map, ...memory.filter((m) => m.id !== map.id)].slice(0, MAP_HISTORY_LIMIT); // quota or blocked: keep it for this visit
  }
  changed();
}

/** Change some fields of a stored map (its name or play-area layout). */
export async function patchMap(id: string, patch: Partial<Omit<StoredMap, "id" | "blob">>): Promise<boolean> {
  const db = await open();
  const inMemory = memory.find((m) => m.id === id);
  if (inMemory) memory = memory.map((m) => (m.id === id ? { ...m, ...patch } : m));
  if (!db) {
    if (inMemory) changed();
    return !!inMemory;
  }
  try {
    const cur = (await run<StoredMap>(db, "readonly", (s) => s.get(id))) as StoredMap | undefined;
    if (!cur) {
      if (inMemory) changed();
      return !!inMemory;
    }
    await run(db, "readwrite", (s) => s.put({ ...cur, ...patch }));
    changed();
    return true;
  } catch {
    return false;
  }
}

export async function deleteMaps(ids: string[]): Promise<void> {
  memory = memory.filter((m) => !ids.includes(m.id));
  const db = await open();
  if (db && ids.length) await run(db, "readwrite", (s) => void ids.forEach((id) => s.delete(id))).catch(() => {});
  if (ids.length) changed();
}

export async function clearAllMaps(): Promise<void> {
  memory = [];
  const db = await open();
  if (db) await run(db, "readwrite", (s) => s.clear()).catch(() => {});
  changed();
}

/** Tests only. */
export function __resetMapsForTests() {
  memory = [];
  dbPromise = null;
}
