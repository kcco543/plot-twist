import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { canTalkTransition, goTo, newSession, TALK_NOTICES, TALK_PHASES } from "@/lib/talk/flow";
import { DRAG, hitCharacter, pressState, toStagePoint } from "@/lib/talk/drag";
import { applyTopic, eligibleTopics, GOOD_MEMORIES, REASONS, sayKey, suggestTopics, talkContext, TOPIC_DEFS, TOPIC_IDS, type TalkContext } from "@/lib/talk/topics";
import { cleanMessage, CUSTOM_MAX, requestCustomReply } from "@/lib/talk/customReply";
import { relationWords } from "@/lib/talk/text";
import { sampleCharacter } from "@/lib/mind/scenarios";
import { relKey } from "@/lib/mind/relations";
import { emptyStory, neutralState } from "@/lib/story/engine";
import { migrateSave, emptySave } from "@/lib/gameStore";
import { StageSim } from "@/lib/stage/sim";
import { FOOT, gap, hitsObstacle, insideWalk, roomFor, standGap, type RoomLayout } from "@/lib/stage/room";
import type { Memory, MemoryKind, StoryState } from "@/lib/types";
import { seeded } from "./helpers";

const get = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
const WORLDS = ["western-fantasy", "modern", "ancient-china", "otherworld"] as const;
const PLACES = ["interior", "street", "wilderness", "ruins", "dreamscape"] as const;

const mira = () => sampleCharacter("mira");
const tobi = () => sampleCharacter("tobi");
const wren = () => sampleCharacter("wren");
const mem = (kind: MemoryKind, withId: string, turn: number, importance = 2): Memory => ({ id: `m-${kind}-${withId}-${turn}`, turn, eventType: kind, kind, count: 1, reaction: null, withId, withName: "x", mood: "calm", importance, note: null, at: 0 });
function story(patch: Partial<StoryState> = {}): StoryState {
  return { ...emptyStory(), turn: 10, relations: {}, decisions: [], ...patch };
}
const ids = (c: TalkContext) => eligibleTopics(c).map((t) => t.id);

describe("conversation flow", () => {
  it("follows SELECT_TARGET → MOVE → FACE → SHOW_OPTIONS → SPEAK → WAIT → CONTINUE → SPEAK", () => {
    let s = newSession(1, "a", "drag");
    for (const p of ["MOVE_TO_TARGET", "FACE_TARGET", "SHOW_OPTIONS", "SPEAK", "WAIT_FOR_RESPONSE", "CONTINUE_OR_EXIT", "SPEAK"] as const) {
      s = goTo(s, p);
      expect(s.phase).toBe(p);
    }
  });
  it("refuses skipping steps (no options while walking, no second topic mid-reply)", () => {
    expect(canTalkTransition("MOVE_TO_TARGET", "SHOW_OPTIONS")).toBe(false);
    expect(canTalkTransition("SPEAK", "SPEAK")).toBe(false);
    expect(canTalkTransition("WAIT_FOR_RESPONSE", "SPEAK")).toBe(false);
    expect(canTalkTransition("SELECT_TARGET", "FACE_TARGET")).toBe(false);
    const s = goTo(newSession(1, "a", "tap"), "SPEAK");
    expect(s.phase).toBe("SELECT_TARGET");
    expect(TALK_PHASES).toHaveLength(7);
  });
});

describe("drag detection", () => {
  it("mouse: a small wobble stays a click, a real move becomes a drag", () => {
    expect(pressState("mouse", 3, 2, 50)).toBe("pending");
    expect(pressState("mouse", DRAG.mouseSlop, 0, 50)).toBe("drag");
    expect(pressState("mouse", 0, 1, 2000)).toBe("pending"); // holding still is still a click
  });
  it("touch: hold to drag; moving before the hold is a swipe and is ignored", () => {
    expect(pressState("touch", 4, 0, 100)).toBe("pending");
    expect(pressState("touch", 30, 0, 100)).toBe("cancel");
    expect(pressState("touch", 2, 2, DRAG.holdMs + 10)).toBe("drag");
    expect(pressState("touch", 200, 0, 1000, "drag")).toBe("drag"); // once lifted it stays a drag
  });
  it("finds the character under the pointer, never the dragged one, and nothing on empty floor", () => {
    const actors = [
      { id: "a", x: 60, y: 170 },
      { id: "b", x: 160, y: 170 },
      { id: "c", x: 168, y: 178 },
    ];
    expect(hitCharacter(actors, { x: 60, y: 155 }, null)).toBe("a");
    expect(hitCharacter(actors, { x: 60, y: 155 }, "a")).toBeNull();
    expect(hitCharacter(actors, { x: 110, y: 160 }, "a")).toBeNull();
    expect(hitCharacter(actors, { x: 164, y: 165 }, "a")).toBe("c"); // nearer one (drawn on top) wins
    expect(hitCharacter(actors, { x: 60 + 14, y: 155 }, null, "mouse")).toBeNull();
    expect(hitCharacter(actors, { x: 60 + 14, y: 155 }, null, "touch")).toBe("a"); // fingers get a bigger target
  });
  it("maps screen px to stage px", () => {
    expect(toStagePoint(150, 96, { left: 50, top: 0, width: 640, height: 384 })).toEqual({ x: 50, y: 48 });
  });
});

describe("topic library", () => {
  it("has a label for every topic and reason, and lines in both languages", () => {
    for (const loc of [en, zh]) {
      for (const id of TOPIC_IDS) expect(typeof get(loc, `talk.topics.${id}`), id).toBe("string");
      for (const r of REASONS) expect(typeof get(loc, `talk.reasons.${r}`), r).toBe("string");
      for (const k of GOOD_MEMORIES) expect(typeof get(loc, `talk.memory.${k}`), k).toBe("string");
      for (const n of TALK_NOTICES) expect(typeof get(loc, `talk.notices.${n}`), n).toBe("string");
      for (const id of TOPIC_IDS)
        for (const tone of ["bold", "soft"] as const)
          for (const w of WORLDS)
            for (const p of PLACES) {
              const lines = get(loc, sayKey({ id }, tone, w, p));
              expect(Array.isArray(lines) && lines.length >= 2, `${id} ${tone} ${w} ${p}`).toBe(true);
            }
    }
    expect(get(en, "talk.panel.askElse")).toBe("Ask Something Else");
    expect(get(zh, "talk.panel.askElse")).toBe("问问其他的事");
  });

  it("offers 2–3 different topics from different groups", () => {
    const c = talkContext(story(), mira(), tobi(), "otherworld", "interior");
    for (let i = 0; i < 30; i++) {
      const s = suggestTopics(c, seeded(i));
      expect(s.length).toBeGreaterThanOrEqual(2);
      expect(s.length).toBeLessThanOrEqual(3);
      expect(new Set(s.map((t) => t.id)).size).toBe(s.length);
      expect(new Set(s.map((t) => TOPIC_DEFS[t.id].group)).size).toBe(s.length);
    }
  });

  it("does not always show the same three", () => {
    const c = talkContext(story(), mira(), wren(), "otherworld", "interior");
    const sets = new Set(Array.from({ length: 30 }, (_, i) => suggestTopics(c, seeded(i)).map((t) => t.id).sort().join(",")));
    expect(sets.size).toBeGreaterThan(2);
    // Next round of the same conversation: what was just offered is pushed down.
    const first = suggestTopics(c, seeded(1));
    const second = suggestTopics(c, seeded(1), first.map((t) => t.id));
    expect(second.map((t) => t.id).sort()).not.toEqual(first.map((t) => t.id).sort());
  });

  it("reads moods: an anxious listener gets cheer-up / worries, never teasing or a challenge", () => {
    const s = story({ characters: { "sample-tobi": { ...neutralState(), emotion: "anxious", emotionLevel: 2, emotionAt: 1 } } });
    const rel = { trust: 30, affection: 40, respect: 10, familiarity: 80, rivalry: 60, tension: 10, fear: 0, label: "friend" as const };
    s.relations = { [relKey("sample-wren", "sample-tobi")]: rel };
    const c = talkContext(s, wren(), tobi(), "modern", "street");
    const e = ids(c);
    expect(e).toContain("cheerUp");
    expect(e).toContain("worries");
    expect(e).not.toContain("tease");
    expect(e).not.toContain("challenge");
    const reason = eligibleTopics(c).find((t) => t.id === "cheerUp")!;
    expect(reason.reason).toBe("looks");
    expect(reason.vars.emotionKey).toBe("emotions.anxious");
  });

  it("reads history: a recent argument brings up the disagreement; a betrayal only for the one betrayed", () => {
    const s = story({ characters: { "sample-mira": { ...neutralState(), memories: [mem("argument", "sample-tobi", 9), mem("betrayed", "sample-tobi", 8, 3)] } } });
    expect(ids(talkContext(s, mira(), tobi(), "otherworld", "ruins"))).toEqual(expect.arrayContaining(["recentDisagreement", "betrayal"]));
    // Tobi didn't feel betrayed: he can't "ask why you betrayed me".
    const fromTobi = ids(talkContext(s, tobi(), mira(), "otherworld", "ruins"));
    expect(fromTobi).toContain("recentDisagreement");
    expect(fromTobi).not.toContain("betrayal");
    // Nothing happened: no disagreement to talk about.
    expect(ids(talkContext(story(), mira(), sampleCharacter("sol"), "otherworld", "interior"))).not.toContain("recentDisagreement");
  });

  it("reads relationships and personality: rivals can challenge, strangers introduce themselves, friends share memories", () => {
    // Wren's text: Tobi is her rival and enemy → a proud, confrontational Wren may challenge him.
    const wt = ids(talkContext(story(), wren(), tobi(), "otherworld", "interior"));
    expect(wt).toContain("challenge");
    // Mira "barely knows Tobi".
    expect(ids(talkContext(story(), mira(), tobi(), "otherworld", "interior"))).toContain("introduce");
    // Best friends with a shared good memory, no introductions.
    const s = story({ characters: { "sample-mira": { ...neutralState(), memories: [mem("cooperated", "sample-wren", 9)] } } });
    const mw = eligibleTopics(talkContext(s, mira(), wren(), "otherworld", "interior"));
    expect(mw.map((t) => t.id)).toContain("sharedMemory");
    expect(mw.map((t) => t.id)).not.toContain("introduce");
    expect(mw.find((t) => t.id === "sharedMemory")!.vars.memoryKey).toBe("talk.memory.cooperated");
  });

  it("uses each topic's own trigger for the listener (the behavior engine answers)", () => {
    const c = talkContext(story(), wren(), tobi(), "otherworld", "interior");
    expect(TOPIC_DEFS.challenge.trigger(c)).toBe("provoked");
    expect(TOPIC_DEFS.compliment.trigger(c)).toBe("complimented");
    expect(TOPIC_DEFS.cheerUp.trigger(c)).toBe("helped");
  });

  it("applying a topic writes to the existing story state (turn, relation, memories, history) and never personality", () => {
    const s0 = story();
    const m = mira();
    const before = JSON.stringify(m);
    const choice = eligibleTopics(talkContext(s0, m, tobi(), "otherworld", "interior")).find((t) => t.id === "introduce")!;
    const s1 = applyTopic(s0, m, tobi(), choice, 0);
    expect(s1.turn).toBe(s0.turn + 1);
    expect(s1.events.at(-1)).toMatchObject({ type: "chat.introduce", actorId: "sample-mira", otherId: "sample-tobi" });
    expect(s1.relations![relKey("sample-mira", "sample-tobi")].familiarity).toBeGreaterThan(0);
    expect(s1.characters["sample-mira"].memories.at(-1)?.kind).toBe("met");
    expect(s1.characters["sample-tobi"].memories.at(-1)?.kind).toBe("met");
    expect(JSON.stringify(m)).toBe(before);
    // Used topics are remembered for the pair, so they come up less.
    expect(talkContext(s1, tobi(), m, "otherworld", "interior").recentTopics).toEqual(["introduce"]);
  });

  it("describes a relationship in plain words", () => {
    expect(relationWords({ label: "friend", affection: 60, trust: 50, tension: 0, rivalry: 0 })).toEqual({ label: "friend", words: ["warm", "trusting"] });
    expect(relationWords({ affection: 0, trust: 0, tension: 0, rivalry: 0 })).toEqual({ label: "stranger", words: ["neutral"] });
  });
});

describe("Ask Something Else", () => {
  it("keeps English, Chinese and emoji, trims and caps the length", () => {
    expect(cleanMessage("  hello there  ")).toBe("hello there");
    expect(cleanMessage("你好，我们和好吧？")).toBe("你好，我们和好吧？");
    expect(cleanMessage("   \n  ")).toBe("");
    const long = "好".repeat(CUSTOM_MAX + 50);
    expect(Array.from(cleanMessage(long)).length).toBe(CUSTOM_MAX);
    expect(cleanMessage("🙂".repeat(CUSTOM_MAX + 1))).toBe("🙂".repeat(CUSTOM_MAX));
  });
  it("never fakes an AI answer: the reply service says it isn't available yet", async () => {
    const r = await requestCustomReply({ locale: "en", world: "modern", place: "street", speaker: { id: "a", name: "A" }, listener: { id: "b", name: "B" }, message: "hi", relation: { trust: 0, affection: 0, respect: 0, familiarity: 0, rivalry: 0, tension: 0, fear: 0 }, listenerEmotion: "neutral", recentLines: [] });
    expect(r.status).toBe("unavailable");
  });
});

describe("walking over to talk (stage)", () => {
  const setup = (room: RoomLayout = roomFor("otherworld", "interior")) => {
    const sim = new StageSim({ room, idle: false });
    sim.setCast([mira(), tobi(), wren()]);
    return sim;
  };
  const ids3 = ["sample-mira", "sample-tobi", "sample-wren"];

  it("walks (never teleports), respects walls and people, and stops at talking distance", () => {
    const room = roomFor("otherworld", "interior");
    const sim = setup(room);
    expect(sim.previewApproach("sample-mira", "sample-tobi", 34)?.length).toBeGreaterThan(0);
    expect(sim.request({ type: "approach", actor: "sample-mira", target: "sample-tobi", distance: 34 }, "conversation", "player").ok).toBe(true);
    let prev = sim.position("sample-mira")!;
    for (let t = 0; t < 12000 && sim.walkOf("sample-mira"); t += 16) {
      sim.tick(16);
      const p = sim.position("sample-mira")!;
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(3); // small steps every frame
      prev = p;
      expect(insideWalk(room, p)).toBe(true);
      expect(hitsObstacle(room, p)).toBeNull();
      for (const o of ids3) if (o !== "sample-mira") expect(gap(p, sim.position(o)!)).toBeGreaterThanOrEqual(FOOT.w - 0.5);
    }
    const g = standGap(sim.position("sample-mira")!, sim.position("sample-tobi")!);
    expect(g).toBeGreaterThanOrEqual(18);
    expect(g).toBeLessThanOrEqual(34 + 10);
  });

  it("reports an unreachable target before anyone moves", () => {
    const base = roomFor("otherworld", "interior");
    const sim = setup(base);
    const t = sim.position("sample-tobi")!;
    sim.room = { ...base, obstacles: [...base.obstacles, { id: "wall-l", x0: t.x - 40, y0: 0, x1: t.x - 32, y1: 192 }, { id: "wall-r", x0: t.x + 32, y0: 0, x1: t.x + 40, y1: 192 }] };
    expect(sim.previewApproach("sample-mira", "sample-tobi", 34)).toBeNull();
    expect(sim.canReach("sample-mira", "sample-tobi", 34)).toBe(false);
  });

  it("tells a wall from someone standing in the way", () => {
    // In this room Tobi stands in the only gap between the table and the rug's edge.
    const sim = setup();
    expect(sim.previewApproach("sample-wren", "sample-mira", 30)).toBeNull();
    expect(sim.previewApproach("sample-wren", "sample-mira", 30, { ignorePeople: true })).not.toBeNull();
  });

  it("follows a target that moves, and can be cancelled for good", () => {
    const sim = setup();
    sim.request({ type: "approach", actor: "sample-mira", target: "sample-wren", distance: 30 }, "conversation", "player");
    sim.tick(300);
    sim.request({ type: "retreat", actor: "sample-wren", distance: 30 }, "test", "player");
    for (let t = 0; t < 15000 && sim.walkOf("sample-mira"); t += 16) sim.tick(16);
    expect(standGap(sim.position("sample-mira")!, sim.position("sample-wren")!)).toBeLessThanOrEqual(42);

    const sim2 = setup();
    expect(sim2.request({ type: "approach", actor: "sample-wren", target: "sample-tobi", distance: 30 }, "conversation", "player").ok).toBe(true);
    sim2.tick(200);
    const at = sim2.position("sample-wren")!;
    expect(sim2.cancelWalk("sample-wren")).toBe(true);
    expect(sim2.walkOf("sample-wren")).toBeNull();
    for (let t = 0; t < 2000; t += 16) sim2.tick(16);
    expect(sim2.position("sample-wren")).toEqual(at);
  });
});

describe("saves", () => {
  it("keep relationships and decisions across a reload", () => {
    const s = migrateSave({ ...emptySave, story: { ...emptyStory(), relations: { "a>b": { trust: 5 } }, decisions: [{ turn: 1 }] } });
    expect(s.story.relations).toEqual({ "a>b": { trust: 5 } });
    expect(s.story.decisions).toHaveLength(1);
  });
});
