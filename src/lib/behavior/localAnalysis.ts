/**
 * Built-in personality analysis: no AI, no network. Reads the sliders and the
 * written profile and fills the same BehaviorProfile shape the AI returns, so
 * the game works (and the player can review/approve) without an API key.
 * Player-written text is quoted as-is and never rewritten or translated.
 */
import { translate, type Locale } from "../../i18n";
import { detectConflicts, LEAN_HIGH, LEAN_LOW, writtenLean } from "../character/traits";
import { REACTIONS, TRAIT_IDS, type BehaviorProfile, type Character, type Reaction } from "../types";
import { reactionTendencies, speechLength, topApproaches, traitVector } from "./tendencies";

/** Split a written field into short items (lines, semicolons, Chinese full stops). */
export function splitItems(text: string, max = 5): string[] {
  return text
    .split(/\n|;|；|。|(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/^[-*•·]\s*/, ""))
    .filter(Boolean)
    .slice(0, max);
}

export function buildLocalProfile(c: Character, locale: Locale): BehaviorProfile {
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const name = c.name.trim() || t("common.unnamed");
  const vec = traitVector(c);
  const tendencies = reactionTendencies(c);

  const coreTraits: BehaviorProfile["coreTraits"] = [];
  for (const id of TRAIT_IDS) {
    const v = vec[id];
    if (v > LEAN_LOW && v < LEAN_HIGH) continue;
    const pole = v <= LEAN_LOW ? "low" : "high";
    const fromSlider = c.traits[id] !== undefined;
    const lean = writtenLean(c, id);
    const fromText = (pole === "low" && lean < 0) || (pole === "high" && lean > 0);
    coreTraits.push({
      label: t(`traits.${id}.${pole}`),
      evidence: fromSlider ? t("analysis.local.sliderEvidence", { value: c.traits[id]! }) : t("analysis.local.textEvidence"),
      source: fromSlider && fromText ? "both" : fromSlider ? "sliders" : "written",
    });
  }

  const top = [...REACTIONS].sort((a, b) => tendencies[b] - tendencies[a]).slice(0, 3);
  const emotionalPatterns = top.map((r: Reaction) => ({
    trigger: t(`analysis.local.triggers.${r}`),
    reaction: t(`reactions.${r}`),
    variation: t(`analysis.local.variations.${r}`),
  }));

  const traitWords = coreTraits.slice(0, 3).map((x) => x.label);
  const summary =
    (traitWords.length ? t("analysis.local.summary", { name, traits: traitWords.join(t("analysis.local.listSep")) }) : t("analysis.local.summaryNeutral", { name })) +
    (c.personality.trim() ? " " + t("analysis.local.summaryWritten", { text: c.personality.trim() }) : "");

  const length = speechLength(c);
  return {
    summary,
    coreTraits: coreTraits.slice(0, 8),
    speech: {
      register: c.speakingStyle.trim() || t(`analysis.local.register.${length}`),
      length,
      tics: splitItems(c.habits, 3),
      avoids: [],
      sample: "",
    },
    emotionalPatterns,
    decisionStyle: t(vec.impulsiveness >= 60 ? "analysis.local.decision.fast" : vec.impulsiveness <= 40 ? "analysis.local.decision.slow" : "analysis.local.decision.mixed"),
    socialStyle: t(vec.extroversion >= 60 ? "analysis.local.social.out" : vec.extroversion <= 40 ? "analysis.local.social.in" : "analysis.local.social.mixed"),
    motivations: splitItems(c.goals, 4),
    boundaries: splitItems(c.rules, 6),
    dialogueApproaches: topApproaches(c),
    reactionTendencies: tendencies,
    conflicts: detectConflicts(c).map((x) => ({
      traitId: x.trait,
      written: x.words.join(", "),
      slider: `${t(`traits.${x.trait}.low`)} ${x.slider} ${t(`traits.${x.trait}.high`)}`,
      note: t("analysis.local.conflictNote"),
    })),
    storyHooks: [...splitItems(c.fears, 2), ...splitItems(c.goals, 2)].slice(0, 4),
  };
}
