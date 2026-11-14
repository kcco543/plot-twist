import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { actorEmotion, EMOTIONS, emotionFromMood, emotionOf, fadeEmotion, otherEmotion, withEmotion } from "@/lib/emotion/emotions";
import { EFFECTS, glyphPixels, GLYPHS, particlesFor, type GlyphId } from "@/lib/emotion/effects";
import { IDLE_KINDS, NOTES, REFUSALS, STAGE_ACTION_TYPES, validateStageAction } from "@/lib/stage/actions";
import { choreographBeat, reactionAction, rngFrom } from "@/lib/stage/behavior";
import { findPath, isFree, spawnPoints } from "@/lib/stage/path";
import { FOOT, gap, hitsObstacle, insideWalk, roomFor, standGap, type RoomLayout } from "@/lib/stage/room";
import { ACTOR_STATES, canTransition, StageSim } from "@/lib/stage/sim";
import { emptyStory, neutralState, plan } from "@/lib/story/engine";
import type { Character, EnvironmentTypeId, StoryState, WorldId } from "@/lib/types";
import { juniper, makeChar, mei, rook, seeded } from "./helpers";

const WORLDS: WorldId[] = ["western-fantasy", "modern", "ancient-china", "otherworld"];
const PLACES: EnvironmentTypeId[] = ["interior", "street", "wilderness", "ruins", "dreamscape"];

const extra = (n: number) => makeChar({ id: `c-extra-${n}`, name: `Extra ${n}`, traits: { extroversion: 50 + n * 5 } });

/** Run the sim for `ms`, checking the safety rules on every frame. */
function runChecked(sim: StageSim, ids: string[], ms: number, room: RoomLayout, step = 16) {
  for (let t = 0; t < ms; t += step) {
    sim.tick(step);
    const pts = ids.map((id) => sim.position(id)!);
    for (const p of pts) {
      expect(insideWalk(room, p), `left the floor at ${p.x},${p.y}`).toBe(true);
      expect(hitsObstacle(room, p), `walked into furniture at ${p.x},${p.y}`).toBeNull();
    }
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(gap(pts[i], pts[j]), `${ids[i]} and ${ids[j]} overlap`).toBeGreaterThanOrEqual(FOOT.w - 0.5);
  }
}

function makeSim(cast: Character[], world: WorldId = "modern", place: EnvironmentTypeId = "interior") {
  const room = roomFor(world, place);
  const sim = new StageSim({ room, idle: false });
  sim.setCast(cast);
  return { sim, room };
}

describe("emotions", () => {
  it("has the 11 required emotions, each with a translated name", () => {
    expect(EMOTIONS).toEqual(["neutral", "happy", "excited", "affectionate", "embarrassed", "angry", "frustrated", "sad", "anxious", "surprised", "confused"]);
    for (const e of EMOTIONS) {
      expect(en.emotions[e]).toBeTruthy();
      expect(zh.emotions[e]).toBeTruthy();
    }
  });

  it("keeps emotion separate from personality: the same mood shows differently per person", () => {
    const hothead = makeChar({ id: "h", traits: { confrontation: 85 } });
    const calm = makeChar({ id: "c", traits: { confrontation: 15, impulsiveness: 20 } });
    expect(emotionFromMood("irritated", hothead)).toBe("angry");
    expect(emotionFromMood("irritated", calm)).toBe("frustrated");
    // ...and a calm person can still be angry when the situation calls for it.
    expect(actorEmotion({ kind: "event", type: "rivalry", reaction: "confront", moodAfter: "irritated", importance: 2 }, calm, null)).toBe("angry");
    // An introvert can still get excited.
    const shy = makeChar({ id: "s", traits: { extroversion: 10, impulsiveness: 80 } });
    expect(actorEmotion({ kind: "event", type: "discovery", reaction: "act", moodAfter: "excited", importance: 1 }, shy, null)).toBe("excited");
    expect(shy.traits.extroversion).toBe(10);
  });

  it("the other character in an event reacts by their own personality and the bond", () => {
    const warm = { affinity: 40, trust: 20 };
    expect(otherEmotion("comfort", makeChar({ id: "a", traits: { extroversion: 10, expressiveness: 10 } }), warm)).toBe("embarrassed");
    expect(otherEmotion("comfort", makeChar({ id: "b", traits: { extroversion: 70 } }), warm)).toBe("affectionate");
    expect(otherEmotion("confront", makeChar({ id: "c", traits: { confrontation: 90 } }), null)).toBe("angry");
    expect(otherEmotion("confront", makeChar({ id: "d", traits: { confrontation: 10, extroversion: 20 } }), null)).toBe("anxious");
  });

  it("story events set and fade emotions; older saves without emotions read as neutral", () => {
    expect(emotionOf(neutralState()).emotion).toBe("neutral");
    expect(emotionOf({ mood: "sad", intensity: 2, memories: [] }).emotion).toBe("neutral");
    const s = withEmotion(neutralState(), "angry", 2, 5);
    expect(emotionOf(s)).toEqual({ emotion: "angry", level: 2, at: 5 });
    expect(emotionOf(fadeEmotion(fadeEmotion(s))).emotion).toBe("neutral");

    const cast = [juniper(), rook(), mei()];
    const rng = seeded(3);
    let story: StoryState = emptyStory();
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const res = plan({ story, cast, actorId: cast[i % 3].id, action: "twist", world: "otherworld", place: "street", frequency: "normal", rng });
      story = res.story;
      if (res.beat.kind === "event") {
        const e = emotionOf(story.characters[res.beat.actorId]);
        seen.add(e.emotion);
        if (res.beat.otherId) expect(story.characters[res.beat.otherId].emotion).toBeDefined();
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});

describe("emotion effects", () => {
  it("every emotion except neutral has a small, consistent pixel effect", () => {
    for (const e of EMOTIONS) {
      if (e === "neutral") {
        expect(particlesFor(e, 3)).toEqual([]);
        continue;
      }
      const def = EFFECTS[e];
      for (const lvl of [1, 2, 3] as const) {
        const ps = particlesFor(e, lvl);
        expect(ps.length).toBeGreaterThanOrEqual(1);
        expect(ps.length).toBeLessThanOrEqual(3);
      }
      // Close to the head or body, never far away.
      for (const s of def.slots) {
        expect(Math.abs(s.x)).toBeLessThanOrEqual(16);
        expect(s.y).toBeGreaterThanOrEqual(-16);
        expect(s.y).toBeLessThanOrEqual(16);
      }
      expect(def.duration).toBeLessThanOrEqual(1600);
    }
  });

  it("glyphs are tiny bitmaps with a 1px outline", () => {
    for (const id of Object.keys(GLYPHS) as GlyphId[]) {
      const g = glyphPixels(id);
      expect(g.w).toBeLessThanOrEqual(9);
      expect(g.h).toBeLessThanOrEqual(9);
      expect(g.pixels.some((p) => p.color === "#3d3060")).toBe(true);
    }
  });
});

describe("rooms and paths", () => {
  it("every room has floor space for six characters, off the furniture", () => {
    for (const w of WORLDS)
      for (const p of PLACES) {
        const room = roomFor(w, p);
        const pts = spawnPoints(room, 6);
        for (const q of pts) expect(isFree(room, q)).toBe(true);
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(gap(pts[i], pts[j])).toBeGreaterThanOrEqual(20);
      }
  });

  it("walks around furniture instead of through it", () => {
    const room = roomFor("modern", "interior"); // table at x 136–184
    const path = findPath(room, { x: 120, y: 144 }, { x: 200, y: 144 })!;
    expect(path).not.toBeNull();
    let prev = { x: 120, y: 144 };
    for (const p of path) {
      const steps = Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y));
      for (let i = 1; i <= steps; i++) {
        const q = { x: prev.x + ((p.x - prev.x) * i) / steps, y: prev.y + ((p.y - prev.y) * i) / steps };
        expect(hitsObstacle(room, q)).toBeNull();
      }
      prev = p;
    }
    expect(path.length).toBeGreaterThan(1);
  });
});

describe("stage actions (the interface a future AI will use)", () => {
  const facts = { onStage: (id: string) => ["a", "b"].includes(id), stateOf: (id: string) => (id === "b" ? ("speaking" as const) : ("idle" as const)) };

  it("validates shape, characters and state", () => {
    expect(STAGE_ACTION_TYPES).toEqual(["approach", "retreat", "face_target", "idle_reaction", "show_emotion"]);
    expect(validateStageAction({ type: "teleport", actor: "a" }, facts)).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateStageAction({ type: "approach", actor: "a" }, facts)).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateStageAction({ type: "approach", actor: "z", target: "a" }, facts)).toMatchObject({ ok: false, reason: "unknown_actor" });
    expect(validateStageAction({ type: "approach", actor: "a", target: "z" }, facts)).toMatchObject({ ok: false, reason: "unknown_target" });
    expect(validateStageAction({ type: "approach", actor: "a", target: "a" }, facts)).toMatchObject({ ok: false, reason: "self_target" });
    expect(validateStageAction({ type: "approach", actor: "a", target: "b", distance: 2 }, facts)).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateStageAction({ type: "retreat", actor: "b", from: "a" }, facts)).toMatchObject({ ok: false, reason: "busy" });
    expect(validateStageAction({ type: "show_emotion", actor: "b", emotion: "happy" }, facts)).toMatchObject({ ok: true });
    expect(validateStageAction({ type: "show_emotion", actor: "a", emotion: "smug" }, facts)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("every refusal, note and idle kind has a translation in both languages", () => {
    for (const r of REFUSALS) expect([en.play.test.reasons[r], zh.play.test.reasons[r]].every(Boolean)).toBe(true);
    for (const n of NOTES) expect([en.play.test.notes[n], zh.play.test.notes[n]].every(Boolean)).toBe(true);
    for (const k of IDLE_KINDS) expect([en.play.test.idleKinds[k], zh.play.test.idleKinds[k]].every(Boolean)).toBe(true);
    for (const a of STAGE_ACTION_TYPES) expect([en.play.test.actions[a], zh.play.test.actions[a]].every(Boolean)).toBe(true);
    for (const s of ACTOR_STATES) expect([en.stageStates[s], zh.stageStates[s]].every(Boolean)).toBe(true);
  });
});

describe("state machine", () => {
  it("only allows the listed transitions (no walking off mid-sentence)", () => {
    expect(canTransition("idle", "moving")).toBe(true);
    expect(canTransition("moving", "speaking")).toBe(true);
    expect(canTransition("speaking", "moving")).toBe(false);
    expect(canTransition("reacting", "idle")).toBe(true);
  });
});

describe("movement", () => {
  it("two characters approach each other and stop at talking distance without overlapping", () => {
    const cast = [juniper(), rook()];
    const { sim, room } = makeSim(cast);
    const [a, b] = cast.map((c) => c.id);
    expect(sim.request({ type: "approach", actor: a, target: b, distance: 26 })).toMatchObject({ ok: true, note: "moving" });
    expect(sim.request({ type: "approach", actor: b, target: a, distance: 26 })).toMatchObject({ ok: true });
    runChecked(sim, [a, b], 8000, room);
    const d = standGap(sim.position(a)!, sim.position(b)!);
    expect(d).toBeGreaterThanOrEqual(20);
    expect(d).toBeLessThanOrEqual(34);
    expect(sim.stateOf(a)).not.toBe("moving");
    expect(sim.stateOf(b)).not.toBe("moving");
  });

  it("retreating never leaves the room; at the wall they turn away instead", () => {
    for (const w of WORLDS)
      for (const p of PLACES) {
        const cast = [juniper(), rook()];
        const { sim, room } = makeSim(cast, w, p);
        const [a, b] = cast.map((c) => c.id);
        let cornered = false;
        for (let i = 0; i < 8 && !cornered; i++) {
          const r = sim.request({ type: "retreat", actor: a, from: b, distance: 80 });
          if (!r.ok) {
            expect(r.reason).toBe("cornered");
            cornered = true;
          }
          runChecked(sim, [a, b], 4000, room, 32);
        }
        expect(cornered).toBe(true);
      }
  });

  it("a crowd gathering around one character never overlaps or clips furniture", () => {
    const cast = [juniper(), rook(), mei(), extra(1), extra(2), extra(3)];
    for (const [w, p] of WORLDS.flatMap((w) => PLACES.map((p) => [w, p] as const))) {
      const { sim, room } = makeSim(cast, w, p);
      const ids = cast.map((c) => c.id);
      for (const id of ids.slice(1)) sim.request({ type: "approach", actor: id, target: ids[0], distance: 24 });
      runChecked(sim, ids, 9000, room);
      for (const id of ids) expect(sim.stateOf(id)).not.toBe("moving");
      // Where they end up, nobody stands in front of / behind / inside someone else.
      const pts = ids.map((id) => sim.position(id)!);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(standGap(pts[i], pts[j]), `${ids[i]} / ${ids[j]}`).toBeGreaterThanOrEqual(17);
    }
  });

  it("speaking pauses a walk, and it resumes when the line ends (conversation while moving)", () => {
    const cast = [juniper(), rook(), mei()];
    const { sim, room } = makeSim(cast);
    const [a, b, c] = cast.map((x) => x.id);
    sim.request({ type: "approach", actor: a, target: c, distance: 24 });
    sim.request({ type: "retreat", actor: b, from: a, distance: 40 });
    runChecked(sim, [a, b, c], 300, room);
    sim.setSpeaker(a);
    expect(sim.stateOf(a)).toBe("speaking");
    expect(sim.isSuspended(a)).toBe(true);
    const frozen = sim.position(a)!;
    runChecked(sim, [a, b, c], 800, room);
    expect(sim.position(a)).toEqual(frozen);
    // The listener kept walking during the line.
    expect(["moving", "idle"]).toContain(sim.stateOf(b));
    // Mid-sentence they can't be sent walking off.
    expect(sim.request({ type: "retreat", actor: a, from: c })).toMatchObject({ ok: false, reason: "busy" });
    sim.setSpeaker(null);
    expect(sim.stateOf(a)).toBe("moving");
    runChecked(sim, [a, b, c], 8000, room);
    expect(gap(sim.position(a)!, sim.position(c)!)).toBeLessThanOrEqual(28);
  });

  it("stop and resume", () => {
    const cast = [juniper(), rook()];
    const { sim, room } = makeSim(cast, "modern", "street");
    const [a, b] = cast.map((x) => x.id);
    sim.request({ type: "approach", actor: a, target: b, distance: 24 });
    runChecked(sim, [a, b], 400, room);
    expect(sim.stop(a)).toBe(true);
    expect(sim.stateOf(a)).toBe("idle");
    const at = sim.position(a)!;
    runChecked(sim, [a, b], 500, room);
    expect(sim.position(a)).toEqual(at);
    expect(sim.resume(a)).toBe(true);
    expect(sim.stateOf(a)).toBe("moving");
    runChecked(sim, [a, b], 9000, room);
    expect(gap(sim.position(a)!, sim.position(b)!)).toBeLessThanOrEqual(28);
  });

  it("pausing the game freezes everyone", () => {
    const cast = [juniper(), rook()];
    const { sim } = makeSim(cast);
    sim.request({ type: "approach", actor: cast[0].id, target: cast[1].id });
    sim.setPaused(true);
    const at = sim.position(cast[0].id);
    sim.tick(500);
    expect(sim.position(cast[0].id)).toEqual(at);
    expect(sim.request({ type: "face_target", actor: cast[0].id, target: cast[1].id })).toMatchObject({ ok: false, reason: "paused" });
  });

  it("rapid emotion changes update the effect without loops or stacked movement", () => {
    const cast = [juniper(), rook()];
    const { sim, room } = makeSim(cast);
    const [a, b] = cast.map((x) => x.id);
    for (const e of EMOTIONS) {
      expect(sim.request({ type: "show_emotion", actor: a, emotion: e, level: 3, react: true, target: b })).toMatchObject({ ok: true });
      runChecked(sim, [a, b], 48, room);
    }
    expect(sim.emotionOf(a)).toEqual({ emotion: "confused", level: 3 });
    runChecked(sim, [a, b], 10000, room);
    expect(["idle", "interacting"]).toContain(sim.stateOf(a));
  });

  it("an emotion interrupting a walk plays its reaction, then the walk continues", () => {
    const cast = [juniper(), rook()];
    const { sim, room } = makeSim(cast, "modern", "street");
    const [a, b] = cast.map((x) => x.id);
    sim.request({ type: "approach", actor: a, target: b, distance: 24 });
    runChecked(sim, [a, b], 300, room);
    sim.request({ type: "show_emotion", actor: a, emotion: "surprised", level: 2 });
    expect(sim.stateOf(a)).toBe("reacting");
    runChecked(sim, [a, b], 800, room);
    expect(sim.stateOf(a)).toBe("moving");
  });
});

describe("behavior rules", () => {
  it("the same emotion leads to different movement for different personalities", () => {
    const bold = makeChar({ id: "bold", traits: { confrontation: 95, impulsiveness: 80 } });
    const meek = makeChar({ id: "meek", traits: { confrontation: 5, extroversion: 10 } });
    const other = makeChar({ id: "o" });
    const count = (c: Character, type: string) => {
      let n = 0;
      for (let i = 0; i < 200; i++) if (reactionAction(c, "angry", 2, other, { affinity: 0, trust: 0 }, "event", rngFrom(`t${i}`))?.type === type) n++;
      return n;
    };
    expect(count(bold, "approach")).toBeGreaterThan(count(meek, "approach") * 2);
    expect(count(meek, "retreat")).toBeGreaterThan(count(bold, "retreat") * 2);
    // Never just one fixed response.
    const kinds = new Set(Array.from({ length: 200 }, (_, i) => reactionAction(bold, "angry", 2, other, { affinity: 0, trust: 0 }, "event", rngFrom(`k${i}`))?.type ?? "none"));
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it("bond decides whether an affectionate character walks closer", () => {
    const c = makeChar({ id: "c", traits: { extroversion: 50 } });
    const o = makeChar({ id: "o" });
    const approaches = (affinity: number) =>
      Array.from({ length: 200 }, (_, i) => reactionAction(c, "affectionate", 2, o, { affinity, trust: 0 }, "event", rngFrom(`a${i}`))).filter((a) => a?.type === "approach").length;
    expect(approaches(70)).toBeGreaterThan(approaches(-60));
  });

  it("solo contexts never walk up to anyone; the result is repeatable", () => {
    const c = juniper();
    for (let i = 0; i < 50; i++) expect(reactionAction(c, "excited", 3, null, { affinity: 0, trust: 0 }, "solo", rngFrom(`s${i}`))?.type).not.toBe("approach");
    const once = reactionAction(c, "sad", 2, rook(), { affinity: 20, trust: 0 }, "event", rngFrom("same"));
    expect(reactionAction(c, "sad", 2, rook(), { affinity: 20, trust: 0 }, "event", rngFrom("same"))).toEqual(once);
  });

  it("turns story beats into validated stage actions", () => {
    const cast = [juniper(), rook(), mei()];
    const rng = seeded(11);
    let story: StoryState = emptyStory();
    const { sim } = makeSim(cast);
    for (let i = 0; i < 40; i++) {
      const res = plan({ story, cast, actorId: cast[i % 3].id, action: i % 4 === 0 ? "talk" : "twist", world: "modern", place: "interior", frequency: "normal", rng });
      story = res.story;
      const ch = choreographBeat(res.beat, cast, story, (id) => sim.nearest(id));
      for (const a of ch.actions) {
        const r = sim.request(a, "event");
        if (!r.ok) expect(["no_room", "no_path", "cornered", "busy"]).toContain(r.reason);
      }
      for (let t = 0; t < 2000; t += 50) sim.tick(50);
    }
  });
});
