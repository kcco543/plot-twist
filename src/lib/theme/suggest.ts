/**
 * Local, free theme suggestions from a world description (no AI call).
 * Keyword lists in English and Simplified Chinese map words to a mood, a few
 * motifs and (only as a hint) a world type. Nothing is inferred from words
 * that aren't there: an empty or vague description suggests nothing, and
 * the selected world type always stays the base.
 */
import type { WorldId } from "../types";
import type { MotifId } from "./motifs";
import { BASES, MAX_MOTIFS, type MoodId } from "./themes";

type Rule = { words: string[]; mood?: MoodId; motifs?: MotifId[]; base?: WorldId };

const RULES: Rule[] = [
  // moods (on a tie, the earlier rule wins: specific places before general adjectives)
  { words: ["temple", "shrine", "sacred", "holy", "monastery", "cathedral", "寺", "庙", "神圣", "圣殿", "道观"], mood: "sacred" },
  { words: ["rain", "rainy", "neon", "night", "gloomy", "lonely", "雨", "霓虹", "夜", "阴沉", "孤独"], mood: "moody" },
  { words: ["cozy", "cosy", "warm", "snug", "hearth", "fireplace", "tea", "温馨", "舒适", "暖", "炉火", "茶"], mood: "cozy" },
  { words: ["cheerful", "bright", "crowded", "busy", "festival", "market", "bustling", "lively", "热闹", "欢快", "集市", "市场", "节日", "拥挤"], mood: "cheerful" },
  { words: ["dream", "dreamy", "floating", "float", "clouds", "surreal", "梦", "漂浮", "浮空", "云端", "奇幻"], mood: "dreamy", motifs: ["cloud"] },
  { words: ["quiet", "calm", "peaceful", "still", "serene", "安静", "宁静", "平静", "静谧"], mood: "calm" },
  { words: ["mysterious", "mystery", "secret", "hidden", "shadow", "fog", "mist", "神秘", "秘密", "隐藏", "迷雾", "雾"], mood: "mysterious" },
  { words: ["farm", "village", "cottage", "barn", "rustic", "mill", "农场", "村", "乡村", "小屋", "磨坊"], mood: "rustic" },
  { words: ["palace", "elegant", "court", "manor", "noble", "royal", "宫", "优雅", "贵族", "皇家", "府邸"], mood: "elegant" },
  // motifs
  { words: ["library", "book", "books", "study", "school", "图书馆", "书", "书院", "学堂"], motifs: ["book", "scroll"] },
  { words: ["forest", "woods", "garden", "vine", "leaf", "leaves", "tree", "森林", "树林", "花园", "藤", "叶", "树"], motifs: ["leaf", "vine"] },
  { words: ["potion", "alchemy", "witch", "magic", "wizard", "药水", "炼金", "魔法", "巫师", "女巫"], motifs: ["potion", "key"], base: "western-fantasy" },
  { words: ["castle", "knight", "kingdom", "dragon", "tavern", "城堡", "骑士", "王国", "龙", "酒馆"], motifs: ["crest"], base: "western-fantasy" },
  { words: ["rain", "rainy", "storm", "雨", "暴雨"], motifs: ["raindrop"] },
  { words: ["apartment", "city", "street", "office", "convenience", "store", "subway", "公寓", "城市", "街", "办公室", "便利店", "地铁"], motifs: ["window", "citylight"], base: "modern" },
  { words: ["neon", "lights", "霓虹", "灯光"], motifs: ["citylight"] },
  { words: ["phone", "camera", "photo", "selfie", "手机", "相机", "照片"], motifs: ["camera", "message"], base: "modern" },
  { words: ["mountain", "mountains", "peak", "cliff", "山", "峰", "悬崖"], motifs: ["mountain", "cloud"] },
  { words: ["lantern", "lanterns", "灯笼", "花灯"], motifs: ["lantern"] },
  { words: ["bamboo", "竹"], motifs: ["bamboo"], base: "ancient-china" },
  { words: ["jade", "dynasty", "emperor", "scholar", "inn", "sect", "玉", "王朝", "皇帝", "书生", "客栈", "门派", "江湖"], motifs: ["jade", "seal"], base: "ancient-china" },
  { words: ["scroll", "ink", "calligraphy", "卷轴", "水墨", "书法"], motifs: ["scroll"], base: "ancient-china" },
  { words: ["mushroom", "mushrooms", "fungus", "蘑菇", "菌"], motifs: ["mushroom"], base: "otherworld" },
  { words: ["star", "stars", "starlight", "galaxy", "space", "星", "星光", "银河", "太空"], motifs: ["star", "sparkle"] },
  { words: ["moon", "lunar", "月", "月亮"], motifs: ["moon"] },
  { words: ["crystal", "crystals", "gem", "gems", "水晶", "宝石"], motifs: ["crystal"], base: "otherworld" },
  { words: ["bubble", "bubbles", "underwater", "sea", "ocean", "泡泡", "水下", "海"], motifs: ["bubble"] },
  { words: ["cloud", "clouds", "sky", "云", "天空"], motifs: ["cloud"] },
  { words: ["candy", "sweets", "糖果", "甜点"], motifs: ["crystal", "bubble"], base: "otherworld" },
];

export type ThemeSuggestion = {
  /** Never "default" unless nothing matched. */
  mood: MoodId;
  motifs: MotifId[];
  /** A world type the words point to, only shown as a hint (never applied). */
  baseHint: WorldId | null;
  /** Words that matched, so the player sees why. */
  matched: string[];
  confidence: "none" | "low" | "high";
};

const tokenize = (s: string) => s.toLowerCase();

export function suggestTheme(description: string, worldId: WorldId | null): ThemeSuggestion {
  const text = tokenize(description.trim());
  const empty: ThemeSuggestion = { mood: "default", motifs: [], baseHint: null, matched: [], confidence: "none" };
  if (text.length < 6) return empty;
  const moodScore = new Map<MoodId, number>();
  const motifScore = new Map<MotifId, number>();
  const baseScore = new Map<WorldId, number>();
  const matched = new Set<string>();
  // Latin words match whole words; Chinese matches as a substring.
  const has = (w: string) => (/^[a-z]+$/.test(w) ? new RegExp(`\\b${w}\\b`).test(text) : text.includes(w));
  RULES.forEach((r) => {
    const hit = r.words.find(has);
    if (!hit) return;
    matched.add(hit);
    if (r.mood) moodScore.set(r.mood, (moodScore.get(r.mood) ?? 0) + 1);
    r.motifs?.forEach((m, i) => motifScore.set(m, (motifScore.get(m) ?? 0) + (i === 0 ? 2 : 1)));
    if (r.base) baseScore.set(r.base, (baseScore.get(r.base) ?? 0) + 1);
  });
  if (matched.size === 0) return empty;
  const best = <K,>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const mood = best(moodScore)[0]?.[0] ?? "default";
  // Prefer motifs from this world's own vocabulary when scores tie.
  const vocab = worldId ? BASES[worldId].vocabulary : [];
  const motifs = [...motifScore.entries()]
    .sort((a, b) => b[1] - a[1] || Number(vocab.includes(b[0])) - Number(vocab.includes(a[0])))
    .map(([m]) => m)
    .slice(0, MAX_MOTIFS);
  const topBase = best(baseScore)[0];
  const baseHint = topBase && topBase[0] !== worldId && topBase[1] >= 2 ? topBase[0] : null;
  return { mood, motifs, baseHint, matched: [...matched], confidence: matched.size >= 2 ? "high" : "low" };
}
