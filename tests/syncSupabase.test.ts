/**
 * Cloud saves against a REAL Supabase (local stack: `supabase start`, then
 * `supabase migration up`). Skipped unless SUPABASE_TEST_URL and
 * SUPABASE_TEST_KEY (the publishable/anon key) are set:
 *
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_KEY=<publishable key> npx vitest run tests/syncSupabase.test.ts
 *
 * Checks the full desktop → phone → desktop round trip through Postgres and
 * Storage, and that row-level security keeps every player's saves private.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { imageBlob, makeDevice, onDevice } from "./syncHarness";

const URL_ = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_KEY;
const run = URL_ && KEY ? describe : describe.skip;

afterEach(() => vi.unstubAllGlobals());

const client = () => createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function newPlayer(): Promise<{ sb: SupabaseClient; uid: string; email: string }> {
  const sb = client();
  const email = `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { data, error } = await sb.auth.signUp({ email, password: "correct horse battery" });
  if (error) throw error;
  expect(data.session).toBeTruthy(); // local stack: no email confirmation
  return { sb, uid: data.user!.id, email };
}

run("cloud saves on a real Supabase", () => {
  it("desktop → phone → desktop with characters, maps, photos and gifts intact", async () => {
    const A = await newPlayer();
    const desktop = makeDevice("Mac");
    const phone = makeDevice("iPhone");

    let env = await onDevice(desktop);
    env.game.gameActions.addSampleCast("en");
    const id = env.saves.activeWorldId()!;
    await env.maps.putMap({ id: "map_x", blob: imageBlob(11), width: 4, height: 4, description: "tavern", type: "interior", worldId: null, model: "t", createdAt: 1, scene: { objects: [1, 2] }, saveId: id } as never);
    env.game.gameActions.updateEnvironment({ mapId: "map_x" });
    const chars = env.game.getSave().characters;
    await env.keepsakes.savePhoto({ worldId: id, characterId: chars[0].id, blob: imageBlob(12, "image/jpeg"), width: 2, height: 2, caption: "hi", source: "upload" });
    await env.keepsakes.saveGift(id, { name: "Cocoa", description: "", image: null, art: null });
    env.account.setCurrentAccount({ id: A.uid, email: A.email });
    env.saves.setWorldOwner([id], A.uid);
    const cloudMod = await import("@/lib/sync/cloud");
    let sync = new env.engine.SyncEngine(cloudMod.supabaseCloud(A.sb, A.uid), { device: "Mac", copyName: (n) => `${n} (other)` });
    let r = await sync.sync();
    expect(r.failed).toEqual([]);
    expect(r.uploaded).toEqual([id]);
    const original = await env.local.readLocalBundle(id);

    env = await onDevice(phone);
    env.account.setCurrentAccount({ id: A.uid, email: A.email });
    sync = new env.engine.SyncEngine((await import("@/lib/sync/cloud")).supabaseCloud(A.sb, A.uid), { device: "iPhone", copyName: (n) => n });
    r = await sync.sync();
    expect(r.failed).toEqual([]);
    expect(r.downloaded).toEqual([id]);
    const got = await env.local.readLocalBundle(id);
    expect(got!.hash).toBe(original!.hash);
    const map = (await env.maps.listMaps()).find((m) => m.id === "map_x")!;
    expect(new Uint8Array(await map.blob.arrayBuffer())).toEqual(new Uint8Array(await imageBlob(11).arrayBuffer()));
    expect((await env.keepsakes.listPhotos(id))[0].caption).toBe("hi");
    env.saves.renameWorld(id, "From the phone");
    r = await sync.sync();
    expect(r.uploaded).toEqual([id]);

    env = await onDevice(desktop);
    sync = new env.engine.SyncEngine((await import("@/lib/sync/cloud")).supabaseCloud(A.sb, A.uid), { device: "Mac", copyName: (n) => n });
    r = await sync.sync();
    expect(r.downloaded).toEqual([id]);
    expect(env.saves.allWorlds()[0].name).toBe("From the phone");

    // The replaced version is kept.
    const { data: versions } = await A.sb.from("pt_world_versions").select("revision").eq("world_id", id);
    expect(versions!.map((v) => v.revision)).toEqual([1]);

    // A stale write is refused, not applied.
    const { data: stale } = await A.sb.rpc("pt_save_world", { p_world_id: id, p_base_revision: 1, p_name: "stale", p_bundle: { format: "x" }, p_content_hash: "0".repeat(64), p_deleted: false, p_device: "x" });
    expect(stale).toMatchObject({ ok: false, conflict: true, revision: 2 });
  });

  it("row-level security: players see and change only their own saves and images", async () => {
    const A = await newPlayer();
    const B = await newPlayer();
    const hash = "a".repeat(64);
    const ok = await A.sb.rpc("pt_save_world", { p_world_id: "world_secret", p_base_revision: null, p_name: "A's world", p_bundle: { format: "plot-twist-world" }, p_content_hash: hash, p_deleted: false, p_device: "Mac" });
    expect(ok.data).toMatchObject({ ok: true, revision: 1 });
    const blob = imageBlob(1);
    const up = await A.sb.storage.from("plot-twist-saves").upload(`${A.uid}/${hash}.png`, blob, { contentType: "image/png" });
    expect(up.error).toBeNull();

    // B sees nothing of A's.
    expect((await B.sb.from("pt_worlds").select("*")).data).toEqual([]);
    expect((await B.sb.from("pt_world_versions").select("*")).data).toEqual([]);
    expect((await B.sb.storage.from("plot-twist-saves").download(`${A.uid}/${hash}.png`)).error).toBeTruthy();
    // …and can't write into A's folder or A's rows.
    expect((await B.sb.storage.from("plot-twist-saves").upload(`${A.uid}/${"b".repeat(64)}.png`, blob, { contentType: "image/png" })).error).toBeTruthy();
    expect((await B.sb.from("pt_worlds").update({ name: "hacked" }).eq("user_id", A.uid)).error).toBeTruthy();
    expect((await B.sb.from("pt_worlds").insert({ user_id: A.uid, world_id: "x", revision: 1, content_hash: hash, bundle: {} })).error).toBeTruthy();
    // Saving the same world id as B makes B's own row; A's is untouched.
    await B.sb.rpc("pt_save_world", { p_world_id: "world_secret", p_base_revision: null, p_name: "B's", p_bundle: { format: "plot-twist-world" }, p_content_hash: hash, p_deleted: false, p_device: "x" });
    const mine = await A.sb.from("pt_worlds").select("name");
    expect(mine.data).toEqual([{ name: "A's world" }]);
    // Even A can't write the table directly (only through the revision-checked function).
    expect((await A.sb.from("pt_worlds").update({ name: "direct" }).eq("world_id", "world_secret")).error).toBeTruthy();
    expect((await A.sb.storage.from("plot-twist-saves").remove([`${A.uid}/${hash}.png`])).data ?? []).toEqual([]);

    // Not signed in: nothing.
    const anon = client();
    expect((await anon.from("pt_worlds").select("*")).data ?? []).toEqual([]);
    expect((await anon.rpc("pt_save_world", { p_world_id: "w", p_base_revision: null, p_name: "", p_bundle: {}, p_content_hash: hash, p_deleted: false, p_device: "" })).error).toBeTruthy();
  });
});
