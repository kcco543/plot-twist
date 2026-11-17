import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh-CN.json";
import { tick, type EngineEnv, type EngineEvent } from "@/lib/autonomy/engine";
import {
  answerInvite,
  conceptsIn,
  ENV,
  envOf,
  envProposals,
  interestsOf,
  knowsLike,
  mayReact,
  noteReaction,
  noticeable,
  objectConcepts,
  remindsOf,
  witness,
  type EnvContext,
} from "@/lib/autonomy/environment";
import { emptyAgency, type AgencyState } from "@/lib/autonomy/types";
import { rngFrom } from "@/lib/stage/behavior";
import type { WorldObject } from "@/lib/stage/objects";
import { roomFor } from "@/lib/stage/room";
import { StageSim } from "@/lib/stage/sim";
import { emptyStory, neutralState } from "@/lib/story/engine";
import type { Character, Memory, StoryState } from "@/lib/types";
import { makeChar } from "./helpers";

const T0 = 5_000_000;

const pond: WorldObject = {
  id: "pond",
  type: "feature",
  name: "pond",
  label: "Pond",
  world: "default",
  place: "interior",
  bounds: { x0: 150, y0: 150, x1: 190, y1: 166 },
  collider: null,
  anchors: [{ x: 170, y: 172 }],
  radius: 6,
  actions: ["inspect"],
  tags: ["pond", "water"],
};
const shelf: WorldObject = { ...pond, id: "shelf", type: "book", name: "bookshelf", label: "Bookshelf", tags: ["books"], bounds: { x0: 40, y0: 120, x1: 70, y1: 150 }, anchors: [{ x: 56, y: 160 }] };

const mira = (p: Partial<Character> = {}) => makeChar({ id: "mira", name: "Mira", identity: "Cartographer who loves the water", personality: "Warm and outgoing", traits: { extroversion: 80, expressiveness: 70, playfulness: 60 }, ...p });
const wren = (p: Partial<Character> = {}) => makeChar({ id: "wren", name: "Wren", identity: "Fisher; happiest by a river", traits: { extroversion: 60 }, ...p });

function memory(p: Partial<Memory>): Memory {
  return { id: "m1", turn: 1, eventType: "talk", reaction: null, withId: null, withName: "", mood: "calm", importance: 2, note: null, at: 1, ...p };
}

function storyFor(cast: Character[], patch: (s: StoryState) => StoryState = (s) => s): StoryState {
  return patch({ ...emptyStory(), characters: Object.fromEntries(cast.map((c) => [c.id, neutralState()])) });
}

describe("concepts and interests (EN + ZH)", () => {
  it("reads concepts from both languages", () => {
    expect(conceptsIn("She reads by the lake")).toEqual(expect.arrayContaining(["books", "water"]));
    expect(conceptsIn("喜欢看星星和花")).toEqual(expect.arrayContaining(["stars", "plants"]));
    expect(conceptsIn("already ready")).not.toContain("books");
    expect(objectConcepts({ type: "feature", name: "crystals", label: "水晶", tags: [], description: "" })).not.toContain("water");
  });

  it("likes, fears and painful associations come from the character's own words", () => {
    const c = makeChar({ id: "x", identity: "Gardener", habits: "Sings while working", fears: "Deep water", personality: "Hates candles", background: "Lost her brother to a fire at the mill" });
    const i = interestsOf(c);
    expect(i.likes.plants).toBeGreaterThan(0);
    expect(i.likes.music).toBeGreaterThan(0);
    expect(i.fears).toEqual(expect.arrayContaining(["water", "fire"]));
    expect(i.painful).toContain("fire");
    expect(i.likes.fire).toBeUndefined();
    const zhChar = makeChar({ id: "z", identity: "喜欢读书的学者", fears: "害怕黑暗" });
    expect(interestsOf(zhChar).likes.books).toBeGreaterThan(0);
    expect(interestsOf(zhChar).fears).toContain("darkness");
  });

  it("an unresolved sad memory about something makes it painful", () => {
    const c = makeChar({ id: "x" });
    const s = storyFor([c], (st) => ({ ...st, characters: { x: { ...st.characters.x, memories: [memory({ mood: "sad", note: "The music box broke on the day she left", importance: 3 })] } } }));
    expect(interestsOf(c, s).painful).toContain("music");
  });

  it("objects say what they are about through kind, names, tags and player words", () => {
    expect(objectConcepts(pond)).toContain("water");
    expect(objectConcepts(shelf)).toContain("books");
    expect(objectConcepts({ ...pond, tags: [], name: "thing", label: "", interests: ["stargazing"] })).toContain("stars");
  });
});

describe("perception and cooldowns", () => {
  it("only notices close, visible things (no hidden objects, no other people's gifts)", () => {
    const me = { x: 170, y: 175 };
    expect(noticeable(me, [pond], "mira").map((o) => o.id)).toEqual(["pond"]);
    expect(noticeable(me, [{ ...pond, hidden: true }], "mira")).toEqual([]);
    expect(noticeable(me, [{ ...pond, giftId: "g", ownerId: "wren" }], "mira")).toEqual([]);
    expect(noticeable({ x: 10, y: 10 }, [pond], "mira")).toEqual([]);
  });

  it("cooldowns per character, per object and for the whole scene", () => {
    let a = emptyAgency();
    expect(mayReact(envOf(a), "mira", "pond", T0)).toBe(true);
    a = noteReaction(a, "mira", "pond", T0);
    expect(mayReact(envOf(a), "wren", null, T0 + 1000)).toBe(false); // global gap
    expect(mayReact(envOf(a), "wren", null, T0 + ENV.globalGapMs + 1)).toBe(true);
    expect(mayReact(envOf(a), "mira", "shelf", T0 + ENV.globalGapMs + 1)).toBe(false); // per character
    expect(mayReact(envOf(a), "mira", "shelf", T0 + ENV.actorGapMs + 1)).toBe(true);
    expect(mayReact(envOf(a), "mira", "pond", T0 + ENV.actorGapMs + 1)).toBe(false); // per object
    expect(mayReact(envOf(a), "mira", "pond", T0 + ENV.objectGapMs + 1)).toBe(true);
  });
});

describe("knowledge boundaries", () => {
  it("A never knows B's interests from B's private profile alone", () => {
    const a = mira();
    const b = wren();
    const s = storyFor([a, b]);
    expect(knowsLike(s, emptyAgency(), a, b, "water")).toBeNull();
    expect(remindsOf(s, a, b, "water")).toBe(false);
  });

  it("…but from a memory, the written relationships, or having seen it", () => {
    const b = wren();
    const s = storyFor([mira(), b], (st) => ({ ...st, characters: { ...st.characters, mira: { ...st.characters.mira, memories: [memory({ withId: "wren", withName: "Wren", note: "Wren showed me the fish in the river" })] } } }));
    expect(knowsLike(s, emptyAgency(), mira(), b, "water")).toBe("memory");
    expect(remindsOf(s, mira(), b, "water")).toBe(true);
    const rel = mira({ relationships: "Wren is my oldest friend. Wren loves stargazing." });
    expect(knowsLike(storyFor([rel, b]), emptyAgency(), rel, b, "stars")).toBe("relationship");
    expect(knowsLike(storyFor([rel, b]), emptyAgency(), rel, b, "water")).toBeNull();
    // Saw Wren enjoy the pond from close by.
    const pos: Record<string, { x: number; y: number }> = { wren: { x: 170, y: 172 }, mira: { x: 200, y: 172 }, far: { x: 600, y: 172 } };
    const seen = witness(emptyAgency(), "wren", "pond", [pond], [mira(), b, makeChar({ id: "far" })], (id) => pos[id] ?? null);
    expect(knowsLike(storyFor([mira(), b]), seen, mira(), b, "water")).toBe("witnessed");
    expect(envOf(seen).witnessed.far).toBeUndefined();
  });
});

describe("invitations: B decides for themself", () => {
  const s = (cast: Character[], feelings: Record<string, object> = {}) =>
    storyFor(cast, (st) => ({ ...st, characters: Object.fromEntries(Object.entries(st.characters).map(([id, c]) => [id, { ...c, feelings: feelings[id] ?? {} }])) }));

  it("accepts something they love, from someone they don't dislike", () => {
    const r = answerInvite(s([mira(), wren()]), wren(), mira(), "water", rngFrom("x"));
    expect(r).toEqual({ accept: true, why: "likesIt" });
  });

  it("declines what they fear, when upset, or when not interested", () => {
    expect(answerInvite(s([mira(), wren({ fears: "Deep water" })]), wren({ fears: "Deep water" }), mira(), "water", rngFrom("x")).why).toBe("afraid");
    expect(answerInvite(s([mira(), wren()], { wren: { anger: 90, sadness: 70 } }), wren(), mira(), "water", rngFrom("x")).accept).toBe(false);
    const shy = wren({ identity: "Clerk", traits: { extroversion: 10, expressiveness: 10 } });
    expect(answerInvite(s([mira(), shy]), shy, mira(), "books", rngFrom("x"))).toEqual({ accept: false, why: "notInterested" });
  });
});

describe("environment proposals", () => {
  const ctx = (actor: Character, at: { x: number; y: number }, extra: Partial<EnvContext> = {}): EnvContext => ({
    actor,
    story: storyFor([actor, wren()]),
    cast: [actor, wren()],
    objects: [pond, shelf],
    position: (id) => (id === actor.id ? at : id === "wren" ? { x: 120, y: 175 } : null),
    agency: emptyAgency(),
    now: T0,
    apart: () => false,
    busy: () => false,
    rng: rngFrom("p"),
    ...extra,
  });

  it("drawn to a loved thing nearby; nothing when it's out of reach", () => {
    const solo = ctx(mira({ traits: { extroversion: 10, expressiveness: 10 } }), { x: 170, y: 176 });
    expect(envProposals(solo)[0]).toMatchObject({ kind: "inspect_object", object: "pond", reason: "drawnTo", concept: "water" });
    expect(envProposals(ctx(mira(), { x: 40, y: 40 }, { objects: [pond] }))).toEqual([]);
  });

  it("uneasy near a feared thing: steps away from it", () => {
    const scared = makeChar({ id: "s", fears: "water, deep ponds" });
    const p = envProposals(ctx(scared, { x: 170, y: 176 }))[0];
    expect(p).toMatchObject({ kind: "avoid_object", object: "pond", reason: "uneasyNear" });
    expect(Math.hypot(p.at!.x - 170, p.at!.y - 166)).toBeGreaterThan(Math.hypot(0, 176 - 166));
  });

  it("goes quiet near something tied to a painful memory", () => {
    const sad = makeChar({ id: "s", background: "Her father drowned in the river" });
    expect(envProposals(ctx(sad, { x: 170, y: 176 }))[0]).toMatchObject({ kind: "reflect", reason: "quietMemory" });
  });

  it("invites someone when it knows they'd like it; an upset character doesn't potter or invite", () => {
    const withMemory = (st: StoryState) => ({ ...st, characters: { ...st.characters, mira: { ...st.characters.mira, memories: [memory({ withId: "wren", withName: "Wren", note: "Wren loves the water" })] } } });
    const c = ctx(mira(), { x: 170, y: 176 }, { story: withMemory(storyFor([mira(), wren()])) });
    const inv = envProposals(c).find((x) => x.kind === "invite");
    expect(inv).toMatchObject({ target: "wren", object: "pond", knowledge: "memory" });
    const upset = ctx(mira(), { x: 170, y: 176 }, { story: storyFor([mira(), wren()], (st) => ({ ...withMemory(st), characters: { ...withMemory(st).characters, mira: { ...withMemory(st).characters.mira, feelings: { anger: 90 } } } })) });
    expect(envProposals(upset).some((x) => x.kind === "invite" || x.kind === "inspect_object")).toBe(false);
    // Kept apart (a conversation boundary) or busy: no invitation.
    expect(envProposals({ ...c, apart: () => true }).some((x) => x.kind === "invite")).toBe(false);
    expect(envProposals({ ...c, busy: (id) => id === "wren" }).some((x) => x.kind === "invite")).toBe(false);
  });

  it("no duplicates, and nothing at all during a cooldown", () => {
    const c = ctx(mira(), { x: 170, y: 176 });
    const keys = envProposals(c).map((x) => `${x.kind}:${x.object}:${x.target ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(envProposals({ ...c, agency: noteReaction(emptyAgency(), "mira", null, T0 - 1000) })).toEqual([]);
  });
});

describe("engine: an invitation end to end (no AI)", () => {
  function setup(wrenPatch: Partial<Character> = {}) {
    const cast = [mira(), wren(wrenPatch)];
    const sim = new StageSim({ room: roomFor("modern", "interior"), idle: false });
    sim.setCast(cast);
    sim.setObjects([pond]);
    sim.spawnAt("mira", { x: 140, y: 176 });
    sim.spawnAt("wren", { x: 80, y: 176 });
    const story = storyFor(cast, (st) => ({ ...st, characters: { ...st.characters, mira: { ...st.characters.mira, memories: [memory({ withId: "wren", withName: "Wren", note: "Wren loves fishing in the river" })] } } }));
    const events: EngineEvent[] = [];
    const env = (now: number): EngineEnv => ({
      stage: { request: (a, c, p) => sim.request(a, c, p), position: (id) => sim.position(id), poseOf: (id) => sim.poseOf(id), walkOf: (id) => sim.walkOf(id), isCommanded: (id) => sim.isCommanded(id) },
      cast,
      objects: [pond],
      story,
      inConversation: () => false,
      now,
      rng: (k) => rngFrom(k),
      onEvent: (e) => events.push(e),
    });
    return { sim, env, events };
  }

  it("A invites, B accepts: both head to the pond; the pair won't repeat it soon", () => {
    const { sim, env, events } = setup();
    let a: AgencyState = emptyAgency();
    let t1 = 0;
    for (let t = 0; t < 120_000 && !events.length; t += 1000) {
      a = tick(a, env(T0 + t));
      t1 = t;
    }
    expect(events[0]).toMatchObject({ kind: "invite", actor: "mira", target: "wren", object: "pond", answer: { accept: true } });
    const walking = a.intents.filter((i) => i.status === "executing").map((i) => `${i.actor}:${i.kind}:${i.reason}`);
    expect(walking).toEqual(expect.arrayContaining(["mira:inspect_object:invitesOver", "wren:approach:acceptedInvite"]));
    for (let t = 0; t < 6000; t += 16) sim.tick(16);
    expect(Math.abs(sim.position("wren")!.x - 170)).toBeLessThan(50);
    expect(Math.abs(sim.position("mira")!.x - 170)).toBeLessThan(12);
    const at = events.length;
    for (let t = t1 + 1000; t < t1 + ENV.inviteGapMs - 1000; t += 1000) a = tick(a, env(T0 + t));
    expect(events.filter((e) => e.target === "wren").length).toBe(at);
  });

  it("B can say no; A takes it in their stride (no walk)", () => {
    const { env, events } = setup({ fears: "deep water", identity: "Clerk" });
    let a: AgencyState = emptyAgency();
    for (let t = 0; t < 120_000 && !events.some((e) => e.kind === "invite"); t += 1000) a = tick(a, env(T0 + t));
    const inv = events.find((e) => e.kind === "invite");
    // Mira only knows Wren "loves fishing in the river"; Wren's fear of deep water is Wren's own and decides the answer.
    expect(inv?.answer).toEqual({ accept: false, why: "afraid" });
    expect(a.log.some((i) => i.actor === "wren" && i.kind === "decline")).toBe(true);
    expect(a.intents.some((i) => i.actor === "wren" && i.status === "executing")).toBe(false);
  });
});

describe("text", () => {
  it("every new reason, kind and notice has EN + ZH text", () => {
    for (const k of ["drawnTo", "uneasyNear", "quietMemory", "remindsOf", "invitesOver", "acceptedInvite", "declinedInvite"] as const) {
      expect(en.autonomy.reasons[k]).toBeTruthy();
      expect(zh.autonomy.reasons[k]).toBeTruthy();
    }
    for (const k of ["avoid_object", "reflect"] as const) expect(en.autonomy.kinds[k] && zh.autonomy.kinds[k]).toBeTruthy();
    for (const k of ["inviteAccepted", "inviteDeclined"] as const) expect(en.talk.notices[k] && zh.talk.notices[k]).toBeTruthy();
  });
});
