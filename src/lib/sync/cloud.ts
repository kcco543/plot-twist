/**
 * CLOUD SIDE of world saves (Supabase). See supabase/migrations/ for the
 * tables, the row-level security that keeps each player's saves private, and
 * pt_save_world(), which refuses to replace a version the device hasn't seen.
 *
 * The engine (engine.ts) only talks to the CloudApi interface, so tests can
 * use an in-memory cloud or a real local Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { extFor, validateBundle, type AssetRef, type WorldBundle } from "./bundle";
import { sha256Blob } from "./sha256";

export type CloudRow = {
  worldId: string;
  revision: number;
  contentHash: string;
  deleted: boolean;
  name: string;
  device: string;
  updatedAt: string;
};

export type SaveResult = { ok: true; revision: number } | { ok: false; conflict: true; revision: number | null; contentHash: string | null; deleted: boolean | null };

export type CloudApi = {
  userId: string;
  list(): Promise<CloudRow[]>;
  /** One world's current version, or null if the cloud doesn't have it. */
  get(worldId: string): Promise<{ row: CloudRow; bundle: WorldBundle | null } | null>;
  save(p: { worldId: string; baseRevision: number | null; name: string; bundle: WorldBundle | null; contentHash: string; deleted: boolean; device: string }): Promise<SaveResult>;
  uploadAsset(a: AssetRef, blob: Blob): Promise<void>;
  /** Downloads and checks the bytes against the hash. */
  downloadAsset(a: AssetRef): Promise<Blob>;
};

/** A failure the player can retry: no connection, server unreachable, timeout. */
export class CloudError extends Error {
  constructor(
    public kind: "network" | "auth" | "server" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export const BUCKET = "plot-twist-saves";

function classify(e: unknown): CloudError {
  if (e instanceof CloudError) return e;
  const err = e as { message?: string; status?: number; statusCode?: string | number; code?: string; name?: string } | null;
  const msg = err?.message ?? String(e);
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  if (/fetch|network|Failed to fetch|Load failed|NetworkError|ECONNREFUSED|timed? ?out|aborted/i.test(msg) || err?.name === "TypeError") return new CloudError("network", msg);
  if (status === 401 || status === 403 || err?.code === "42501" || err?.code === "PGRST301" || /JWT|not signed in/i.test(msg)) return new CloudError("auth", msg);
  return new CloudError("server", msg);
}

type Row = { world_id: string; revision: number; content_hash: string; deleted: boolean; name: string; device: string; updated_at: string };
const toRow = (r: Row): CloudRow => ({ worldId: r.world_id, revision: r.revision, contentHash: r.content_hash, deleted: r.deleted, name: r.name, device: r.device, updatedAt: r.updated_at });
const COLS = "world_id, revision, content_hash, deleted, name, device, updated_at";

export function supabaseCloud(client: SupabaseClient, userId: string): CloudApi {
  const path = (a: AssetRef) => `${userId}/${a.hash}.${extFor(a.type)}`;
  return {
    userId,
    async list() {
      const { data, error } = await client.from("pt_worlds").select(COLS).eq("user_id", userId);
      if (error) throw classify(error);
      return (data as Row[]).map(toRow);
    },
    async get(worldId) {
      const { data, error } = await client.from("pt_worlds").select(`${COLS}, bundle`).eq("user_id", userId).eq("world_id", worldId).maybeSingle();
      if (error) throw classify(error);
      if (!data) return null;
      const row = toRow(data as Row);
      const raw = (data as { bundle: unknown }).bundle;
      if (row.deleted || raw == null) return { row, bundle: null };
      const v = validateBundle(raw);
      if (!v.ok || v.bundle.id !== worldId) throw new CloudError("invalid", `cloud copy unreadable: ${v.ok ? "id" : v.reason}`);
      return { row, bundle: v.bundle };
    },
    async save(p) {
      const { data, error } = await client.rpc("pt_save_world", {
        p_world_id: p.worldId,
        p_base_revision: p.baseRevision,
        p_name: p.name,
        p_bundle: p.bundle,
        p_content_hash: p.contentHash,
        p_deleted: p.deleted,
        p_device: p.device,
      });
      if (error) throw classify(error);
      const r = data as { ok: boolean; revision: number | null; content_hash?: string | null; deleted?: boolean | null };
      if (r.ok) return { ok: true, revision: r.revision! };
      return { ok: false, conflict: true, revision: r.revision ?? null, contentHash: r.content_hash ?? null, deleted: r.deleted ?? null };
    },
    async uploadAsset(a, blob) {
      const { error } = await client.storage.from(BUCKET).upload(path(a), blob, { upsert: false, contentType: a.type, cacheControl: "31536000" });
      if (!error) return;
      const e = error as { message?: string; statusCode?: string | number; status?: number };
      // Already there: files are named by their content, so it is the same file.
      if (String(e.statusCode ?? e.status) === "409" || /already exists|Duplicate/i.test(e.message ?? "")) return;
      throw classify(error);
    },
    async downloadAsset(a) {
      const { data, error } = await client.storage.from(BUCKET).download(path(a));
      if (error || !data) throw classify(error ?? new Error("no data"));
      const blob = data.type === a.type ? data : new Blob([await data.arrayBuffer()], { type: a.type });
      if ((await sha256Blob(blob)) !== a.hash) throw new CloudError("invalid", "image check failed");
      return blob;
    },
  };
}
