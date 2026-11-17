"use client";

/**
 * CLOUD SYNC ENGINE — keeps this device's worlds and the account's cloud
 * copies the same, without ever silently losing a version
 * --------------------------------------------------------------------------
 * For each world the device remembers the cloud version it last matched
 * (`rev`) and the fingerprint of the world at that moment (`hash`). Then:
 *
 *   changed here only           → upload (refused by the cloud if it moved on)
 *   changed in the cloud only   → back up this device's copy, then download
 *   changed in both places      → CONFLICT: nothing is overwritten; the player
 *                                  picks keep both / this device / the cloud
 *   in the cloud, not here      → download it
 *   deleted here                → delete in the cloud, unless it changed there
 *   deleted elsewhere           → back up, then remove here, unless it changed here
 *
 * Downloads are written only once every image arrived and checked out, and
 * only if the world didn't change on this device in the meantime, so a lost
 * connection never leaves a half-written world. Uploading never deletes
 * anything in the cloud: the version it replaces is kept (pt_world_versions).
 *
 * Only worlds that belong to the signed-in account (WorldSave.owner) take
 * part. This device's own worlds are added only when the player says so.
 */
import { makeId } from "../id";
import { allWorlds } from "../saves/worldSaves";
import { backupWorld } from "./backups";
import { bundleAssets, type WorldBundle } from "./bundle";
import { CloudError, type CloudApi, type CloudRow } from "./cloud";
import { localWorld, readLocalBundle, removeLocalWorld, writeLocalBundle, type LocalBundle } from "./local";
import { clearPendingDelete, pendingDeletes } from "./pendingDeletes";
import { copyBundle } from "./transfer";

export type WorldSyncState = { rev: number; hash: string; at: number };
export type ConflictKind = "both-changed" | "deleted-elsewhere";
export type Conflict = { worldId: string; kind: ConflictKind; cloudRevision: number | null; cloudDevice: string; cloudUpdatedAt: string | null; at: number };
export type SyncState = { v: 1; worlds: Record<string, WorldSyncState>; conflicts: Record<string, Conflict>; assets: Record<string, 1> };

export type SyncReport = {
  uploaded: string[];
  downloaded: string[];
  removed: string[];
  conflicts: string[];
  /** Deletes not done because the world changed on another device (it stays). */
  keptDeletes: string[];
  failed: { worldId: string; error: CloudError }[];
};

/** Another tab on this device is syncing right now (not an error: it will be done there). */
export class SyncBusy extends Error {}

export const stateKey = (uid: string) => `plot-twist:sync:v1:${uid}`;
const LOCK_KEY = "plot-twist:sync:lock";
const LOCK_MS = 90_000;

const emptyState = (): SyncState => ({ v: 1, worlds: {}, conflicts: {}, assets: {} });

export function loadState(uid: string): SyncState {
  try {
    const p = JSON.parse(window.localStorage.getItem(stateKey(uid)) ?? "null");
    if (p && p.v === 1) return { ...emptyState(), ...p };
  } catch {}
  return emptyState();
}

function saveState(uid: string, s: SyncState) {
  try {
    window.localStorage.setItem(stateKey(uid), JSON.stringify(s));
  } catch {}
}

const KINDS = ["network", "auth", "server", "invalid"];
const asCloudError = (e: unknown): CloudError => {
  if (e instanceof CloudError) return e;
  const k = (e as { kind?: unknown } | null)?.kind;
  const msg = e instanceof Error ? e.message : String(e);
  return new CloudError(typeof k === "string" && KINDS.includes(k) ? (k as CloudError["kind"]) : "server", msg);
};

export type EngineOptions = {
  device: string;
  /** Name for the extra world made by "Keep both". */
  copyName: (name: string) => string;
};

export class SyncEngine {
  private tab = makeId("tab");
  private running: Promise<unknown> | null = null;

  constructor(
    private cloud: CloudApi,
    private opts: EngineOptions,
  ) {}

  get userId() {
    return this.cloud.userId;
  }

  state(): SyncState {
    return loadState(this.userId);
  }

  conflicts(): Conflict[] {
    return Object.values(this.state().conflicts).filter((c) => localWorld(c.worldId)?.owner === this.userId);
  }

  /** One full sync pass. Concurrent calls share the pass already running. */
  sync(): Promise<SyncReport> {
    return this.exclusive(() => this.pass());
  }

  /** Settle a conflict the way the player chose. */
  resolve(worldId: string, choice: "keep-both" | "use-local" | "use-cloud"): Promise<void> {
    return this.exclusive(() => this.settle(worldId, choice));
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running) await this.running.catch(() => {});
    const job = (async () => {
      if (!this.lock()) throw new SyncBusy("busy in another tab");
      try {
        return await fn();
      } finally {
        this.unlock();
      }
    })();
    this.running = job;
    try {
      return await job;
    } finally {
      if (this.running === job) this.running = null;
    }
  }

  /** A short lease in localStorage, so two tabs on one device never sync at the same time. */
  private lock(): boolean {
    try {
      const now = Date.now();
      const cur = JSON.parse(window.localStorage.getItem(LOCK_KEY) ?? "null");
      if (cur && cur.tab !== this.tab && cur.until > now) return false;
      window.localStorage.setItem(LOCK_KEY, JSON.stringify({ tab: this.tab, until: now + LOCK_MS }));
      return JSON.parse(window.localStorage.getItem(LOCK_KEY) ?? "null")?.tab === this.tab;
    } catch {
      return true;
    }
  }
  private unlock() {
    try {
      const cur = JSON.parse(window.localStorage.getItem(LOCK_KEY) ?? "null");
      if (cur?.tab === this.tab) window.localStorage.removeItem(LOCK_KEY);
    } catch {}
  }

  // ---------------------------------------------------------------- one pass

  private async pass(): Promise<SyncReport> {
    const uid = this.userId;
    const report: SyncReport = { uploaded: [], downloaded: [], removed: [], conflicts: [], keptDeletes: [], failed: [] };
    const rows = new Map((await this.cloud.list()).map((r) => [r.worldId, r]));
    const st = loadState(uid);
    const commit = () => saveState(uid, st);

    // 1. Worlds deleted on this device.
    for (const d of pendingDeletes()) {
      if (d.owner !== uid) continue;
      try {
        const row = rows.get(d.id);
        const seen = st.worlds[d.id];
        if (localWorld(d.id) || !row || row.deleted || !seen) {
          // Nothing to delete, or a cloud version this device never saw: never delete unseen work.
          if (row && !row.deleted && !seen) report.keptDeletes.push(d.id);
        } else {
          const res = await this.cloud.save({ worldId: d.id, baseRevision: seen.rev, name: row.name, bundle: null, contentHash: row.contentHash, deleted: true, device: this.opts.device });
          if (res.ok) rows.set(d.id, { ...row, deleted: true, revision: res.revision });
          else report.keptDeletes.push(d.id);
        }
        delete st.worlds[d.id];
        delete st.conflicts[d.id];
        clearPendingDelete(d.id);
        commit();
      } catch (e) {
        report.failed.push({ worldId: d.id, error: asCloudError(e) });
        if (asCloudError(e).kind === "network") throw asCloudError(e);
      }
    }

    // 2. This account's worlds on this device.
    for (const w of allWorlds()) {
      if (w.owner !== uid) continue;
      try {
        await this.syncWorld(w.id, rows.get(w.id), st, report);
        commit();
      } catch (e) {
        commit();
        const err = asCloudError(e);
        if (err.kind === "network" || err.kind === "auth") throw err;
        report.failed.push({ worldId: w.id, error: err });
      }
    }

    // 3. Worlds in the cloud that aren't on this device yet.
    const pending = new Set(pendingDeletes().map((d) => d.id));
    for (const row of rows.values()) {
      if (row.deleted || pending.has(row.worldId) || localWorld(row.worldId)) continue;
      try {
        if (await this.download(row, undefined, st)) report.downloaded.push(row.worldId);
        commit();
      } catch (e) {
        commit();
        const err = asCloudError(e);
        if (err.kind === "network" || err.kind === "auth") throw err;
        report.failed.push({ worldId: row.worldId, error: err });
      }
    }
    commit();
    return report;
  }

  private async syncWorld(id: string, row: CloudRow | undefined, st: SyncState, report: SyncReport) {
    const local = await readLocalBundle(id);
    if (!local) return;
    const seen = st.worlds[id];
    const link = (r: CloudRow) => {
      st.worlds[id] = { rev: r.revision, hash: local.hash, at: Date.now() };
      delete st.conflicts[id];
    };
    const conflict = (kind: ConflictKind, r: CloudRow) => {
      st.conflicts[id] = { worldId: id, kind, cloudRevision: r.revision, cloudDevice: r.device, cloudUpdatedAt: r.updatedAt, at: Date.now() };
      report.conflicts.push(id);
    };

    if (st.conflicts[id]) {
      // Waiting for the player, unless the two copies became the same meanwhile.
      if (row && !row.deleted && row.contentHash === local.hash) link(row);
      else {
        if (row) st.conflicts[id] = { ...st.conflicts[id], cloudRevision: row.revision, cloudDevice: row.device, cloudUpdatedAt: row.updatedAt };
        report.conflicts.push(id);
      }
      return;
    }

    if (!row) {
      if (await this.upload(local, null, st, report)) report.uploaded.push(id);
      return;
    }
    if (row.deleted) {
      if (seen && seen.hash === local.hash) {
        // Deleted on another device, untouched here: keep a backup, then remove it here too.
        await backupWorld(id, "before-remote-delete", this.userId);
        await removeLocalWorld(id);
        delete st.worlds[id];
        report.removed.push(id);
      } else conflict("deleted-elsewhere", row);
      return;
    }
    if (!seen) {
      if (row.contentHash === local.hash) link(row);
      else conflict("both-changed", row);
      return;
    }
    const changedHere = seen.hash !== local.hash;
    const changedThere = seen.rev !== row.revision;
    if (!changedHere && !changedThere) return;
    if (changedHere && !changedThere) {
      if (await this.upload(local, seen.rev, st, report)) report.uploaded.push(id);
      return;
    }
    if (!changedHere && changedThere) {
      if (await this.download(row, local.hash, st)) report.downloaded.push(id);
      return;
    }
    if (row.contentHash === local.hash) link(row);
    else conflict("both-changed", row);
  }

  /** Upload this device's version on top of `base`. False = the cloud moved on (recorded as a conflict). */
  private async upload(local: LocalBundle, base: number | null, st: SyncState, report: SyncReport | null): Promise<boolean> {
    const b = local.bundle;
    for (const a of bundleAssets(b)) {
      if (st.assets[a.hash]) continue;
      const blob = local.blobs.get(a.hash);
      if (!blob) throw new CloudError("invalid", "image missing on this device");
      await this.cloud.uploadAsset(a, blob);
      st.assets[a.hash] = 1;
    }
    const res = await this.cloud.save({ worldId: b.id, baseRevision: base, name: b.meta.name, bundle: b, contentHash: local.hash, deleted: false, device: this.opts.device });
    if (res.ok) {
      st.worlds[b.id] = { rev: res.revision, hash: local.hash, at: Date.now() };
      delete st.conflicts[b.id];
      return true;
    }
    if (res.revision !== null && !res.deleted && res.contentHash === local.hash) {
      st.worlds[b.id] = { rev: res.revision, hash: local.hash, at: Date.now() };
      delete st.conflicts[b.id];
      return false;
    }
    st.conflicts[b.id] = { worldId: b.id, kind: res.deleted ? "deleted-elsewhere" : "both-changed", cloudRevision: res.revision, cloudDevice: "", cloudUpdatedAt: null, at: Date.now() };
    report?.conflicts.push(b.id);
    return false;
  }

  /** Fetch a world's cloud version and every image it needs (checked), without writing anything. */
  private async fetchCloud(worldId: string): Promise<{ row: CloudRow; bundle: WorldBundle; blobs: Map<string, Blob> } | null> {
    const got = await this.cloud.get(worldId);
    if (!got || !got.bundle) return null;
    const have = (await readLocalBundle(worldId))?.blobs ?? new Map<string, Blob>();
    const blobs = new Map<string, Blob>();
    for (const a of bundleAssets(got.bundle)) {
      const mine = have.get(a.hash);
      blobs.set(a.hash, mine ?? (await this.cloud.downloadAsset(a)));
    }
    return { row: got.row, bundle: got.bundle, blobs };
  }

  /**
   * Download a world's cloud version over this device's copy. `expect` = the
   * local fingerprint the decision was based on: if the world changed here
   * meanwhile, nothing is written (the next pass sees both changes).
   */
  private async download(row: CloudRow, expect: string | undefined, st: SyncState): Promise<boolean> {
    const got = await this.fetchCloud(row.worldId);
    if (!got) return false;
    const now = await readLocalBundle(row.worldId);
    if (expect !== undefined && now?.hash !== expect) return false;
    if (expect === undefined && now) return false;
    if (now) await backupWorld(row.worldId, "before-cloud-update", this.userId);
    await writeLocalBundle(got.bundle, got.blobs, this.userId);
    for (const a of bundleAssets(got.bundle)) st.assets[a.hash] = 1;
    const after = await readLocalBundle(row.worldId);
    st.worlds[row.worldId] = { rev: got.row.revision, hash: after?.hash ?? got.row.contentHash, at: Date.now() };
    delete st.conflicts[row.worldId];
    return true;
  }

  private async settle(worldId: string, choice: "keep-both" | "use-local" | "use-cloud") {
    const uid = this.userId;
    const st = loadState(uid);
    const row = (await this.cloud.list()).find((r) => r.worldId === worldId);
    const local = await readLocalBundle(worldId);
    try {
      if (choice === "use-cloud") {
        if (!row || row.deleted) {
          if (local) {
            await backupWorld(worldId, "before-use-cloud", uid);
            await removeLocalWorld(worldId);
          }
          delete st.worlds[worldId];
          delete st.conflicts[worldId];
          return;
        }
        const got = await this.fetchCloud(worldId);
        if (!got) return;
        if (local) await backupWorld(worldId, "before-use-cloud", uid);
        await writeLocalBundle(got.bundle, got.blobs, uid);
        const after = await readLocalBundle(worldId);
        st.worlds[worldId] = { rev: got.row.revision, hash: after?.hash ?? got.row.contentHash, at: Date.now() };
        delete st.conflicts[worldId];
        return;
      }
      if (!local) return;
      if (choice === "keep-both" && row && !row.deleted) {
        // The cloud version becomes a separate world (new ids), so neither is lost.
        const got = await this.fetchCloud(worldId);
        if (got) {
          const copy = copyBundle(got.bundle, this.opts.copyName(got.bundle.meta.name));
          await writeLocalBundle(copy, got.blobs, uid);
        }
      }
      // This device's version becomes the current one; the replaced cloud version stays in its history.
      await this.upload(local, row ? row.revision : null, st, null);
    } finally {
      saveState(uid, st);
    }
  }
}
