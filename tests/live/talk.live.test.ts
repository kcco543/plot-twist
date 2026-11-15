/**
 * LIVE checks against the real model. Costs a few cents; skipped unless you ask:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... RUN_LIVE_AI=1 npx vitest run tests/live
 *
 * Each situation sends real requests through /api/ai/talk (same prompt,
 * checks and retry as the game) and writes every reply to
 * tests/live/last-run.md so you can read how each character answered.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as talk } from "@/app/api/ai/talk/route";
import { resetTalkLimits } from "@/lib/ai/server/limits";
import { sampleCharacter } from "@/lib/mind/scenarios";
import { emptyStory } from "@/lib/story/engine";
import { similarity } from "@/lib/story/similarity";
import { applyReply, pushTalkLine, validateReply } from "@/lib/talk/ai/apply";
import { replyProblem } from "@/lib/talk/ai/checks";
import type { TalkResponse } from "@/lib/talk/ai/contract";
import { buildTalkRequest } from "@/lib/talk/ai/request";
import type { Character, StoryState } from "@/lib/types";
import { makeChar } from "../helpers";

const LIVE = process.env.RUN_LIVE_AI === "1" && !!process.env.ANTHROPIC_API_KEY;
const OUT = path.join(__dirname, "last-run.md");
const log = (s: string) => appendFileSync(OUT, s + "\n");

type Loc = "en" | "zh-CN";
const cast = (l: Loc) => ({ mira: sampleCharacter("mira", l), wren: sampleCharacter("wren", l), tobi: sampleCharacter("tobi", l) });
const pip = () =>
  makeChar({ id: "pip", name: "Pip", identity: "Apprentice baker", personality: "Open-hearted, believes the best of everyone.", speakingStyle: "Warm, chatty, lots of 'oh!'", values: "Helping is what friends do.", relationships: "Mira is a friend.", traits: { trust: 92, empathy: 85, extroversion: 70 } });

async function ask(story: StoryState, speaker: Character, listener: Character, message: string, locale: Loc = "en", title = "") {
  resetTalkLimits();
  const req = buildTalkRequest({ story, speaker, listener, locale, world: "otherworld", place: "street", placeDescription: "", message, kind: "typed", topic: null, decision: null, recentEvents: [], usedTopics: [] });
  const res = await talk(new Request("http://x/api/ai/talk", { method: "POST", body: JSON.stringify(req), headers: { "Content-Type": "application/json" } }));
  const data = (await res.json()) as TalkResponse & { error?: string };
  expect(res.status, data.error).toBe(200);
  expect(data.source).toBe("ai");
  expect(replyProblem(data.reply, req)).toBeNull();
  const v = validateReply(data.reply, { listener, speaker, story });
  log(`### ${title}\n**${speaker.name}:** ${message}\n**${listener.name}:** ${v.dialogue}\n_emotion ${v.emotion} (${v.level}) · move ${v.movement} · relation ${JSON.stringify(v.relation)} · memory ${v.memory ? `"${v.memory.note}" (${v.memory.importance})` : "none"} · attempts ${data.attempts}${v.adjustments.length ? ` · engine: ${v.adjustments.join(", ")}` : ""}_\n_suggestions: ${v.suggestions.map((s) => `${s.label} (${s.intent})`).join(" / ")}_\n`);
  let next = pushTalkLine(story, speaker.id, listener.id, { from: speaker.id, text: message, turn: story.turn, at: 0, source: "player" });
  next = applyReply({ ...next, turn: next.turn + 1 }, v, listener, speaker, "ai");
  return { v, story: next };
}

const fresh = (): StoryState => ({ ...emptyStory(), turn: 10, relations: {}, decisions: [] });

describe.skipIf(!LIVE)("live AI conversations", { timeout: 120_000 }, () => {
  beforeAll(() => writeFileSync(OUT, `# Live AI conversation run\n\n${new Date().toISOString()}\n\n`));

  it("a shy character receives a compliment", async () => {
    const { mira, tobi } = cast("en");
    await ask(fresh(), tobi, mira, "Your map is honestly the coolest thing I've seen all week!", "en", "Shy character complimented (Tobi → Mira)");
  });
  it("a proud character is criticized", async () => {
    const { wren, tobi } = cast("en");
    await ask(fresh(), tobi, wren, "Your guard post is a mess. No wonder you lost the race.", "en", "Proud character criticized (Tobi → Wren)");
  });
  it("two rivals discuss their old disagreement", async () => {
    const { wren, tobi } = cast("en");
    await ask(fresh(), wren, tobi, "Let's talk about the storm race. You cut my lane and you know it.", "en", "Rivals and the storm race (Wren → Tobi)");
  });
  it("a trusting character is asked for help", async () => {
    const { mira } = cast("en");
    await ask(fresh(), mira, pip(), "Could you help me carry my ink pots to the lighthouse?", "en", "Trusting character asked for help (Mira → Pip)");
  });
  it("an angry character is comforted", async () => {
    const { mira, tobi } = cast("en");
    const s = { ...fresh(), characters: { [tobi.id]: { mood: "irritated" as const, intensity: 3, memories: [], emotion: "angry" as const, emotionLevel: 3, feelings: { anger: 80 } } } };
    await ask(s, mira, tobi, "Hey… you look really upset. Do you want to sit for a bit?", "en", "Angry character comforted (Mira → Tobi)");
  });
  it("the same question from two different relationships", async () => {
    const { mira, wren, tobi } = cast("en");
    const a = await ask(fresh(), mira, wren, "What are you doing tonight?", "en", "Same question from best friend (Mira → Wren)");
    const b = await ask(fresh(), tobi, wren, "What are you doing tonight?", "en", "Same question from rival (Tobi → Wren)");
    expect(similarity(a.v.dialogue, b.v.dialogue)).toBeLessThan(0.6);
  });
  it("several conversations in a row are remembered", async () => {
    const { mira, tobi } = cast("en");
    let s = fresh();
    s = (await ask(s, tobi, mira, "I promise I'll bring your compass back tomorrow.", "en", "Memory 1: a promise")).story;
    s = (await ask(s, tobi, mira, "So, about the market yesterday…", "en", "Memory 2")).story;
    const last = await ask(s, tobi, mira, "Do you remember what I promised you?", "en", "Memory 3: recall the promise");
    expect(last.v.dialogue.toLowerCase()).toMatch(/compass/);
  });
  it("repeated questions vary without contradiction", async () => {
    const { mira, wren } = cast("en");
    let s = fresh();
    const lines: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await ask(s, wren, mira, "How are you feeling?", "en", `Repeat ${i + 1}`);
      lines.push(r.v.dialogue);
      s = r.story;
    }
    expect(similarity(lines[0], lines[1])).toBeLessThan(0.6);
    expect(similarity(lines[1], lines[2])).toBeLessThan(0.6);
  });
  it("Chinese game, and an English message in a Chinese game", async () => {
    const { mira, tobi } = cast("zh-CN");
    await ask(fresh(), tobi, mira, "你的地图画得真好！", "zh-CN", "中文 (托比 → 米拉)");
    await ask(fresh(), tobi, mira, "Hey, nice map!", "zh-CN", "English message, Chinese game (Tobi → 米拉)");
  });
});
