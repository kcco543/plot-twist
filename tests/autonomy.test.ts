/**
 * Character autonomy: intents and their lifecycle, the planner, ending a
 * conversation (boundary, refusal, recovery), following through on plans
 * said out loud, priorities, and persistence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { CONVO_BOUNDARY, cooldownUntil, recordBoundary, recordPush, severityFrom, willingToTalk } from "@/lib/autonomy/convoBoundary";
import { submit, tick, walkEnded, type EngineEnv } from "@/lib/autonomy/engine";
import { classifyStatement, goalFromLine } from "@/lib/autonomy/goals";
import { advance, INTENT_TRANSITIONS, resumeAfterLoad } from "@/lib/autonomy/lifecycle";
import { planFor, proposals } from "@/lib/autonomy/planner";
import { AUTONOMY, emptyAgency, INTENT_KINDS, type AgencyState } from "@/lib/autonomy/types";
import { newIntent, validateIntent } from "@/lib/autonomy/validate";
import { forgetCharacterInStory } from "@/lib/library/templates";
import { recordInteraction } from "@/lib/relationships/progression";
import { rngFrom } from "@/lib/stage/behavior";
import { objectsFor } from "@/lib/stage/objects";
import { roomFor } from "@/lib/stage/room";
import { StageSim } from "@/lib/stage/sim";
import { emptyStory, neutralState } from "@/lib/story/engine";
import type { Character, Feelings, StoryState } from "@/lib/types";
import { fakeBrowser } from "./fakeBrowser";
import { juniper, makeChar, rook } from "./helpers";

const T0 = 1_000_000;

function setup(cast: Character[] = [juniper(), rook()]) {
  const room = roomFor("modern", "interior");
  const sim = new StageSim({ room, idle: false });
  sim.setCast(cast);
  const objects = objectsFor("modern", "interior");
  sim.setObjects(objects);
  let story: StoryState = { ...emptyStory(), characters: Object.fromEntries(cast.map((c) => [c.id, neutralState()])) };
  const env = (now: number, inConvo: string[] = []): EngineEnv => ({
    stage: { request: (a, c, p) => sim.request(a, c, p), position: (id) => sim.position(id), poseOf: (id) => sim.poseOf(id), walkOf: (id) => sim.walkOf(id), isCommanded: (id) => sim.isCommanded(id) },
    cast,
    objects,
    story,
    inConversation: (id) => inConvo.includes(id),
    now,
    rng: (k) => rngFrom(k),
  });
  const feel = (id: string, f: Feelings) => {
    story = { ...story, characters: { ...story.characters, [id]: { ...story.characters[id], feelings: f } } };
  };
  return { sim, objects, cast, env, feel, getStory: () => story, setStory: (s: StoryState) => (story = s) };
}

/** Run the sim until a walk ends, forwarding walk-end events to the agency. */
function runWalks(sim: StageSim, a: AgencyState, ms = 15000): AgencyState {
  let out = a;
  sim.onWalkEnd = (actor, outcome) => (out = walkEnded(out, actor, outcome, T0 + 1));
  for (let t = 0; t < ms; t += 16) sim.tick(16);
  sim.onWalkEnd = null;
  return out;
}

describe("intent lifecycle", () => {
  it("only allows proposed → validated → queued → executing → completed / interrupted / failed", () => {
    const i = newIntent({ actor: "a", kind: "observe", reason: "curious", source: "rules" }, T0);
    expect(advance(i, "completed").status).toBe("proposed"); // can't skip ahead
    const done = advance(advance(advance(advance(i, "validated"), "queued"), "executing"), "completed");
    expect(done.status).toBe("completed");
    expect(advance(done, "executing").status).toBe("completed"); // finished stays finished
    expect(Object.keys(INTENT_TRANSITIONS).sort()).toEqual(["completed", "executing", "failed", "interrupted", "proposed", "queued", "validated"]);
  });

  it("every intent kind, reason and status has EN + ZH text", () => {
    for (const k of INTENT_KINDS) {
      expect(en.autonomy.kinds[k], k).toBeTruthy();
      expect(zh.autonomy.kinds[k], k).toBeTruthy();
    }
    expect(Object.keys(zh.autonomy.reasons).sort()).toEqual(Object.keys(en.autonomy.reasons).sort());
    expect(Object.keys(zh.autonomy.why).sort()).toEqual(Object.keys(en.autonomy.why).sort());
  });
});

describe("scenario 1–4: ending a conversation, refusal and recovery", () => {
  it("1. ending a conversation records a boundary whose severity comes from how they feel", () => {
    const { feel, getStory } = setup();
    feel("c-rook", { frustration: 55 });
    expect(severityFrom(getStory(), "c-rook")).toBe(2);
    const a = recordBoundary(emptyAgency(), "c-rook", "c-juniper", severityFrom(getStory(), "c-rook"), 3, T0);
    expect(a.boundaries["c-rook>c-juniper"]).toMatchObject({ who: "c-rook", other: "c-juniper", severity: 2, pushes: 0 });
  });

  it("2. trying again right away is refused; retrying can't bypass it and makes it longer", () => {
    const { getStory } = setup();
    let a = recordBoundary(emptyAgency(), "c-rook", "c-juniper", 1, 0, T0);
    const r = willingToTalk(getStory(), a, rook(), juniper(), T0 + 1000);
    expect(r.willing).toBe(false);
    expect(r.blockers).toContain("cooldown");
    const before = cooldownUntil(a.boundaries["c-rook>c-juniper"], rook());
    for (let n = 0; n < 5; n++) a = recordPush(a, "c-rook", "c-juniper", T0 + 2000 + n);
    expect(willingToTalk(getStory(), a, rook(), juniper(), T0 + 3000).willing).toBe(false);
    expect(cooldownUntil(a.boundaries["c-rook>c-juniper"], rook())).toBeGreaterThan(before);
    // The push is felt in the relationship too.
    const s = recordInteraction(getStory(), { from: rook(), to: juniper(), kind: "boundary_push", source: "behavior", now: T0 }).story;
    expect(s.progress?.["c-rook>c-juniper"]?.counts.boundary_push).toBe(1);
  });

  it("3. the cooldown running out is not enough while they're still upset", () => {
    const { feel, getStory } = setup();
    const a = recordBoundary(emptyAgency(), "c-rook", "c-juniper", 1, 0, T0);
    feel("c-rook", { anger: 60 });
    const later = T0 + 10 * 60_000;
    expect(willingToTalk(getStory(), a, rook(), juniper(), later)).toMatchObject({ willing: false, blockers: ["upset"] });
    feel("c-rook", { anger: 10 });
    expect(willingToTalk(getStory(), a, rook(), juniper(), later).willing).toBe(true);
  });

  it("4. after an upset ending, time and calm still need a repair: an apology works", () => {
    const { getStory, setStory } = setup();
    const a = recordBoundary(emptyAgency(), "c-rook", "c-juniper", 2, 0, T0);
    const later = T0 + 30 * 60_000;
    expect(willingToTalk(getStory(), a, rook(), juniper(), later).blockers).toEqual(["repair"]);
    setStory(recordInteraction(getStory(), { from: rook(), to: juniper(), kind: "apology", source: "behavior", now: T0 + 60_000 }).story);
    expect(willingToTalk(getStory(), a, rook(), juniper(), later).willing).toBe(true);
  });

  it("4b. a long trusting history can stand in for repair after severity 2, never after severity 3", () => {
    const { getStory, setStory } = setup();
    const trusted: StoryState = { ...getStory(), relations: { "c-rook>c-juniper": { trust: 60, affection: 50, respect: 40, familiarity: 70, rivalry: 0, tension: 0, fear: 0, label: "friend" } } };
    setStory(trusted);
    const later = T0 + 60 * 60_000;
    expect(willingToTalk(getStory(), recordBoundary(emptyAgency(), "c-rook", "c-juniper", 2, 0, T0), rook(), juniper(), later).willing).toBe(true);
    expect(willingToTalk(getStory(), recordBoundary(emptyAgency(), "c-rook", "c-juniper", 3, 0, T0), rook(), juniper(), later).blockers).toContain("repair");
  });

  it("personality changes how long it takes (holds on vs lets go)", () => {
    const b = recordBoundary(emptyAgency(), "x", "y", 2, 0, T0).boundaries["x>y"];
    const forgiving = makeChar({ id: "x", name: "F", traits: { empathy: 95, trust: 90 } });
    const proud = makeChar({ id: "x", name: "P", personality: "Proud and guarded.", traits: { empathy: 10, trust: 10, expressiveness: 10 } });
    expect(cooldownUntil(b, proud) - T0).toBeGreaterThan(cooldownUntil(b, forgiving) - T0);
    expect(cooldownUntil(b, forgiving) - T0).toBeGreaterThanOrEqual(CONVO_BOUNDARY.cooldownMs[2] * 0.6);
  });
});

describe("scenario 5: walking away after ending a conversation", () => {
  it("the one who ended it walks somewhere valid, away from the other", () => {
    const { sim, env } = setup();
    const before = Math.hypot(sim.position("c-rook")!.x - sim.position("c-juniper")!.x, sim.position("c-rook")!.y - sim.position("c-juniper")!.y);
    let a = recordBoundary(emptyAgency(), "c-rook", "c-juniper", 2, 0, T0);
    const r = submit(a, newIntent({ actor: "c-rook", kind: "move_away", target: "c-juniper", reason: "endedConversation", source: "story" }, T0), env(T0));
    expect(r.intent.status).toBe("executing");
    a = runWalks(sim, r.agency);
    expect(a.log.find((i) => i.id === r.intent.id)?.status).toBe("completed");
    const after = Math.hypot(sim.position("c-rook")!.x - sim.position("c-juniper")!.x, sim.position("c-rook")!.y - sim.position("c-juniper")!.y);
    expect(after).toBeGreaterThan(before);
  });

  it("nobody plans to walk up to someone they're keeping apart from, and validation refuses it too", () => {
    const { env, feel, getStory, cast, sim, objects } = setup();
    const a = recordBoundary(emptyAgency(), "c-rook", "c-juniper", 2, 0, T0);
    feel("c-juniper", { happiness: 90, excitement: 80 });
    const ps = proposals({ actor: juniper(), story: getStory(), cast, objects, position: (id) => sim.position(id), pose: () => null, agency: a, rng: rngFrom("x") });
    expect(ps.some((p) => p.kind === "approach" && p.target === "c-rook")).toBe(false);
    const v = validateIntent(newIntent({ actor: "c-juniper", kind: "approach", target: "c-rook", reason: "wantsCompany", source: "ai" }), { ...env(T0), onStage: (id) => !!sim.position(id), objects, inConversation: () => false, commanded: () => false, walking: () => null, agency: a, autonomousWalks: 0 });
    expect(v).toEqual({ ok: false, note: "boundary" });
  });
});

describe("scenario 6–8: following through on what was said", () => {
  it("6. only a genuine intention becomes a goal (EN)", () => {
    expect(classifyStatement("I'm heading to the window.").kind).toBe("intention");
    expect(classifyStatement("If it rains I'll go to the window.").kind).toBe("hypothetical");
    expect(classifyStatement("I went to the window yesterday.").kind).toBe("past");
    expect(classifyStatement("I'm going to the moon, lol.").kind).toBe("joke");
    expect(classifyStatement("Should I go to the window?").kind).toBe("question");
    expect(classifyStatement("I'm going to be honest with you.").kind).toBe("none");
    expect(classifyStatement("I'm not going to the window.").kind).toBe("none");
  });

  it("6b. …and in Chinese", () => {
    expect(classifyStatement("我去书架那边看看。").kind).toBe("intention");
    expect(classifyStatement("要是下雨我就去图书馆。").kind).toBe("hypothetical");
    expect(classifyStatement("我昨天去过图书馆。").kind).toBe("past");
    expect(classifyStatement("我去月球了，开玩笑的。").kind).toBe("joke");
    expect(classifyStatement("我要不要去窗边？").kind).toBe("question");
  });

  it("7. a place in this room resolves to its object; one that isn't here is reported, never faked", () => {
    const objects = objectsFor("modern", "interior");
    expect(goalFromLine("I'll go sit on the rug for a bit.", objects)?.object?.id).toBe("rug");
    expect(goalFromLine("我去书架那边看看。", objects)?.object?.id).toBe("bookshelf");
    expect(goalFromLine("I'm going to the library.", objects)).toEqual({ place: "library", object: null });
    expect(goalFromLine("我去图书馆了。", objects)).toEqual({ place: "图书馆", object: null }); // 图书馆 is not the bookshelf
    expect(goalFromLine("If it rains I'll go to the library.", objects)).toBeNull();
  });

  it("8. go_to_place walks there for real and completes on arrival", () => {
    const { sim, env } = setup();
    const r = submit(emptyAgency(), newIntent({ actor: "c-juniper", kind: "go_to_place", object: "window", place: "window", reason: "saidSo", source: "dialogue" }, T0), env(T0));
    expect(r.intent.status).toBe("executing");
    const a = runWalks(sim, r.agency);
    expect(a.log.find((i) => i.id === r.intent.id)?.status).toBe("completed");
    const p = sim.position("c-juniper")!;
    const anchors = objectsFor("modern", "interior").find((o) => o.id === "window")!.anchors;
    expect(Math.min(...anchors.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))).toBeLessThan(12);
  });
});

describe("scenario 9–10: priorities", () => {
  it("9. the player can interrupt an autonomous walk (the intent ends as interrupted)", () => {
    const { sim, env } = setup();
    const r = submit(emptyAgency(), newIntent({ actor: "c-juniper", kind: "inspect_object", object: "window", reason: "curious", source: "rules" }, T0), env(T0));
    expect(r.intent.status).toBe("executing");
    let a = r.agency;
    sim.onWalkEnd = (actor, outcome) => (a = walkEnded(a, actor, outcome, T0 + 5));
    for (let t = 0; t < 200; t += 16) sim.tick(16);
    expect(sim.request({ type: "walk_to", actor: "c-juniper", x: 60, y: 170 }, "test", "player").ok).toBe(true);
    sim.onWalkEnd = null;
    expect(a.log.find((i) => i.id === r.intent.id)?.status).toBe("interrupted");
  });

  it("10. autonomy never overrides the player's command", () => {
    const { sim, env } = setup();
    sim.request({ type: "walk_to", actor: "c-juniper", x: 60, y: 170 }, "test", "player");
    const r = submit(emptyAgency(), newIntent({ actor: "c-juniper", kind: "inspect_object", object: "window", reason: "curious", source: "rules" }, T0), env(T0));
    expect(r.intent.status).toBe("failed");
    expect(["player_command", "busy"]).toContain(r.intent.note);
  });
});

describe("scenario 11: diverse, personality-driven behavior", () => {
  it("the same feeling leads different people to different things (no one-size reaction)", () => {
    const outgoing = makeChar({ id: "c-a", name: "A", traits: { extroversion: 95, playfulness: 80 } });
    const quiet = makeChar({ id: "c-b", name: "B", traits: { extroversion: 5, expressiveness: 10 } });
    const friend = makeChar({ id: "c-f", name: "F" });
    const kinds = (c: Character) => {
      const { getStory, feel, sim, objects } = setup([c, friend]);
      feel(c.id, { happiness: 80 });
      const st: StoryState = { ...getStory(), relations: { [`${c.id}>c-f`]: { trust: 40, affection: 40, respect: 20, familiarity: 50, rivalry: 0, tension: 0, fear: 0, label: "friend" } } };
      return proposals({ actor: c, story: st, cast: [c, friend], objects, position: (id) => sim.position(id), pose: () => null, agency: emptyAgency(), rng: rngFrom("same") })[0].kind;
    };
    expect(kinds(outgoing)).toBe("approach");
    expect(kinds(quiet)).toBe("inspect_object");
  });

  it("a calm character mostly stays put, and doesn't repeat the same thing over and over", () => {
    const { getStory, sim, objects, cast } = setup();
    const ctx = { actor: rook(), story: getStory(), cast, objects, position: (id: string) => sim.position(id), pose: () => null };
    let acted = 0;
    for (let n = 0; n < 40; n++) if (planFor({ ...ctx, agency: emptyAgency(), rng: rngFrom(`calm${n}`) })) acted++;
    expect(acted).toBeLessThan(20);
  });

  it("the planner is rate-limited: one character thinks per tick, each at most every thinkMs", () => {
    const { env, feel } = setup();
    feel("c-juniper", { surprise: 80 });
    feel("c-rook", { surprise: 80 });
    let a = tick(emptyAgency(), env(T0));
    expect(Object.keys(a.lastThought ?? {})).toHaveLength(1);
    const first = Object.keys(a.lastThought!)[0];
    a = tick(a, env(T0 + 1000));
    expect(a.lastThought![first]).toBe(T0); // didn't think again a second later
  });
});

describe("scenario 12: persistence and isolation", () => {
  it("an executing intent resumes as queued after loading; stale ones are dropped", () => {
    const i = advance(advance(advance(newIntent({ actor: "a", kind: "go_to_place", object: "window", reason: "saidSo", source: "dialogue" }, T0), "validated", undefined, T0), "queued", undefined, T0), "executing", undefined, T0);
    expect(resumeAfterLoad({ ...emptyAgency(), intents: [i] }, T0 + 1000).intents[0]).toMatchObject({ status: "queued", note: "resumed" });
    expect(resumeAfterLoad({ ...emptyAgency(), intents: [i] }, T0 + 60 * 60_000).intents).toHaveLength(0);
    expect(AUTONOMY.queueTtlMs).toBeGreaterThan(0);
  });

  it("removing a character removes their intents, goals and boundaries", () => {
    const a = recordBoundary(emptyAgency(), "c-rook", "c-juniper", 2, 0, T0);
    const s = forgetCharacterInStory({ ...emptyStory(), agency: { ...a, goals: [{ id: "g", actor: "c-rook", place: "window", object: "window", text: "", at: 0, status: "pending" }] } }, "c-rook");
    expect(s.agency?.boundaries).toEqual({});
    expect(s.agency?.goals).toEqual([]);
  });

  describe("saved per world", () => {
    type Saves = typeof import("@/lib/saves/worldSaves");
    type Game = typeof import("@/lib/gameStore");
    let saves: Saves;
    let game: Game;
    const reload = async () => {
      vi.resetModules();
      saves = await import("@/lib/saves/worldSaves");
      game = await import("@/lib/gameStore");
    };
    beforeEach(async () => {
      fakeBrowser();
      await reload();
    });

    it("boundaries, goals and positions survive a reload, and stay in their own world", async () => {
      const a = saves.createWorld();
      const b = saves.createWorld();
      saves.enterWorld(a.id, "/play");
      await reload();
      game.gameActions.selectWorld("modern");
      const agency: AgencyState = { ...recordBoundary(emptyAgency(), "c-rook", "c-juniper", 2, 4, T0), spots: { place: "modern:interior", at: { "c-rook": { x: 100, y: 160, facing: -1, pose: "sit", object: "rug" } } } };
      game.gameActions.setStory({ ...game.getSave().story, agency });
      await reload();
      expect(game.getSave().story.agency?.boundaries["c-rook>c-juniper"]?.severity).toBe(2);
      expect(game.getSave().story.agency?.spots?.at["c-rook"]).toMatchObject({ x: 100, y: 160, pose: "sit" });
      saves.enterWorld(b.id, "/play");
      await reload();
      expect(game.getSave().story.agency).toBeUndefined();
    });
  });

  it("a saved spot puts a character back where they stood (and sitting)", () => {
    const sim = new StageSim({ room: roomFor("modern", "interior"), idle: false });
    sim.setSavedSpots({ "c-rook": { x: 116, y: 168, facing: -1, pose: "sit", object: "rug" } });
    sim.setCast([rook()]);
    expect(sim.position("c-rook")).toMatchObject({ x: 116, y: 168 });
    expect(sim.poseOf("c-rook")).toBe("sit");
  });
});
