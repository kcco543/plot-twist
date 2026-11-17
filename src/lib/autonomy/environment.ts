/**
 * ENVIRONMENT-AWARE BEHAVIOUR — characters notice the things around them.
 * --------------------------------------------------------------------------
 * Pure rules, no AI and no per-frame work: evaluated by the planner when a
 * character's turn to think comes up (a few times a minute at most).
 *
 *   interests   what a character loves, fears or finds painful, read from
 *               their own written profile (identity, habits, goals, fears,
 *               background…) and memories, with a small bilingual concept
 *               lexicon (EN + 中文). Never from gender or appearance.
 *   perception  only objects in the same scene, close enough to notice, and
 *               not hidden. Objects say what they're about through their
 *               kind, name, tags and the player's "interests" words.
 *   reactions   drawn to something they love, uneasy near something they
 *               fear (they step away), quiet when something touches a
 *               painful memory; the current mood shapes all of it.
 *   invitations A may ask B to come and look at something. A only knows B
 *               likes it if A has a memory of it, A's written relationships
 *               say so, or A saw B enjoy it (knowledge boundaries). B decides
 *               from B's own interests, mood, relationship and personality,
 *               and may say no.
 *   reminders   an object reminds A of B only when A's memories or written
 *               relationships connect B with it.
 *
 * Cooldowns keep this rare: per character, per character + object, per pair
 * of characters for invitations, and a global gap, and nothing repeats.
 */
import { level } from "../mind/feelings";
import { personalityOf } from "../mind/profile";
import { currentRelation } from "../relationships/progression";
import type { WorldObject } from "../stage/objects";
import type { Point } from "../stage/room";
import type { Character, StoryState } from "../types";
import type { AgencyState, EnvMemory } from "./types";

// ---------------------------------------------------------------- concepts

export const CONCEPT_IDS = ["water", "books", "plants", "stars", "fire", "magic", "music", "art", "food", "maps", "animals", "mushrooms", "potions", "heights", "darkness", "view", "weapons"] as const;
export type ConceptId = (typeof CONCEPT_IDS)[number];

/** English stems (matched at a word start) and Chinese words, per concept. */
const LEXICON: Record<ConceptId, { en: string[]; zh: string[] }> = {
  water: { en: ["water", "pond", "lake", "river", "sea\\b", "ocean", "fountain", "fish", "swim", "boat", "rain"], zh: ["水(?!晶)", "池", "湖", "河", "海", "鱼", "游泳", "船", "雨", "泉"] },
  books: { en: ["book", "read(?:s|ing|er)?\\b", "librar", "poem", "poetry", "scroll", "novel", "study", "studies"], zh: ["书", "阅读", "读书", "图书", "诗", "卷轴", "小说"] },
  plants: { en: ["flower", "garden", "plant", "tree", "herb", "leaf", "leaves", "forest", "bloom", "blossom"], zh: ["花", "园", "植物", "树", "草药", "叶", "森林", "盆栽"] },
  stars: { en: ["star", "sky", "moon", "astronom", "constellation"], zh: ["星", "天空", "月亮", "夜空", "天文"] },
  fire: { en: ["fire", "flame", "candle", "hearth", "torch", "lantern", "lamp", "campfire"], zh: ["火", "烛", "炉", "火把", "灯笼", "篝火"] },
  magic: { en: ["magic", "crystal", "spell", "rune", "portal", "gem", "wizard", "witch", "enchant"], zh: ["魔法", "水晶", "咒", "符文", "传送", "宝石", "巫"] },
  music: { en: ["music", "song", "sing", "instrument", "lute", "piano", "guitar", "melod", "violin", "flute"], zh: ["音乐", "歌", "唱", "乐器", "琴", "曲", "笛"] },
  art: { en: ["art\\b", "artist", "paint", "drawing", "draws?\\b", "sketch", "portrait", "picture"], zh: ["画", "绘", "艺术", "素描", "肖像"] },
  food: { en: ["food", "cook", "bak(?:e|ing)", "tea\\b", "coffee", "cake", "bread", "pastr", "sweets"], zh: ["食物", "做饭", "烹饪", "烘焙", "茶", "咖啡", "蛋糕", "面包", "甜点"] },
  maps: { en: ["map", "travel", "explor", "journey", "adventur", "compass", "cartograph"], zh: ["地图", "旅行", "探索", "冒险", "指南针", "制图"] },
  animals: { en: ["animal", "cats?\\b", "dogs?\\b", "bird", "horse", "pet\\b", "pets\\b", "slime", "creature"], zh: ["动物", "猫", "狗", "鸟", "马", "宠物", "史莱姆"] },
  mushrooms: { en: ["mushroom", "fung"], zh: ["蘑菇", "菌"] },
  potions: { en: ["potion", "alchem", "brew", "elixir"], zh: ["药水", "炼金", "药剂"] },
  heights: { en: ["height", "climb", "tower", "cliff", "high places"], zh: ["高处", "爬", "塔", "悬崖"] },
  darkness: { en: ["dark", "shadow"], zh: ["黑暗", "影子", "暗处"] },
  view: { en: ["window", "view\\b", "scenery", "sunset", "sunrise"], zh: ["窗", "风景", "景色", "日落", "日出"] },
  weapons: { en: ["sword", "weapon", "blade", "duel", "spar"], zh: ["剑", "武器", "刀", "决斗"] },
};

const PATTERNS: Record<ConceptId, RegExp> = Object.fromEntries(
  CONCEPT_IDS.map((id) => [id, new RegExp(`\\b(?:${LEXICON[id].en.join("|")})|${LEXICON[id].zh.join("|")}`, "gi")]),
) as Record<ConceptId, RegExp>;

/**
 * What something is about: one of the lexicon's concepts, or a word the
 * player wrote on an object ("knights", "骑士") that matches the same word in
 * a character's own profile or memories.
 */
export type Topic = ConceptId | `word:${string}`;
const isConcept = (t: Topic): t is ConceptId => !t.startsWith("word:");
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordPatterns = new Map<string, RegExp>();
function patternOf(t: Topic): RegExp {
  if (isConcept(t)) return PATTERNS[t];
  let re = wordPatterns.get(t);
  if (!re) {
    const raw = t.slice(5);
    // "knights" also matches "knight" (and the other way round).
    const w = /^[a-z]{4,}$/i.test(raw) ? raw.replace(/(?:es|s)$/i, "") : raw;
    // Latin words match whole words (and a plural); Chinese has no spaces, so it matches anywhere.
    re = /^[\x00-\x7f]+$/.test(w) ? new RegExp(`\\b${escapeRe(w)}(?:s|es)?\\b`, "gi") : new RegExp(escapeRe(w), "g");
    wordPatterns.set(t, re);
  }
  return re;
}
/** Does a text mention this topic? */
export function mentionsTopic(text: string, t: Topic): boolean {
  if (!text) return false;
  const re = patternOf(t);
  re.lastIndex = 0;
  return re.test(text);
}

/** Every concept a text mentions. */
export function conceptsIn(text: string): ConceptId[] {
  if (!text) return [];
  return CONCEPT_IDS.filter((id) => {
    PATTERNS[id].lastIndex = 0;
    return PATTERNS[id].test(text);
  });
}

/** Words just before a mention that turn a like into a dislike / fear ("afraid of water", "怕水"). */
const AVERSE = /(hate|hates|dislike|afraid|scared|terrified|fear|can'?t stand|avoid|phobi|讨厌|怕|害怕|恐惧|不喜欢|厌恶|不敢)/i;
/** Words near a mention that make it a painful association ("lost her brother at sea"). */
const PAINFUL = /(lost|died|death|dead|drown|burn|war\b|accident|grief|mourn|funeral|失去|去世|死|淹|烧毁|战争|事故|悲伤|葬礼)/i;

type Mention = { id: Topic; before: string; around: string };
function mentions(text: string, topics: readonly Topic[]): Mention[] {
  const out: Mention[] = [];
  if (!text) return out;
  for (const id of topics) {
    const re = patternOf(id);
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ id, before: text.slice(Math.max(0, m.index - 18), m.index), around: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40) });
      if (!m[0].length) re.lastIndex++;
    }
  }
  return out;
}

/** How strongly each written field says "this is what I'm into". */
const LIKE_FIELDS: [keyof Character, number][] = [
  ["identity", 1.5],
  ["habits", 1.5],
  ["goals", 1.2],
  ["personality", 1],
  ["values", 0.8],
  ["background", 0.6],
];

export type Interests = {
  /** Topic → strength (about 0.5–4). */
  likes: Partial<Record<Topic, number>>;
  fears: Topic[];
  /** Things tied to a painful memory: being near them makes the character go quiet. */
  painful: Topic[];
};

/** What a character loves, fears and finds painful, from their own profile and memories (plus any player words to look for). */
export function interestsOf(c: Character, story?: StoryState, words: readonly Topic[] = []): Interests {
  const topics: Topic[] = [...CONCEPT_IDS, ...words.filter((w) => !isConcept(w))];
  const likes: Partial<Record<Topic, number>> = {};
  const fears = new Set<Topic>();
  const painful = new Set<Topic>();
  for (const [field, w] of LIKE_FIELDS) {
    for (const m of mentions(String(c[field] ?? ""), topics)) {
      if (AVERSE.test(m.before)) fears.add(m.id);
      else if (field === "background" && PAINFUL.test(m.around)) painful.add(m.id);
      else likes[m.id] = (likes[m.id] ?? 0) + w;
    }
  }
  for (const id of topics) if (mentionsTopic(c.fears, id)) fears.add(id);
  for (const mem of story?.characters[c.id]?.memories ?? []) {
    if (!mem.note || mem.importance < 2) continue;
    const bad = mem.mood === "sad" || mem.mood === "anxious" || mem.kind === "betrayed" || mem.kind === "rejected" || PAINFUL.test(mem.note);
    if (bad && !mem.resolved) for (const id of topics) if (mentionsTopic(mem.note, id)) painful.add(id);
  }
  for (const id of fears) delete likes[id];
  return { likes, fears: [...fears], painful: [...painful] };
}

/** What an object is about: its kind, names, tags and the player's interest words. */
const TYPE_CONCEPT: Partial<Record<WorldObject["type"], ConceptId>> = { book: "books", plant: "plants", light: "fire", window: "view", painting: "art", portal: "magic" };
export function objectConcepts(o: Pick<WorldObject, "type" | "name" | "label" | "tags" | "interests" | "description">): ConceptId[] {
  const words = [o.name, o.label ?? "", o.description ?? "", ...o.tags, ...(o.interests ?? [])].join(" ").replace(/[-_]/g, " ");
  const set = new Set(conceptsIn(words));
  const t = TYPE_CONCEPT[o.type];
  if (t) set.add(t);
  return [...set];
}

/** Concepts plus the player's own interest words that no concept covers ("knights"). */
export function objectTopics(o: Pick<WorldObject, "type" | "name" | "label" | "tags" | "interests" | "description">): Topic[] {
  const own = (o.interests ?? []).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2 && !conceptsIn(w).length).map((w) => `word:${w}` as Topic);
  return [...objectConcepts(o), ...new Set(own)];
}

// ---------------------------------------------------------------- perception

export const ENV = {
  /** How far a character notices things (stage px). */
  noticeRadius: 110,
  /** A feared thing this close makes them step away. */
  uneasyRadius: 64,
  /** Seeing someone enjoy something counts as knowing it from this close. */
  witnessRadius: 120,
  /** A character reacts to the environment at most this often. */
  actorGapMs: 45_000,
  /** …and to the same object at most this often. */
  objectGapMs: 240_000,
  /** One environmental reaction in the whole scene at a time. */
  globalGapMs: 12_000,
  /** The same two characters: one invitation per this long. */
  inviteGapMs: 240_000,
  witnessedLimit: 24,
} as const;

const center = (o: WorldObject): Point => ({ x: (o.bounds.x0 + o.bounds.x1) / 2, y: o.bounds.y1 });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Objects this character can notice right now: same scene (they're all in the room list), close, not hidden, not someone else's gift. */
export function noticeable(me: Point, objects: WorldObject[], actorId: string, radius: number = ENV.noticeRadius): WorldObject[] {
  return objects.filter((o) => !o.hidden && !o.marker && (!o.giftId || o.ownerId === actorId) && dist(me, center(o)) <= radius);
}

export const emptyEnvMemory = (): EnvMemory => ({ lastAt: {}, seen: {}, globalAt: 0, invites: {}, witnessed: {} });
export const envOf = (a: AgencyState): EnvMemory => ({ ...emptyEnvMemory(), ...(a.env ?? {}) });

/** May `actor` react to `object` now (cooldowns)? */
export function mayReact(mem: EnvMemory, actor: string, object: string | null, now: number): boolean {
  if (now - mem.globalAt < ENV.globalGapMs) return false;
  if (now - (mem.lastAt[actor] ?? -Infinity) < ENV.actorGapMs) return false;
  if (object && now - (mem.seen[`${actor}>${object}`] ?? -Infinity) < ENV.objectGapMs) return false;
  return true;
}

/** Record a reaction (and, for invitations, the pair). */
export function noteReaction(a: AgencyState, actor: string, object: string | null, now: number, invited?: string): AgencyState {
  const mem = envOf(a);
  return {
    ...a,
    env: {
      ...mem,
      globalAt: now,
      lastAt: { ...mem.lastAt, [actor]: now },
      seen: object ? { ...mem.seen, [`${actor}>${object}`]: now } : mem.seen,
      invites: invited ? { ...mem.invites, [`${actor}>${invited}`]: now } : mem.invites,
    },
  };
}

/**
 * `actor` finished looking at / using `objectId`: everyone close enough saw
 * them enjoy what it's about (that's how others come to know their interests).
 */
export function witness(a: AgencyState, actor: string, objectId: string, objects: WorldObject[], cast: Character[], position: (id: string) => Point | null): AgencyState {
  const o = objects.find((x) => x.id === objectId);
  const at = position(actor);
  if (!o || !at) return a;
  const concepts = objectTopics(o);
  if (!concepts.length) return a;
  const mem = envOf(a);
  let witnessed = mem.witnessed;
  for (const c of cast) {
    if (c.id === actor) continue;
    const p = position(c.id);
    if (!p || dist(p, at) > ENV.witnessRadius) continue;
    const seen = new Set(witnessed[c.id] ?? []);
    for (const k of concepts) seen.add(`${actor}:${k}`);
    witnessed = { ...witnessed, [c.id]: [...seen].slice(-ENV.witnessedLimit) };
  }
  return witnessed === mem.witnessed ? a : { ...a, env: { ...mem, witnessed } };
}

// ---------------------------------------------------------------- knowledge

export type KnowledgeSource = "memory" | "relationship" | "witnessed";

/** Sentences of a text that name someone. */
const sentencesAbout = (text: string, name: string) => (name ? text.split(/[.!?。！？\n]/).filter((s) => s.toLowerCase().includes(name.toLowerCase())) : []);

/**
 * Does `a` know that `b` likes `concept`? Only from what `a` could know:
 * a memory with b about it, a's own written relationships text, or having
 * seen b enjoy it. Never from b's private profile.
 */
export function knowsLike(story: StoryState, agency: AgencyState, a: Character, b: Character, concept: Topic): KnowledgeSource | null {
  const mems = story.characters[a.id]?.memories ?? [];
  if (mems.some((m) => m.withId === b.id && m.note && mentionsTopic(m.note, concept) && !AVERSE.test(m.note))) return "memory";
  if (sentencesAbout(a.relationships, b.name.trim()).some((s) => mentionsTopic(s, concept) && !AVERSE.test(s))) return "relationship";
  if ((envOf(agency).witnessed[a.id] ?? []).includes(`${b.id}:${concept}`)) return "witnessed";
  return null;
}

/** Does `concept` remind `a` of `b`? Only when a's memories or written relationships connect them. */
export function remindsOf(story: StoryState, a: Character, b: Character, concept: Topic): boolean {
  const mems = story.characters[a.id]?.memories ?? [];
  if (mems.some((m) => m.withId === b.id && m.note && mentionsTopic(m.note, concept))) return true;
  return sentencesAbout(a.relationships, b.name.trim()).some((s) => mentionsTopic(s, concept));
}

// ---------------------------------------------------------------- invitations

export type InviteAnswer = { accept: boolean; why: "likesIt" | "forYou" | "notInterested" | "notNow" | "afraid" | "notWithYou" };

/** B decides, from B's own interests, mood, relationship with A and personality. Deterministic for a given rng. */
export function answerInvite(story: StoryState, invitee: Character, inviter: Character, concept: Topic, rng: () => number): InviteAnswer {
  const mine = interestsOf(invitee, story, [concept]);
  if (mine.fears.includes(concept) || mine.painful.includes(concept)) return { accept: false, why: "afraid" };
  const p = personalityOf(invitee);
  const f = story.characters[invitee.id]?.feelings ?? {};
  const upset = Math.max(level(f, "anger"), level(f, "frustration")) / 100;
  const low = Math.max(level(f, "sadness"), level(f, "anxiety")) / 100;
  const bright = Math.max(level(f, "happiness"), level(f, "excitement")) / 100;
  const rel = currentRelation(story, invitee, inviter);
  const bond = (rel.affection + rel.trust) / 200; // about -1…1
  if (rel.tension >= 60 || bond < -0.3) return { accept: false, why: "notWithYou" };
  const interest = Math.min(1, (mine.likes[concept] ?? 0) / 2);
  const score = 0.4 * interest + 0.3 * bond + 0.12 * p.extro + 0.08 * p.playful + 0.1 * bright - 0.3 * upset - 0.15 * low - 0.08 * p.reserved + (rng() - 0.5) * 0.16;
  if (score >= 0.22) return { accept: true, why: interest >= 0.5 ? "likesIt" : "forYou" };
  return { accept: false, why: upset + low > 0.6 ? "notNow" : "notInterested" };
}

// ---------------------------------------------------------------- proposals

export type EnvProposal = {
  kind: "inspect_object" | "avoid_object" | "reflect" | "invite";
  object: string;
  target?: string;
  /** Where to step to (avoid_object). */
  at?: Point;
  concept: Topic;
  reason: "drawnTo" | "uneasyNear" | "quietMemory" | "remindsOf" | "invitesOver";
  score: number;
  knowledge?: KnowledgeSource;
};

export type EnvContext = {
  actor: Character;
  story: StoryState;
  cast: Character[];
  objects: WorldObject[];
  position: (id: string) => Point | null;
  agency: AgencyState;
  now: number;
  /** Someone the actor is keeping apart from (boundaries). */
  apart: (a: string, b: string) => boolean;
  busy: (id: string) => boolean;
  rng: () => number;
};

/** What the room around this character suggests doing, best first (empty most of the time). */
export function envProposals(ctx: EnvContext): EnvProposal[] {
  const { actor, story, objects, agency, now } = ctx;
  const me = ctx.position(actor.id);
  if (!me) return [];
  const mem = envOf(agency);
  if (!mayReact(mem, actor.id, null, now)) return [];
  const near = noticeable(me, objects, actor.id);
  const mine = interestsOf(actor, story, near.flatMap(objectTopics));
  const p = personalityOf(actor);
  const f = story.characters[actor.id]?.feelings ?? {};
  const upset = Math.max(level(f, "anger"), level(f, "frustration")) / 100;
  const low = Math.max(level(f, "sadness"), level(f, "anxiety")) / 100;
  const bright = Math.max(level(f, "happiness"), level(f, "excitement")) / 100;
  const out: EnvProposal[] = [];
  for (const o of near) {
    if (!mayReact(mem, actor.id, o.id, now)) continue;
    const concepts = objectTopics(o);
    const d = dist(me, center(o));
    for (const k of concepts) {
      // Fear: uneasy, and steps away if it's close (anxious people more so).
      if (mine.fears.includes(k)) {
        if (d <= ENV.uneasyRadius) {
          const c = center(o);
          const dx = me.x - c.x || 1;
          const dy = me.y - c.y;
          const len = Math.hypot(dx, dy) || 1;
          out.push({ kind: "avoid_object", object: o.id, concept: k, at: { x: me.x + (dx / len) * 56, y: me.y + (dy / len) * 20 }, reason: "uneasyNear", score: 0.6 + low * 0.3 + p.cautious * 0.1 });
        }
        continue;
      }
      // A painful memory: goes quiet (a sigh, no walk).
      if (mine.painful.includes(k)) {
        out.push({ kind: "reflect", object: o.id, concept: k, reason: "quietMemory", score: 0.45 + low * 0.3 + p.reserved * 0.1 });
        continue;
      }
      const like = mine.likes[k] ?? 0;
      // Reminded of someone (only through memories / written relationships).
      for (const b of ctx.cast) {
        if (b.id === actor.id || !remindsOf(story, actor, b, k)) continue;
        const here = !!ctx.position(b.id);
        // Someone close and liked who (as far as the actor knows) would enjoy it: an invitation.
        const knows = here ? knowsLike(story, agency, actor, b, k) : null;
        if (!here || !knows) out.push({ kind: "reflect", object: o.id, target: b.id, concept: k, reason: "remindsOf", score: 0.3 + p.expressive * 0.1 + low * 0.15 });
      }
      if (like <= 0) continue;
      // Upset people don't potter about; low ones are less drawn.
      const pull = Math.min(1, like / 2.5) * (1 - upset * 0.8) * (1 - low * 0.4) * (0.75 + bright * 0.35);
      if (pull > 0.15) out.push({ kind: "inspect_object", object: o.id, concept: k, reason: "drawnTo", score: 0.3 + pull * 0.35 + (p.playful + p.impulsive) * 0.05 });
      // Invitations: someone on stage, free, not kept apart, whom the actor knows likes it (or a close friend to share it with).
      if (upset < 0.4 && p.extro + p.expressive > 0.5) {
        for (const b of ctx.cast) {
          if (b.id === actor.id || !ctx.position(b.id) || ctx.busy(b.id) || ctx.apart(actor.id, b.id)) continue;
          if (now - (mem.invites[`${actor.id}>${b.id}`] ?? -Infinity) < ENV.inviteGapMs) continue;
          const rel = currentRelation(story, actor, b);
          const knows = knowsLike(story, agency, actor, b, k);
          if (!knows && rel.affection < 40) continue;
          out.push({ kind: "invite", object: o.id, target: b.id, concept: k, reason: "invitesOver", knowledge: knows ?? undefined, score: 0.38 + pull * 0.2 + p.extro * 0.15 + (knows ? 0.12 : 0) + Math.max(0, rel.affection) / 1000 });
        }
      }
    }
  }
  // One idea per object and kind (no duplicates), best first.
  const seen = new Set<string>();
  return out
    .map((x) => ({ ...x, score: x.score + ctx.rng() * 0.08 }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      const key = `${x.kind}:${x.object}:${x.target ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
