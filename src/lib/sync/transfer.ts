"use client";

/**
 * EXPORT SAVE / IMPORT SAVE — move or back up worlds without the cloud
 * --------------------------------------------------------------------------
 * An export file (.plottwist.json) holds whole worlds: their data, maps with
 * play-area layouts, photos and gifts, with every image inline. Importing
 * never replaces a world that is already here: a world that isn't here is
 * added as it was (same id, so cloud sync recognises it), an identical one
 * is skipped, and a different version of one that is here is added next to
 * it as a separate copy.
 */
import { makeId } from "../id";
import { remapIds } from "../saves/remap";
import { blobToDataUrl, bundleAssets, contentHash, dataUrlToBlob, isExportFile, validateBundle, type ExportFile, type WorldBundle } from "./bundle";
import { localWorld, readLocalBundle, writeLocalBundle } from "./local";
import { sha256Blob } from "./sha256";

export async function buildExport(ids: string[]): Promise<ExportFile> {
  const worlds: WorldBundle[] = [];
  const assets: Record<string, string> = {};
  for (const id of ids) {
    const local = await readLocalBundle(id);
    if (!local) continue;
    worlds.push(local.bundle);
    for (const [hash, blob] of local.blobs) assets[hash] ??= await blobToDataUrl(blob);
  }
  return { format: "plot-twist-export", v: 1, app: "PLOT TWIST!", exportedAt: Date.now(), worlds, assets };
}

/** Same as buildExport, from bundles + images already in hand (backups). */
export async function exportFromBundles(items: { bundle: WorldBundle; blobs: Record<string, Blob> }[]): Promise<ExportFile> {
  const assets: Record<string, string> = {};
  for (const it of items) for (const [h, b] of Object.entries(it.blobs)) assets[h] ??= await blobToDataUrl(b);
  return { format: "plot-twist-export", v: 1, app: "PLOT TWIST!", exportedAt: Date.now(), worlds: items.map((i) => i.bundle), assets };
}

export function exportFileName(name: string, at = new Date()) {
  const safe = Array.from(name.trim() || "world").join("").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 40) || "world";
  return `plot-twist-${safe}-${at.toISOString().slice(0, 10)}.plottwist.json`;
}

/** Hand the player the file to save. */
export function downloadExport(file: ExportFile, filename: string) {
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A copy of a bundle with its own world, map and keepsake ids (characters keep theirs: they live inside the world). */
export function copyBundle(b: WorldBundle, name: string): WorldBundle {
  const ids = new Map<string, string>();
  ids.set(b.id, makeId("world"));
  for (const m of b.maps) ids.set(m.id, makeId("map"));
  for (const k of b.keepsakes) ids.set(k.id, makeId(k.kind));
  // Assets (hashes) never match ids, so remapping leaves them alone.
  const copy = remapIds({ ...b, meta: { ...b.meta } }, ids);
  return { ...copy, meta: { ...copy.meta, name, copiedFrom: b.id } };
}

export type ImportResult = { name: string; status: "added" | "copied" | "same" | "invalid"; id?: string };

/** Read an export file's text. Throws Error("not-a-save") if it isn't one. */
export async function parseExport(text: string): Promise<{ worlds: WorldBundle[]; blobs: Map<string, Blob>; invalid: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not-a-save");
  }
  if (!isExportFile(raw)) throw new Error("not-a-save");
  const blobs = new Map<string, Blob>();
  for (const [hash, url] of Object.entries(raw.assets)) {
    if (typeof url !== "string") continue;
    const blob = dataUrlToBlob(url);
    // Only images whose bytes match their name are used.
    if (blob && (await sha256Blob(blob)) === hash) blobs.set(hash, blob);
  }
  const worlds: WorldBundle[] = [];
  let invalid = 0;
  for (const w of raw.worlds) {
    const v = validateBundle(w);
    if (v.ok && bundleAssets(v.bundle).every((a) => blobs.has(a.hash))) worlds.push(v.bundle);
    else invalid++;
  }
  return { worlds, blobs, invalid };
}

/**
 * Add the worlds from an export file (or a backup) to this device. Never
 * overwrites: see the top of this file. `owner` = the signed-in account, so
 * imported worlds are saved to it too.
 */
export async function importBundles(worlds: WorldBundle[], blobs: ReadonlyMap<string, Blob>, owner: string | undefined, copyName: (name: string) => string): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const b of worlds) {
    const here = localWorld(b.id);
    if (!here) {
      const saved = await writeLocalBundle(b, blobs, owner);
      out.push({ name: b.meta.name, status: "added", id: saved.id });
      continue;
    }
    const mine = await readLocalBundle(b.id);
    if (mine && mine.hash === (await contentHash(b))) {
      out.push({ name: b.meta.name, status: "same", id: b.id });
      continue;
    }
    const copy = copyBundle(b, copyName(b.meta.name));
    const saved = await writeLocalBundle(copy, blobs, owner);
    out.push({ name: copy.meta.name, status: "copied", id: saved.id });
  }
  return out;
}
