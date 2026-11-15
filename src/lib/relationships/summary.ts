/**
 * Read-only views of a relationship: for the AI brief, the character panel
 * and the inspector. Nothing here changes state.
 */
import type { Character, StoryState } from "../types";
import { currentRelation, progressOf } from "./progression";
import { bondLabel, type BondLabel } from "./stages";
import type { Axis, Impression, RelProgress } from "./types";

export type ImpressionView = { theme: Impression["theme"]; polarity: "pos" | "neg"; strength: "tentative" | "growing" | "firm"; score: number; evidence: number };

export function impressionViews(p: RelProgress): ImpressionView[] {
  return p.impressions
    .filter((i) => Math.abs(i.score) >= 0.15 && i.evidence >= 0.8)
    .sort((a, b) => b.evidence * Math.abs(b.score) - a.evidence * Math.abs(a.score))
    .map((i) => ({
      theme: i.theme,
      polarity: i.score >= 0 ? "pos" : "neg",
      strength: i.evidence >= 5 && Math.abs(i.score) >= 0.6 ? "firm" : i.evidence >= 2.5 ? "growing" : "tentative",
      score: i.score,
      evidence: i.evidence,
    }));
}

export type RelationshipSummary = {
  stages: Record<Axis, string>;
  label: BondLabel;
  impressions: ImpressionView[];
  conflicts: string[];
  promises: string[];
  milestones: string[];
};

export function relationshipSummary(story: StoryState, from: Character, to: Character | null): RelationshipSummary {
  const p = progressOf(story, from, to);
  const rel = currentRelation(story, from, to);
  const st = p.stages;
  const turn = story.turn;
  return {
    stages: { trust: st.trust ?? "cautious", affection: st.affection ?? "neutral", respect: st.respect ?? "neutral", familiarity: st.familiarity ?? "stranger", tension: st.tension ?? "calm" },
    label: bondLabel(rel, st),
    impressions: impressionViews(p).slice(0, 5),
    conflicts: p.conflicts
      .filter((c) => !c.resolved)
      .slice(-3)
      .map((c) => `${c.kind.replace("_", " ")} ${Math.max(0, turn - c.turn)} turns ago${c.apologies ? `, apologized ${c.apologies}×` : ", no apology"}${c.repairNeeded ? `, ${c.repair}/${c.repairNeeded} acts of repair` : ""}`),
    promises: p.promises
      .slice(-3)
      .map((x) => `${x.status}: ${x.text || "(a promise)"} (${Math.max(0, turn - x.turn)} turns ago)`),
    milestones: p.milestones.slice(-5).map((m) => `${m.kind.replace(/_/g, " ")} (${Math.max(0, turn - m.turn)} turns ago)`),
  };
}
