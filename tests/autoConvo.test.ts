/**
 * Autonomous conversations (autonomy/convoDirector.ts) against a real
 * StageSim, with the mock writer (the same canned reply as AI_TALK_MOCK=1)
 * or scripted fakes. No network, no credits.
 *
 * Numbers in the test names refer to the "Autonomous Conversation Tests"
 * list in the request (1–18).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/claude", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/claude")>();
  return { ...real, structuredCall: vi.fn() };
});

import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { POST as converse } from "@/app/api/ai/converse/route";
import { structuredCall } from "@/lib/ai/server/claude";
import { mockConverse, sanitizeConverse, converseProblem } from "@/lib/ai/server/converse";
import { resetAutoTalkLimits } from "@/lib/ai/server/limits";
import { submit, tick, type EngineEnv } from "@/lib/autonomy/engine";
import { AUTO_CONVO, bookOf, canMove, CONVO_STATES, CONVO_TRANSITIONS, FINAL_STATES, type AutoConvo, type ConvoState } from "@/lib/autonomy/convo";
import { ConversationDirector, planFromReply, type DirectorDeps, type WriteResult } from "@/lib/autonomy/convoDirector";
import { FREQUENCIES, frequencySpec, type Frequency } from "@/lib/autonomy/frequency";
import { agencyOf } from "@/lib/autonomy/lifecycle";
import { newIntent } from "@/lib/autonomy/validate";
import { rngFrom } from "@/lib/stage/behavior";
import { objectsFor } from "@/lib/stage/objects";
import { roomFor } from "@/lib/stage/room";
import { StageSim } from "@/lib/stage/sim";
import { emptyStory, neutralState } from "@/lib/story/engine";
import { buildConverseRequest, ConverseReplySchema, type ConverseReply } from "@/lib/talk/ai/converse";
import type { Character, StoryLine, StoryState } from "@/lib/types";
import { juniper, makeChar, rook } from "./helpers";

const T0 = 5_000_000;
const STEP = 100;

const wren = () => makeChar({ id: "c-wren", name: "Wren", personality: "Warm, chatty, notices everyone.", traits: { extroversion: 85, empathy: 80, playfulness: 70 } });

type Opts = {
  cast?: Character[];
  writer?: "ai" | "mock" | null;
  write?: (c: AutoConvo, story: StoryState, signal: AbortSignal) => Promise<WriteResult>;
  frequency?: Frequency;
  idle?: boolean;
};

/** The mock writer: the real request builder, the AI_TALK_MOCK reply, schema check, sanitizer, then planFromReply. */
async function mockWrite(c: AutoConvo, story: StoryState, cast: Character[], patch: Partial<ConverseReply> = {}): Promise<WriteResult> {
  const a = cast.find((x) => x.id === c.participants[0])!;
  const b = cast.find((x) => x.id === c.participants[1])!;
  const req = buildConverseRequest({ story, convo: c, a, b, locale: "en", world: "modern", place: "interior", placeDescription: "A small flat.", recentEvents: [], doing: () => "standing around", reasonText: "wants to chat" });
  const reply = sanitizeConverse(ConverseReplySchema.parse({ ...mockConverse(req), ...patch }), req);
  const plan = planFromReply(c, reply);
  return { ok: true, turns: plan.turns, outcome: plan.outcome, source: "mock" };
}

function harness(o: Opts = {}) {
  const cast = o.cast ?? [juniper(), wren()];
  let room = roomFor("modern", "interior");
  let roomKey = "flat";
  const sim = new StageSim({ room, idle: o.idle ?? false });
  sim.setCast(cast);
  const objects = objectsFor("modern", "interior");
  sim.setObjects(objects);
  let story: StoryState = { ...emptyStory(), characters: Object.fromEntries(cast.map((c) => [c.id, neutralState()])) };
  let wall = T0;
  const log: StoryLine[] = [];
  const departs: { actor: string; from: string; lockedAtDepart: string | null; stateAtDepart: string | undefined }[] = [];
  const writes: string[] = [];
  const states: Record<string, ConvoState[]> = {};
  let frequency: Frequency = o.frequency ?? "medium";
  let writer = o.writer === undefined ? "mock" : o.writer;
  let enabled = true;
  // eslint-disable-next-line prefer-const -- assigned once below; the deps close over it
  let director: ConversationDirector;
  const deps: DirectorDeps = {
    stage: sim,
    cast: () => cast,
    objects: () => objects,
    getStory: () => story,
    setStory: (s) => (story = s),
    log: (l) => log.push(...l),
    inPlayerTalk: () => false,
    talkDistance: () => 30,
    writer: () => writer,
    writeAi: (c, signal) => {
      writes.push(c.id);
      return o.write ? o.write(c, story, signal) : mockWrite(c, story, cast);
    },
    frequency: () => frequency,
    enabled: () => enabled,
    roomKey: () => roomKey,
    sceneId: () => "scene-1",
    sceneName: () => "The flat",
    worldId: () => "world-1",
    textSpeed: () => "fast",
    rng: (k) => rngFrom(k),
    objectName: () => "the plant",
    renderText: (l) => (l.params?.text as string) ?? l.tpl ?? "",
    depart: (actor, from) => departs.push({ actor, from, lockedAtDepart: sim.lockOf(actor), stateAtDepart: director.sessionOf(actor)?.state }),
    wall: () => wall,
  };
  director = new ConversationDirector(deps);
  // Same hookup as useAutoConversations.
  sim.onLockedMove = (actorId, sessionId) => {
    director.interrupt(sessionId, "player");
    return sim.lockOf(actorId) === null;
  };
  sim.onLockLost = (sessionId, reason) => director.interrupt(sessionId, reason === "room" ? "scene_change" : reason === "cast" ? "left" : reason === "moved" ? "player" : "reset");
  director.subscribe(() => {
    for (const c of director.getSnapshot()) {
      const l = (states[c.id] ??= []);
      if (l[l.length - 1] !== c.state) l.push(c.state);
    }
  });

  /** Advance stage + wall time, stepping the director like the 250ms interval does (and letting writer promises settle). */
  const run = async (ms: number, each?: () => void) => {
    for (let t = 0; t < ms; t += STEP) {
      sim.tick(STEP);
      wall += STEP;
      director.step();
      each?.();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  /** Run until no session is running (or the time runs out). */
  const runUntilDone = async (max = 120_000, each?: () => void) => {
    for (let t = 0; t < max; t += STEP) {
      await run(STEP, each);
      if (!director.active.length) return t;
    }
    return max;
  };
  const place = (id: string, x: number, y: number) => sim.spawnAt(id, { x, y });
  const book = () => bookOf(agencyOf(story.agency));
  return {
    sim,
    cast,
    get director() {
      return director;
    },
    log,
    departs,
    writes,
    states,
    run,
    runUntilDone,
    place,
    book,
    story: () => story,
    setStory: (s: StoryState) => (story = s),
    wall: () => wall,
    skipWall: (ms: number) => (wall += ms),
    setFrequency: (f: Frequency) => (frequency = f),
    setWriter: (w: "ai" | "mock" | null) => (writer = w),
    setEnabled: (e: boolean) => (enabled = e),
    changeRoom: (key: string) => {
      roomKey = key;
      room = roomFor("modern", "street");
      sim.setRoom(room);
    },
    deps,
  };
}

/** Two characters on open floor, a set distance apart. */
function standApart(h: ReturnType<typeof harness>, a: string, b: string, gap: number) {
  const p = h.sim.position(a)!;
  h.place(a, p.x, p.y);
  h.place(b, p.x + gap, p.y);
  const pb = h.sim.position(b)!;
  if (Math.abs(pb.x - p.x - gap) > 2) {
    // Blocked there: try the other side.
    h.place(b, p.x - gap, p.y);
  }
}

const J = "c-juniper";
const W = "c-wren";
const R = "c-rook";

afterEach(() => {
  vi.mocked(structuredCall).mockReset();
});

describe("conversation state machine", () => {
  it("has the eight states, final states go nowhere, and Active is only left through Ending / Interrupted", () => {
    expect([...CONVO_STATES].sort()).toEqual(["active", "approaching", "awaiting", "completed", "declined", "ending", "interrupted", "proposed"]);
    for (const f of FINAL_STATES) expect(CONVO_TRANSITIONS[f]).toEqual([]);
    expect([...CONVO_TRANSITIONS.active].sort()).toEqual(["ending", "interrupted"]);
    expect(canMove("proposed", "active")).toBe(false);
    expect(canMove("awaiting", "declined")).toBe(true);
    expect(canMove("completed", "active")).toBe(false);
  });

  it("every state, end reason and built-in line has EN + ZH text", () => {
    const keys = (o: object, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(zh.autoTalk).sort()).toEqual(keys(en.autoTalk).sort());
    for (const s of CONVO_STATES) expect(en.autoTalk.states[s], s).toBeTruthy();
    for (const f of FREQUENCIES) {
      expect(en.settings.autoFrequencies[f]).toBeTruthy();
      expect(zh.settings.autoFrequencies[f]).toBeTruthy();
    }
    expect(zh.settings.autoFrequencies).toEqual({ low: "低频", medium: "中频", high: "高频" });
    expect(zh.settings.autoFrequency).toBe("自主互动频率");
  });
});

describe("a whole conversation (1–8)", () => {
  it("1–6: A starts, walks over, both stop, several turns, a natural end, the full transcript in the Story Log", async () => {
    const h = harness({ idle: true });
    standApart(h, J, W, 140);
    const before = h.sim.gapBetween(J, W)!;
    expect(before).toBeGreaterThan(100);
    expect(h.director.request(J, W)).toBe(true); // nobody touched anything: the planner's own wish

    // Watch positions while Active / Ending.
    let lockedAt: Record<string, { x: number; y: number }> | null = null;
    let movedWhileLocked = 0;
    let lockSeen = false;
    const watch = () => {
      const s = h.director.active[0];
      if (s && (s.state === "active" || s.state === "ending")) {
        lockSeen = true;
        expect(h.sim.lockOf(J)).toBe(s.id);
        expect(h.sim.lockOf(W)).toBe(s.id);
        const now: Record<string, { x: number; y: number }> = { [J]: h.sim.position(J)!, [W]: h.sim.position(W)! };
        if (!lockedAt) lockedAt = { [J]: { ...now[J] }, [W]: { ...now[W] } };
        for (const id of [J, W]) if (Math.hypot(now[id].x - lockedAt[id].x, now[id].y - lockedAt[id].y) > 0.01) movedWhileLocked++;
      }
    };
    await h.runUntilDone(120_000, watch);

    const id = Object.keys(h.states)[0];
    expect(h.states[id]).toEqual(["proposed", "approaching", "awaiting", "active", "ending"]);
    // 2. They ended up at talking distance.
    expect(h.sim.gapBetween(J, W)!).toBeLessThanOrEqual(30 + AUTO_CONVO.talkSlack);
    // 3. Nobody moved while locked (idle wandering is on).
    expect(lockSeen).toBe(true);
    expect(movedWhileLocked).toBe(0);
    // 4–5. Several turns, alternating, ended naturally.
    const rec = h.book().history.at(-1)!;
    expect(rec.status).toBe("completed");
    expect(rec.endReason).toBe("natural");
    expect(rec.turns.length).toBeGreaterThanOrEqual(4);
    rec.turns.forEach((t, i) => i && expect(t.speaker).not.toBe(rec.turns[i - 1].speaker));
    expect(rec.turns[0].speaker).toBe(J);
    expect(rec.source).toBe("mock");
    // 6. Every line is in the Story Log, in order, tagged with the conversation.
    const lines = h.log.filter((l) => l.convo === rec.id && l.speaker.kind === "character");
    expect(lines.map((l) => l.params?.text)).toEqual(rec.turns.map((t) => t.text));
    expect(rec.sceneId).toBe("scene-1");
    expect(rec.place).toBe("The flat");
    expect(rec.endedAt).toBeGreaterThan(rec.startedAt);
    // Released.
    expect(h.sim.lockOf(J)).toBeNull();
    expect(h.sim.lockOf(W)).toBeNull();
    expect(h.director.owns(J)).toBe(false);
  });

  it("3 + 7: while Active nothing moves them: walks of any priority, the planner, idle shuffles, a second conversation", async () => {
    const h = harness({ idle: true, cast: [juniper(), wren(), rook()] });
    standApart(h, J, W, 34);
    // A writer that holds the turns until we say so, so the session sits in Active.
    let release: (r: WriteResult) => void = () => {};
    h.deps.writeAi = () => new Promise<WriteResult>((res) => (release = res));
    expect(h.director.request(J, W)).toBe(true);
    await h.run(3000);
    const s = h.director.active[0];
    expect(s.state).toBe("active");
    expect(s.writing).toBe(true);
    const pj = { ...h.sim.position(J)! };
    const pw = { ...h.sim.position(W)! };

    // Routine and story walks are refused outright.
    for (const priority of ["auto", "story"] as const) {
      const r = h.sim.request({ type: "walk_to", actor: J, x: pj.x + 80, y: pj.y }, "event", priority);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toBe("in_conversation");
    }
    // The autonomy engine: a wander intent for a locked character doesn't start.
    const env: EngineEnv = {
      stage: { request: (a, c, p) => h.sim.request(a, c, p), position: (id) => h.sim.position(id), poseOf: (id) => h.sim.poseOf(id), walkOf: (id) => h.sim.walkOf(id), isCommanded: (id) => h.sim.isCommanded(id) },
      cast: h.cast,
      objects: objectsFor("modern", "interior"),
      story: h.story(),
      inConversation: (id) => h.director.owns(id),
      now: h.wall(),
      rng: (k) => rngFrom(k),
    };
    let ag = agencyOf(h.story().agency);
    ag = submit(ag, newIntent({ actor: J, kind: "move_away", target: W, reason: "restless", source: "rules" }, h.wall()), env).agency;
    for (let i = 0; i < 40; i++) {
      ag = tick(ag, { ...env, now: h.wall() + i * 500 });
      h.sim.tick(500);
    }
    // A second conversation with either of them can't start.
    expect(h.director.request(R, J)).toBe(false);
    expect(h.director.request(W, R)).toBe(false);
    expect(h.director.active.length).toBe(1);
    // Long enough for idle shuffles to have happened if they could.
    await h.run(20_000);
    expect(h.sim.position(J)).toEqual(pj);
    expect(h.sim.position(W)).toEqual(pw);
    expect(h.sim.walkOf(J)).toBeNull();
    expect(h.sim.walkOf(W)).toBeNull();
    expect(h.sim.usingObjectOf(J)).toBeNull();
    release(await mockWrite(h.director.active[0], h.story(), h.cast));
    await h.runUntilDone();
    expect(h.book().history.at(-1)!.status).toBe("completed");
  });

  it("the player's own command is the one thing that can move them, and it ends the session first", async () => {
    const h = harness();
    standApart(h, J, W, 34);
    h.deps.writeAi = () => new Promise<WriteResult>(() => {});
    h.director.request(J, W);
    await h.run(3000);
    expect(h.director.active[0].state).toBe("active");
    const r = h.sim.request({ type: "retreat", actor: J, from: W, distance: 40 }, "test", "player");
    expect(r.ok ? "ok" : r.reason).toBe("ok");
    expect(h.director.active.length).toBe(0);
    const rec = h.book().history.at(-1)!;
    expect(rec.status).toBe("interrupted");
    expect(rec.endReason).toBe("player");
    expect(h.sim.lockOf(J)).toBeNull();
    expect(h.sim.lockOf(W)).toBeNull();
  });

  it("8: after it ends they're free again: walks are accepted once the short hold is over", async () => {
    const h = harness();
    standApart(h, J, W, 34);
    h.director.request(J, W);
    await h.runUntilDone();
    await h.run(AUTO_CONVO.releaseHoldMs + 500);
    const p = h.sim.position(W)!;
    const r = h.sim.request({ type: "walk_to", actor: W, x: p.x + 50, y: p.y }, "event", "auto");
    expect(r.ok).toBe(true);
    expect(h.sim.stateOf(W)).toBe("moving");
    expect(h.director.owns(W)).toBe(false);
  });
});

describe("personality and departures (9–10)", () => {
  it("9: B declines an unwanted conversation: one decline line, no lock, no relationship change, recorded", async () => {
    const h = harness();
    standApart(h, J, W, 34);
    const s = h.story();
    h.setStory({ ...s, characters: { ...s.characters, [W]: { ...s.characters[W], feelings: { anger: 95, frustration: 90, sadness: 80 } } } });
    expect(h.director.request(J, W)).toBe(true);
    let everLocked = false;
    await h.runUntilDone(60_000, () => (everLocked ||= !!h.sim.lockOf(J) || !!h.sim.lockOf(W)));
    const rec = h.book().history.at(-1)!;
    expect(rec.status).toBe("declined");
    expect(rec.endReason).toMatch(/^declined_/);
    expect(rec.turns.length).toBe(1);
    expect(rec.turns[0].speaker).toBe(W);
    expect(rec.turns[0].tpl).toMatch(/^autoTalk\.builtin\.decline\./);
    expect(rec.changes).toEqual([]);
    expect(everLocked).toBe(false);
    expect(h.writes).toEqual([]); // a refusal never costs an AI call
    expect(h.log.filter((l) => l.convo === rec.id)).toHaveLength(1);
    // And Juniper doesn't immediately try again.
    expect(h.director.request(J, W)).toBe(false);
  });

  it("10: someone who walks off ends the session and releases the lock before the departure starts", async () => {
    const h = harness({ write: (c, story) => mockWrite(c, story, [juniper(), wren()], { how: "walks_off" }) });
    standApart(h, J, W, 34);
    h.director.request(J, W);
    await h.runUntilDone();
    const rec = h.book().history.at(-1)!;
    expect(rec.status).toBe("completed");
    expect(rec.endReason).toBe("walkedOff");
    expect(h.departs).toHaveLength(1);
    const d = h.departs[0];
    expect(d.actor).toBe(rec.leaver);
    expect(d.lockedAtDepart).toBeNull(); // the lock was already gone
    expect(d.stateAtDepart).toBeUndefined(); // and the session no longer owned them
  });

  it("relationships move gradually: one conversation never makes close friends, ordinary chat leaves no long-term memory", async () => {
    const h = harness();
    standApart(h, J, W, 34);
    h.director.request(J, W);
    await h.runUntilDone();
    const rec = h.book().history.at(-1)!;
    for (const c of rec.changes) for (const v of Object.values(c.delta)) expect(Math.abs(v as number)).toBeLessThanOrEqual(3);
    expect(rec.memories).toEqual([]);
    expect([J, W].flatMap((id) => h.story().characters[id].memories)).toEqual([]);
  });

  it("nothing changes for a turn before it is shown", async () => {
    const h = harness();
    standApart(h, J, W, 34);
    h.director.request(J, W);
    // Run until the writer has answered but only the first line has been shown.
    for (let i = 0; i < 600; i++) {
      await h.run(STEP);
      const s = h.director.active[0];
      if (s && s.turns.length === 1 && s.pending.length) break;
    }
    const s = h.director.active[0];
    expect(s.pending.length).toBeGreaterThan(0);
    expect(h.log.filter((l) => l.convo === s.id && l.speaker.kind === "character")).toHaveLength(1);
    expect(Object.values(h.story().relationLog ?? {}).flat()).toEqual([]);
    expect(Object.values(h.story().talk ?? {}).flat()).toHaveLength(1);
  });
});

describe("frequency (11–13)", () => {
  /** How many conversations the scheduler starts on its own in this much (wall + stage) time, with three free characters. */
  async function startsOver(f: Frequency, minutes: number) {
    const h = harness({ cast: [juniper(), wren(), rook()], frequency: f, writer: null });
    const p = h.sim.position(J)!;
    h.place(W, p.x + 40, p.y);
    h.place(R, p.x, p.y + 30);
    const starts: number[] = [];
    let seen = new Set<string>();
    await h.run(minutes * 60_000, () => {
      for (const c of h.director.active)
        if (!seen.has(c.id)) {
          seen.add(c.id);
          starts.push(h.wall());
        }
    });
    seen = new Set();
    return { starts, h };
  }

  it("11–13: Low < Medium < High, and even High keeps the gaps (never back-to-back)", async () => {
    const low = await startsOver("low", 20);
    const med = await startsOver("medium", 20);
    const high = await startsOver("high", 20);
    expect(low.starts.length).toBeGreaterThan(0);
    expect(low.starts.length).toBeLessThan(med.starts.length);
    expect(med.starts.length).toBeLessThan(high.starts.length);
    for (const [f, r] of [
      ["low", low],
      ["medium", med],
      ["high", high],
    ] as const) {
      const gap = frequencySpec(f).convoGapMs;
      r.starts.forEach((t, i) => i && expect(t - r.starts[i - 1]).toBeGreaterThanOrEqual(gap));
      // Never more than one at a time.
      expect(r.h.director.active.length).toBeLessThanOrEqual(AUTO_CONVO.maxActive);
    }
    // High in 20 minutes is still a handful, not nonstop talk.
    expect(high.starts.length).toBeLessThanOrEqual(Math.ceil((20 * 60_000) / frequencySpec("high").convoGapMs));
  }, 60_000);

  it("the frequency only changes how often it's considered: a character who won't talk still won't on High", async () => {
    const h = harness({ cast: [juniper(), wren()], frequency: "high", writer: null });
    standApart(h, J, W, 40);
    const s = h.story();
    // Both furious and miserable: nobody starts anything, however often it's considered.
    h.setStory({ ...s, characters: Object.fromEntries([J, W].map((id) => [id, { ...s.characters[id], feelings: { anger: 95, sadness: 90 } }])) });
    await h.run(5 * 60_000);
    expect(h.book().history.filter((r) => r.status === "completed")).toHaveLength(0);
  }, 30_000);

  it("ordinary characters (no traits set) do start conversations; a quiet one less readily than a loud one", async () => {
    const { scorePair } = await import("@/lib/autonomy/convo");
    const quiet = makeChar({ id: "q", name: "Mira", personality: "Quiet, careful map-maker who dislikes crowds." });
    const loud = makeChar({ id: "l", name: "Tobi", personality: "Loud, friendly courier who loves gossip." });
    const story: StoryState = { ...emptyStory(), characters: { q: neutralState(), l: neutralState() } };
    const ctx = (k: string) => ({ story, agency: agencyOf(undefined), objects: [], position: () => ({ x: 100, y: 100 }), now: T0, rng: rngFrom(k) });
    const rate = (a: Character, b: Character) => Array.from({ length: 200 }, (_, i) => scorePair(a, b, ctx(`r${i}`))!.score >= AUTO_CONVO.startBar).filter(Boolean).length;
    expect(rate(loud, quiet)).toBeGreaterThan(100);
    expect(rate(quiet, loud)).toBeLessThan(rate(loud, quiet));
  });

  it("is saved per world and defaults to Medium", async () => {
    const { migrateSave } = await import("@/lib/gameStore");
    const saved = migrateSave({ version: 1, observation: { frequency: "high" } } as never) as { observation?: { frequency: string } };
    expect(saved.observation?.frequency).toBe("high");
    const bad = migrateSave({ version: 1, observation: { frequency: "nonstop" } } as never) as { observation?: { frequency: string } };
    expect(bad.observation?.frequency ?? "medium").toBe("medium");
    expect(frequencySpec("medium").considerMs).toBeGreaterThan(frequencySpec("high").considerMs);
  });
});

describe("robustness (14–18)", () => {
  it("14: runs with no camera or viewport at all (offscreen is the same simulation)", async () => {
    const h = harness();
    expect(Object.keys(h.deps).some((k) => /camera|viewport|focus/i.test(k))).toBe(false);
    const p = h.sim.position(J)!;
    // Far side of the room from where anyone would be looking.
    h.place(J, p.x, p.y);
    h.place(W, p.x + 34, p.y);
    h.director.request(J, W);
    await h.runUntilDone();
    expect(h.book().history.at(-1)!.status).toBe("completed");
  });

  it("15: an API error mid-conversation stops it honestly: no invented lines, lock released, AI paused, next one uses labelled built-in lines", async () => {
    const h = harness({ write: async () => ({ ok: false, code: "billing" }) });
    standApart(h, J, W, 34);
    h.director.request(J, W);
    await h.runUntilDone();
    const rec = h.book().history.at(-1)!;
    expect(rec.status).toBe("interrupted");
    expect(rec.endReason).toBe("ai_billing");
    expect(rec.turns).toEqual([]);
    expect(h.log.filter((l) => l.convo === rec.id && l.speaker.kind === "character")).toHaveLength(0);
    expect(h.log.some((l) => l.convo === rec.id && l.tpl === "autoTalk.log.aiStopped")).toBe(true);
    expect(h.sim.lockOf(J)).toBeNull();
    expect(h.sim.lockOf(W)).toBeNull();
    expect(h.book().ai.offUntil).toBeGreaterThan(h.wall());
    // Later: no further AI request while paused; built-in lines, marked as such.
    h.skipWall(frequencySpec("medium").pairGapMs + 1);
    await h.run(AUTO_CONVO.releaseHoldMs + 500);
    expect(h.director.request(J, W)).toBe(true);
    await h.runUntilDone();
    expect(h.writes).toHaveLength(1);
    const next = h.book().history.at(-1)!;
    expect(next.status).toBe("completed");
    expect(next.source).toBe("builtin");
    expect(next.turns.every((t) => t.tpl?.startsWith("autoTalk.builtin."))).toBe(true);
  });

  it("15b: a writer that throws or hangs never leaves a stale lock", async () => {
    const h = harness({ write: () => Promise.reject(new Error("network down")) });
    standApart(h, J, W, 34);
    h.director.request(J, W);
    await h.runUntilDone();
    expect(h.book().history.at(-1)!.endReason).toBe("ai_failed");
    expect(h.sim.lockOf(J)).toBeNull();

    const h2 = harness({ write: () => new Promise<WriteResult>(() => {}) });
    standApart(h2, J, W, 34);
    h2.director.request(J, W);
    await h2.runUntilDone(AUTO_CONVO.writeTimeoutMs + 20_000);
    expect(h2.book().history.at(-1)!.endReason).toBe("timeout");
    expect(h2.sim.lockOf(J)).toBeNull();
    expect(h2.sim.lockOf(W)).toBeNull();
  });

  it("16: switching scenes during an active conversation interrupts it and frees both", async () => {
    const h = harness();
    standApart(h, J, W, 34);
    h.deps.writeAi = () => new Promise<WriteResult>(() => {});
    h.director.request(J, W);
    await h.run(3000);
    expect(h.director.active[0].state).toBe("active");
    h.changeRoom("street");
    await h.run(500);
    expect(h.director.active).toHaveLength(0);
    const rec = h.book().history.at(-1)!;
    expect(rec.status).toBe("interrupted");
    expect(rec.endReason).toBe("scene_change");
    expect(h.sim.lockOf(J)).toBeNull();
    expect(h.sim.lockOf(W)).toBeNull();
    expect(bookOf(agencyOf(h.story().agency)).active).toEqual([]);
  });

  it("16b: after a reload a saved running session is closed as interrupted, never resumed with a stale lock", async () => {
    const h = harness();
    standApart(h, J, W, 34);
    h.deps.writeAi = () => new Promise<WriteResult>(() => {});
    h.director.request(J, W);
    await h.run(3000);
    const saved = h.story();
    expect(bookOf(agencyOf(saved.agency)).active).toHaveLength(1);
    // A fresh page: new stage, new director, the saved story.
    const h2 = harness();
    h2.setStory(saved);
    await h2.run(STEP);
    expect(h2.director.active).toHaveLength(0);
    expect(h2.book().history.at(-1)!.endReason).toBe("reload");
    expect(h2.sim.lockOf(J)).toBeNull();
  });

  it("17: one shared session per conversation; nobody is in two", async () => {
    const h = harness({ cast: [juniper(), wren(), rook()] });
    standApart(h, J, W, 34);
    h.place(R, h.sim.position(J)!.x, h.sim.position(J)!.y + 40);
    expect(h.director.request(J, W)).toBe(true);
    expect(h.director.request(J, W)).toBe(false);
    expect(h.director.request(W, J)).toBe(false);
    expect(h.director.request(R, J)).toBe(false);
    expect(h.director.active).toHaveLength(1);
    const s = h.director.active[0];
    expect(h.director.sessionOf(J)).toBe(h.director.sessionOf(W));
    expect(s.participants).toEqual([J, W]);
    expect(s.worldId).toBe("world-1");
    expect(s.sceneId).toBe("scene-1");
    // The stage refuses a second lock over a locked character too.
    await h.run(3000);
    expect(h.sim.lockConversation("other", [R, J])).toBe(false);
    await h.runUntilDone();
    expect(h.book().history).toHaveLength(1);
  });

  it("18: exactly one AI request per accepted conversation, however many steps; the hourly cap falls back to built-in lines", async () => {
    const h = harness({ writer: "ai" });
    standApart(h, J, W, 34);
    h.director.request(J, W);
    await h.runUntilDone();
    expect(h.writes).toHaveLength(1);
    expect(h.director.aiRequests).toBe(1);
    // Idle time with nobody talking: no calls at all.
    h.setEnabled(false);
    await h.run(30_000);
    expect(h.writes).toHaveLength(1);
    h.setEnabled(true);
    // Fill the hour's allowance, then the next one is built-in.
    const cap = frequencySpec("medium").aiPerHour;
    const s = h.story();
    const ag = agencyOf(s.agency);
    const b = bookOf(ag);
    h.setStory({ ...s, agency: { ...ag, convos: { ...b, ai: { ...b.ai, windowStart: h.wall(), count: cap } } } });
    h.skipWall(frequencySpec("medium").pairGapMs + 1);
    expect(h.director.request(J, W)).toBe(true);
    await h.runUntilDone();
    expect(h.writes).toHaveLength(1);
    expect(h.book().history.at(-1)!.source).toBe("builtin");
  });

  it("disabled autonomy starts nothing", async () => {
    const h = harness({ frequency: "high" });
    standApart(h, J, W, 34);
    h.setEnabled(false);
    expect(h.director.request(J, W)).toBe(false);
    await h.run(60_000);
    expect(h.book().history).toHaveLength(0);
  });
});

describe("/api/ai/converse", () => {
  const post = (body: unknown) => new Request("http://x/api/ai/converse", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const request = () => {
    const a = juniper();
    const b = wren();
    const story: StoryState = { ...emptyStory(), characters: { [a.id]: neutralState(), [b.id]: neutralState() } };
    const c = { id: "convo-x", participants: [a.id, b.id], initiator: a.id, topic: { kind: "smallTalk", about: "the weather" }, reason: "chats", minTurns: 4, maxTurns: 8, willingness: "willing", turns: [] } as unknown as AutoConvo;
    return buildConverseRequest({ story, convo: c, a, b, locale: "en", world: "modern", place: "interior", placeDescription: "A flat.", recentEvents: [], doing: () => "", reasonText: "wants to chat" });
  };
  beforeEach(() => resetAutoTalkLimits());
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_TALK_MOCK;
  });

  it("rejects bad input and explains a missing key without inventing anything", async () => {
    expect((await converse(post({ nope: 1 }))).status).toBe(400);
    expect((await converse(post("x".repeat(70_000)))).status).toBe(413);
    const res = await converse(post(request()));
    expect(res.status).toBe(503);
    expect(vi.mocked(structuredCall)).not.toHaveBeenCalled();
  });

  it("mock mode returns a labelled TEST conversation (no model call)", async () => {
    process.env.AI_TALK_MOCK = "1";
    const res = await converse(post(request()));
    const data = await res.json();
    expect(data.source).toBe("mock");
    expect(data.reply.turns.length).toBeGreaterThanOrEqual(4);
    expect(data.reply.turns.every((t: { text: string }) => t.text.includes("TEST"))).toBe(true);
    expect(vi.mocked(structuredCall)).not.toHaveBeenCalled();
  });

  it("one bounded structured call; a broken reply is retried once, then rejected", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const good = mockConverse(request());
    vi.mocked(structuredCall).mockResolvedValueOnce({ ...good, staysInCharacter: false }).mockResolvedValueOnce(good);
    const ok = await converse(post(request()));
    expect(ok.status).toBe(200);
    expect((await ok.json()).source).toBe("ai");
    expect(vi.mocked(structuredCall)).toHaveBeenCalledTimes(2);
    const call = vi.mocked(structuredCall).mock.calls[0][0];
    expect(call.feature).toBe("auto_talk");
    expect(call.maxTokens).toBeLessThanOrEqual(1800);
    vi.mocked(structuredCall).mockReset();
    vi.mocked(structuredCall).mockResolvedValue({ ...good, turns: good.turns.slice(0, 1) });
    resetAutoTalkLimits();
    const bad = await converse(post(request()));
    expect(bad.status).not.toBe(200);
    expect(vi.mocked(structuredCall)).toHaveBeenCalledTimes(2);
  });

  it("only one autonomous conversation request in flight per visitor", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    let finish: (v: unknown) => void = () => {};
    vi.mocked(structuredCall).mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const first = converse(post(request()));
    await new Promise((r) => setTimeout(r, 5));
    const second = await converse(post(request()));
    expect(second.status).toBe(429);
    finish(mockConverse(request()));
    expect((await first).status).toBe(200);
  });

  it("the sanitizer drops out-of-character and repeated lines and keeps speakers alternating", () => {
    const r = request();
    const reply: ConverseReply = {
      ...mockConverse(r),
      turns: [
        { speaker: "a", text: "Hi Wren.", emotion: "happy", intensity: 2 },
        { speaker: "a", text: "Nice day.", emotion: "neutral", intensity: 0.2 },
        { speaker: "b", text: "As an AI language model I can't say.", emotion: "neutral", intensity: 0.2 },
        { speaker: "b", text: "It is, yes.", emotion: "neutral", intensity: 0.2 },
        { speaker: "a", text: "It is, yes.", emotion: "neutral", intensity: 0.2 },
      ],
    };
    const out = sanitizeConverse(reply, r);
    expect(out.turns.map((t) => t.speaker)).toEqual(["a", "b"]);
    expect(out.turns[0].intensity).toBeLessThanOrEqual(1);
    expect(converseProblem(out, r)).toBeNull();
  });
});
