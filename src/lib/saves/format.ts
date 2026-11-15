/**
 * WORLD SAVES — storage format and migration (pure: no React, no window)
 * --------------------------------------------------------------------------
 * Up to v0.4 the whole game lived in ONE localStorage entry
 * ("plot-twist:save:v1"). From save format v2 every world is its own save:
 *
 *   plot-twist:worlds:v2          the index: list of worlds + last played
 *   plot-twist:world:v2:<id>      one world's data (same shape as the old
 *                                  save: characters, relationships, memories,
 *                                  story log, environment / map reference…)
 *   plot-twist:save:v1            the old single save. NEVER written or
 *                                  removed by the migration: it stays as the
 *                                  backup of the original data.
 *
 * Generated map images live in IndexedDB (src/lib/mapLibrary.ts); each map
 * records which world owns it (see worldMaps.ts).
 *
 * Migrations are versioned: `openIndex()` brings any older layout up to
 * SAVE_FORMAT_VERSION once, and records what it did in `index.migration`.
 */
import type { EnvironmentTypeId, WorldId } from "../types";

export const SAVE_FORMAT_VERSION = 2;
export const LEGACY_SAVE_KEY = "plot-twist:save:v1";
export const INDEX_KEY = "plot-twist:worlds:v2";
export const WORLD_KEY_PREFIX = "plot-twist:world:v2:";
/** Per browser tab: which world this tab is playing (two tabs can play two worlds). */
export const SESSION_ACTIVE_KEY = "plot-twist:active-world";
export const WORLD_NAME_MAX = 40;

export const worldKey = (id: string) => `${WORLD_KEY_PREFIX}${id}`;

/** One world save as listed in the index. The world's own data lives under `storageKey`. */
export type WorldSave = {
  /** Unique and never changes (rename, play, duplicate all keep it). */
  id: string;
  /** Player-chosen name. Empty = automatic name from the theme ("Otherworld 2"). */
  name: string;
  /** The world theme (Western Fantasy, Modern…). Mirrors the world data. */
  theme: WorldId | null;
  /** Running number used for automatic names. */
  number: number;
  createdAt: number;
  lastPlayedAt: number;
  updatedAt: number;
  /** Card summary, refreshed on every save. */
  characterCount: number;
  envType: EnvironmentTypeId;
  mapId: string | null;
  /** Normally worldKey(id). The migrated world uses the old key only if the browser had no room for a copy. */
  storageKey: string;
  /** Set on duplicates. */
  copiedFrom?: string;
};

export type MigrationRecord = {
  from: 1;
  at: number;
  /**
   * migrated  = the old save was copied into a world and the copy checked byte for byte
   * in-place  = no room for a copy: the world reads and writes the old save directly
   * empty     = there was no old save
   * unreadable = the old save could not be read; it was left untouched
   */
  status: "migrated" | "in-place" | "empty" | "unreadable";
  worldId: string | null;
  /** Where the untouched original lives. */
  backupKey: string;
  verified: boolean;
  /** The player has seen the "your save was moved" note. */
  noticeSeen?: boolean;
};

export type SaveIndex = {
  version: typeof SAVE_FORMAT_VERSION;
  /** The world played last (new tabs open it). */
  activeWorldId: string | null;
  nextNumber: number;
  worlds: WorldSave[];
  migration: MigrationRecord | null;
};

/** Minimal Storage (localStorage, or a Map-backed fake in tests). */
export type KV = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(i: number): string | null;
};

export const emptyIndex = (): SaveIndex => ({ version: SAVE_FORMAT_VERSION, activeWorldId: null, nextNumber: 1, worlds: [], migration: null });

const ENV_TYPES: EnvironmentTypeId[] = ["interior", "street", "wilderness", "ruins", "dreamscape"];
const THEMES: WorldId[] = ["western-fantasy", "modern", "ancient-china", "otherworld"];
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Card summary read leniently from raw world data (old or partial saves included). */
export function summarize(raw: unknown): Pick<WorldSave, "theme" | "characterCount" | "envType" | "mapId"> {
  const r = obj(raw);
  const env = obj(r.environment);
  return {
    theme: THEMES.includes(r.worldId as WorldId) ? (r.worldId as WorldId) : null,
    characterCount: Array.isArray(r.characters) ? r.characters.length : 0,
    envType: ENV_TYPES.includes(env.type as EnvironmentTypeId) ? (env.type as EnvironmentTypeId) : "interior",
    mapId: typeof env.mapId === "string" ? env.mapId : null,
  };
}

/** Trim, collapse spaces, cap length (by characters, so Chinese and emoji are never cut in half). */
export function cleanWorldName(name: string): string {
  const s = name.replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, WORLD_NAME_MAX).join("");
}

function sanitizeWorld(raw: unknown, now: number): WorldSave | null {
  const r = obj(raw);
  if (typeof r.id !== "string" || !r.id) return null;
  const created = num(r.createdAt, now);
  return {
    id: r.id,
    name: typeof r.name === "string" ? cleanWorldName(r.name) : "",
    theme: THEMES.includes(r.theme as WorldId) ? (r.theme as WorldId) : null,
    number: Math.max(1, Math.round(num(r.number, 1))),
    createdAt: created,
    lastPlayedAt: num(r.lastPlayedAt, created),
    updatedAt: num(r.updatedAt, created),
    characterCount: Math.max(0, Math.round(num(r.characterCount, 0))),
    envType: ENV_TYPES.includes(r.envType as EnvironmentTypeId) ? (r.envType as EnvironmentTypeId) : "interior",
    mapId: typeof r.mapId === "string" ? r.mapId : null,
    storageKey: typeof r.storageKey === "string" && r.storageKey ? r.storageKey : worldKey(r.id),
    ...(typeof r.copiedFrom === "string" ? { copiedFrom: r.copiedFrom } : {}),
  };
}

/** Repair a stored index without dropping any world it lists. */
export function sanitizeIndex(raw: unknown, now: number): SaveIndex {
  const r = obj(raw);
  const seen = new Set<string>();
  const worlds = (Array.isArray(r.worlds) ? r.worlds : []).map((w) => sanitizeWorld(w, now)).filter((w): w is WorldSave => w !== null && !seen.has(w.id) && Boolean(seen.add(w.id)));
  const active = typeof r.activeWorldId === "string" && seen.has(r.activeWorldId) ? r.activeWorldId : null;
  const m = obj(r.migration);
  const migration: MigrationRecord | null =
    m.from === 1
      ? {
          from: 1,
          at: num(m.at, now),
          status: (["migrated", "in-place", "empty", "unreadable"] as const).includes(m.status as MigrationRecord["status"]) ? (m.status as MigrationRecord["status"]) : "migrated",
          worldId: typeof m.worldId === "string" ? m.worldId : null,
          backupKey: typeof m.backupKey === "string" ? m.backupKey : LEGACY_SAVE_KEY,
          verified: m.verified === true,
          ...(m.noticeSeen === true ? { noticeSeen: true } : {}),
        }
      : null;
  const highest = worlds.reduce((n, w) => Math.max(n, w.number), 0);
  return { version: SAVE_FORMAT_VERSION, activeWorldId: active, nextNumber: Math.max(num(r.nextNumber, 1), highest + 1), worlds, migration };
}

function oldestCharacter(raw: unknown): number | null {
  const chars = obj(raw).characters;
  if (!Array.isArray(chars)) return null;
  const times = chars.map((c) => obj(c).createdAt).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  return times.length ? Math.min(...times) : null;
}

/**
 * v1 → v2: copy the single old save into the first world save.
 * The old entry is only READ. The copy is written as the exact same text and
 * read back to verify it; if the browser has no room for the copy, the world
 * uses the old entry directly instead (nothing is lost either way).
 */
export function migrateV1(kv: KV, now: number, newId: () => string): SaveIndex {
  const index = emptyIndex();
  let raw: string | null = null;
  try {
    raw = kv.getItem(LEGACY_SAVE_KEY);
  } catch {
    raw = null;
  }
  const record = (status: MigrationRecord["status"], worldId: string | null, verified: boolean): MigrationRecord => ({ from: 1, at: now, status, worldId, backupKey: LEGACY_SAVE_KEY, verified });

  if (raw === null) {
    index.migration = record("empty", null, true);
    return index;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a save");
  } catch {
    // Keep the unreadable save exactly as it is; start with no worlds.
    index.migration = record("unreadable", null, false);
    return index;
  }

  const id = newId();
  const key = worldKey(id);
  let storageKey = key;
  let verified = false;
  try {
    kv.setItem(key, raw);
    verified = kv.getItem(key) === raw;
  } catch {
    verified = false;
  }
  if (!verified) {
    try {
      kv.removeItem(key);
    } catch {}
    storageKey = LEGACY_SAVE_KEY;
  }
  const updated = num(obj(parsed).updatedAt, now);
  const created = Math.min(oldestCharacter(parsed) ?? updated, updated);
  index.worlds.push({ id, name: "", number: 1, createdAt: created, lastPlayedAt: updated, updatedAt: updated, storageKey, ...summarize(parsed) });
  index.nextNumber = 2;
  index.activeWorldId = id;
  index.migration = record(verified ? "migrated" : "in-place", id, true);
  return index;
}

/** World saves found in storage that the index does not list (used to rebuild a damaged index). */
function orphanWorlds(kv: KV, known: Set<string>, now: number, startNumber: number): WorldSave[] {
  const out: WorldSave[] = [];
  if (typeof kv.length !== "number" || !kv.key) return out;
  for (let i = 0; i < kv.length; i++) {
    const k = kv.key(i);
    if (!k || !k.startsWith(WORLD_KEY_PREFIX)) continue;
    const id = k.slice(WORLD_KEY_PREFIX.length);
    if (known.has(id)) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(kv.getItem(k) ?? "null");
    } catch {}
    const t = num(obj(parsed).updatedAt, now);
    out.push({ id, name: "", number: startNumber + out.length, createdAt: t, lastPlayedAt: t, updatedAt: t, storageKey: k, ...summarize(parsed) });
  }
  return out;
}

/**
 * Read the index, migrating older layouts once. Returns the index and whether
 * it needs writing back. Never deletes or overwrites any world or the old save.
 */
export function openIndex(kv: KV, now: number, newId: () => string): { index: SaveIndex; changed: boolean } {
  let stored: string | null = null;
  try {
    stored = kv.getItem(INDEX_KEY);
  } catch {
    return { index: emptyIndex(), changed: false };
  }
  if (stored === null) return { index: sanitizeIndex(migrateV1(kv, now, newId), now), changed: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") {
    // Damaged index: keep the damaged text aside, rebuild the list from the world saves themselves.
    try {
      kv.setItem(`${INDEX_KEY}:damaged:${now}`, stored);
    } catch {}
    const index = emptyIndex();
    index.migration = { from: 1, at: now, status: "migrated", worldId: null, backupKey: LEGACY_SAVE_KEY, verified: true, noticeSeen: true };
    index.worlds = orphanWorlds(kv, new Set(), now, 1);
    index.nextNumber = index.worlds.length + 1;
    return { index, changed: true };
  }
  const index = sanitizeIndex(parsed, now);
  return { index, changed: JSON.stringify(index) !== stored };
}

/** Display name: the player's name, or the automatic one. */
export function displayWorldName(w: Pick<WorldSave, "name" | "number" | "theme">, themeName: (theme: WorldId) => string, auto: (theme: string | null, n: number) => string) {
  return w.name || auto(w.theme ? themeName(w.theme) : null, w.number);
}
