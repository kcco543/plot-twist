/**
 * SAMPLE CAST + TEST SCENARIOS (Otherworld).
 * --------------------------------------------------------------------------
 * Three sample characters (plus Sol, who shares Mira's sliders but not her
 * past) and the ten situations the behavior engine is tested on. Used by
 * tests/mind.test.ts and by the Behavior Debug Panel, which can put a
 * scenario on the real Play Mode stage without touching the player's save.
 */
import { createBlankCharacter } from "../character/model";
import type { Character, CharacterBoundary, CharacterState, Feelings, Memory, MemoryKind, Relation, StoryState } from "../types";
import { emptyStory, neutralState } from "../story/engine";
import type { TriggerId } from "./catalog";
import { relKey, seedFromText } from "./relations";

type Loc = "en" | "zh-CN";

type Sample = { id: string; portrait: number; traits: Character["traits"]; text: Record<Loc, Partial<Record<keyof Character, string>>>; locked?: Character["lockedFields"] };

const MIRA_TRAITS = { extroversion: 18, impulsiveness: 25, expressiveness: 35, trust: 40, idealism: 60, dependence: 40, confrontation: 25, playfulness: 35, empathy: 80, rebelliousness: 30 };

const SAMPLES: Sample[] = [
  {
    id: "mira",
    portrait: 1,
    traits: MIRA_TRAITS,
    text: {
      en: {
        name: "Mira",
        age: "22",
        identity: "Cloud-island cartographer",
        personality: "Quiet, calm and careful. Warm once she trusts you.",
        background: "Grew up alone in a lighthouse on a floating island.",
        goals: "Finish the first true map of the drifting islands.",
        fears: "Strangers who stand too close.",
        values: "Patience. Doing things properly.",
        speakingStyle: "Short, soft sentences. Lots of pauses.",
        relationships: "Wren is her best friend. Barely knows Tobi.",
      },
      "zh-CN": {
        name: "米拉",
        age: "22",
        identity: "云岛制图师",
        personality: "安静、冷静、谨慎。信任你之后很温柔。",
        background: "在一座浮岛的灯塔里独自长大。",
        goals: "画出第一张真正的漂流群岛地图。",
        fears: "站得太近的陌生人。",
        values: "耐心。把事情做好。",
        speakingStyle: "句子短而轻，常常停顿。",
        relationships: "雯雯是她最好的朋友。几乎不认识托比。",
      },
    },
  },
  {
    id: "tobi",
    portrait: 0,
    traits: { extroversion: 85, impulsiveness: 80, expressiveness: 80, trust: 60, idealism: 55, dependence: 50, confrontation: 70, playfulness: 75, empathy: 50, rebelliousness: 65 },
    text: {
      en: {
        name: "Tobi",
        age: "19",
        identity: "Sky courier",
        personality: "Loud, proud and quick to act. Laughs at everything except himself.",
        background: "Won the storm race last spring by cutting through Wren's lane.",
        goals: "Be the fastest courier in the sky.",
        fears: "Being slow. Being laughed at.",
        values: "Speed, nerve and a good story.",
        speakingStyle: "Fast, loud, full of exclamation marks.",
        relationships: "Wren is his rival. Afraid of Wren since the storm race.",
      },
      "zh-CN": {
        name: "托比",
        age: "19",
        identity: "天空信使",
        personality: "嗓门大、骄傲、行动快。什么都能拿来开玩笑，除了他自己。",
        background: "去年春天抢了雯雯的航道，赢了暴风竞速。",
        goals: "成为天空中最快的信使。",
        fears: "慢。被人笑话。",
        values: "速度、胆量和好故事。",
        speakingStyle: "语速快，嗓门大，满是感叹号。",
        relationships: "雯雯是他的对手。暴风竞速之后，他害怕雯雯。",
      },
    },
  },
  {
    id: "wren",
    portrait: 2,
    traits: { extroversion: 35, impulsiveness: 40, expressiveness: 20, trust: 35, idealism: 40, dependence: 25, confrontation: 60, playfulness: 30, empathy: 55, rebelliousness: 45 },
    locked: ["canon", "name"],
    text: {
      en: {
        name: "Wren",
        age: "23",
        identity: "Island guard",
        personality: "Proud and sharp-tongued. Hides her feelings behind dry remarks.",
        background: "Lost the storm race to Tobi's cheating.",
        goals: "Win the rematch fairly.",
        fears: "Looking weak in front of Tobi.",
        values: "Fairness. Pride in her work.",
        canon: "Never admits her feelings for Mira out loud.",
        speakingStyle: "Dry, clipped, a little formal.",
        relationships: "Mira is her best friend and secret crush. Tobi is her rival and enemy since the storm race.",
      },
      "zh-CN": {
        name: "雯雯",
        age: "23",
        identity: "岛屿守卫",
        personality: "骄傲，嘴硬。用冷淡的话藏起自己的感情。",
        background: "暴风竞速被托比的小动作抢走了冠军。",
        goals: "在复赛里公平地赢回来。",
        fears: "在托比面前显得软弱。",
        values: "公平。为自己的工作骄傲。",
        canon: "从不说出自己对米拉的感情。",
        speakingStyle: "干脆、简短，有点正式。",
        relationships: "米拉是她最好的朋友，也是她暗恋的人。托比是她的对手，自暴风竞速以来就是敌人。",
      },
    },
  },
  {
    id: "sol",
    portrait: 3,
    traits: MIRA_TRAITS,
    text: {
      en: {
        name: "Sol",
        age: "22",
        identity: "Ferry keeper",
        personality: "Quiet, calm and careful. Warm once she trusts you.",
        background: "Grew up running a busy ferry, chatting with every passenger all day.",
        goals: "Keep the ferry running through storm season.",
        fears: "Deep water.",
        values: "Patience. Doing things properly.",
        speakingStyle: "Short, soft sentences.",
      },
      "zh-CN": {
        name: "索尔",
        age: "22",
        identity: "渡船看守",
        personality: "安静、冷静、谨慎。信任你之后很温柔。",
        background: "在热闹的渡口长大，每天和乘客聊天。",
        goals: "让渡船撑过风暴季。",
        fears: "深水。",
        values: "耐心。把事情做好。",
        speakingStyle: "句子短而轻。",
      },
    },
  },
];

export const SAMPLE_IDS = SAMPLES.map((s) => `sample-${s.id}`);

type SampleBoundary = Omit<CharacterBoundary, "text"> & { text: Record<Loc, string> };
/** Sample boundaries (topic words in both languages so they match whichever language is played). */
const SAMPLE_BOUNDARIES: Partial<Record<"mira" | "tobi" | "wren" | "sol", SampleBoundary[]>> = {
  mira: [
    { id: "mira-lighthouse", strength: "soft", kind: "topic", text: { en: "Her childhood alone in the lighthouse", "zh-CN": "她一个人在灯塔长大的童年" }, topics: "lighthouse, childhood, grew up, your parents, alone as a kid, 灯塔, 小时候, 童年, 父母, 一个人长大" },
    { id: "mira-maps", strength: "hard", kind: "principle", text: { en: "Never shows anyone an unfinished map", "zh-CN": "从不给任何人看没画完的地图" }, topics: "unfinished map, show me the map, half-finished map, let me see the map, 没画完, 未完成的地图, 给我看地图, 让我看看地图" },
  ],
  wren: [
    { id: "wren-feelings", strength: "hard", kind: "secret", text: { en: "Her feelings for Mira", "zh-CN": "她对米拉的感情" }, topics: "feelings for mira, crush, in love, love mira, like mira, your feelings, feelings for me, do you love me, do you like me, 喜欢米拉, 你喜欢我, 你爱我, 对我的感情, 暗恋, 对米拉的感情, 爱米拉, 你的感情" },
    { id: "wren-fair", strength: "hard", kind: "principle", text: { en: "Never cheats, even to beat Tobi", "zh-CN": "绝不作弊，哪怕是为了赢托比" }, topics: "cheat, sabotage, trick him, rig the race, cut his lane, 作弊, 使坏, 动手脚, 耍手段" },
    { id: "wren-race", strength: "soft", kind: "topic", text: { en: "Losing the storm race", "zh-CN": "输掉暴风竞速" }, topics: "storm race, lost the race, losing the race, 暴风竞速, 输了比赛, 输掉" },
  ],
  tobi: [
    { id: "tobi-lane", strength: "hard", kind: "secret", text: { en: "He cut through Wren's lane on purpose", "zh-CN": "他是故意抢了雯雯的航道" }, topics: "on purpose, cut through, wren's lane, did you cheat, you cheated, 故意, 抢了航道, 抢航道, 你作弊" },
    { id: "tobi-afraid", strength: "soft", kind: "topic", text: { en: "Being afraid of Wren", "zh-CN": "害怕雯雯" }, topics: "afraid of wren, scared of wren, fear wren, 害怕雯雯, 怕雯雯" },
  ],
};

export function sampleCharacter(id: "mira" | "tobi" | "wren" | "sol", locale: Loc = "en"): Character {
  const s = SAMPLES.find((x) => x.id === id)!;
  const boundaries = (SAMPLE_BOUNDARIES[id] ?? []).map((b) => ({ ...b, text: b.text[locale] }));
  return { ...createBlankCharacter(s.portrait), ...s.text[locale], id: `sample-${s.id}`, traits: { ...s.traits }, lockedFields: s.locked ?? [], ...(boundaries.length ? { boundaries } : {}) } as Character;
}

// ---------------------------------------------------------------- scenarios

export type ScenarioSetup = {
  feelings?: Feelings;
  /** Relation overrides on top of what the written text says (from>to by sample id). */
  relations?: Record<string, Partial<Relation>>;
  memories?: { kind: MemoryKind; with: string; importance: number; count?: number; turnsAgo?: number }[];
  /** Earlier decisions (e.g. repeated provocations). */
  history?: { trigger: TriggerId; action: string; times: number };
};

export type Scenario = {
  key: string;
  reactor: "mira" | "tobi" | "wren" | "sol";
  other: "mira" | "tobi" | "wren" | "sol";
  /** Everyone on stage. */
  cast: ("mira" | "tobi" | "wren" | "sol")[];
  trigger: TriggerId;
  setup: ScenarioSetup;
};

export const SCENARIOS: Scenario[] = [
  { key: "introStranger", reactor: "mira", other: "tobi", cast: ["mira", "tobi"], trigger: "approached", setup: { feelings: { anxiety: 40 } } },
  { key: "introFriend", reactor: "mira", other: "wren", cast: ["mira", "wren"], trigger: "approached", setup: { feelings: { happiness: 55 } } },
  { key: "extroFearedRival", reactor: "tobi", other: "wren", cast: ["tobi", "wren"], trigger: "approached", setup: {} },
  { key: "impulsiveCriticized", reactor: "tobi", other: "mira", cast: ["tobi", "mira"], trigger: "criticized", setup: { relations: { "mira>tobi": { familiarity: 30 }, "tobi>mira": { familiarity: 30, respect: 10 } } } },
  { key: "proudComplimentedByEnemy", reactor: "wren", other: "tobi", cast: ["wren", "tobi"], trigger: "complimented", setup: {} },
  { key: "rivalsCooperate", reactor: "wren", other: "tobi", cast: ["wren", "tobi"], trigger: "forced_cooperation", setup: {} },
  {
    key: "calmTurnsAngry",
    reactor: "mira",
    other: "tobi",
    cast: ["mira", "tobi"],
    trigger: "provoked",
    setup: { feelings: { anger: 30, frustration: 35 }, memories: [{ kind: "provoked", with: "tobi", importance: 2, count: 2, turnsAgo: 1 }], history: { trigger: "provoked", action: "stay_silent", times: 2 } },
  },
  {
    key: "betrayedBefore",
    reactor: "mira",
    other: "tobi",
    cast: ["mira", "tobi"],
    trigger: "approached",
    setup: { relations: { "mira>tobi": { trust: -60, familiarity: 50, affection: -20, tension: 40 } }, memories: [{ kind: "betrayed", with: "tobi", importance: 3, turnsAgo: 4 }] },
  },
  { key: "sameTraitsDifferentPast", reactor: "sol", other: "tobi", cast: ["sol", "tobi", "mira"], trigger: "approached", setup: { feelings: { anxiety: 40 } } },
  { key: "hiddenAffection", reactor: "wren", other: "mira", cast: ["wren", "mira"], trigger: "complimented", setup: { feelings: { affection: 75 } } },
];

export const scenarioByKey = (key: string) => SCENARIOS.find((s) => s.key === key) ?? null;

/** Cast + story for a scenario (fresh each time). */
export function buildScenario(sc: Scenario, locale: Loc = "en"): { cast: Character[]; story: StoryState; reactorId: string; otherId: string } {
  const cast = sc.cast.map((id) => sampleCharacter(id, locale));
  const id = (k: string) => `sample-${k}`;
  const story: StoryState = { ...emptyStory(), turn: 10, relations: {}, decisions: [] };
  const reactor = id(sc.reactor);
  const state: CharacterState = { ...neutralState(), feelings: { ...(sc.setup.feelings ?? {}) } };
  const memories: Memory[] = (sc.setup.memories ?? []).map((m, i) => ({
    id: `mem-setup-${i}`,
    turn: story.turn - (m.turnsAgo ?? 2),
    eventType: m.kind,
    kind: m.kind,
    count: m.count ?? 1,
    reaction: null,
    withId: id(m.with),
    withName: cast.find((c) => c.id === id(m.with))?.name ?? "",
    mood: "calm",
    importance: m.importance,
    note: null,
    at: 0,
  }));
  story.characters = { [reactor]: { ...state, memories } };
  for (const [k, v] of Object.entries(sc.setup.relations ?? {})) {
    const [from, to] = k.split(">");
    story.relations![relKey(id(from), id(to))] = { trust: 0, affection: 0, respect: 0, familiarity: 0, rivalry: 0, tension: 0, fear: 0, ...seedOrEmpty(cast, id(from), id(to)), ...v };
  }
  if (sc.setup.history) {
    for (let i = 0; i < sc.setup.history.times; i++)
      story.decisions!.push({ turn: story.turn - 1, actorId: reactor, otherId: id(sc.other), trigger: sc.setup.history.trigger, action: sc.setup.history.action, at: 0 });
  }
  return { cast, story, reactorId: reactor, otherId: id(sc.other) };
}

function seedOrEmpty(cast: Character[], from: string, to: string): Partial<Relation> {
  const a = cast.find((c) => c.id === from);
  const b = cast.find((c) => c.id === to);
  return (a && b && seedFromText(a, b)) || {};
}
