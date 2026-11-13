/**
 * Zod schemas for everything the AI returns. The server asks Claude for this
 * exact shape (structured outputs) and validates it again before use. Length
 * limits are applied after parsing (finishProfile / finishTurn), because
 * structured-output schemas can't carry them.
 */
import { z } from "zod";
import { APPROACHES, REACTIONS, TRAIT_IDS, type BehaviorProfile } from "../types";

export const BehaviorProfileSchema = z.object({
  summary: z.string(),
  coreTraits: z.array(z.object({ label: z.string(), evidence: z.string(), source: z.enum(["written", "sliders", "both"]) })),
  speech: z.object({
    register: z.string(),
    length: z.enum(["terse", "measured", "chatty"]),
    tics: z.array(z.string()),
    avoids: z.array(z.string()),
    sample: z.string(),
  }),
  emotionalPatterns: z.array(z.object({ trigger: z.string(), reaction: z.string(), variation: z.string() })),
  decisionStyle: z.string(),
  socialStyle: z.string(),
  motivations: z.array(z.string()),
  boundaries: z.array(z.string()),
  dialogueApproaches: z.array(z.enum(APPROACHES)),
  reactionTendencies: z.object({
    confront: z.number(),
    deflect: z.number(),
    withdraw: z.number(),
    comfort: z.number(),
    joke: z.number(),
    investigate: z.number(),
    act: z.number(),
    cooperate: z.number(),
  }),
  conflicts: z.array(z.object({ traitId: z.enum(TRAIT_IDS).nullable(), written: z.string(), slider: z.string(), note: z.string() })),
  storyHooks: z.array(z.string()),
});

const cut = (s: string, n: number) => s.trim().slice(0, n);
const list = <T,>(a: T[], n: number) => a.slice(0, n);

/** Clamp lengths and numbers after parsing. Throws if the profile is unusable. */
export function finishProfile(raw: unknown): BehaviorProfile {
  const p = BehaviorProfileSchema.parse(raw);
  const rt = Object.fromEntries(REACTIONS.map((r) => [r, Math.round(Math.min(100, Math.max(0, Number.isFinite(p.reactionTendencies[r]) ? p.reactionTendencies[r] : 50)))]));
  const approaches = [...new Set(p.dialogueApproaches)].slice(0, 4);
  if (!p.summary.trim() || approaches.length === 0) throw new Error("Profile is missing a summary or dialogue approaches");
  return {
    summary: cut(p.summary, 600),
    coreTraits: list(p.coreTraits, 8).map((x) => ({ label: cut(x.label, 60), evidence: cut(x.evidence, 240), source: x.source })),
    speech: {
      register: cut(p.speech.register, 200),
      length: p.speech.length,
      tics: list(p.speech.tics, 5).map((x) => cut(x, 100)),
      avoids: list(p.speech.avoids, 5).map((x) => cut(x, 100)),
      sample: cut(p.speech.sample, 240),
    },
    emotionalPatterns: list(p.emotionalPatterns, 6).map((x) => ({ trigger: cut(x.trigger, 140), reaction: cut(x.reaction, 160), variation: cut(x.variation, 200) })),
    decisionStyle: cut(p.decisionStyle, 240),
    socialStyle: cut(p.socialStyle, 240),
    motivations: list(p.motivations, 5).map((x) => cut(x, 160)),
    boundaries: list(p.boundaries, 8).map((x) => cut(x, 200)),
    dialogueApproaches: approaches,
    reactionTendencies: rt as BehaviorProfile["reactionTendencies"],
    conflicts: list(p.conflicts, 6).map((x) => ({ traitId: x.traitId, written: cut(x.written, 200), slider: cut(x.slider, 160), note: cut(x.note, 240) })),
    storyHooks: list(p.storyHooks, 5).map((x) => cut(x, 200)),
  };
}

/** One generated story beat. Speakers are ids the server allowed; names are filled in by the game, never by the AI. */
export const TurnOutputSchema = z.object({
  lines: z.array(z.object({ speaker: z.string(), text: z.string() })),
  memoryNote: z.string(),
});
export type TurnOutput = z.infer<typeof TurnOutputSchema>;
