/**
 * AI photo reactions: request building, the server's checks (reply and image
 * bytes), the game engine's validation, photo memories (world / character
 * isolation, deletion), and the /api/ai/photo route with the model mocked.
 * Live model checks: tests/live/photo.live.test.ts (RUN_LIVE_AI=1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/claude", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/claude")>();
  return { ...real, structuredCall: vi.fn(), assertImageInput: vi.fn(async () => {}) };
});

import { AiError, assertImageInput, structuredCall } from "@/lib/ai/server/claude";
import { resetTalkLimits } from "@/lib/ai/server/limits";
import { mockPhotoReply, PHOTO_SYSTEM, photoContent, photoText } from "@/lib/ai/server/photo";
import { POST as photoRoute } from "@/app/api/ai/photo/route";
import { __resetKeepsakesForTests, copyWorldKeepsakes, deletePhoto, getPhoto, listPhotos, prunePhotos, savePhoto } from "@/lib/keepsakes/store";
import { sampleCharacter } from "@/lib/mind/scenarios";
import { addPhotoMemory, applyPhotoReaction, linkedPhotoIds, PHOTO_FAMILIARITY, PHOTO_STEP, RECENT_KEEP, unlinkPhoto, validatePhotoReply } from "@/lib/photo/apply";
import { checkImage, photoProblem, sanitizePhotoReply, sniffImage } from "@/lib/photo/checks";
import { PHOTO_AI_MAX_BYTES, PhotoReplySchema, PhotoRequestSchema, type PhotoReply, type PhotoRequest } from "@/lib/photo/contract";
import { buildPhotoRequest, sendPhotoRequest, type PhotoBuildInput } from "@/lib/photo/request";
import { remapIds } from "@/lib/saves/remap";
import { emptyStory } from "@/lib/story/engine";
import { editMemory } from "@/lib/talk/ai/apply";
import { buildTalkRequest } from "@/lib/talk/ai/request";
import { PLAYER_ID, type Character, type StoryState } from "@/lib/types";
import { makeChar } from "./helpers";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";

const mocked = vi.mocked(structuredCall);
const imageCheck = vi.mocked(assertImageInput);
const mira = (l: "en" | "zh-CN" = "en") => sampleCharacter("mira", l);
const wren = (l: "en" | "zh-CN" = "en") => sampleCharacter("wren", l);
const tobi = (l: "en" | "zh-CN" = "en") => sampleCharacter("tobi", l);
const story0 = (): StoryState => ({ ...emptyStory(), turn: 10, relations: {}, decisions: [] });

/** A tiny "JPEG": the route checks the magic bytes and size, the model mock never decodes it. */
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

function build(character: Character, patch: Partial<PhotoBuildInput> = {}): PhotoRequest {
  return buildPhotoRequest({
    story: story0(),
    character,
    locale: "en",
    world: "otherworld",
    place: "street",
    placeDescription: "A windy market on a floating island.",
    caption: "My neighbour's cat on the windowsill",
    image: { data: jpeg, width: 1280, height: 960 },
    ...patch,
  });
}

const reply = (patch: Partial<PhotoReply> = {}): PhotoReply => ({
  observation: { description: "A grey cat asleep on a sunny windowsill next to a potted plant.", subjects: ["cat", "windowsill", "plant"], clarity: "clear", containsPeople: false },
  reactionType: "curious",
  dialogue: "Is it… asleep? It looks like it owns that whole window.",
  emotion: "happy",
  intensity: 0.4,
  movementIntent: "lean_in",
  relationshipChanges: { trust: 0, affection: 1 },
  memory: { suggestSave: true, summary: "The visitor showed me a grey cat asleep on a sunny windowsill.", significance: "it looked so peaceful", importance: 2 },
  followUpQuestion: "Does it let anyone pet it?",
  staysInCharacter: true,
  ...patch,
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  photoRoute(new Request("http://x/api/ai/photo", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

// ---------------------------------------------------------------- what the AI is told

describe("what the AI is told about a photo", () => {
  it("sends the image first, then the character's canon, state, bond with the player, memories and the caption", () => {
    const req = build(mira());
    expect(PhotoRequestSchema.safeParse(req).success).toBe(true);
    const content = photoContent(req);
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg } });
    expect(content[1].type).toBe("text");
    const text = photoText(req);
    expect(text).toContain("<game_language>English</game_language>");
    expect(text).toContain("<character");
    expect(text).toContain("Strangers who stand too close"); // Mira's written fears / canon
    expect(text).toContain("<player_bond");
    expect(text).toContain("barely knows them");
    expect(text).toContain("My neighbour's cat on the windowsill");
  });

  it("the rules: only what is visible, uncertainty allowed, never identify people or infer sensitive traits, vary reactions", () => {
    expect(PHOTO_SYSTEM).toMatch(/Never invent details/);
    expect(PHOTO_SYSTEM).toMatch(/ask what it is/);
    expect(PHOTO_SYSTEM).toMatch(/Never identify anyone/);
    expect(PHOTO_SYSTEM).toMatch(/sensitive traits/);
    expect(PHOTO_SYSTEM).toMatch(/Avoid generic praise/);
    expect(PHOTO_SYSTEM).toMatch(/recent_reactions/);
  });

  it("the same photo with different personalities or relationships gives different requests", () => {
    const a = photoText(build(mira()));
    const b = photoText(build(tobi()));
    expect(a).not.toEqual(b);
    const close: StoryState = { ...story0(), player: { [mira().id]: { trust: 60, affection: 70, familiarity: 50, photos: 6, recent: [] } } };
    const wary: StoryState = { ...story0(), player: { [mira().id]: { trust: -40, affection: -30, familiarity: 30, photos: 2, recent: [] } } };
    expect(photoText(build(mira(), { story: close }))).toContain("In short: close.");
    expect(photoText(build(mira(), { story: wary }))).toContain("In short: wary of them.");
  });

  it("includes photo moments with the player first, and the last reactions so the next one differs", () => {
    const m = mira();
    let s = story0();
    s = applyPhotoReaction(s, validatePhotoReply(reply(), m, s), m);
    s = addPhotoMemory(s, m, validatePhotoReply(reply(), m, s), { photoId: "photo-1", caption: "" }, "ai").story;
    const req = build(m, { story: s });
    expect(req.memories[0]).toMatchObject({ withName: "the visitor" });
    expect(req.recentReactions).toHaveLength(1);
    expect(req.player.photosShared).toBe(1);
    expect(photoText(req)).toContain("<recent_reactions");
  });

  it("uses the game language (Chinese) and keeps names as written", () => {
    const req = build(mira("zh-CN"), { locale: "zh-CN", caption: "我家的猫" });
    expect(req.locale).toBe("zh-CN");
    expect(photoText(req)).toContain("Simplified Chinese");
    expect(photoText(req)).toContain(mira("zh-CN").name);
  });
});

// ---------------------------------------------------------------- server checks

describe("server checks", () => {
  it("cleans the words, clamps numbers and caps tags", () => {
    const r = sanitizePhotoReply(reply({ dialogue: 'Mira: "*leans in* Is that a cat?"', intensity: 7, relationshipChanges: { trust: 40, affection: -40 }, memory: { suggestSave: true, summary: "x", significance: "", importance: 9 }, observation: { ...reply().observation, subjects: ["a", "b", "c", "d", "e", "f", "a"] } }), build(mira()));
    expect(r.dialogue).toBe("Is that a cat?");
    expect(r.intensity).toBe(1);
    expect(r.relationshipChanges).toEqual({ trust: 5, affection: -5 });
    expect(r.memory.importance).toBe(3);
    expect(r.observation.subjects).toHaveLength(5);
  });

  it("rejects assistant-speak, wrong language, repeats and failed self-checks", () => {
    const req = build(mira());
    expect(photoProblem(reply(), req)).toBeNull();
    expect(photoProblem(reply({ dialogue: "As an AI, I can see a cat in this image." }), req)).toBe("out_of_character");
    expect(photoProblem(reply({ staysInCharacter: false }), req)).toBe("self_check");
    expect(photoProblem(reply({ dialogue: "这是一只猫吗？" }), req)).toBe("wrong_language");
    const zhReq = build(mira("zh-CN"), { locale: "zh-CN" });
    expect(photoProblem(reply({ dialogue: "这是一只猫吗？", followUpQuestion: "", observation: { ...reply().observation, description: "窗台上睡着一只灰猫。" }, memory: { ...reply().memory, summary: "访客给我看了一只猫。" } }), zhReq)).toBeNull();
    const again = { ...req, recentReactions: [{ type: "curious" as const, dialogue: "Is it… asleep? It looks like it owns that whole window." }] };
    expect(photoProblem(reply(), again)).toBe("repeat");
  });

  it("accepts only real JPEG / PNG / WebP bytes of a sensible size, matching the declared type", () => {
    expect(sniffImage(Buffer.from(jpeg, "base64"))).toBe("image/jpeg");
    expect(sniffImage(pngBytes)).toBe("image/png");
    expect(checkImage(jpeg, "image/jpeg")).toMatchObject({ ok: true });
    expect(checkImage(pngBytes.toString("base64"), "image/jpeg")).toEqual({ ok: false, problem: "type" });
    expect(checkImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64"), "image/jpeg")).toEqual({ ok: false, problem: "type" });
    expect(checkImage("not base64 at all!", "image/jpeg")).toEqual({ ok: false, problem: "type" });
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(PHOTO_AI_MAX_BYTES)]).toString("base64");
    expect(checkImage(big, "image/jpeg")).toEqual({ ok: false, problem: "size" });
  });
});

// ---------------------------------------------------------------- game engine

describe("the game engine validates a photo reaction", () => {
  it("caps the bond change and guards strong feelings", () => {
    const m = mira();
    const v = validatePhotoReply(reply({ relationshipChanges: { trust: 9, affection: -9 } }), m, story0());
    expect(v.bond).toEqual({ trust: PHOTO_STEP, affection: -PHOTO_STEP });
    const fond: StoryState = { ...story0(), player: { [m.id]: { trust: 60, affection: 60, familiarity: 50, photos: 3, recent: [] } } };
    const w = validatePhotoReply(reply({ relationshipChanges: { trust: -3, affection: -3 } }), m, fond);
    expect(w.bond).toEqual({ trust: -1, affection: -1 });
  });

  it("canon and emotion rules: masked feelings, no retreat for the brave, no happy hop while upset", () => {
    const masked = validatePhotoReply(reply({ emotion: "affectionate", intensity: 0.9 }), wren(), story0());
    expect(masked.emotion).toBe("embarrassed");
    const brave = makeChar({ id: "brave", name: "Brave", rules: "Never backs down from a fight." });
    expect(validatePhotoReply(reply({ movementIntent: "step_back", emotion: "anxious" }), brave, story0()).move).toBe("none");
    expect(validatePhotoReply(reply({ movementIntent: "hop", emotion: "sad" }), mira(), story0()).move).toBe("fidget");
    expect(validatePhotoReply(reply({ movementIntent: "lean_in", emotion: "anxious", intensity: 0.6 }), mira(), story0()).move).toBe("step_back");
  });

  it("only allowed emotions and movements get through the schema", () => {
    expect(PhotoReplySchema.safeParse({ ...reply(), movementIntent: "teleport" }).success).toBe(false);
    expect(PhotoReplySchema.safeParse({ ...reply(), emotion: "furious" }).success).toBe(false);
  });

  it("applies emotion and bond, remembers the reaction for variety, and does NOT store a memory by itself", () => {
    const m = mira();
    let s = story0();
    for (let i = 0; i < 6; i++) s = applyPhotoReaction(s, validatePhotoReply(reply({ dialogue: `Reaction ${i}` }), m, s), m, 1000 + i);
    const st = s.characters[m.id];
    expect(st.emotion).toBe("happy");
    expect(st.memories).toHaveLength(0);
    expect(s.player![m.id]).toMatchObject({ photos: 6, familiarity: 6 * PHOTO_FAMILIARITY, affection: 6 });
    expect(s.player![m.id].recent).toHaveLength(RECENT_KEEP);
  });
});

// ---------------------------------------------------------------- memory

describe("photo memories", () => {
  beforeEach(() => __resetKeepsakesForTests());

  it("saves to the right character: an AI summary with the photo linked by id, kept separate from the photo file", async () => {
    const m = mira();
    const t = tobi();
    const v = validatePhotoReply(reply(), m, story0());
    const photo = await savePhoto({ worldId: "w1", characterId: m.id, blob: new Blob([Buffer.from(jpeg, "base64")], { type: "image/jpeg" }), width: 4, height: 3, caption: "cat", source: "upload" });
    const { story, memoryId } = addPhotoMemory(story0(), m, v, { photoId: photo.id, caption: "cat" }, "ai");
    const mem = story.characters[m.id].memories.find((x) => x.id === memoryId)!;
    expect(mem).toMatchObject({ withId: PLAYER_ID, eventType: "photo.shared", note: v.memory.note, importance: 2, photo: { photoId: photo.id, description: v.memory.description, caption: "cat", said: v.dialogue } });
    expect(story.characters[t.id]).toBeUndefined();
    // Only the id is in the save; the image is not.
    expect(JSON.stringify(story)).not.toContain(jpeg.slice(0, 40));
    // Save round trip.
    expect(JSON.parse(JSON.stringify(story)).characters[m.id].memories[0].photo.photoId).toBe(photo.id);
  });

  it("photos stay in their own world: another world can't read or delete them", async () => {
    const p = await savePhoto({ worldId: "w1", characterId: "c1", blob: new Blob(["x"]), width: 1, height: 1, caption: "", source: "camera" });
    expect(await getPhoto("w2", p.id)).toBeNull();
    expect(await deletePhoto("w2", p.id)).toBe(false);
    expect(await getPhoto("w1", p.id)).not.toBeNull();
  });

  it("deleting the photo removes the file and the link, the memory stays; forgetting the memory frees the photo", async () => {
    const m = mira();
    const p = await savePhoto({ worldId: "w1", characterId: m.id, blob: new Blob(["x"]), width: 1, height: 1, caption: "", source: "camera" });
    const { story, memoryId } = addPhotoMemory(story0(), m, validatePhotoReply(reply(), m, story0()), { photoId: p.id, caption: "" }, "ai");
    expect(linkedPhotoIds(story).has(p.id)).toBe(true);
    expect(await deletePhoto("w1", p.id)).toBe(true);
    const after = unlinkPhoto(story, p.id);
    expect(after.characters[m.id].memories[0].photo?.photoId).toBeNull();
    expect(after.characters[m.id].memories[0].note).toBeTruthy();
    // Forgetting a memory: its photo is no longer linked, so the clean-up removes it.
    const p2 = await savePhoto({ worldId: "w1", characterId: m.id, blob: new Blob(["y"]), width: 1, height: 1, caption: "", source: "camera" });
    const r2 = addPhotoMemory(story0(), m, validatePhotoReply(reply(), m, story0()), { photoId: p2.id, caption: "" }, "ai");
    const forgot = editMemory(r2.story, m.id, r2.memoryId, null);
    expect(linkedPhotoIds(forgot).size).toBe(0);
    expect(await prunePhotos("w1", linkedPhotoIds(forgot), 0, Date.now() + 1)).toBe(1);
    expect(await listPhotos("w1")).toHaveLength(0);
    expect(memoryId).toBeTruthy();
  });

  it("recent photos are never pruned while their memory is being written", async () => {
    await savePhoto({ worldId: "w1", characterId: "c1", blob: new Blob(["x"]), width: 1, height: 1, caption: "", source: "camera" });
    expect(await prunePhotos("w1", new Set())).toBe(0);
  });

  it("duplicating a world copies photos with new ids and the copy's memories point at the copies", async () => {
    const m = mira();
    const p = await savePhoto({ worldId: "w1", characterId: m.id, blob: new Blob(["x"]), width: 1, height: 1, caption: "", source: "camera" });
    const { story } = addPhotoMemory(story0(), m, validatePhotoReply(reply(), m, story0()), { photoId: p.id, caption: "" }, "ai");
    const charIds = new Map([[m.id, "copy-mira"]]);
    const keepIds = await copyWorldKeepsakes("w1", "w2", charIds);
    const copied = remapIds({ story }, new Map([...charIds, ...keepIds])).story;
    const newPhotoId = copied.characters["copy-mira"].memories[0].photo!.photoId!;
    expect(newPhotoId).not.toBe(p.id);
    expect(await getPhoto("w2", newPhotoId)).toMatchObject({ characterId: "copy-mira", worldId: "w2" });
    // Deleting the copy's photo leaves the original alone.
    await deletePhoto("w2", newPhotoId);
    expect(await getPhoto("w1", p.id)).not.toBeNull();
  });

  it("later conversations can use the photo memory (as a moment with 'the visitor')", () => {
    const m = mira();
    const { story } = addPhotoMemory(story0(), m, validatePhotoReply(reply({ memory: { ...reply().memory, importance: 3 } }), m, story0()), { photoId: "photo-x", caption: "" }, "ai");
    const req = buildTalkRequest({ story, speaker: tobi(), listener: m, locale: "en", world: "otherworld", place: "street", placeDescription: "", message: "Seen any cats lately?", kind: "typed", topic: null, decision: null, recentEvents: [], usedTopics: [] });
    const mem = req.memories.find((x) => x.withName === "the visitor");
    expect(mem?.summary).toMatch(/grey cat/);
  });
});

// ---------------------------------------------------------------- route

describe("/api/ai/photo", () => {
  beforeEach(() => {
    resetTalkLimits();
    process.env.ANTHROPIC_API_KEY = "sk-test-secret";
  });
  afterEach(() => {
    mocked.mockReset();
    imageCheck.mockReset();
    imageCheck.mockImplementation(async () => {});
    vi.unstubAllEnvs();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_TALK_MOCK;
    delete process.env.AI_TALK_PER_MINUTE;
  });

  it("explains when no key is configured, and never invents a reaction", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post(build(mira()));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("validates the request, the image type and the size", async () => {
    expect((await post({ hello: "world" })).status).toBe(400);
    expect((await post("{nope")).status).toBe(400);
    const png = build(mira());
    png.image = { ...png.image, data: pngBytes.toString("base64") }; // declared jpeg, really png
    expect((await post(png)).status).toBe(415);
    expect((await post("z".repeat(2_600_000))).status).toBe(413);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("checks the model can see images, then returns a checked reaction marked as real AI, without leaking the key", async () => {
    mocked.mockResolvedValueOnce(reply());
    const res = await post(build(mira()));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("sk-test-secret");
    expect(text).not.toContain(jpeg.slice(0, 40)); // the image isn't echoed back
    const data = JSON.parse(text);
    expect(data).toMatchObject({ source: "ai", attempts: 1 });
    expect(imageCheck).toHaveBeenCalledTimes(1);
    const call = mocked.mock.calls[0][0];
    expect(Array.isArray(call.user)).toBe(true);
    expect((call.user as { type: string }[])[0].type).toBe("image");
    expect(call.system).toBe(PHOTO_SYSTEM);
  });

  it("says so when the configured model can't take images", async () => {
    imageCheck.mockRejectedValueOnce(new AiError("unsupported", "no images"));
    const res = await post(build(mira()));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("unsupported");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("retries once when a reaction breaks the rules, then rejects it", async () => {
    mocked.mockResolvedValueOnce(reply({ dialogue: "As an AI, I see a cat." })).mockResolvedValueOnce(reply());
    const ok = await post(build(mira()));
    expect((await ok.json()).attempts).toBe(2);
    const retry = mocked.mock.calls[1][0].user as { type: string; text?: string }[];
    expect(retry[1].text).toContain('<rejected_reply reason="out_of_character">');
    mocked.mockReset();
    mocked.mockResolvedValue(reply({ staysInCharacter: false }));
    const bad = await post(build(mira()));
    expect(bad.status).toBe(422);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("reports API failures and timeouts as failures", async () => {
    mocked.mockRejectedValueOnce(new AiError("timeout", "slow"));
    expect((await post(build(mira()))).status).toBe(504);
    mocked.mockRejectedValueOnce(new AiError("failed", "boom"));
    expect((await post(build(mira()))).status).toBe(502);
    mocked.mockRejectedValueOnce(new AiError("auth", "bad key"));
    expect((await (await post(build(mira()))).json()).error).toBe("auth");
  });

  it("limits usage per visitor", async () => {
    process.env.AI_TALK_PER_MINUTE = "1";
    mocked.mockResolvedValue(reply());
    const h = { "x-forwarded-for": "10.0.0.9" };
    expect((await post(build(mira()), h)).status).toBe(200);
    const second = await post(build(mira()), h);
    expect(second.status).toBe(429);
  });

  it("developer TEST reactions are labelled, honest about not looking, and never available in production", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_TALK_MOCK = "1";
    const res = await post(build(mira("zh-CN"), { locale: "zh-CN", caption: "" }));
    const data = await res.json();
    expect(data.source).toBe("mock");
    expect(data.reply.observation.clarity).toBe("unclear");
    expect(mocked).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(build(mira()))).status).toBe(503);
    expect(mockPhotoReply(build(mira())).dialogue).toBeTruthy();
  });
});

// ---------------------------------------------------------------- browser side

describe("sending from the game", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("accepts a valid reaction and rejects anything outside the contract", async () => {
    expect((await sendPhotoRequest(build(mira()), undefined, ok({ reply: reply(), source: "ai", model: "m", attempts: 1 }))).ok).toBe(true);
    expect(await sendPhotoRequest(build(mira()), undefined, ok({ reply: { ...reply(), movementIntent: "fly_away" }, source: "ai" }))).toEqual({ ok: false, code: "invalid_output" });
    expect((await sendPhotoRequest(build(mira()), undefined, ok({ reply: reply(), source: "pretend" }))).ok).toBe(false);
  });
  it("turns errors, offline and cancellation into failures", async () => {
    expect(await sendPhotoRequest(build(mira()), undefined, ok({ error: "unsupported" }, 503))).toEqual({ ok: false, code: "unsupported" });
    const offline = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await sendPhotoRequest(build(mira()), undefined, offline)).toEqual({ ok: false, code: "offline" });
    const ctrl = new AbortController();
    const hang = vi.fn((_u: unknown, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const p = sendPhotoRequest(build(mira()), ctrl.signal, hang);
    ctrl.abort();
    expect(await p).toEqual({ ok: false, code: "cancelled" });
  });
  it("every photo error has words in both languages", () => {
    const codes = ["not_configured", "unsupported", "refused", "invalid_output", "rate_limited", "busy", "limit", "auth", "failed", "offline", "timeout", "bad_request", "bad_image", "too_large", "cancelled"];
    for (const c of codes) {
      expect((en.keepsakes.photo.error as Record<string, string>)[c]).toBeTruthy();
      expect((zh.keepsakes.photo.error as Record<string, string>)[c]).toBeTruthy();
    }
  });
});
