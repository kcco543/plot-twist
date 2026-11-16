/**
 * Test harness for cloud saves: several "devices" (each with its own
 * localStorage, sessionStorage and IndexedDB that survive a reload), and an
 * in-memory cloud with the same rules as supabase/migrations (revision check,
 * versions kept, content-named images, one space per account).
 */
import { vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { FakeStorage } from "./fakeBrowser";
import type { CloudApi, CloudRow, SaveResult } from "@/lib/sync/cloud";
import { CloudError } from "@/lib/sync/cloud";
import type { AssetRef, WorldBundle } from "@/lib/sync/bundle";

export type Device = { name: string; local: FakeStorage; session: FakeStorage; idb: IDBFactory; navigations: string[] };

export function makeDevice(name: string): Device {
  return { name, local: new FakeStorage(), session: new FakeStorage(), idb: new IDBFactory(), navigations: [] };
}

/** Switch the test process to this device and load fresh modules (like opening the page on it). */
export async function onDevice(d: Device) {
  vi.resetModules();
  vi.stubGlobal("window", {
    localStorage: d.local,
    sessionStorage: d.session,
    location: { assign: (href: string) => d.navigations.push(href), reload: () => d.navigations.push("reload"), search: "", origin: "http://localhost:3000" },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("indexedDB", d.idb);
  vi.stubGlobal("navigator", { onLine: true, userAgent: d.name });
  const saves = await import("@/lib/saves/worldSaves");
  const game = await import("@/lib/gameStore");
  const maps = await import("@/lib/mapLibrary");
  const keepsakes = await import("@/lib/keepsakes/store");
  const account = await import("@/lib/sync/account");
  const engine = await import("@/lib/sync/engine");
  const local = await import("@/lib/sync/local");
  const transfer = await import("@/lib/sync/transfer");
  const backups = await import("@/lib/sync/backups");
  return { saves, game, maps, keepsakes, account, engine, local, transfer, backups };
}

type Stored = { row: CloudRow; bundle: WorldBundle | null };

/** The cloud: one shared store, opened per account (like row-level security). */
export class FakeCloudServer {
  worlds = new Map<string, Stored>(); // key uid/worldId
  versions: (Stored & { uid: string })[] = [];
  assets = new Map<string, Blob>(); // key uid/hash
  offline = false;
  /** Fail this many upcoming asset downloads (simulates a dropped connection mid-download). */
  failDownloads = 0;
  calls: string[] = [];

  open(uid: string): CloudApi {
    const net = (what: string) => {
      this.calls.push(`${uid}:${what}`);
      if (this.offline) throw new CloudError("network", "Failed to fetch");
    };
    const key = (id: string) => `${uid}/${id}`;
    return {
      userId: uid,
      list: async () => {
        net("list");
        return [...this.worlds.entries()].filter(([k]) => k.startsWith(`${uid}/`)).map(([, v]) => ({ ...v.row }));
      },
      get: async (id) => {
        net("get");
        const s = this.worlds.get(key(id));
        return s ? { row: { ...s.row }, bundle: s.bundle ? (JSON.parse(JSON.stringify(s.bundle)) as WorldBundle) : null } : null;
      },
      save: async (p): Promise<SaveResult> => {
        net("save");
        const cur = this.worlds.get(key(p.worldId));
        const row = (revision: number): CloudRow => ({ worldId: p.worldId, revision, contentHash: p.contentHash, deleted: p.deleted, name: p.name, device: p.device, updatedAt: new Date().toISOString() });
        const bundle = p.deleted ? null : (JSON.parse(JSON.stringify(p.bundle)) as WorldBundle);
        if (!cur) {
          if (p.baseRevision !== null) return { ok: false, conflict: true, revision: null, contentHash: null, deleted: null };
          this.worlds.set(key(p.worldId), { row: row(1), bundle });
          return { ok: true, revision: 1 };
        }
        if (p.baseRevision !== cur.row.revision) return { ok: false, conflict: true, revision: cur.row.revision, contentHash: cur.row.contentHash, deleted: cur.row.deleted };
        this.versions.push({ uid, ...cur });
        this.worlds.set(key(p.worldId), { row: row(cur.row.revision + 1), bundle });
        return { ok: true, revision: cur.row.revision + 1 };
      },
      uploadAsset: async (a: AssetRef, blob: Blob) => {
        net("upload");
        if (!this.assets.has(key(a.hash))) this.assets.set(key(a.hash), blob);
      },
      downloadAsset: async (a: AssetRef) => {
        net("download");
        if (this.failDownloads > 0) {
          this.failDownloads--;
          throw new CloudError("network", "connection dropped");
        }
        const b = this.assets.get(key(a.hash));
        if (!b) throw new CloudError("server", "not found");
        return b;
      },
    };
  }
}

/** A small PNG-ish blob with recognisable bytes. */
export const imageBlob = (seed: number, type = "image/png") => new Blob([new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * seed + 7) % 256))], { type });
