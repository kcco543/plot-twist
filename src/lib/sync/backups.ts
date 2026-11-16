"use client";

/**
 * LOCAL BACKUPS — full copies of world saves, kept in this browser
 * --------------------------------------------------------------------------
 * Taken automatically before anything replaces or removes a world on this
 * device (a newer version from the cloud, a world deleted on another device,
 * "use the other device's version") and before adding this device's worlds
 * to an account. Each backup is a complete bundle with its images, so it can
 * be downloaded as an export file or restored as a copy at any time.
 *
 * Stored in IndexedDB ("plot-twist-backups"), in memory if that's blocked.
 * The newest BACKUPS_PER_WORLD per world are kept.
 */
import { makeId } from "../id";
import type { WorldBundle } from "./bundle";
import { readLocalBundle } from "./local";

export const BACKUPS_PER_WORLD = 8;

export type BackupReason = "before-cloud-import" | "before-cloud-update" | "before-remote-delete" | "before-use-cloud" | "before-import-file" | "manual";

export type Backup = {
  id: string;
  worldId: string;
  name: string;
  reason: BackupReason;
  at: number;
  owner?: string;
  bundle: WorldBundle;
  blobs: Record<string, Blob>;
};

export type BackupSummary = Omit<Backup, "bundle" | "blobs"> & { characters: number; maps: number };

const DB = "plot-twist-backups";
const STORE = "backups";
let memory: Backup[] = [];
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
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

async function all(): Promise<Backup[]> {
  const db = await open();
  if (!db) return [...memory];
  const stored = ((await run<Backup[]>(db, "readonly", (s) => s.getAll()).catch(() => [])) ?? []) as Backup[];
  const ids = new Set(stored.map((b) => b.id));
  return [...stored, ...memory.filter((b) => !ids.has(b.id))];
}

/** Back up one world as it is on this device now. Returns null if the world doesn't exist. Never throws. */
export async function backupWorld(worldId: string, reason: BackupReason, owner?: string): Promise<Backup | null> {
  try {
    const local = await readLocalBundle(worldId);
    if (!local) return null;
    const b: Backup = {
      id: makeId("backup"),
      worldId,
      name: local.bundle.meta.name,
      reason,
      at: Date.now(),
      ...(owner ? { owner } : {}),
      bundle: local.bundle,
      blobs: Object.fromEntries(local.blobs),
    };
    const db = await open();
    let stored = false;
    if (db) {
      try {
        await run(db, "readwrite", (s) => s.put(b));
        stored = true;
      } catch {}
    }
    if (!stored) memory = [b, ...memory];
    await prune(worldId);
    return b;
  } catch {
    return null;
  }
}

async function prune(worldId: string) {
  const mine = (await all()).filter((b) => b.worldId === worldId).sort((a, c) => c.at - a.at);
  const drop = mine.slice(BACKUPS_PER_WORLD).map((b) => b.id);
  if (!drop.length) return;
  memory = memory.filter((b) => !drop.includes(b.id));
  const db = await open();
  if (db) await run(db, "readwrite", (s) => void drop.forEach((id) => s.delete(id))).catch(() => {});
}

/** Backups this tab may show: the device's own and those of the signed-in account. Newest first. */
export async function listBackups(accountId: string | null): Promise<BackupSummary[]> {
  return (await all())
    .filter((b) => !b.owner || b.owner === accountId)
    .sort((a, c) => c.at - a.at)
    .map(({ bundle, blobs: _b, ...rest }) => {
      void _b;
      const chars = (bundle.data as { characters?: unknown[] } | null)?.characters;
      return { ...rest, characters: Array.isArray(chars) ? chars.length : 0, maps: bundle.maps.length };
    });
}

export async function getBackup(id: string): Promise<Backup | null> {
  return (await all()).find((b) => b.id === id) ?? null;
}

export function __resetBackupsForTests() {
  memory = [];
  dbPromise = null;
}
