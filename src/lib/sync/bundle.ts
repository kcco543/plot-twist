/**
 * WORLD BUNDLES — one world save as a single, self-describing value
 * --------------------------------------------------------------------------
 * A bundle holds everything that makes up a world: the world's entry in My
 * Worlds (name, theme…), its data (characters, personalities, relationships,
 * memories, story log and progress, scenes, UI skin…), its generated maps
 * with their play-area / object layouts, and its photos and gifts.
 *
 * Images are not inlined: each one is an AssetRef naming the SHA-256 of its
 * bytes. Cloud saves store the images once each under that hash (so a file
 * never changes after upload and can always be checked on download); export
 * files carry them inline as data URLs.
 *
 * Pure: no window, no storage. Used by cloud sync, export/import and backups.
 */
import type { GiftKeepsake, PhotoKeepsake } from "../keepsakes/types";
import type { StoredMap } from "../mapLibrary";
import type { WorldSave } from "../saves/format";
import { sha256Text } from "./sha256";

export const BUNDLE_FORMAT = "plot-twist-world";
export const BUNDLE_VERSION = 1;
export const EXPORT_FORMAT = "plot-twist-export";
export const EXPORT_VERSION = 1;

export type AssetRef = { hash: string; type: string; size: number };

export type BundleMap = Omit<StoredMap, "blob"> & { asset: AssetRef };
export type BundlePhoto = Omit<PhotoKeepsake, "blob" | "worldId"> & { asset: AssetRef };
export type BundleGift = Omit<GiftKeepsake, "worldId">;
export type BundleKeepsake = BundlePhoto | BundleGift;

export type BundleMeta = Pick<WorldSave, "name" | "theme" | "number" | "createdAt" | "lastPlayedAt" | "updatedAt"> & { copiedFrom?: string };

export type WorldBundle = {
  format: typeof BUNDLE_FORMAT;
  v: typeof BUNDLE_VERSION;
  /** The world save's id: the same on every device. */
  id: string;
  meta: BundleMeta;
  /** The world's own save data (gameStore SaveData), or null for a world that was never saved into. */
  data: Record<string, unknown> | null;
  maps: BundleMap[];
  keepsakes: BundleKeepsake[];
};

/** A file made by Export Save (one or many worlds, images inline). */
export type ExportFile = {
  format: typeof EXPORT_FORMAT;
  v: typeof EXPORT_VERSION;
  app: "PLOT TWIST!";
  exportedAt: number;
  worlds: WorldBundle[];
  /** hash → data URL */
  assets: Record<string, string>;
};

export const WORLD_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const HASH_RE = /^[0-9a-f]{64}$/;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** JSON with object keys sorted, so equal content always gives equal text. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** Put maps and keepsakes in a stable order (by id). */
export function normalizeBundle(b: WorldBundle): WorldBundle {
  const byId = <T extends { id: string }>(a: T, c: T) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0);
  return { ...b, maps: [...b.maps].sort(byId), keepsakes: [...b.keepsakes].sort(byId) };
}

/**
 * Fingerprint of what the player made. Leaves out when the world was last
 * opened and its automatic number (both differ per device and are not
 * progress), so opening a world on two devices is never a "conflict".
 */
export async function contentHash(b: WorldBundle): Promise<string> {
  const n = normalizeBundle(b);
  return sha256Text(canonicalJson({ id: n.id, name: n.meta.name, theme: n.meta.theme, copiedFrom: n.meta.copiedFrom ?? null, data: n.data, maps: n.maps, keepsakes: n.keepsakes }));
}

/** Every image a bundle needs. */
export function bundleAssets(b: WorldBundle): AssetRef[] {
  const seen = new Map<string, AssetRef>();
  for (const m of b.maps) seen.set(m.asset.hash, m.asset);
  for (const k of b.keepsakes) if (k.kind === "photo") seen.set(k.asset.hash, k.asset);
  return [...seen.values()];
}

function validAsset(a: unknown): a is AssetRef {
  return isObj(a) && typeof a.hash === "string" && HASH_RE.test(a.hash) && typeof a.type === "string" && IMAGE_TYPES.includes(a.type) && isNum(a.size) && a.size >= 0;
}

/**
 * Check a bundle that came from outside (cloud, file). Returns the bundle or
 * a reason. Anything that does not look exactly like a world is refused, so
 * it can never be written over a real save.
 */
export function validateBundle(raw: unknown): { ok: true; bundle: WorldBundle } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: "not an object" };
  if (raw.format !== BUNDLE_FORMAT) return { ok: false, reason: "not a world" };
  if (raw.v !== BUNDLE_VERSION) return { ok: false, reason: "unsupported version" };
  if (typeof raw.id !== "string" || !WORLD_ID_RE.test(raw.id)) return { ok: false, reason: "bad id" };
  const meta = raw.meta;
  if (!isObj(meta) || typeof meta.name !== "string" || !isNum(meta.createdAt) || !isNum(meta.updatedAt)) return { ok: false, reason: "bad meta" };
  if (raw.data !== null && !isObj(raw.data)) return { ok: false, reason: "bad data" };
  if (isObj(raw.data) && raw.data.characters !== undefined && !Array.isArray(raw.data.characters)) return { ok: false, reason: "bad characters" };
  if (!Array.isArray(raw.maps) || !Array.isArray(raw.keepsakes)) return { ok: false, reason: "bad lists" };
  for (const m of raw.maps) if (!isObj(m) || typeof m.id !== "string" || !m.id || !validAsset(m.asset)) return { ok: false, reason: "bad map" };
  for (const k of raw.keepsakes) {
    if (!isObj(k) || typeof k.id !== "string" || !k.id) return { ok: false, reason: "bad keepsake" };
    if (k.kind === "photo" ? !validAsset(k.asset) || typeof k.characterId !== "string" : k.kind !== "gift") return { ok: false, reason: "bad keepsake" };
  }
  return { ok: true, bundle: raw as unknown as WorldBundle };
}

export const extFor = (type: string) => (type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png");

// ---------------------------------------------------------------- data URLs (export files)

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + "=";
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2] ?? "A") & 63) << 6) | (B64.indexOf(clean[i + 3] ?? "A") & 63);
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length && i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (o < out.length && i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

export async function blobToDataUrl(b: Blob): Promise<string> {
  return `data:${b.type || "application/octet-stream"};base64,${bytesToBase64(new Uint8Array(await b.arrayBuffer()))}`;
}

export function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (!m) return null;
  return new Blob([base64ToBytes(m[2]) as BlobPart], { type: m[1] });
}

export function isExportFile(raw: unknown): raw is ExportFile {
  return isObj(raw) && raw.format === EXPORT_FORMAT && Array.isArray(raw.worlds) && isObj(raw.assets);
}
