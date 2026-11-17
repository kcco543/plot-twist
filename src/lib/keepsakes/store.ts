/**
 * Keepsake storage. Photos are too big for the localStorage world save, so
 * photos and gifts live in the browser's IndexedDB, one record each, tagged
 * with the world save they belong to. If IndexedDB is unavailable (some
 * private windows, tests) they are kept in memory for this visit.
 *
 * World lifecycle hooks (called from saves/worldSaves.ts):
 *   copyWorldKeepsakes   — duplicating a world copies its keepsakes, with character ids remapped
 *   deleteWorldKeepsakes — deleting a world deletes only that world's keepsakes
 *   clearAllKeepsakes    — Settings → Erase all data
 */
import { makeId } from "../id";
import type { GiftKeepsake, Keepsake, PhotoKeepsake } from "./types";

const DB = "plot-twist-keepsakes";
const STORE = "items";

let memory: Keepsake[] = [];
let dbPromise: Promise<IDBDatabase | null> | null = null;
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

/** Re-render hook support: bumps whenever a keepsake is added, changed or removed. */
export function subscribeKeepsakes(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
export const keepsakeVersion = () => version;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("worldId", "worldId");
      };
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

async function all(): Promise<Keepsake[]> {
  const db = await open();
  if (!db) return [...memory];
  const stored = ((await run<Keepsake[]>(db, "readonly", (s) => s.getAll()).catch(() => [])) ?? []) as Keepsake[];
  const ids = new Set(stored.map((k) => k.id));
  return [...stored, ...memory.filter((k) => !ids.has(k.id))];
}

async function put(items: Keepsake[]): Promise<void> {
  if (!items.length) return;
  const db = await open();
  const keep = () => {
    const ids = new Set(items.map((k) => k.id));
    memory = [...items, ...memory.filter((k) => !ids.has(k.id))];
  };
  if (!db) return keep();
  try {
    await run(db, "readwrite", (s) => void items.forEach((k) => s.put(k)));
  } catch {
    keep(); // quota or blocked: keep it for this visit
  }
}

async function remove(ids: string[]): Promise<void> {
  if (!ids.length) return;
  memory = memory.filter((k) => !ids.includes(k.id));
  const db = await open();
  if (db) await run(db, "readwrite", (s) => void ids.forEach((id) => s.delete(id))).catch(() => {});
}

const newest = <T extends { createdAt: number }>(a: T, b: T) => b.createdAt - a.createdAt;

// ---------------------------------------------------------------- photos

export async function savePhoto(input: Omit<PhotoKeepsake, "kind" | "id" | "createdAt">): Promise<PhotoKeepsake> {
  if (!input.worldId || !input.characterId) throw new Error("A photo needs a world and a character");
  const photo: PhotoKeepsake = { ...input, caption: input.caption.trim(), kind: "photo", id: makeId("photo"), createdAt: Date.now() };
  await put([photo]);
  changed();
  return photo;
}

/** One photo, only if it belongs to this world (photos are never read across world saves). */
export async function getPhoto(worldId: string, id: string): Promise<PhotoKeepsake | null> {
  const k = (await all()).find((x) => x.id === id);
  return k && k.kind === "photo" && k.worldId === worldId ? k : null;
}

/** Delete a photo file (only from its own world). Memories that linked it are updated by the caller. */
export async function deletePhoto(worldId: string, id: string): Promise<boolean> {
  const k = await getPhoto(worldId, id);
  if (!k) return false;
  await remove([id]);
  changed();
  return true;
}

/**
 * Remove this world's photos that no memory links any more (a memory forgotten
 * or pushed out by newer ones). Photos saved in the last `graceMs` are left
 * alone, so a photo whose memory is still being written isn't lost.
 */
export async function prunePhotos(worldId: string, linked: Set<string>, graceMs = 60_000, now = Date.now()): Promise<number> {
  const drop = (await all()).filter((k) => k.kind === "photo" && k.worldId === worldId && !linked.has(k.id) && now - k.createdAt > graceMs).map((k) => k.id);
  await remove(drop);
  if (drop.length) changed();
  return drop.length;
}

/** Photos saved in one world (optionally only for one character), newest first. */
export async function listPhotos(worldId: string, characterId?: string): Promise<PhotoKeepsake[]> {
  return (await all()).filter((k): k is PhotoKeepsake => k.kind === "photo" && k.worldId === worldId && (!characterId || k.characterId === characterId)).sort(newest);
}

// ---------------------------------------------------------------- gifts

export type GiftDraft = Pick<GiftKeepsake, "name" | "description" | "image" | "art"> & { id?: string };

/** Save (or update) a gift in this world's gift box. */
export async function saveGift(worldId: string, draft: GiftDraft): Promise<GiftKeepsake> {
  if (!worldId) throw new Error("A gift needs a world");
  const now = Date.now();
  const existing = draft.id ? (await all()).find((k): k is GiftKeepsake => k.kind === "gift" && k.id === draft.id && k.worldId === worldId) : undefined;
  const gift: GiftKeepsake = {
    kind: "gift",
    id: existing?.id ?? makeId("gift"),
    worldId,
    name: draft.name.trim(),
    description: draft.description.trim(),
    image: draft.image,
    art: draft.image ? draft.art : null,
    givenTo: existing?.givenTo ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await put([gift]);
  changed();
  return gift;
}

/** Record in the gift box that a saved gift was given to a character (in the gift's own world). */
export async function recordGiving(worldId: string, giftId: string, characterId: string): Promise<GiftKeepsake> {
  const gift = (await all()).find((k): k is GiftKeepsake => k.kind === "gift" && k.id === giftId);
  if (!gift || gift.worldId !== worldId) throw new Error("Gift not found in this world");
  const next: GiftKeepsake = { ...gift, givenTo: [...gift.givenTo, { characterId, at: Date.now() }], updatedAt: Date.now() };
  await put([next]);
  changed();
  return next;
}

export async function listGifts(worldId: string): Promise<GiftKeepsake[]> {
  return (await all()).filter((k): k is GiftKeepsake => k.kind === "gift" && k.worldId === worldId).sort(newest);
}

// ---------------------------------------------------------------- world lifecycle

/**
 * Duplicate a world's keepsakes into its copy. `ids` maps old character ids
 * to the copy's new ones. Returns old → new keepsake ids, so the copied
 * world's memories can be pointed at the copies (never at the original's).
 */
export async function copyWorldKeepsakes(fromId: string, toId: string, ids: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const mine = (await all()).filter((k) => k.worldId === fromId);
  const map = new Map<string, string>();
  const copies: Keepsake[] = mine.map((k) => {
    const id = makeId(k.kind);
    map.set(k.id, id);
    return k.kind === "photo"
      ? { ...k, id, worldId: toId, characterId: ids.get(k.characterId) ?? k.characterId }
      : { ...k, id, worldId: toId, givenTo: k.givenTo.map((g) => ({ ...g, characterId: ids.get(g.characterId) ?? g.characterId })) };
  });
  await put(copies);
  if (copies.length) changed();
  return map;
}

export async function deleteWorldKeepsakes(worldId: string): Promise<void> {
  const drop = (await all()).filter((k) => k.worldId === worldId).map((k) => k.id);
  await remove(drop);
  if (drop.length) changed();
}

export async function clearAllKeepsakes(): Promise<void> {
  memory = [];
  const db = await open();
  if (db) await run(db, "readwrite", (s) => s.clear()).catch(() => {});
  changed();
}

export function __resetKeepsakesForTests() {
  memory = [];
  dbPromise = null;
}

// ---------------------------------------------------------------- cloud sync, import and backups (src/lib/sync/)

/** Every photo and gift of one world, as stored. */
export async function listWorldKeepsakes(worldId: string): Promise<Keepsake[]> {
  return (await all()).filter((k) => k.worldId === worldId);
}

/** Store keepsakes exactly as given (they already carry their world id). */
export async function putKeepsakes(items: Keepsake[]): Promise<void> {
  await put(items);
  if (items.length) changed();
}

export async function removeKeepsakes(ids: string[]): Promise<void> {
  await remove(ids);
  if (ids.length) changed();
}
