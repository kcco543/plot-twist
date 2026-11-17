/**
 * AI conversations: request building, the server's checks, the game engine's
 * validation, memory, and the /api/ai/talk route (with the model mocked).
 * Live model checks: tests/live/talk.live.test.ts (RUN_LIVE_AI=1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/claude", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/claude")>();
  return { ...real, structuredCall: vi.fn() };
});

import { AiError, structuredCall } from "@/lib/ai/server/claude";
import { resetTalkLimits } from "@/lib/ai/server/limits";
import { mockReply, TALK_SYSTEM, talkUser } from "@/lib/ai/server/talk";
import { POST as talk } from "@/app/api/ai/talk/route";
import { decide } from "@/lib/mind";
import { sampleCharacter } from "@/lib/mind/scenarios";
import { relationOf, relKey } from "@/lib/mind/relations";
import { emptyStory } from "@/lib/story/engine";
import { AI_STEP, applyReply, editMemory, pushTalkLine, REVERSAL_STEP, validateReply } from "@/lib/talk/ai/apply";
import { cleanDialogue, inLanguage, replyProblem, sanitizeReply } from "@/lib/talk/ai/checks";
import { HISTORY_MAX, MEMORY_MAX, TalkReplySchema, TalkRequestSchema, type TalkReply, type TalkRequest } from "@/lib/talk/ai/contract";
import { buildTalkRequest, sendTalkRequest, type BuildInput } from "@/lib/talk/ai/request";
import type { Character, Memory, StoryState } from "@/lib/types";
import { makeChar, seeded } from "./helpers";

const mocked = vi.mocked(structuredCall);
const mira = (l: "en" | "zh-CN" = "en") => sampleCharacter("mira", l);
const wren = (l: "en" | "zh-CN" = "en") => sampleCharacter("wren", l);
const tobi = (l: "en" | "zh-CN" = "en") => sampleCharacter("tobi", l);

const story0 = (): StoryState => ({ ...emptyStory(), turn: 10, relations: {}, decisions: [] });

function build(speaker: Character, listener: Character, patch: Partial<BuildInput> = {}): TalkRequest {
  return buildTalkRequest({
    story: story0(),
    speaker,
    listener,
    locale: "en",
    world: "otherworld",
    place: "street",
    placeDescription: "A windy market on a floating island.",
    message: "You did a beautiful job on that map.",
    kind: "topic",
    topic: "compliment",
    decision: null,
    recentEvents: [],
    usedTopics: [],
    ...patch,
  });
}

const reply = (patch: Partial<TalkReply> = {}): TalkReply => ({
  dialogue: "Oh. Thank you… I wasn't sure anyone looked at it.",
  emotion: "embarrassed",
  reactionIntensity: 0.5,
  movementIntent: "none",
  relationshipChanges: { trust: 1, affection: 2, respect: 1, tension: 0 },
  memory: { summary: "Tobi praised my map in the market.", importance: 2, kind: "complimented", thread: "none", resolves: "" },
  conversationSuggestions: [
    { label: "Ask about the map", line: "How long did the map take you?", intent: "curious" },
    { label: "Offer to help", line: "Need someone to carry your ink?", intent: "warm" },
  ],
  stance: "respond_freely",
  interpretation: { interaction: "compliment", significance: "ordinary", evidence: "praised my map" },
  staysInCharacter: true,
  ...patch,
});

const mem = (p: Partial<Memory>): Memory => ({ id: `m-${Math.random()}`, turn: 5, eventType: "talk.note", count: 1, reaction: null, withId: null, withName: "", mood: "calm", importance: 1, note: null, at: 0, ...p });

// ---------------------------------------------------------------- building the request

describe("what the AI is told", () => {
  it("includes identity, written personality, sliders, goals/fears/values, speaking style, mood, relationship, memories, history and place", () => {
    const m = mira();
    const t = tobi();
    let s = story0();
    s = { ...s, characters: { [m.id]: { mood: "calm", intensity: 0, memories: [mem({ withId: t.id, withName: "Tobi", note: "Tobi knocked over my ink pots.", importance: 2, thread: "conflict" })], emotion: "anxious", emotionLevel: 2, feelings: { anxiety: 55 } } } };
    s = pushTalkLine(s, t.id, m.id, { from: t.id, text: "Hey! Map girl!", turn: 9, at: 0, source: "builtin" });
    s = pushTalkLine(s, t.id, m.id, { from: m.id, text: "…Hello.", turn: 9, at: 0, source: "ai" });
    const decision = decide({ story: s, cast: [m, t], event: { trigger: "complimented", reactorId: m.id, otherId: t.id }, rng: seeded(3) });
    const req = build(t, m, { story: s, decision, recentEvents: ["Narrator: The wind picks up."] });
    expect(TalkRequestSchema.safeParse(req).success).toBe(true);
    const prompt = talkUser(req);
    for (const piece of [
      "Cloud-island cartographer",
      "Quiet, calm and careful",
      "Grew up alone in a lighthouse",
      "Finish the first true map",
      "Strangers who stand too close",
      "Patience. Doing things properly.",
      "Short, soft sentences",
      "introverted ↔ extroverted: 18",
      "Shows: anxious",
      "anxiety 55",
      "Tobi knocked over my ink pots.",
      "OPEN conflict",
      "Tobi: Hey! Map girl!",
      "Mira: …Hello.",
      "A windy market",
      "The wind picks up.",
      "<engine_hint>",
      "Tobi: You did a beautiful job on that map.",
      "<game_language>English</game_language>",
    ])
      expect(prompt).toContain(piece);
    expect(TALK_SYSTEM).toMatch(/locked="true" are fixed facts/);
  });

  it("marks locked canon, and two different relationships give two different requests for the same question", () => {
    const w = wren();
    const fromFriend = build(mira(), w, { message: "Are you alright?" });
    const fromRival = build(tobi(), w, { message: "Are you alright?" });
    expect(talkUser(fromFriend)).toContain('<canon locked="true">Never admits her feelings for Mira out loud.</canon>');
    // Wren → Mira (best friend, secret crush) vs Wren → Tobi (rival, enemy).
    expect(fromFriend.listenerView.affection).toBeGreaterThan(40);
    expect(fromRival.listenerView.affection).toBeLessThan(0);
    expect(fromRival.listenerView.rivalry).toBeGreaterThan(40);
    expect(talkUser(fromFriend)).not.toEqual(talkUser(fromRival));
  });

  it("sends recent lines and the most relevant memories, never the whole lifetime", () => {
    const m = mira();
    const t = tobi();
    let s = story0();
    const memories: Memory[] = Array.from({ length: 24 }, (_, i) => mem({ id: `m${i}`, withId: i % 2 ? t.id : "someone", withName: i % 2 ? "Tobi" : "Sol", importance: (i % 3) + 1, note: `memory ${i}`, turn: i }));
    memories[3] = { ...memories[3], thread: "promise", importance: 1, note: "Tobi promised to return my compass." };
    s = { ...s, characters: { [m.id]: { mood: "calm", intensity: 0, memories } } };
    for (let i = 0; i < 16; i++) s = pushTalkLine(s, t.id, m.id, { from: i % 2 ? m.id : t.id, text: `line ${i}`, turn: i, at: 0, source: "ai" });
    const req = build(t, m, { story: s });
    expect(req.history).toHaveLength(HISTORY_MAX);
    expect(req.history.at(-1)!.text).toBe("line 15");
    expect(req.memories.length).toBeLessThanOrEqual(MEMORY_MAX);
    // Open threads with this person come first, even when minor.
    expect(req.memories[0].summary).toBe("Tobi promised to return my compass.");
    expect(req.memories.filter((x) => x.withName === "Sol").length).toBeLessThanOrEqual(2);
  });

  it("uses the game language and keeps names as written (Chinese)", () => {
    const req = build(tobi("zh-CN"), mira("zh-CN"), { locale: "zh-CN", message: "你的地图画得真好！" });
    const prompt = talkUser(req);
    expect(prompt).toContain("<game_language>Simplified Chinese</game_language>");
    expect(prompt).toContain("米拉");
    expect(prompt).toContain("托比: 你的地图画得真好！");
    expect(TALK_SYSTEM).toMatch(/still answer in the game language/);
  });
});

// ---------------------------------------------------------------- server checks

describe("server checks on a reply", () => {
  const req = () => build(tobi(), mira());
  it("keeps only the spoken words and clamps numbers", () => {
    const r = sanitizeReply(reply({ dialogue: 'Mira: "*looks away* Thank you."', reactionIntensity: 4, relationshipChanges: { trust: 40, affection: -99, respect: 2.4, tension: Number.NaN } }), req());
    expect(r.dialogue).toBe("Thank you.");
    expect(r.reactionIntensity).toBe(1);
    expect(r.relationshipChanges).toEqual({ trust: 10, affection: -10, respect: 2, tension: 0 });
    expect(cleanDialogue("「好。」", "米拉")).toBe("好。");
  });
  it("drops suggestions that repeat what was already said, and duplicates", () => {
    const base = req();
    const r = sanitizeReply(
      reply({
        conversationSuggestions: [
          { label: "Compliment again", line: "You did a beautiful job on that map.", intent: "warm" },
          { label: "Ask about the map", line: "How long did the map take you?", intent: "curious" },
          { label: "Ask about the map", line: "How long did the map take you??", intent: "curious" },
          { label: "Tease", line: "Bet you got lost drawing it.", intent: "playful" },
        ],
      }),
      base,
    );
    expect(r.conversationSuggestions.map((s) => s.label)).toEqual(["Ask about the map", "Tease"]);
  });
  it("rejects assistant-speak, wrong language, own repeats and failed self-checks", () => {
    const r = req();
    expect(replyProblem(sanitizeReply(reply({ dialogue: "As an AI, I can't feel embarrassed." }), r), r)).toBe("out_of_character");
    expect(replyProblem(sanitizeReply(reply({ dialogue: "作为一个AI助手，我很高兴帮助你。" }), r), r)).toBe("out_of_character");
    expect(replyProblem(sanitizeReply(reply({ staysInCharacter: false }), r), r)).toBe("self_check");
    const zh = build(tobi("zh-CN"), mira("zh-CN"), { locale: "zh-CN" });
    expect(replyProblem(sanitizeReply(reply(), zh), zh)).toBe("wrong_language");
    const ok = sanitizeReply(reply({ dialogue: "……谢谢你，托比。", conversationSuggestions: [{ label: "问地图", line: "你画了多久？", intent: "curious" }] }), zh);
    expect(replyProblem(ok, zh)).toBeNull();
    let s = story0();
    s = pushTalkLine(s, "sample-tobi", "sample-mira", { from: "sample-mira", text: "Oh. Thank you… I wasn't sure anyone looked at it.", turn: 9, at: 0, source: "ai" });
    const again = build(tobi(), mira(), { story: s });
    expect(replyProblem(sanitizeReply(reply(), again), again)).toBe("repeat");
  });
  it("judges language by letters, not by names", () => {
    expect(inLanguage("Tobi，你又来了？", "zh-CN", ["Tobi"])).toBe(true);
    expect(inLanguage("米拉? Hi there, how are you doing today?", "en", ["米拉"])).toBe(true);
    expect(inLanguage("……！", "zh-CN", [])).toBe(true);
    expect(inLanguage("I don't know what you mean.", "zh-CN", [])).toBe(false);
  });
});

// ---------------------------------------------------------------- game engine validation

describe("the game engine validates what the AI proposes", () => {
  it("clamps relationship changes and caps the total", () => {
    const v = validateReply(reply({ relationshipChanges: { trust: 9, affection: 9, respect: 9, tension: -9 } }), { listener: mira(), speaker: tobi(), story: story0() });
    for (const k of ["trust", "affection", "respect", "tension"] as const) expect(Math.abs(v.relation[k] ?? 0)).toBeLessThanOrEqual(AI_STEP);
    const total = Object.values(v.relation).reduce((a, b) => a + Math.abs(b ?? 0), 0);
    expect(total).toBeLessThanOrEqual(10);
    expect(v.adjustments).toContain("relation:total_cap");
  });

  it("no sudden reversal of a strong relationship without a major moment", () => {
    const m = mira();
    const w = wren();
    expect(relationOf(story0(), m, w).affection).toBeGreaterThanOrEqual(40);
    const v = validateReply(reply({ relationshipChanges: { trust: -5, affection: -5, respect: 0, tension: 3 }, memory: { summary: "Wren snapped at me.", importance: 2, kind: "argument", thread: "conflict", resolves: "" } }), { listener: m, speaker: w, story: story0() });
    expect(v.relation.affection).toBe(-REVERSAL_STEP);
    expect(v.relation.trust).toBe(-REVERSAL_STEP);
    const big = validateReply(reply({ relationshipChanges: { trust: -5, affection: -5, respect: 0, tension: 3 }, memory: { summary: "Wren sold my map to the guild.", importance: 3, kind: "betrayed", thread: "conflict", resolves: "" } }), { listener: m, speaker: w, story: story0() });
    // An unforgettable moment (betrayal) may move it further than the guard allows.
    expect(big.relation.trust).toBeLessThan(-REVERSAL_STEP);
  });

  it("canon wins: hidden feelings stay hidden, and 'never backs down' means no retreat", () => {
    const v = validateReply(reply({ emotion: "affectionate", reactionIntensity: 0.9 }), { listener: wren(), speaker: mira(), story: story0() });
    expect(v.emotion).toBe("embarrassed");
    expect(v.level).toBe(1);
    expect(v.adjustments).toContain("emotion:canon_mask_affection");
    const brave = makeChar({ id: "brave", name: "Brave", rules: "Never backs down from a fight." });
    const r = validateReply(reply({ movementIntent: "retreat", emotion: "angry" }), { listener: brave, speaker: tobi(), story: story0() });
    expect(r.movement).toBe("face_target");
  });

  it("stops contradictory movement and strong swings", () => {
    const warm = validateReply(reply({ movementIntent: "retreat", emotion: "happy", relationshipChanges: { trust: 2, affection: 3, respect: 0, tension: 0 } }), { listener: mira(), speaker: wren(), story: story0() });
    expect(warm.movement).toBe("face_target");
    const tense = validateReply(reply({ movementIntent: "approach", emotion: "frustrated", relationshipChanges: { trust: 0, affection: 0, respect: 0, tension: 4 } }), { listener: mira(), speaker: tobi(), story: story0() });
    expect(tense.movement).toBe("face_target");
    const s = { ...story0(), characters: { "sample-tobi": { mood: "irritated" as const, intensity: 2, memories: [], emotion: "angry" as const, emotionLevel: 3 } } };
    const cooled = validateReply(reply({ emotion: "happy", reactionIntensity: 1 }), { listener: tobi(), speaker: mira(), story: s });
    expect(cooled.level).toBe(1);
  });

  it("only allowed emotions and movements get through the schema", () => {
    expect(TalkReplySchema.safeParse({ ...reply(), emotion: "furious" }).success).toBe(false);
    expect(TalkReplySchema.safeParse({ ...reply(), movementIntent: "teleport" }).success).toBe(false);
    expect(TalkReplySchema.safeParse({ ...reply(), movementIntent: "approach" }).success).toBe(true);
  });
});

// ---------------------------------------------------------------- memory

describe("conversation memory", () => {
  it("saves significant moments, skips forgettable ones, and merges repeats instead of duplicating", () => {
    const m = mira();
    const t = tobi();
    const none = validateReply(reply({ memory: { summary: "", importance: 0, kind: "none", thread: "none", resolves: "" } }), { listener: m, speaker: t, story: story0() });
    expect(none.memory).toBeNull();
    let s = story0();
    const v = validateReply(reply(), { listener: m, speaker: t, story: s });
    s = applyReply(s, v, m, t, "ai");
    const mine = s.characters[m.id].memories;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ note: "Tobi praised my map in the market.", kind: "complimented", source: "ai", withId: t.id });
    // The speaker remembers notable moments too (kind only, no words put in their mouth).
    expect(s.characters[t.id].memories[0]).toMatchObject({ kind: "complimented", note: null });
    // Same moment again: merged.
    s = { ...s, turn: s.turn + 1 };
    s = applyReply(s, validateReply(reply({ memory: { summary: "Tobi praised my map in the market again.", importance: 2, kind: "complimented", thread: "none", resolves: "" } }), { listener: m, speaker: t, story: s }), m, t, "ai");
    expect(s.characters[m.id].memories).toHaveLength(1);
    expect(s.characters[m.id].memories[0].count).toBe(2);
  });

  it("records open threads and marks them resolved when settled", () => {
    const w = wren();
    const t = tobi();
    let s = story0();
    s = applyReply(s, validateReply(reply({ memory: { summary: "Tobi still hasn't admitted he cut my lane.", importance: 2, kind: "argument", thread: "conflict", resolves: "" } }), { listener: w, speaker: t, story: s }), w, t, "ai");
    const open = s.characters[w.id].memories.find((x) => x.thread === "conflict")!;
    expect(open.resolved).toBe(false);
    s = { ...s, turn: s.turn + 3 };
    const v = validateReply(reply({ memory: { summary: "Tobi finally admitted he cut my lane.", importance: 3, kind: "helped", thread: "none", resolves: "Tobi still hasn't admitted he cut my lane." } }), { listener: w, speaker: t, story: s });
    expect(v.resolves).toBe(open.id);
    s = applyReply(s, v, w, t, "ai");
    expect(s.characters[w.id].memories.find((x) => x.id === open.id)!.resolved).toBe(true);
  });

  it("applies the reply: emotion, clamped relationship, history and a relationship log", () => {
    const m = mira();
    const t = tobi();
    const s0 = story0();
    const before = relationOf(s0, m, t);
    const s = applyReply(s0, validateReply(reply(), { listener: m, speaker: t, story: s0 }), m, t, "ai");
    expect(s.characters[m.id].emotion).toBe("embarrassed");
    const after = s.relations![relKey(m.id, t.id)];
    // The reply proposed more; the game accepts a small, validated change.
    expect(after.affection - before.affection).toBeGreaterThan(0);
    expect(after.affection - before.affection).toBeLessThanOrEqual(2);
    expect(s.talk!["sample-mira|sample-tobi"].at(-1)!.text).toMatch(/Thank you/);
    expect(s.relationLog![relKey(m.id, t.id)]).toHaveLength(1);
  });

  it("lets the player correct, resolve and forget memories", () => {
    const m = mira();
    let s: StoryState = { ...story0(), characters: { [m.id]: { mood: "calm", intensity: 0, memories: [mem({ id: "x", note: "Wrong thing", thread: "promise", resolved: false })] } } };
    s = editMemory(s, m.id, "x", { note: "Wren promised to show me the north cliffs." });
    expect(s.characters[m.id].memories[0]).toMatchObject({ note: "Wren promised to show me the north cliffs.", source: "player" });
    s = editMemory(s, m.id, "x", { resolved: true });
    expect(s.characters[m.id].memories[0].resolved).toBe(true);
    s = editMemory(s, m.id, "x", null);
    expect(s.characters[m.id].memories).toHaveLength(0);
  });

  it("history and memories survive a save round trip (JSON)", () => {
    const m = mira();
    const t = tobi();
    let s = applyReply(story0(), validateReply(reply(), { listener: m, speaker: t, story: story0() }), m, t, "ai");
    s = JSON.parse(JSON.stringify(s));
    const req = build(t, m, { story: s });
    expect(req.history.at(-1)!.who).toBe("listener");
    expect(req.memories[0].summary).toBe("Tobi praised my map in the market.");
  });
});

// ---------------------------------------------------------------- route

const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://x/api/ai/talk", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

describe("/api/ai/talk", () => {
  beforeEach(() => {
    resetTalkLimits();
    process.env.ANTHROPIC_API_KEY = "sk-test-secret";
  });
  afterEach(() => {
    mocked.mockReset();
    vi.unstubAllEnvs();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_TALK_MOCK;
    delete process.env.AI_TALK_PER_MINUTE;
  });

  it("explains when no key is configured, and never invents a reply", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await talk(post(build(tobi(), mira())));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("validates input and size", async () => {
    expect((await talk(post({ hello: "world" }))).status).toBe(400);
    expect((await talk(post("{not json"))).status).toBe(400);
    const huge = build(tobi(), mira());
    huge.placeDescription = "x".repeat(600);
    expect((await talk(post({ ...huge, message: { ...huge.message, text: "y".repeat(401) } }))).status).toBe(400);
    expect((await talk(post("z".repeat(60_000)))).status).toBe(413);
  });

  it("returns a checked reply marked as real AI, without leaking the key", async () => {
    mocked.mockResolvedValueOnce(reply());
    const res = await talk(post(build(tobi(), mira())));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("sk-test-secret");
    const data = JSON.parse(text);
    expect(data).toMatchObject({ source: "ai", attempts: 1 });
    expect(data.reply.dialogue).toMatch(/Thank you/);
    const call = mocked.mock.calls[0][0];
    // The character profiles go in the cached prefix; what changed goes in the rest.
    expect(call.cachePrefix).toContain("Strangers who stand too close");
    expect(call.user).toContain("<speaker_says");
    expect(call.user).not.toContain("Strangers who stand too close");
    expect(call.feature).toBe("talk");
    expect(call.model).toBe("claude-sonnet-5-5");
    expect(call.effort).toBe("low");
  });

  it("retries once when a reply breaks character, then rejects it", async () => {
    mocked.mockResolvedValueOnce(reply({ dialogue: "As an AI language model, I appreciate it." })).mockResolvedValueOnce(reply());
    const ok = await talk(post(build(tobi(), mira())));
    expect((await ok.json()).attempts).toBe(2);
    expect(mocked.mock.calls[1][0].user).toContain('<rejected_reply reason="out_of_character">');
    mocked.mockReset();
    mocked.mockResolvedValue(reply({ staysInCharacter: false }));
    const bad = await talk(post(build(tobi(), mira())));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toBe("invalid_output");
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("reports API failures and timeouts as failures", async () => {
    mocked.mockRejectedValueOnce(new AiError("timeout", "slow"));
    expect((await talk(post(build(tobi(), mira())))).status).toBe(504);
    mocked.mockRejectedValueOnce(new AiError("rate_limited", "slow down"));
    expect((await talk(post(build(tobi(), mira())))).status).toBe(429);
    mocked.mockRejectedValueOnce(new AiError("failed", "boom"));
    const res = await talk(post(build(tobi(), mira())));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("failed");
  });

  it("limits usage per visitor and refuses a second request while one is running", async () => {
    process.env.AI_TALK_PER_MINUTE = "2";
    mocked.mockResolvedValue(reply());
    const h = { "x-forwarded-for": "10.0.0.1" };
    expect((await talk(post(build(tobi(), mira()), h))).status).toBe(200);
    expect((await talk(post(build(tobi(), mira()), h))).status).toBe(200);
    const third = await talk(post(build(tobi(), mira()), h));
    expect(third.status).toBe(429);
    expect((await third.json()).error).toBe("limit");
    // Someone else is unaffected.
    expect((await talk(post(build(tobi(), mira()), { "x-forwarded-for": "10.0.0.2" }))).status).toBe(200);
    // Repeated clicks: the second request while the first is still running is refused (no extra cost).
    let release!: (r: TalkReply) => void;
    mocked.mockReset();
    mocked.mockImplementationOnce(() => new Promise((res) => (release = res)));
    const h3 = { "x-forwarded-for": "10.0.0.3" };
    const first = talk(post(build(tobi(), mira()), h3));
    await new Promise((r) => setTimeout(r, 5));
    const second = await talk(post(build(tobi(), mira()), h3));
    expect(second.status).toBe(429);
    expect((await second.json()).error).toBe("busy");
    release(reply());
    expect((await first).status).toBe(200);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("developer TEST replies are labelled as such and never available in production", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_TALK_MOCK = "1";
    const res = await talk(post(build(tobi("zh-CN"), mira("zh-CN"), { locale: "zh-CN", message: "你好" })));
    const data = await res.json();
    expect(data.source).toBe("mock");
    expect(replyProblem(data.reply, build(tobi("zh-CN"), mira("zh-CN"), { locale: "zh-CN" }))).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect((await talk(post(build(tobi(), mira())))).status).toBe(503);
    expect(mockReply(build(tobi(), mira())).dialogue).toBeTruthy();
  });
});

// ---------------------------------------------------------------- browser side

describe("sending from the game", () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it("accepts a valid reply and rejects anything outside the contract", async () => {
    const good = await sendTalkRequest(build(tobi(), mira()), undefined, ok({ reply: reply(), source: "ai", model: "m", attempts: 1 }) as unknown as typeof fetch);
    expect(good.ok).toBe(true);
    const sneaky = await sendTalkRequest(build(tobi(), mira()), undefined, ok({ reply: { ...reply(), movementIntent: "delete_files" }, source: "ai" }) as unknown as typeof fetch);
    expect(sneaky).toEqual({ ok: false, code: "invalid_output" });
    const fake = await sendTalkRequest(build(tobi(), mira()), undefined, ok({ reply: reply(), source: "pretend" }) as unknown as typeof fetch);
    expect(fake.ok).toBe(false);
  });
  it("turns errors, offline and cancellation into failures (never a fake success)", async () => {
    expect(await sendTalkRequest(build(tobi(), mira()), undefined, ok({ error: "timeout" }, 504) as unknown as typeof fetch)).toEqual({ ok: false, code: "timeout" });
    const offline = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await sendTalkRequest(build(tobi(), mira()), undefined, offline as unknown as typeof fetch)).toEqual({ ok: false, code: "offline" });
    const ctrl = new AbortController();
    const hang = vi.fn((_u: unknown, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = sendTalkRequest(build(tobi(), mira()), ctrl.signal, hang as unknown as typeof fetch);
    ctrl.abort();
    expect(await p).toEqual({ ok: false, code: "cancelled" });
  });
  it("gives up on a very slow connection", async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_u: unknown, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = sendTalkRequest(build(tobi(), mira()), undefined, hang as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await p).toEqual({ ok: false, code: "timeout" });
    vi.useRealTimers();
  });
});
