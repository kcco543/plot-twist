/**
 * RELATIONSHIP MANAGER — directional attitudes between characters.
 * --------------------------------------------------------------------------
 * StoryState.relations["A>B"] is how A feels about B; B>A can be completely
 * different. A pair nobody has interacted with yet starts from what the
 * player WROTE in A's relationships field (names + words like "best friend",
 * "rival", "betrayed me"…), nudged by the story's shared bond numbers.
 *
 * The label (friend, rival…) is kept for context only. Behavior never reads
 * the label directly: it reads the numbers, together with personality,
 * feelings and memories.
 */
import { RELATION_LABELS, type Bond, type Character, type Relation, type RelationLabel, type StoryState } from "../types";
import { textHas } from "./text";

export { RELATION_LABELS };

export const relKey = (from: string, to: string) => `${from}>${to}`;

export const neutralRelation = (): Relation => ({ trust: 0, affection: 0, respect: 0, familiarity: 0, rivalry: 0, tension: 0, fear: 0, label: "stranger" });

type Seed = { label?: RelationLabel; words: string[]; delta: Partial<Omit<Relation, "label">> };

/** Words in the relationships text near the other character's name, and what they suggest. EN + 中文. */
export const RELATION_SEEDS: Seed[] = [
  { label: "friend", words: ["best friend", "closest friend", "挚友", "最好的朋友", "知己"], delta: { trust: 55, affection: 60, familiarity: 85, respect: 20 } },
  { label: "friend", words: ["friend", "friends", "buddy", "朋友", "好友", "伙伴"], delta: { trust: 35, affection: 40, familiarity: 65, respect: 10 } },
  { label: "family", words: ["sister", "brother", "sibling", "mother", "father", "cousin", "family", "姐姐", "妹妹", "哥哥", "弟弟", "家人", "母亲", "父亲", "表哥", "表姐"], delta: { trust: 35, affection: 40, familiarity: 90 } },
  { label: "partner", words: ["partner", "girlfriend", "boyfriend", "spouse", "in love with", "crush on", "恋人", "爱人", "喜欢"], delta: { trust: 45, affection: 70, familiarity: 75 } },
  { label: "rival", words: ["rival", "rivals", "competitor", "对手", "宿敌", "竞争"], delta: { rivalry: 65, tension: 35, respect: 15, familiarity: 45 } },
  { label: "enemy", words: ["enemy", "enemies", "hates", "nemesis", "敌人", "仇人", "讨厌"], delta: { trust: -55, affection: -50, tension: 60, familiarity: 40 } },
  { words: ["betrayed", "betrayal", "betray", "背叛", "出卖"], delta: { trust: -60, tension: 40, affection: -15 } },
  { words: ["afraid of", "scared of", "fears", "terrified", "害怕", "怕"], delta: { fear: 55, tension: 20 } },
  { words: ["admires", "respects", "looks up to", "敬佩", "佩服", "崇拜", "尊敬"], delta: { respect: 55, affection: 10 } },
  { words: ["owes", "owe", "欠"], delta: { familiarity: 30, respect: 10 } },
  { words: ["secret crush", "secretly in love", "暗恋"], delta: { affection: 35 } },
  { words: ["distrusts", "doesn't trust", "suspicious of", "不信任", "怀疑"], delta: { trust: -40, tension: 15 } },
  { words: ["just met", "barely knows", "never met", "stranger", "刚认识", "不认识", "陌生"], delta: { familiarity: -40 } },
];

const RANGES: Record<keyof Omit<Relation, "label">, [number, number]> = {
  trust: [-100, 100],
  affection: [-100, 100],
  respect: [-100, 100],
  familiarity: [0, 100],
  rivalry: [0, 100],
  tension: [0, 100],
  fear: [0, 100],
};
const NUM_KEYS = Object.keys(RANGES) as (keyof Omit<Relation, "label">)[];

const clampTo = (k: keyof typeof RANGES, v: number) => Math.max(RANGES[k][0], Math.min(RANGES[k][1], Math.round(v)));

/** Clauses of `text` that mention `name` (split on sentence / clause marks). */
export function clausesAbout(text: string, name: string): string[] {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return [];
  return text
    .split(/[.!?;\n。！？；]+/)
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().includes(n));
}

/** What A's written relationships text says about B (null if B isn't mentioned). */
export function seedFromText(a: Character, b: Character): Relation | null {
  const clauses = clausesAbout(a.relationships, b.name);
  if (clauses.length === 0) return null;
  const rel: Relation = { ...neutralRelation(), familiarity: 40, label: "acquaintance" };
  const text = clauses.join(". ");
  const used = new Set<string>();
  for (const seed of RELATION_SEEDS) {
    if (!seed.words.some((w) => textHas(text, w))) continue;
    // "best friend" already counted: don't add plain "friend" on top.
    if (seed.label && used.has(seed.label)) continue;
    if (seed.label) {
      used.add(seed.label);
      rel.label = seed.label;
    }
    for (const k of NUM_KEYS) if (seed.delta[k]) rel[k] = clampTo(k, rel[k] + seed.delta[k]!);
  }
  if (rel.label === "acquaintance" && rel.familiarity < 15) rel.label = "stranger";
  return rel;
}

/**
 * How `from` currently feels about `to`. Stored value if the story has one,
 * otherwise the written text (or a stranger), adjusted by the shared bond.
 */
export function relationOf(story: StoryState, from: Character, to: Character, bond?: Bond | null): Relation {
  const stored = story.relations?.[relKey(from.id, to.id)];
  if (stored) return stored;
  const rel = seedFromText(from, to) ?? neutralRelation();
  if (bond && (bond.affinity || bond.trust)) {
    rel.affection = clampTo("affection", rel.affection + bond.affinity * 0.6);
    rel.trust = clampTo("trust", rel.trust + bond.trust * 0.6);
    rel.familiarity = clampTo("familiarity", Math.max(rel.familiarity, 20));
  }
  return rel;
}

export type RelationDelta = Partial<Omit<Relation, "label">>;

/** Change one direction. Each step is capped so a single moment can't flip a relationship. */
export const REL_STEP_CAP = 15;
export function applyRelation(rel: Relation, d: RelationDelta): Relation {
  const out = { ...rel };
  for (const k of NUM_KEYS) {
    const v = d[k];
    if (!v) continue;
    out[k] = clampTo(k, out[k] + Math.max(-REL_STEP_CAP, Math.min(REL_STEP_CAP, v)));
  }
  if (out.label === "stranger" && out.familiarity >= 20) out.label = "acquaintance";
  return out;
}

export function withRelation(story: StoryState, from: string, to: string, rel: Relation): StoryState {
  return { ...story, relations: { ...(story.relations ?? {}), [relKey(from, to)]: rel } };
}

/** A story beat changed the shared bond: mirror it (softened) into both directions. */
export function syncRelationsFromBond(story: StoryState, a: Character, b: Character, before: Bond, after: Bond): StoryState {
  const da = after.affinity - before.affinity;
  const dt = after.trust - before.trust;
  if (!da && !dt) return story;
  let s = story;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const rel = relationOf(s, x, y, before);
    s = withRelation(s, x.id, y.id, applyRelation(rel, { affection: da * 0.7, trust: dt * 0.7, familiarity: 3, tension: da < 0 ? -da * 0.5 : 0 }));
  }
  return s;
}
