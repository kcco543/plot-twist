/**
 * Gifts (Phase 3): the reaction request and route (model mocked), the game
 * engine's validation, transfer checks, world-specific gift instances,
 * memories, display spots, rule-based autonomy, knowledge, and gifts in
 * later conversations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/claude", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/claude")>();
  return { ...real, structuredCall: vi.fn(), assertImageInput: vi.fn(async () => {}) };
});

import { AiError, structuredCall } from "@/lib/ai/server/claude";
import { resetTalkLimits } from "@/lib/ai/server/limits";
import { GIFT_SYSTEM, giftContent, giftText } from "@/lib/ai/server/giftReaction";
import { talkUser } from "@/lib/ai/server/talk";
import { POST as route } from "@/app/api/ai/gift-reaction/route";
import { CARRY_MAX, checkTransfer, displaySpots, freeSpotCount, giftAutonomy, giveGift, MOVE_COOLDOWN, moveGift, placeDisplayed, validateGiftReply, type ValidatedGift } from "@/lib/gifts/apply";
import { giftProblem, sanitizeGiftReply } from "@/lib/gifts/checks";
import { GiftReactionReplySchema, GiftReactionRequestSchema, type GiftReactionReply } from "@/lib/gifts/contract";
import { buildGiftRequest, sendGiftRequest } from "@/lib/gifts/request";
import { sampleCharacter } from "@/lib/mind/scenarios";
import { remapIds } from "@/lib/saves/remap";
import { emptySave, migrateSave } from "@/lib/gameStore";
import { forgetCharacterInStory } from "@/lib/library/templates";
import { hitsObstacle, roomFor } from "@/lib/stage/room";
import { emptyStory } from "@/lib/story/engine";
import { pushTalkLine } from "@/lib/talk/ai/apply";
import { buildTalkRequest } from "@/lib/talk/ai/request";
import { PLAYER_ID, type Character, type StoryState } from "@/lib/types";
import { makeChar } from "./helpers";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";

const mocked = vi.mocked(structuredCall);
const mira = (l: "en" | "zh-CN" = "en") => sampleCharacter("mira", l);
const wren = (l: "en" | "zh-CN" = "en") => sampleCharacter("wren", l);
const tobi = (l: "en" | "zh-CN" = "en") => sampleCharacter("tobi", l);
const story0 = (): StoryState => ({ ...emptyStory(), turn: 10, relations: {}, decisions: [] });
const png = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString("base64");
const item = (patch: Partial<{ id: string; worldId: string; name: string; description: string; image: string | null }> = {}) => ({ id: "gift-item-1", worldId: "w1", name: "Moonlight Cookie", description: "A star-shaped cookie that glows faintly.", image: png, ...patch });

const reply = (patch: Partial<GiftReactionReply> = {}): GiftReactionReply => ({
  decision: "accept",
  interpretation: "A glowing cookie, probably for late nights drawing maps.",
  dialogue: "It glows? …I'll save it for the next long night at my desk.",
  emotion: "happy",
  intensity: 0.4,
  movementIntent: "lean_in",
  keep: "displayed",
  keepReason: "so it lights the map table",
  relationshipChanges: { trust: 1, affection: 2 },
  memory: { summary: "The visitor gave me a glowing cookie they drew themselves.", significance: "someone noticed my late nights", importance: 2 },
  followUpQuestion: "Did you bake it, or just draw it?",
  staysInCharacter: true,
  ...patch,
});
const req = (c: Character = mira(), s: StoryState = story0(), patch: Partial<Parameters<typeof buildGiftRequest>[0]> = {}) =>
  buildGiftRequest({ story: s, character: c, locale: "en", world: "otherworld", place: "interior", placeDescription: "", item: item(), freeDisplaySpots: 3, ...patch });
const post = (body: unknown) => route(new Request("http://x/api/ai/gift-reaction", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

function given(c: Character, s: StoryState, r: GiftReactionReply = reply(), present: string[] = [mira().id, wren().id, tobi().id], it = item()) {
  const v = validateGiftReply(r, c, s, { freeSpots: freeSpotCount(s, 3) });
  return { v, ...giveGift(s, it, c, v, "ai", present, 1000) };
}

// ---------------------------------------------------------------- request + prompt

describe("what the AI is told about a gift", () => {
  it("the gift, its picture, the character, the bond, earlier gifts and free display spots", () => {
    const r = req();
    expect(GiftReactionRequestSchema.safeParse(r).success).toBe(true);
    expect(r.gift.image).not.toContain("data:");
    const content = giftContent(r) as { type: string }[];
    expect(content[0].type).toBe("image");
    const text = giftText(r);
    expect(text).toContain("Moonlight Cookie");
    expect(text).toContain("<free_display_spots>3</free_display_spots>");
    expect(text).toContain("Strangers who stand too close");
    expect(text).toContain("<player_bond");
  });
  it("marks a repeated gift and lists where earlier ones ended up", () => {
    const { story } = given(tobi(), story0());
    const r = req(tobi(), story);
    expect(r.gift.repeat).toBe(true);
    expect(r.earlierGifts[0]).toMatchObject({ name: "Moonlight Cookie", display: "displayed" });
    expect(r.player.giftsGiven).toBe(1);
  });
  it("the rules allow refusal and indifference, and every keeping place", () => {
    expect(GIFT_SYSTEM).toMatch(/not everyone loves every gift/);
    for (const k of ["displayed", "carried", "private", "hidden", "stored"]) expect(GIFT_SYSTEM).toContain(k);
    expect(GIFT_SYSTEM).toMatch(/Avoid generic thanks/);
  });
  it("checks language and assistant-speak", () => {
    const r = req();
    expect(giftProblem(sanitizeGiftReply(reply(), r), r)).toBeNull();
    expect(giftProblem(reply({ dialogue: "As an AI, I appreciate the gift." }), r)).toBe("out_of_character");
    expect(giftProblem(reply({ dialogue: "谢谢你的饼干。" }), r)).toBe("wrong_language");
    const zr = req(mira("zh-CN"), story0(), { locale: "zh-CN" });
    expect(giftProblem(reply({ dialogue: "会发光？Moonlight Cookie……我留着。", interpretation: "一块会发光的饼干。", followUpQuestion: "", memory: { summary: "访客送了我一块发光饼干。", significance: "", importance: 1 } }), zr)).toBeNull();
  });
});

// ---------------------------------------------------------------- engine

describe("the game engine decides", () => {
  it("canon wins: a character who never accepts gifts refuses, and gets no warmth from it", () => {
    const strict = makeChar({ id: "strict", name: "Strict", rules: "Never accepts gifts from anyone." });
    const v = validateGiftReply(reply(), strict, story0(), { freeSpots: 3 });
    expect(v.decision).toBe("refuse");
    expect(v.display).toBe("refused");
    expect(v.bond.affection).toBe(0);
  });
  it("a shrug isn't put on show; reserved characters keep things private; no free spot = carried; full hands = private", () => {
    expect(validateGiftReply(reply({ decision: "indifferent" }), tobi(), story0(), { freeSpots: 3 }).display).toBe("stored");
    const shy = makeChar({ id: "shy", name: "Shy", traits: { expressiveness: 10 } });
    expect(validateGiftReply(reply(), shy, story0(), { freeSpots: 3 }).display).toBe("private");
    expect(validateGiftReply(reply(), tobi(), story0(), { freeSpots: 0 }).display).toBe("carried");
    let s = story0();
    for (let i = 0; i < CARRY_MAX; i++) s = given(tobi(), s, reply({ keep: "carried" }), [], item({ id: `it-${i}` })).story;
    expect(validateGiftReply(reply({ keep: "carried" }), tobi(), s, { freeSpots: 3 }).display).toBe("private");
  });
  it("only allowed decisions, places and movements get through", () => {
    expect(GiftReactionReplySchema.safeParse({ ...reply(), keep: "sold" }).success).toBe(false);
    expect(GiftReactionReplySchema.safeParse({ ...reply(), decision: "eat" }).success).toBe(false);
  });
  it("transfer: same world, a real character, not twice", () => {
    const cast = [mira(), tobi()];
    expect(checkTransfer(story0(), item(), mira().id, { worldId: "w1", cast })).toBeNull();
    expect(checkTransfer(story0(), item({ worldId: "w2" }), mira().id, { worldId: "w1", cast })).toBe("not_in_world");
    expect(checkTransfer(story0(), item(), "nobody", { worldId: "w1", cast })).toBe("unknown_character");
    const { story } = given(mira(), story0());
    expect(checkTransfer(story, item(), mira().id, { worldId: "w1", cast })).toBe("already_has");
    expect(checkTransfer(story, item(), tobi().id, { worldId: "w1", cast })).toBeNull();
  });
});

// ---------------------------------------------------------------- recording

describe("a given gift lives in this world", () => {
  it("instance: owner, place, interpretation, history; memory; bond; knowledge", () => {
    const m = tobi(); // outgoing, so the cookie goes on display
    const { story, instanceId } = given(m, story0());
    const g = story.gifts![instanceId];
    expect(g).toMatchObject({ itemId: "gift-item-1", owner: m.id, recipient: m.id, creator: PLAYER_ID, display: "displayed", interpretation: expect.stringMatching(/cookie/), receivedTurn: 10 });
    expect(g.history.map((h) => h.kind)).toEqual(["given", "accepted"]);
    expect(g.knownBy).toEqual(expect.arrayContaining([m.id, wren().id, tobi().id])); // displayed: everyone present saw it
    const mem = story.characters[m.id].memories.at(-1)!;
    expect(mem).toMatchObject({ withId: PLAYER_ID, eventType: "gift.received", gift: { instanceId, name: "Moonlight Cookie" } });
    expect(story.player![m.id].gifts).toBe(1);
    expect(story.player![m.id].affection).toBeGreaterThan(0);
    expect(story.player![m.id].affection).toBeLessThanOrEqual(2);
    expect(story.characters[m.id].emotion).toBe("happy");
  });
  it("a reserved character keeps a gift private even when the AI says display it", () => {
    const { v, story, instanceId } = given(mira(), story0());
    expect(v.adjustments).toContain("display:reserved_keeps_private");
    expect(story.gifts![instanceId].display).toBe("private");
    expect(story.gifts![instanceId].knownBy).toEqual([mira().id]);
  });
  it("hidden or private gifts are known only to the owner; refused gifts go back to the player", () => {
    const hidden = given(mira(), story0(), reply({ keep: "hidden" }));
    expect(hidden.story.gifts![hidden.instanceId].knownBy).toEqual([mira().id]);
    const refused = given(tobi(), story0(), reply({ decision: "refuse" }));
    const g = refused.story.gifts![refused.instanceId];
    expect(g.owner).toBe(PLAYER_ID);
    expect(g.display).toBe("refused");
    expect(refused.story.characters[tobi().id].memories.at(-1)!.eventType).toBe("gift.refused");
  });
  it("reopening a world keeps its gifts and the visitor's bonds", () => {
    const { story, instanceId } = given(tobi(), story0());
    const loaded = migrateSave(JSON.parse(JSON.stringify({ ...emptySave, story })));
    expect(loaded.story.gifts![instanceId].display).toBe("displayed");
    expect(loaded.story.player![tobi().id].gifts).toBe(1);
  });
  it("removing a character from the world removes their gifts and what they saw", () => {
    const a = given(tobi(), story0());
    const b = given(mira(), a.story, reply(), [mira().id, tobi().id], item({ id: "it-2" }));
    const out = forgetCharacterInStory(b.story, tobi().id);
    expect(out.gifts![a.instanceId]).toBeUndefined();
    expect(out.gifts![b.instanceId].knownBy).not.toContain(tobi().id);
  });
  it("survives a save round trip; duplicating a world gives the copy its own gift with new character ids", () => {
    const { story, instanceId } = given(mira(), story0());
    const back = JSON.parse(JSON.stringify(story)) as StoryState;
    expect(back.gifts![instanceId].name).toBe("Moonlight Cookie");
    const copy = remapIds(story, new Map([[mira().id, "copy-mira"], ["gift-item-1", "gift-item-copy"]]));
    expect(copy.gifts![instanceId]).toMatchObject({ owner: "copy-mira", recipient: "copy-mira", itemId: "gift-item-copy" });
    expect(story.gifts![instanceId].owner).toBe(mira().id); // original untouched
  });
});

// ---------------------------------------------------------------- display

describe("display spots", () => {
  it("are on furniture (never where people walk), at most 3, and only free ones are used", () => {
    for (const world of ["otherworld", "modern"] as const)
      for (const place of ["interior", "street", "wilderness", "ruins", "dreamscape"] as const) {
        const room = roomFor(world, place);
        const spots = displaySpots(room);
        expect(spots.length).toBeLessThanOrEqual(3);
        for (const s of spots) expect(hitsObstacle(room, s)).not.toBeNull();
      }
    let s = story0();
    for (let i = 0; i < 4; i++) s = given(tobi(), s, reply(), [], item({ id: `it-${i}` })).story;
    const spots = displaySpots(roomFor("otherworld", "interior"));
    expect(placeDisplayed(s, spots).length).toBe(Math.min(3, spots.length));
    expect(Object.values(s.gifts!).filter((g) => g.display === "displayed").length).toBe(3); // 4th had no free spot
  });
});

// ---------------------------------------------------------------- autonomy

describe("characters handle their gifts by rules, once per turn", () => {
  const cast = () => [mira(), wren(), tobi()];
  it("fond → puts it on display; cooled → stores it; distrust → hides; trust → brings it out", () => {
    let s = given(tobi(), story0(), reply({ keep: "carried" })).story;
    s = { ...s, turn: s.turn + MOVE_COOLDOWN, player: { ...s.player, [tobi().id]: { ...s.player![tobi().id], affection: 60 } } };
    let r = giftAutonomy(s, cast(), 3);
    expect(r.moves).toEqual([expect.objectContaining({ owner: tobi().id, from: "carried", to: "displayed", why: "proud" })]);
    s = { ...r.story, turn: r.story.turn + MOVE_COOLDOWN, player: { ...r.story.player, [tobi().id]: { ...r.story.player![tobi().id], affection: -30 } } };
    r = giftAutonomy(s, cast(), 3);
    expect(r.moves[0]).toMatchObject({ to: "stored", why: "cooled" });

    let p = given(mira(), story0(), reply({ keep: "private" })).story;
    p = { ...p, turn: p.turn + MOVE_COOLDOWN, player: { ...p.player, [mira().id]: { ...p.player![mira().id], trust: -30 } } };
    r = giftAutonomy(p, cast(), 3);
    expect(r.moves[0]).toMatchObject({ to: "hidden", why: "guarded" });
    p = { ...r.story, turn: r.story.turn + MOVE_COOLDOWN, player: { ...r.story.player, [mira().id]: { ...r.story.player![mira().id], trust: 50 } } };
    expect(giftAutonomy(p, cast(), 3).moves[0]).toMatchObject({ to: "private", why: "opened_up" });
  });
  it("waits a few turns between moves, and nothing changes without a reason", () => {
    let s = given(tobi(), story0(), reply({ keep: "carried" })).story;
    s = { ...s, player: { ...s.player, [tobi().id]: { ...s.player![tobi().id], affection: 60 } } };
    expect(giftAutonomy(s, cast(), 3).moves).toHaveLength(0); // same turn it was received
    const calm = { ...given(tobi(), story0(), reply({ keep: "carried" })).story, turn: 20 };
    expect(giftAutonomy(calm, cast(), 3).moves).toHaveLength(0);
  });
  it("people who talk with the owner learn about a carried gift; hidden ones stay secret", () => {
    let s = given(tobi(), story0(), reply({ keep: "carried" }), []).story;
    s = given(mira(), s, reply({ keep: "hidden" }), [], item({ id: "secret" })).story;
    s = pushTalkLine(s, tobi().id, wren().id, { from: wren().id, text: "Hi", turn: 11, at: 0, source: "ai" });
    s = pushTalkLine(s, mira().id, wren().id, { from: wren().id, text: "Hi", turn: 11, at: 0, source: "ai" });
    const r = giftAutonomy({ ...s, turn: 11 }, cast(), 3);
    const gifts = Object.values(r.story.gifts!);
    expect(gifts.find((g) => g.owner === tobi().id)!.knownBy).toContain(wren().id);
    expect(gifts.find((g) => g.owner === mira().id)!.knownBy).toEqual([mira().id]);
  });
  it("moving is recorded in the gift's history", () => {
    const { story, instanceId } = given(mira(), story0());
    const s = moveGift(story, instanceId, "hidden", "embarrassed", []);
    expect(s.gifts![instanceId].history.at(-1)).toMatchObject({ kind: "moved", display: "hidden", by: mira().id });
  });
});

// ---------------------------------------------------------------- conversations

describe("gifts in later conversations", () => {
  const talk = (s: StoryState, speaker: Character, listener: Character, message: string) =>
    buildTalkRequest({ story: s, speaker, listener, locale: "en", world: "otherworld", place: "interior", placeDescription: "", message, kind: "typed", topic: null, decision: null, recentEvents: [], usedTopics: [] });
  it("only when relevant: asked about gifts, named, or on display where the speaker saw it", () => {
    const hidden = given(mira(), story0(), reply({ keep: "hidden" }), []).story;
    expect(talk(hidden, tobi(), mira(), "Nice weather.").gifts).toEqual([]);
    const asked = talk(hidden, tobi(), mira(), "Did anyone give you a gift lately?");
    expect(asked.gifts).toEqual([expect.objectContaining({ name: "Moonlight Cookie", where: "hidden", speakerKnows: false })]);
    expect(talkUser(asked)).toMatch(/does NOT know about it — .* must not reveal it/);
    const shown = given(tobi(), story0()).story;
    expect(talk(shown, mira(), tobi(), "Nice weather.").gifts).toEqual([expect.objectContaining({ where: "displayed", speakerKnows: true })]);
  });
  it("the speaker's own hidden gifts are never sent to the listener", () => {
    const s = given(tobi(), story0(), reply({ keep: "hidden" }), []).story;
    expect(talk(s, tobi(), mira(), "I got a gift!").gifts).toEqual([]);
  });
  it("the gift memory is there for later conversations", () => {
    const { story } = given(mira(), story0());
    const r = talk(story, tobi(), mira(), "What's that glowing thing?");
    expect(r.memories.some((m) => m.withName === "the visitor" && /cookie/.test(m.summary))).toBe(true);
  });
});

// ---------------------------------------------------------------- route

describe("/api/ai/gift-reaction", () => {
  beforeEach(() => {
    resetTalkLimits();
    process.env.ANTHROPIC_API_KEY = "sk-test-secret";
  });
  afterEach(() => {
    mocked.mockReset();
    vi.unstubAllEnvs();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_TALK_MOCK;
  });
  it("explains a missing key; validates input and picture", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await post(req())).status).toBe(503);
    process.env.ANTHROPIC_API_KEY = "k";
    expect((await post({ nope: 1 })).status).toBe(400);
    const bad = req();
    bad.gift.image = Buffer.from("<svg/>").toString("base64");
    expect((await post(bad)).status).toBe(415);
    expect(mocked).not.toHaveBeenCalled();
  });
  it("returns a checked reaction marked as AI; retries once when it breaks character", async () => {
    mocked.mockResolvedValueOnce(reply({ dialogue: "As an AI, thanks." })).mockResolvedValueOnce(reply());
    const res = await post(req());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ source: "ai", attempts: 2 });
    expect(JSON.stringify(data)).not.toContain("sk-test-secret");
  });
  it("reports failures; TEST reactions only in development", async () => {
    mocked.mockRejectedValueOnce(new AiError("timeout", "slow"));
    expect((await post(req())).status).toBe(504);
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_TALK_MOCK = "1";
    expect((await (await post(req())).json()).source).toBe("mock");
    vi.stubEnv("NODE_ENV", "production");
    expect((await post(req())).status).toBe(503);
  });
  it("the browser rejects anything outside the contract", async () => {
    const f = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    expect((await sendGiftRequest(req(), undefined, f({ reply: reply(), source: "ai" }))).ok).toBe(true);
    expect(await sendGiftRequest(req(), undefined, f({ reply: { ...reply(), keep: "burned" }, source: "ai" }))).toEqual({ ok: false, code: "invalid_output" });
  });
});

describe("words in both languages", () => {
  it("every display state, transfer problem and move has EN and 中文 text", () => {
    for (const k of ["displayed", "carried", "private", "hidden", "stored", "refused"]) {
      expect((en.keepsakes.giftState as Record<string, string>)[k]).toBeTruthy();
      expect((zh.keepsakes.giftState as Record<string, string>)[k]).toBeTruthy();
    }
    for (const k of ["not_in_world", "unknown_character", "already_has", "no_name"]) expect((zh.keepsakes.gift.transfer as Record<string, string>)[k]).toBeTruthy();
    for (const k of ["displayed", "carried", "private", "hidden", "stored"]) expect((zh.keepsakes.log.giftMoved as Record<string, string>)[k]).toBeTruthy();
  });
});

export type { ValidatedGift };
