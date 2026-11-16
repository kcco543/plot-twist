import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeCloudServer, imageBlob, makeDevice, onDevice, type Device } from "./syncHarness";
import { sha256Js } from "@/lib/sync/sha256";
import { base64ToBytes, bytesToBase64, canonicalJson, validateBundle } from "@/lib/sync/bundle";

const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Env = Awaited<ReturnType<typeof onDevice>>;

/** Build a world the way the game does: sample cast (relationships), a memory, story log, a generated map with a play-area layout, a photo and a gift. */
async function buildWorld(env: Env): Promise<string> {
  env.game.gameActions.addSampleCast("en");
  const id = env.saves.activeWorldId()!;
  const save = env.game.getSave();
  const [a, b] = save.characters;
  env.game.gameActions.updateCharacter(a.id, { name: "Mira the Bold" });
  const story = save.story;
  env.game.gameActions.setStory({
    ...story,
    turn: 7,
    characters: { ...story.characters, [a.id]: { ...(story.characters[a.id] ?? {}), mood: "happy", intensity: 2, memories: [{ id: "mem_1", withId: b.id, withName: b.name, note: "shared cocoa by the fire" }] } } as typeof story.characters,
  });
  env.game.gameActions.appendLog({ id: "log_1", at: 5, speaker: { kind: "character", name: a.name, id: a.id }, key: "custom", params: { text: "Merry Christmas!" } } as never);
  const map = { id: "map_tavern", blob: imageBlob(3), width: 64, height: 36, description: "a Christmas tavern", type: "interior", worldId: "western-fantasy", model: "test", createdAt: 1000, scene: { v: 1, walk: [[0, 0, 10, 10]], objects: [{ id: "obj_tree", kind: "tree" }] }, saveId: id };
  await env.maps.putMap(map as never);
  env.game.gameActions.updateEnvironment({ mapId: "map_tavern", description: "a Christmas tavern" });
  await env.keepsakes.savePhoto({ worldId: id, characterId: a.id, blob: imageBlob(5, "image/jpeg"), width: 20, height: 15, caption: "snow!", source: "upload" });
  await env.keepsakes.saveGift(id, { name: "Scarf", description: "red and warm", image: "data:image/png;base64,iVBORw0KGgo=", art: "drawn" });
  return id;
}

async function signIn(env: Env, uid: string, server: FakeCloudServer) {
  env.account.setCurrentAccount({ id: uid, email: `${uid.slice(0, 4)}@example.com` });
  return new env.engine.SyncEngine(server.open(uid), { device: "test", copyName: (n) => `${n} (other device)` });
}

async function bytes(b: Blob) {
  return Array.from(new Uint8Array(await b.arrayBuffer()));
}

describe("sha256 + base64 helpers", () => {
  it("pure-JS SHA-256 matches Node's (used on http:// LAN pages without crypto.subtle)", () => {
    for (const s of ["", "abc", "x".repeat(1000), "日本語🎄"]) {
      const b = new TextEncoder().encode(s);
      expect(sha256Js(b)).toBe(createHash("sha256").update(b).digest("hex"));
    }
  });
  it("base64 round-trips any length", () => {
    for (let n = 0; n < 10; n++) {
      const b = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37) % 256));
      expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b));
      expect(bytesToBase64(b)).toBe(Buffer.from(b).toString("base64"));
    }
  });
  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("refuses anything that isn't a world", () => {
    expect(validateBundle(null).ok).toBe(false);
    expect(validateBundle({ format: "plot-twist-world", v: 1, id: "../x", meta: {}, data: null, maps: [], keepsakes: [] }).ok).toBe(false);
    expect(validateBundle({ format: "plot-twist-world", v: 1, id: "w1", meta: { name: "", createdAt: 1, updatedAt: 1 }, data: null, maps: [{ id: "m", asset: { hash: "nope", type: "image/png", size: 1 } }], keepsakes: [] }).ok).toBe(false);
  });
});

describe("cloud saves: desktop → phone → desktop", () => {
  it("moves a whole world (characters, relationships, memories, story, map + layout, photo, gift) and back, without loss", async () => {
    const server = new FakeCloudServer();
    const desktop = makeDevice("Mac");
    const phone = makeDevice("iPhone");

    // Desktop: an existing world made before signing in (like the Christmas tavern).
    let env = await onDevice(desktop);
    const id = await buildWorld(env);
    const before = await env.local.readLocalBundle(id);
    expect(env.saves.allWorlds()[0].owner).toBeUndefined();

    // Sign in to an empty account: nothing is uploaded or removed until the player adds it.
    let sync = await signIn(env, UID_A, server);
    let r = await sync.sync();
    expect(r.uploaded).toEqual([]);
    expect(server.worlds.size).toBe(0);
    expect((await env.local.readLocalBundle(id))!.hash).toBe(before!.hash);

    // Add it to the account: backed up first, then uploaded as it is.
    for (const w of env.saves.allWorlds()) await env.backups.backupWorld(w.id, "before-cloud-import");
    env.saves.setWorldOwner([id], UID_A);
    r = await sync.sync();
    expect(r.uploaded).toEqual([id]);
    expect(server.worlds.get(`${UID_A}/${id}`)!.row.contentHash).toBe(before!.hash);
    expect(server.assets.size).toBe(2); // map + photo, named by content
    expect((await env.backups.listBackups(null)).length).toBe(1);

    // Phone: sign in to the same account, the world arrives intact.
    env = await onDevice(phone);
    sync = await signIn(env, UID_A, server);
    r = await sync.sync();
    expect(r.downloaded).toEqual([id]);
    const onPhone = await env.local.readLocalBundle(id);
    expect(onPhone!.hash).toBe(before!.hash);
    expect(onPhone!.bundle.data).toEqual(before!.bundle.data);
    const save = env.game.migrateSave(onPhone!.bundle.data);
    expect(save.characters.map((c) => c.name)).toContain("Mira the Bold");
    expect(save.story.turn).toBe(7);
    expect(save.environment.mapId).toBe("map_tavern");
    const map = (await env.maps.listMaps()).find((m) => m.id === "map_tavern")!;
    expect(await bytes(map.blob)).toEqual(await bytes(imageBlob(3)));
    expect((map as { scene?: unknown }).scene).toEqual({ v: 1, walk: [[0, 0, 10, 10]], objects: [{ id: "obj_tree", kind: "tree" }] });
    const photos = await env.keepsakes.listPhotos(id);
    expect(photos).toHaveLength(1);
    expect(await bytes(photos[0].blob)).toEqual(await bytes(imageBlob(5, "image/jpeg")));
    expect((await env.keepsakes.listGifts(id))[0].name).toBe("Scarf");
    expect(env.saves.getVisibleIndex().worlds.map((w) => w.id)).toEqual([id]);

    // Phone: keep playing.
    env.saves.enterWorld(id, "/play");
    env = await onDevice(phone); // entering a world reloads the page
    sync = new env.engine.SyncEngine(server.open(UID_A), { device: "iPhone", copyName: (n) => n });
    expect(env.saves.activeWorldId()).toBe(id);
    const aId = save.characters[0].id;
    env.game.gameActions.setMemoryNote(aId, "mem_1", "shared cocoa AND cookies");
    env.saves.renameWorld(id, "Tavern on my phone");
    r = await sync.sync();
    expect(r.uploaded).toEqual([id]);
    const phoneHash = (await env.local.readLocalBundle(id))!.hash;

    // Desktop: the update arrives; the old version is backed up first.
    env = await onDevice(desktop);
    sync = new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n });
    r = await sync.sync();
    expect(r.downloaded).toEqual([id]);
    const back = await env.local.readLocalBundle(id);
    expect(back!.hash).toBe(phoneHash);
    expect(back!.bundle.meta.name).toBe("Tavern on my phone");
    expect(JSON.stringify(back!.bundle.data)).toContain("shared cocoa AND cookies");
    const backups = await env.backups.listBackups(UID_A);
    expect(backups.some((b) => b.reason === "before-cloud-update" && b.worldId === id)).toBe(true);

    // A reload changes nothing and uploads nothing.
    env = await onDevice(desktop);
    server.calls = [];
    sync = new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n });
    r = await sync.sync();
    expect(r.uploaded).toEqual([]);
    expect(r.downloaded).toEqual([]);
    expect(server.calls.filter((c) => c.endsWith(":save"))).toEqual([]);
    expect(server.versions.length).toBe(1); // the replaced version is kept in the cloud
  });
});

describe("cloud saves: safety", () => {
  async function shared() {
    const server = new FakeCloudServer();
    const desktop = makeDevice("Mac");
    const phone = makeDevice("iPhone");
    let env = await onDevice(desktop);
    const id = await buildWorld(env);
    env.saves.setWorldOwner([id], UID_A);
    await (await signIn(env, UID_A, server)).sync();
    env = await onDevice(phone);
    await (await signIn(env, UID_A, server)).sync();
    return { server, desktop, phone, id };
  }

  it("changes on both devices are a conflict: nothing is overwritten, Keep both keeps both", async () => {
    const { server, desktop, phone, id } = await shared();
    let env = await onDevice(desktop);
    env.saves.renameWorld(id, "Desktop edit");
    await new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n }).sync();

    env = await onDevice(phone);
    env.saves.renameWorld(id, "Phone edit");
    const phoneSync = new env.engine.SyncEngine(server.open(UID_A), { device: "iPhone", copyName: (n) => `${n} (other device)` });
    const r = await phoneSync.sync();
    expect(r.conflicts).toEqual([id]);
    expect(server.worlds.get(`${UID_A}/${id}`)!.bundle!.meta.name).toBe("Desktop edit");
    expect((await env.local.readLocalBundle(id))!.bundle.meta.name).toBe("Phone edit");
    expect(phoneSync.conflicts().map((c) => c.worldId)).toEqual([id]);

    // Syncing again doesn't settle it behind the player's back.
    await phoneSync.sync();
    expect(server.worlds.get(`${UID_A}/${id}`)!.bundle!.meta.name).toBe("Desktop edit");

    await phoneSync.resolve(id, "keep-both");
    await phoneSync.sync();
    const names = env.saves.allWorlds().map((w) => w.name).sort();
    expect(names).toEqual(["Desktop edit (other device)", "Phone edit"]);
    expect(phoneSync.conflicts()).toEqual([]);
    expect(server.worlds.get(`${UID_A}/${id}`)!.bundle!.meta.name).toBe("Phone edit");
    expect([...server.worlds.keys()].filter((k) => k.startsWith(UID_A))).toHaveLength(2);

    // The copy has its own ids: its map is a separate record that points at the same image.
    const copyId = env.saves.allWorlds().find((w) => w.id !== id)!.id;
    const copy = await env.local.readLocalBundle(copyId);
    expect(copy!.bundle.maps[0].id).not.toBe("map_tavern");
    expect(env.game.migrateSave(copy!.bundle.data).environment.mapId).toBe(copy!.bundle.maps[0].id);

    // Desktop gets both.
    env = await onDevice(desktop);
    await new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n }).sync();
    expect(env.saves.allWorlds().map((w) => w.name).sort()).toEqual(["Desktop edit (other device)", "Phone edit"]);
  });

  it("a dropped connection mid-download leaves this device's world exactly as it was", async () => {
    const { server, desktop, phone, id } = await shared();
    let env = await onDevice(phone);
    // A new photo (new image to download on desktop).
    await env.keepsakes.savePhoto({ worldId: id, characterId: env.game.migrateSave(JSON.parse(env.saves.readWorldText(id)!)).characters[0].id, blob: imageBlob(9, "image/jpeg"), width: 2, height: 2, caption: "", source: "camera" });
    await new env.engine.SyncEngine(server.open(UID_A), { device: "iPhone", copyName: (n) => n }).sync();

    env = await onDevice(desktop);
    const before = await env.local.readLocalBundle(id);
    server.failDownloads = 1;
    const sync = new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n });
    await expect(sync.sync()).rejects.toMatchObject({ kind: "network" });
    const after = await env.local.readLocalBundle(id);
    expect(after!.hash).toBe(before!.hash);
    expect(await env.keepsakes.listPhotos(id)).toHaveLength(1);
    // Once the connection is back it completes.
    const r = await sync.sync();
    expect(r.downloaded).toEqual([id]);
    expect(await env.keepsakes.listPhotos(id)).toHaveLength(2);
  });

  it("offline edits stay on the device and upload when the connection returns", async () => {
    const { server, phone, id } = await shared();
    const env = await onDevice(phone);
    server.offline = true;
    env.saves.renameWorld(id, "Edited on the train");
    const sync = new env.engine.SyncEngine(server.open(UID_A), { device: "iPhone", copyName: (n) => n });
    await expect(sync.sync()).rejects.toMatchObject({ kind: "network" });
    expect(env.saves.allWorlds()[0].name).toBe("Edited on the train");
    server.offline = false;
    expect((await sync.sync()).uploaded).toEqual([id]);
    expect(server.worlds.get(`${UID_A}/${id}`)!.bundle!.meta.name).toBe("Edited on the train");
  });

  it("deleting on one device removes it on the other (after a backup); a delete never wins over unseen changes", async () => {
    const { server, desktop, phone, id } = await shared();
    let env = await onDevice(desktop);
    await env.saves.deleteWorld(id);
    let r = await new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n }).sync();
    expect(server.worlds.get(`${UID_A}/${id}`)!.row.deleted).toBe(true);
    expect(r.downloaded).toEqual([]); // not brought back

    env = await onDevice(phone);
    r = await new env.engine.SyncEngine(server.open(UID_A), { device: "iPhone", copyName: (n) => n }).sync();
    expect(r.removed).toEqual([id]);
    expect(env.saves.allWorlds()).toEqual([]);
    const backups = await env.backups.listBackups(UID_A);
    expect(backups.find((b) => b.reason === "before-remote-delete")?.worldId).toBe(id);
  });

  it("a world deleted elsewhere but changed here is a conflict, not a silent delete", async () => {
    const { server, desktop, phone, id } = await shared();
    let env = await onDevice(desktop);
    await env.saves.deleteWorld(id);
    await new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n }).sync();
    env = await onDevice(phone);
    env.saves.renameWorld(id, "Still playing this");
    const sync = new env.engine.SyncEngine(server.open(UID_A), { device: "iPhone", copyName: (n) => n });
    const r = await sync.sync();
    expect(r.conflicts).toEqual([id]);
    expect(env.saves.allWorlds()[0].name).toBe("Still playing this");
    await sync.resolve(id, "use-local");
    expect(server.worlds.get(`${UID_A}/${id}`)!.row.deleted).toBe(false);
    expect(server.worlds.get(`${UID_A}/${id}`)!.bundle!.meta.name).toBe("Still playing this");
  });

  it("a delete made on one device is not applied over changes it never saw", async () => {
    const { server, desktop, phone, id } = await shared();
    let env = await onDevice(phone);
    env.saves.renameWorld(id, "Newer on phone");
    await new env.engine.SyncEngine(server.open(UID_A), { device: "iPhone", copyName: (n) => n }).sync();
    env = await onDevice(desktop);
    await env.saves.deleteWorld(id); // desktop hasn't seen the phone's change
    const r = await new env.engine.SyncEngine(server.open(UID_A), { device: "Mac", copyName: (n) => n }).sync();
    expect(r.keptDeletes).toEqual([id]);
    expect(server.worlds.get(`${UID_A}/${id}`)!.row.deleted).toBe(false);
    expect(r.downloaded).toEqual([id]); // comes back with the phone's version
    expect(env.saves.allWorlds()[0].name).toBe("Newer on phone");
  });

  it("switching accounts never shows or uploads another account's worlds", async () => {
    const { server, desktop, id } = await shared();
    let env = await onDevice(desktop);
    env.account.setCurrentAccount({ id: UID_B, email: "b@example.com" });
    expect(env.saves.getVisibleIndex().worlds).toEqual([]);
    expect(env.saves.hiddenWorldCount()).toBe(1);
    expect(env.saves.activeWorldId()).toBeNull();
    const r = await new env.engine.SyncEngine(server.open(UID_B), { device: "Mac", copyName: (n) => n }).sync();
    expect(r.uploaded).toEqual([]);
    expect(r.downloaded).toEqual([]);
    expect([...server.worlds.keys()].some((k) => k.startsWith(UID_B))).toBe(false);
    // Signed out: still hidden, still on the device.
    env = await onDevice(desktop);
    env.account.setCurrentAccount(null);
    expect(env.saves.getVisibleIndex().worlds).toEqual([]);
    expect(env.saves.allWorlds().map((w) => w.id)).toEqual([id]);
    // Back as A: visible again.
    env.account.setCurrentAccount({ id: UID_A, email: "a@example.com" });
    expect(env.saves.getVisibleIndex().worlds.map((w) => w.id)).toEqual([id]);
  });

  it("an existing local save with the same id as a different cloud version becomes a conflict when added", async () => {
    const server = new FakeCloudServer();
    const desktop = makeDevice("Mac");
    const phone = makeDevice("iPhone");
    let env = await onDevice(desktop);
    const id = await buildWorld(env);
    const file = await env.transfer.buildExport([id]);
    env.saves.setWorldOwner([id], UID_A);
    await (await signIn(env, UID_A, server)).sync();

    // Phone got the world by file while signed out, and changed it.
    env = await onDevice(phone);
    const parsed = await env.transfer.parseExport(JSON.stringify(file));
    await env.transfer.importBundles(parsed.worlds, parsed.blobs, undefined, (n) => n);
    env.saves.renameWorld(id, "Phone version");
    const sync = await signIn(env, UID_A, server);
    await sync.sync();
    expect(env.saves.allWorlds().map((w) => w.id)).toEqual([id]); // not downloaded over the device's own world
    env.saves.setWorldOwner([id], UID_A);
    const r = await sync.sync();
    expect(r.conflicts).toEqual([id]);
    expect(env.saves.allWorlds()[0].name).toBe("Phone version");
  });
});

describe("Export Save / Import Save", () => {
  it("round-trips a world with its images; importing again never overwrites", async () => {
    const a = makeDevice("Mac");
    const b = makeDevice("iPhone");
    let env = await onDevice(a);
    const id = await buildWorld(env);
    const original = await env.local.readLocalBundle(id);
    const file = JSON.stringify(await env.transfer.buildExport([id]));
    expect(file).toContain("data:image/png;base64,");

    env = await onDevice(b);
    let p = await env.transfer.parseExport(file);
    expect(p.invalid).toBe(0);
    let res = await env.transfer.importBundles(p.worlds, p.blobs, undefined, (n) => `${n} (imported)`);
    expect(res[0].status).toBe("added");
    expect((await env.local.readLocalBundle(id))!.hash).toBe(original!.hash);

    p = await env.transfer.parseExport(file);
    res = await env.transfer.importBundles(p.worlds, p.blobs, undefined, (n) => `${n} (imported)`);
    expect(res[0].status).toBe("same");

    env.saves.renameWorld(id, "Changed here");
    p = await env.transfer.parseExport(file);
    res = await env.transfer.importBundles(p.worlds, p.blobs, undefined, (n) => `${n || "World"} (imported)`);
    expect(res[0].status).toBe("copied");
    expect(env.saves.allWorlds()).toHaveLength(2);
    expect(env.saves.allWorlds().find((w) => w.id === id)!.name).toBe("Changed here");
  });

  it("rejects damaged files and images that don't match their hash", async () => {
    const env = await onDevice(makeDevice("Mac"));
    const id = await buildWorld(env);
    await expect(env.transfer.parseExport("not json")).rejects.toThrow("not-a-save");
    await expect(env.transfer.parseExport(JSON.stringify({ hello: 1 }))).rejects.toThrow("not-a-save");
    const file = await env.transfer.buildExport([id]);
    const hash = Object.keys(file.assets)[0];
    file.assets[hash] = "data:image/png;base64,AAAA";
    const p = await env.transfer.parseExport(JSON.stringify(file));
    expect(p.worlds).toHaveLength(0);
    expect(p.invalid).toBe(1);
  });
});

export type { Device };
