/**
 * Behavior engine tests: the 10 required scenarios plus the rules that keep
 * behavior believable (hard limits, repetition, memory, directional
 * relationships, player-command priority, real movement on the stage).
 *
 * Probabilities are measured over many seeds, never a single roll, so the
 * tests check tendencies ("usually steps back") rather than fixed outcomes.
 */
import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import {
  ACTION_DEFS,
  applyDecision,
  BEHAVIOR_ACTIONS,
  buildScenario,
  canonLimits,
  decide,
  decisionLines,
  personalityOf,
  relationOf,
  remember,
  sampleCharacter,
  scenarioByKey,
  SCENARIOS,
  seedFromText,
  TRIGGERS,
  triggerForBeat,
  type BehaviorAction,
  type Decision,
  type StageView,
} from "@/lib/mind";
import { fadeEmotion } from "@/lib/emotion/emotions";
import { renderLine } from "@/lib/scenes";
import { rngFrom } from "@/lib/stage/behavior";
import { roomFor } from "@/lib/stage/room";
import { COMMAND_GRACE_MS, StageSim } from "@/lib/stage/sim";
import { TurnRequestSchema } from "@/lib/ai/contracts";
import { turnUser } from "@/lib/ai/server/prompts";
import { neutralState } from "@/lib/story/engine";
import type { Character, StoryState } from "@/lib/types";

const STAGE: StageView = { gap: 60, talkDistance: 32, state: "idle", canReach: true, canRetreat: true };
const N = 400;

type Setup = { cast: Character[]; story: StoryState; reactorId: string; otherId: string; trigger: Decision["event"]["trigger"] };

function setupOf(key: string, mutate?: (s: Setup) => void): Setup {
  const sc = scenarioByKey(key)!;
  const b = buildScenario(sc);
  const s = { ...b, trigger: sc.trigger };
  mutate?.(s);
  return s;
}

function once(s: Setup, seed: string | number, stage: StageView = STAGE): Decision {
  return decide({ story: s.story, cast: s.cast, event: { trigger: s.trigger, reactorId: s.reactorId, otherId: s.otherId }, place: "interior", stage, rng: rngFrom(`t${seed}`) });
}

/** Share of N seeded runs that picked each action (nothing is applied). */
function dist(s: Setup, stage: StageView = STAGE): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const a = once(s, i, stage).action;
    out[a] = (out[a] ?? 0) + 1 / N;
  }
  return out;
}
const share = (d: Record<string, number>, actions: BehaviorAction[]) => actions.reduce((a, k) => a + (d[k] ?? 0), 0);
const distinct = (d: Record<string, number>, min = 0.02) => Object.values(d).filter((v) => v >= min).length;

const WARM: BehaviorAction[] = ["greet", "approach", "initiate_conversation", "show_affection", "respond_playfully"];
const WARY: BehaviorAction[] = ["retreat", "respond_cautiously", "avoid_conversation", "stay_still", "face_target", "ask_question"];

describe("behavior engine · the 10 scenarios", () => {
  it("1–2. the same introvert: wary with a stranger, warm with a close friend", () => {
    const stranger = dist(setupOf("introStranger"));
    const friend = dist(setupOf("introFriend"));
    expect(share(stranger, WARY)).toBeGreaterThan(0.85);
    expect(share(stranger, ["retreat"])).toBeGreaterThan(0.25);
    expect(share(friend, WARM)).toBeGreaterThan(0.75);
    expect(share(friend, ["retreat", "avoid_conversation"])).toBeLessThan(0.03);
    // Introversion alone doesn't decide: same sliders, opposite behavior.
    expect(sampleCharacter("mira").traits).toEqual(sampleCharacter("mira").traits);
    // Several believable options each time, not one canned reaction.
    expect(distinct(stranger)).toBeGreaterThanOrEqual(3);
    expect(distinct(friend)).toBeGreaterThanOrEqual(3);
  });

  it("3. an extrovert approached by a feared rival is far less welcoming than when approached by someone neutral", () => {
    const rival = dist(setupOf("extroFearedRival"));
    const neutral = dist(
      setupOf("extroFearedRival", (s) => {
        s.cast.push(sampleCharacter("mira"));
        s.otherId = "sample-mira";
      }),
    );
    expect(share(neutral, ["greet", "initiate_conversation"])).toBeGreaterThan(share(rival, ["greet", "initiate_conversation"]) + 0.2);
    expect(share(rival, ["challenge", "retreat", "respond_cautiously", "face_target", "stay_still"])).toBeGreaterThan(0.4);
    // Fear is felt; an expressive extrovert still mostly shows it only a little.
    const d = once(setupOf("extroFearedRival"), 1);
    expect((d.feelings.fear ?? 0) + (d.feelings.anxiety ?? 0)).toBeGreaterThan(30);
  });

  it("4. an impulsive character criticized gets defensive or frustrated, unless the critic is someone they deeply respect", () => {
    const base = setupOf("impulsiveCriticized");
    const d0 = dist(base);
    expect(share(d0, ["respond_defensively", "express_frustration", "challenge"])).toBeGreaterThan(0.5);
    const first = once(base, 3);
    expect((first.feelings.frustration ?? 0) + (first.feelings.anger ?? 0)).toBeGreaterThan(60);
    expect(first.feelings.surprise ?? 0).toBeGreaterThan(20); // unexpected

    const respected = dist(setupOf("impulsiveCriticized", (s) => {
      s.story.relations!["sample-tobi>sample-mira"] = { ...s.story.relations!["sample-tobi>sample-mira"], respect: 90, trust: 60 };
    }));
    expect(respected.acknowledge ?? 0).toBeGreaterThan((d0.acknowledge ?? 0) + 0.1);
    expect(respected.respond_defensively ?? 0).toBeLessThan(d0.respond_defensively ?? 0);
  });

  it("5. a proud character complimented by an enemy is suspicious, not grateful", () => {
    const enemy = setupOf("proudComplimentedByEnemy");
    const d = dist(enemy);
    expect(d.acknowledge ?? 0).toBeLessThan(0.1);
    expect(share(d, ["respond_defensively", "ask_question", "face_target", "respond_cautiously", "stay_silent", "change_subject"])).toBeGreaterThan(0.75);
    expect(once(enemy, 1).feelings.confusion ?? 0).toBeGreaterThan(30);
    // The same compliment from her best friend: no suspicion.
    const friend = setupOf("proudComplimentedByEnemy", (s) => {
      s.cast.push(sampleCharacter("mira"));
      s.otherId = "sample-mira";
    });
    expect(once(friend, 1).feelings.confusion ?? 0).toBeLessThan(10);
  });

  it("6. two rivals forced to cooperate: friction both ways, but cooperation stays possible", () => {
    const wren = dist(setupOf("rivalsCooperate"));
    const tobi = dist(setupOf("rivalsCooperate", (s) => ([s.reactorId, s.otherId] = [s.otherId, s.reactorId])));
    for (const d of [wren, tobi]) {
      expect(share(d, ["challenge", "express_frustration", "respond_cautiously", "stay_silent", "face_target", "ask_question", "respond_defensively"])).toBeGreaterThan(0.6);
      expect(distinct(d)).toBeGreaterThanOrEqual(4);
    }
    // Directional: Tobi fears Wren, Wren doesn't fear Tobi, so they don't react the same way.
    expect(JSON.stringify(wren)).not.toBe(JSON.stringify(tobi));
  });

  it("7. a calm character pushed again and again builds up to visible anger (personality unchanged)", () => {
    const s = setupOf("calmTurnsAngry", (x) => {
      x.story.characters[x.reactorId].feelings = {};
      x.story.decisions = [];
      x.story.characters[x.reactorId].memories = [];
    });
    const traitsBefore = JSON.stringify(s.cast[0].traits);
    const firstOdds = share(dist(s), ["express_frustration", "challenge", "respond_defensively"]);
    const angers: number[] = [];
    let last: Decision | null = null;
    for (let i = 0; i < 5; i++) {
      last = once(s, `calm${i}`);
      s.story = applyDecision(s.story, last, s.cast, 1000 + i);
      angers.push(s.story.characters[s.reactorId].feelings?.anger ?? 0);
    }
    expect(angers[0]).toBeLessThan(45); // calm: the first push doesn't boil over
    expect(angers[4]).toBeGreaterThanOrEqual(70);
    expect(angers[4]).toBeGreaterThan(angers[0] + 25);
    const lateOdds = share(dist(s), ["express_frustration", "challenge", "respond_defensively"]);
    expect(lateOdds).toBeGreaterThan(firstOdds + 0.1);
    // Repeated provocations merge into one memory, not five.
    const mems = s.story.characters[s.reactorId].memories.filter((m) => m.kind === "provoked");
    expect(mems).toHaveLength(1);
    expect(mems[0].count).toBe(5);
    expect(JSON.stringify(s.cast[0].traits)).toBe(traitsBefore);
  });

  it("8. meeting someone who betrayed them: no warm greeting", () => {
    const d = dist(setupOf("betrayedBefore"));
    expect(share(d, WARM)).toBeLessThan(0.05);
    expect(share(d, ["respond_cautiously", "avoid_conversation", "retreat"])).toBeGreaterThan(0.75);
    const one = once(setupOf("betrayedBefore"), 2);
    expect(one.features["m.betrayed"]).toBeGreaterThan(0.5);
    expect(one.feelings.anger ?? 0).toBeGreaterThan(10);
  });

  it("9. same sliders, different past: the ferry keeper handles strangers better than the lighthouse keeper", () => {
    expect(sampleCharacter("sol").traits).toEqual(sampleCharacter("mira").traits);
    const sol = dist(setupOf("sameTraitsDifferentPast"));
    const mira = dist(setupOf("introStranger"));
    expect((mira.retreat ?? 0) - (sol.retreat ?? 0)).toBeGreaterThan(0.2);
    expect(personalityOf(sampleCharacter("sol")).socialBg).toBeGreaterThan(0);
    expect(personalityOf(sampleCharacter("mira")).strangerWary).toBeGreaterThan(0);
  });

  it("10. hiding strong affection: never shows hearts, never confesses, but a small tell can slip out", () => {
    const s = setupOf("hiddenAffection");
    let tells = 0;
    for (let i = 0; i < 120; i++) {
      const d = once(s, i);
      expect(d.action).not.toBe("show_affection");
      expect(d.rejected.find((r) => r.action === "show_affection")?.reason).toBe("canon");
      expect(d.expression?.emotion).not.toBe("affectionate");
      expect(d.feelings.affection ?? 0).toBeGreaterThan(70); // felt, just not shown
      if (decisionLines(d, s.cast, i).some((l) => l.tpl === "behave.hidden.affection")) tells++;
    }
    expect(tells).toBeGreaterThan(60);
  });

  it("every scenario: repeated runs give several plausible responses, and nothing breaks canon", () => {
    for (const sc of SCENARIOS) {
      const s = setupOf(sc.key);
      const d = dist(s);
      expect(distinct(d), sc.key).toBeGreaterThanOrEqual(3);
      const banned = canonLimits(s.cast.find((c) => c.id === s.reactorId)!).banned;
      for (const a of Object.keys(d)) expect(banned.has(a), `${sc.key}: ${a}`).toBe(false);
      // Nothing completely dominates: the top choice stays below 95%.
      expect(Math.max(...Object.values(d)), sc.key).toBeLessThan(0.95);
    }
  });
});

describe("behavior engine · rules", () => {
  it("is reproducible with a fixed seed", () => {
    const s = setupOf("introStranger");
    for (let i = 0; i < 20; i++) expect(once(s, `same${i}`).action).toBe(once(s, `same${i}`).action);
  });

  it("probabilities are a proper distribution and every candidate is valid for the trigger", () => {
    for (const trigger of TRIGGERS) {
      const s = setupOf("introStranger", (x) => (x.trigger = trigger));
      const d = once(s, 1);
      expect(d.candidates.reduce((a, c) => a + c.prob, 0)).toBeCloseTo(1, 6);
      for (const c of d.candidates) {
        const t = ACTION_DEFS[c.action].triggers;
        expect(t === "all" || t.includes(trigger)).toBe(true);
      }
    }
  });

  it("hard limits run before the dice: player control, speaking, unreachable targets, no room", () => {
    const s = setupOf("introFriend");
    const travelling = (d: Decision) => ["approach", "retreat", "initiate_conversation", "show_affection"].includes(d.action);
    for (let i = 0; i < 60; i++) {
      const cmd = once(s, i, { ...STAGE, commanded: true });
      expect(travelling(cmd)).toBe(false);
      expect(cmd.rejected.some((r) => r.reason === "player_command")).toBe(true);
      expect(travelling(once(s, i, { ...STAGE, state: "speaking" }))).toBe(false);
      const blocked = once(s, i, { ...STAGE, canReach: false });
      expect(["approach", "initiate_conversation", "show_affection"]).not.toContain(blocked.action);
      expect(once(setupOf("introStranger"), i, { ...STAGE, canRetreat: false }).action).not.toBe("retreat");
    }
    // Already standing close: "approach" is not an option.
    expect(once(s, 1, { ...STAGE, gap: 20 }).rejected.find((r) => r.action === "approach")?.reason).toBe("already_close");
  });

  it("repetition penalty and cooldowns make the same reaction less likely right after it was used", () => {
    const s = setupOf("introFriend");
    const before = once(s, 1).candidates.find((c) => c.action === "approach")!.prob;
    s.story = { ...s.story, decisions: [{ turn: 10, actorId: s.reactorId, otherId: s.otherId, trigger: "approached", action: "approach", at: 0 }] };
    const after = once(s, 1).candidates.find((c) => c.action === "approach")!.prob;
    expect(after).toBeLessThan(before);
    // greet has a 1-decision cooldown.
    s.story = { ...s.story, decisions: [{ turn: 10, actorId: s.reactorId, otherId: s.otherId, trigger: "approached", action: "greet", at: 0 }] };
    expect(once(s, 1).rejected.find((r) => r.action === "greet")?.reason).toBe("cooldown");
  });

  it("relationships are directional and read from what the player wrote", () => {
    const tobi = sampleCharacter("tobi");
    const wren = sampleCharacter("wren");
    const mira = sampleCharacter("mira");
    const t2w = seedFromText(tobi, wren)!;
    const w2t = seedFromText(wren, tobi)!;
    expect(t2w.fear).toBeGreaterThan(40);
    expect(w2t.fear).toBe(0);
    expect(w2t.tension).toBeGreaterThan(t2w.tension);
    expect(seedFromText(wren, mira)!.affection).toBeGreaterThan(seedFromText(mira, wren)!.affection);
    // 中文 profiles give the same picture.
    const zt = seedFromText(sampleCharacter("tobi", "zh-CN"), sampleCharacter("wren", "zh-CN"))!;
    expect(zt.fear).toBeGreaterThan(40);
    expect(zt.label).toBe("rival");
    // Applying a decision changes each direction differently.
    const s = setupOf("impulsiveCriticized");
    const next = applyDecision(s.story, once(s, 4), s.cast);
    const ab = relationOf(next, s.cast[0], s.cast[1]);
    const ba = relationOf(next, s.cast[1], s.cast[0]);
    expect(JSON.stringify(ab)).not.toBe(JSON.stringify(ba));
  });

  it("feelings coexist and fade over time unless reinforced; personality, feelings, relations and memories stay separate", () => {
    const s = setupOf("hiddenAffection");
    const d = once(s, 1);
    expect(d.feelings.affection ?? 0).toBeGreaterThan(40);
    expect(d.feelings.embarrassment ?? 0).toBeGreaterThan(30);
    let story = applyDecision(s.story, d, s.cast);
    const st = story.characters[s.reactorId];
    expect(st.feelings).toBeTruthy();
    expect(st.memories.length).toBeGreaterThan(0);
    expect(story.relations?.[`${s.reactorId}>${s.otherId}`]).toBeTruthy();
    let faded = st;
    for (let i = 0; i < 6; i++) faded = fadeEmotion(faded);
    expect(faded.feelings?.embarrassment ?? 0).toBeLessThan(st.feelings!.embarrassment! / 3);
    // affection lingers longer than embarrassment
    expect((faded.feelings?.affection ?? 0) / st.feelings!.affection!).toBeGreaterThan((faded.feelings?.embarrassment ?? 0) / st.feelings!.embarrassment!);
    story = { ...story, characters: { ...story.characters, [s.reactorId]: faded } };
    expect(s.cast.find((c) => c.id === s.reactorId)!.traits).toEqual(sampleCharacter("wren").traits);
  });

  it("memories merge repeats and soften a contradicting recent memory", () => {
    let st = neutralState();
    st = remember(st, { kind: "criticized", withId: "x", withName: "X", turn: 1, importance: 2 }).state;
    st = remember(st, { kind: "criticized", withId: "x", withName: "X", turn: 2, importance: 2 }).state;
    expect(st.memories).toHaveLength(1);
    expect(st.memories[0].count).toBe(2);
    st = remember(st, { kind: "complimented", withId: "x", withName: "X", turn: 3, importance: 1 }).state;
    expect(st.memories).toHaveLength(2);
    expect(st.memories.find((m) => m.kind === "criticized")!.importance).toBe(1);
    // A different person is a different memory.
    st = remember(st, { kind: "criticized", withId: "y", withName: "Y", turn: 3, importance: 2 }).state;
    expect(st.memories).toHaveLength(3);
  });

  it("a reserved character shows less than an expressive one feeling the same thing", () => {
    const s = setupOf("impulsiveCriticized");
    const loud = once(s, 1);
    const quiet = once(
      setupOf("impulsiveCriticized", (x) => {
        x.cast = x.cast.map((c) => (c.id === x.reactorId ? { ...c, traits: { ...c.traits, expressiveness: 5 } } : c));
      }),
      1,
    );
    expect((quiet.expression?.shown ?? 0)).toBeLessThan(loud.expression?.shown ?? 0);
  });

  it("story beats map to sensible behavior events", () => {
    expect(triggerForBeat({ kind: "talk", type: "talk.goals", reaction: null }, true)).toBe("approached");
    expect(triggerForBeat({ kind: "talk", type: "talk.goals", reaction: null })).toBe("spoken_to");
    expect(triggerForBeat({ kind: "event", type: "argument", reaction: "confront" })).toBe("provoked");
    expect(triggerForBeat({ kind: "event", type: "rivalry", reaction: "cooperate" })).toBe("forced_cooperation");
    expect(triggerForBeat({ kind: "event", type: "kindness", reaction: "comfort" })).toBe("complimented");
  });
});

describe("behavior engine · dialogue", () => {
  it("every action, trigger group and length has lines in English and Chinese", () => {
    for (const a of BEHAVIOR_ACTIONS) {
      expect(en.behave.actions[a]).toBeTruthy();
      expect(zh.behave.actions[a]).toBeTruthy();
      if (!ACTION_DEFS[a].speaks) continue;
      for (const loc of [en, zh]) {
        const say = (loc.behave.say as unknown as Record<string, Record<string, string[]>>)[a];
        for (const len of ["terse", "short", "full"]) expect(say[len]?.length, `${a}.${len}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("the same event spoken to different characters gives different replies", () => {
    const texts = new Set<string>();
    for (const key of ["introStranger", "introFriend", "extroFearedRival", "sameTraitsDifferentPast", "betrayedBefore"]) {
      const s = setupOf(key, (x) => (x.trigger = "spoken_to"));
      const d = once(s, 5);
      for (const l of decisionLines(d, s.cast, 5)) texts.add(renderLine(l, "en").text);
    }
    expect(texts.size).toBeGreaterThanOrEqual(4);
  });

  it("replies render in both languages, with hesitation and the listener's name when familiar", () => {
    const s = setupOf("introFriend", (x) => (x.trigger = "spoken_to"));
    for (let i = 0; i < 30; i++) {
      const d = once(s, i);
      for (const loc of ["en", "zh-CN"] as const) {
        const castL = buildScenario(scenarioByKey("introFriend")!, loc).cast;
        for (const l of decisionLines(d, castL, i)) {
          const r = renderLine(l, loc);
          expect(r.text.length).toBeGreaterThan(0);
          expect(r.text).not.toMatch(/\{|behave\./);
        }
      }
    }
  });

  it("the AI is told the decided behavior and may not change it", () => {
    const s = setupOf("introStranger");
    const d = once(s, 1);
    const actor = s.cast[1];
    const brief = (c: Character) => ({ id: c.id, fields: { name: c.name }, traits: c.traits, lockedFields: [], profile: null });
    const req = TurnRequestSchema.parse({
      locale: "en",
      world: "otherworld",
      place: "interior",
      placeDescription: "",
      beat: { kind: "talk", type: "talk.goals", reaction: null, approach: "direct", topic: "goals", outcome: null, moodBefore: "calm", moodAfter: "calm", bondChange: null, recalled: null },
      actor: brief(actor),
      other: brief(s.cast[0]),
      bond: null,
      memories: [],
      recentLines: [],
      behaviors: [
        {
          characterId: d.event.reactorId,
          trigger: d.event.trigger,
          causedBy: d.event.otherId,
          intent: d.action,
          style: d.style,
          shows: d.expression ? { emotion: d.expression.emotion, level: d.expression.level } : null,
          hiddenFeeling: null,
          feelings: [],
          movement: ACTION_DEFS[d.action].move,
          speaks: ACTION_DEFS[d.action].speaks,
        },
      ],
    });
    const prompt = turnUser(req);
    expect(prompt).toContain("<behavior_plan");
    expect(prompt).toContain(`intention: ${d.action}`);
  });
});

describe("behavior engine · on the stage", () => {
  it("a chosen retreat really walks away through the movement system (no teleporting, no overlap)", () => {
    const s = setupOf("introStranger");
    const room = roomFor("otherworld", "interior");
    const sim = new StageSim({ room, idle: false });
    sim.setCast(s.cast);
    // Tobi walks up to Mira first.
    sim.request({ type: "approach", actor: s.otherId, target: s.reactorId, distance: 30 }, "event");
    for (let t = 0; t < 6000; t += 16) sim.tick(16);
    let d: Decision | null = null;
    for (let i = 0; i < 50 && d?.action !== "retreat"; i++) d = once(s, `walk${i}`, { ...STAGE, gap: sim.gapBetween(s.reactorId, s.otherId) });
    expect(d!.action).toBe("retreat");
    const before = sim.gapBetween(s.reactorId, s.otherId)!;
    let prev = sim.position(s.reactorId)!;
    for (const m of d!.movement) sim.schedule(m.delay, m.action, "event", "auto");
    for (let t = 0; t < 4000; t += 16) {
      sim.tick(16);
      const p = sim.position(s.reactorId)!;
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(3); // small steps only
      prev = p;
    }
    expect(sim.gapBetween(s.reactorId, s.otherId)!).toBeGreaterThan(before + 6);
  });

  it("the player's direct command wins over autonomous behavior, then autonomy resumes", () => {
    const s = setupOf("introStranger");
    const sim = new StageSim({ room: roomFor("otherworld", "interior"), idle: false });
    sim.setCast(s.cast);
    expect(sim.request({ type: "retreat", actor: s.reactorId, distance: 40 }, "test", "player").ok).toBe(true);
    const auto = sim.request({ type: "approach", actor: s.reactorId, target: s.otherId }, "event", "auto");
    expect(auto.ok).toBe(false);
    expect(!auto.ok && auto.reason).toBe("player_command");
    for (let t = 0; t < 5000; t += 16) sim.tick(16);
    expect(sim.isCommanded(s.reactorId)).toBe(false);
    expect(sim.request({ type: "approach", actor: s.reactorId, target: s.otherId }, "event", "auto").ok).toBe(true);
    void COMMAND_GRACE_MS;
  });

  it("a story walk can't be interrupted by an autonomous one, and delayed reactions wait while the game is paused", () => {
    const s = setupOf("introStranger");
    const sim = new StageSim({ room: roomFor("otherworld", "interior"), idle: false });
    sim.setCast(s.cast);
    expect(sim.request({ type: "approach", actor: s.reactorId, target: s.otherId }, "event", "story").ok).toBe(true);
    const r = sim.request({ type: "retreat", actor: s.reactorId }, "event", "auto");
    expect(!r.ok && r.reason).toBe("outranked");
    // Scheduled (hesitation) actions use game time.
    const sim2 = new StageSim({ room: roomFor("otherworld", "interior"), idle: false });
    sim2.setCast(s.cast);
    sim2.schedule(500, { type: "retreat", actor: s.reactorId, distance: 30 }, "event", "auto");
    sim2.setPaused(true);
    for (let t = 0; t < 2000; t += 16) sim2.tick(16);
    expect(sim2.stateOf(s.reactorId)).toBe("idle");
    sim2.setPaused(false);
    for (let t = 0; t < 600; t += 16) sim2.tick(16);
    expect(sim2.stateOf(s.reactorId)).toBe("moving");
  });
});
