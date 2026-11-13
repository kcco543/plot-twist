/**
 * Personality sliders + a light keyword check that spots when the written
 * profile and the sliders seem to disagree. The check only REPORTS possible
 * conflicts; it never edits the player's text or moves a slider by itself.
 */
import { TRAIT_IDS, type Character, type TraitId } from "../types";

export { TRAIT_IDS };

/** Where a slider counts as clearly leaning one way. */
export const LEAN_LOW = 30;
export const LEAN_HIGH = 70;

type Pole = "low" | "high";

/** Words that suggest each end of a slider, in English and Simplified Chinese. */
const KEYWORDS: Record<TraitId, Record<Pole, string[]>> = {
  extroversion: {
    low: ["introvert", "introverted", "shy", "quiet", "loner", "solitary", "reclusive", "keeps to themselves", "内向", "害羞", "安静", "独来独往", "孤僻", "不爱说话"],
    high: ["extrovert", "extroverted", "outgoing", "sociable", "life of the party", "chatty", "talkative", "外向", "开朗", "健谈", "爱热闹", "话多"],
  },
  impulsiveness: {
    low: ["cautious", "careful", "patient", "deliberate", "methodical", "plans ahead", "谨慎", "小心翼翼", "耐心", "深思熟虑", "稳重"],
    high: ["impulsive", "reckless", "rash", "hot-headed", "hotheaded", "spontaneous", "impatient", "冲动", "鲁莽", "急性子", "莽撞", "心急"],
  },
  expressiveness: {
    low: ["reserved", "stoic", "guarded", "poker face", "hides their feelings", "hides feelings", "内敛", "克制", "面无表情", "不露声色"],
    high: ["expressive", "dramatic", "emotional", "wears their heart on their sleeve", "animated", "表情丰富", "情绪化", "夸张", "喜形于色"],
  },
  trust: {
    low: ["distrustful", "suspicious", "paranoid", "cynical", "wary", "多疑", "猜忌", "戒备", "不信任"],
    high: ["trusting", "naive", "gullible", "trusts everyone", "轻信", "天真", "单纯", "信任他人"],
  },
  idealism: {
    low: ["pragmatic", "practical", "realistic", "务实", "现实主义", "实际"],
    high: ["idealistic", "idealist", "dreamer", "romantic", "optimist", "optimistic", "理想主义", "爱做梦", "浪漫"],
  },
  dependence: {
    low: ["independent", "self-reliant", "lone wolf", "独立", "自立", "独行"],
    high: ["dependent", "clingy", "needy", "依赖", "黏人", "离不开"],
  },
  confrontation: {
    low: ["conflict-avoidant", "avoids conflict", "peacemaker", "meek", "pushover", "timid", "回避冲突", "息事宁人", "胆小", "怕事", "和事佬"],
    high: ["confrontational", "argumentative", "combative", "blunt", "aggressive", "picks fights", "好斗", "爱争论", "火爆", "咄咄逼人"],
  },
  playfulness: {
    low: ["serious", "stern", "solemn", "humorless", "humourless", "严肃", "刻板", "一本正经"],
    high: ["playful", "joker", "silly", "mischievous", "goofy", "funny", "爱开玩笑", "调皮", "搞笑", "幽默"],
  },
  empathy: {
    low: ["selfish", "self-centered", "self-centred", "callous", "cold-hearted", "自私", "冷漠", "以自我为中心"],
    high: ["empathetic", "caring", "compassionate", "kind-hearted", "kind", "gentle", "善解人意", "体贴", "温柔", "善良", "同理心"],
  },
  rebelliousness: {
    low: ["rule-follower", "follows the rules", "obedient", "by the book", "law-abiding", "dutiful", "守规矩", "听话", "循规蹈矩", "守法"],
    high: ["rebellious", "rebel", "defiant", "rule-breaker", "breaks the rules", "troublemaker", "叛逆", "反叛", "不守规矩", "离经叛道"],
  },
};

/** The written fields that describe temperament (goals, fears etc. are about content, not temperament). */
const TEMPERAMENT_FIELDS = ["personality", "identity", "habits", "speakingStyle", "values"] as const;

const isCjk = (s: string) => /[㐀-鿿]/.test(s);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NEGATION_EN = /\b(not|never|no longer|isn't|isnt|aren't|wasn't|hardly|rarely)\s+(?:\w+\s+)?$/i;

/** Keywords for one pole that appear (not negated) in the text. */
export function findKeywords(text: string, trait: TraitId, pole: Pole): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const kw of KEYWORDS[trait][pole]) {
    if (isCjk(kw)) {
      let i = lower.indexOf(kw);
      while (i !== -1) {
        const before = lower.slice(Math.max(0, i - 1), i);
        if (!/[不没非别]/.test(before)) {
          found.push(kw);
          break;
        }
        i = lower.indexOf(kw, i + kw.length);
      }
    } else {
      const re = new RegExp(`(^|[^a-z-])${escape(kw)}(?![a-z-])`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower))) {
        if (kw === "kind" && /^\s*of\b/.test(lower.slice(m.index + m[0].length))) continue; // "kind of"
        if (!NEGATION_EN.test(lower.slice(0, m.index + m[1].length))) {
          found.push(kw);
          break;
        }
      }
    }
  }
  return found;
}

export type TraitConflict = {
  /** Stable id, e.g. "extroversion:low" = text says introverted, slider says extroverted. */
  id: string;
  trait: TraitId;
  /** Which end the WRITTEN profile points to. */
  writtenPole: Pole;
  words: string[];
  slider: number;
  /** A slider value that would match the text, offered (never applied) as a fix. */
  suggested: number;
};

/** Possible disagreements between the written profile and the sliders. */
export function detectConflicts(c: Character): TraitConflict[] {
  const text = TEMPERAMENT_FIELDS.map((f) => c[f]).join("\n");
  if (!text.trim()) return [];
  const out: TraitConflict[] = [];
  for (const trait of TRAIT_IDS) {
    const v = c.traits[trait];
    if (v === undefined) continue;
    if (v >= LEAN_HIGH) {
      const words = findKeywords(text, trait, "low");
      if (words.length) out.push({ id: `${trait}:low`, trait, writtenPole: "low", words, slider: v, suggested: 25 });
    } else if (v <= LEAN_LOW) {
      const words = findKeywords(text, trait, "high");
      if (words.length) out.push({ id: `${trait}:high`, trait, writtenPole: "high", words, slider: v, suggested: 75 });
    }
  }
  return out;
}

/** Conflicts the player hasn't reviewed yet. */
export function openConflicts(c: Character) {
  return detectConflicts(c).filter((x) => !c.resolvedConflicts.includes(x.id));
}

/** What the written profile alone hints for a trait (used by the built-in analyzer). -1 low, 1 high, 0 none/mixed. */
export function writtenLean(c: Character, trait: TraitId): -1 | 0 | 1 {
  const text = TEMPERAMENT_FIELDS.map((f) => c[f]).join("\n");
  const lo = findKeywords(text, trait, "low").length;
  const hi = findKeywords(text, trait, "high").length;
  return lo > hi ? -1 : hi > lo ? 1 : 0;
}

/**
 * The trait value the game uses: the slider when set, otherwise a nudge from
 * the written profile, otherwise neutral (50). Sliders are tendencies, not rules.
 */
export function effectiveTrait(c: Character, trait: TraitId): number {
  const v = c.traits[trait];
  if (v !== undefined) return v;
  const lean = writtenLean(c, trait);
  return lean === 0 ? 50 : lean < 0 ? 28 : 72;
}
