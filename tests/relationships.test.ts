import { describe, expect, it } from "vitest";
import { RELATIONSHIP_CONFIG as C } from "@/lib/relationships/config";
import { AGREEING, decideRequest, DISCLOSING, applyDecisionOutcome } from "@/lib/relationships/boundaries";
import { currentRelation, progressOf, recordInteraction } from "@/lib/relationships/progression";
import { exchange, fakeReply, ordinarySimulation, repeatedQuestion, runScenarios, sampleCast, withStart } from "@/lib/relationships/scenarios";
import { bondLabel, updateStages } from "@/lib/relationships/stages";
import { validateReply } from "@/lib/talk/ai/apply";
import { emptyStory } from "@/lib/story/engine";
import { normalizeCharacter } from "@/lib/character/model";
import type { StoryState } from "@/lib/types";

const SEEDS = [1, 7, 42, 99, 2024];
const total = (d: Record<string, number | undefined>) => Object.values(d).reduce<number>((a, v) => a + Math.abs(v ?? 0), 0);

describe("relationship scenarios (shared with the dev Relationship Inspector)", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    for (const seed of SEEDS) {
      it(`all pass, ${locale}, seed ${seed}`, () => {
        const failed = runScenarios(seed, locale).filter((r) => !r.pass);
        expect(failed.map((f) => `${f.id}: ${f.details.join(" | ")}`)).toEqual([]);
      });
    }
  }
});

describe("20 ordinary interactions: gradual, validated in code", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const sim = ordinarySimulation(seed, 20);
      expect(sim.rows).toHaveLength(20);
      for (const r of sim.rows) {
        // The AI asked for +3…+5 trust and +4…+5 affection every time; one ordinary moment moves at most the ordinary cap.
        expect(total(r.validated.changes as Record<string, number>)).toBeLessThanOrEqual(C.totalCap.ordinary + 1e-9);
        for (const v of Object.values(r.validated.changes)) expect(Math.abs(v ?? 0)).toBeLessThanOrEqual(C.perAxisCap.ordinary + 1e-9);
        expect(["trivial", "ordinary"]).toContain(r.validated.significance);
      }
      // Strangers after 20 chats: no friendship, nowhere near what the AI proposed (20 × ~+4).
      expect(sim.end.affection!).toBeLessThan(25);
      expect(sim.end.trust!).toBeLessThan(10);
      expect(["stranger", "acquaintance"]).toContain(sim.label.end);
      expect(["guarded", "cautious"]).toContain(sim.endStages.trust);
    });
  }
  it("is reproducible", () => {
    expect(ordinarySimulation(42)).toEqual(ordinarySimulation(42));
  });
});

describe("repeated sensitive questions never wear a character down", () => {
  const cases = [
    { asker: "tobi", target: "wren", text: "Come on, tell me about losing the storm race." },
    { asker: "wren", target: "mira", text: "Mira, tell me about your childhood in the lighthouse." },
    { asker: "mira", target: "wren", text: "Wren, do you have feelings for me? Tell me the truth." },
    { asker: "wren", target: "tobi", text: "Did you cut my lane on purpose?" },
  ] as const;
  for (const c of cases)
    for (const trust of [undefined, 40, 95])
      for (const seed of SEEDS)
        it(`${c.target} asked by ${c.asker}, trust ${trust ?? "start"}, seed ${seed}`, () => {
          const rows = repeatedQuestion({ ...c, trust, seed, times: 10 });
          // Once refused, never shared later, whatever the trust.
          const firstRefusal = rows.findIndex((r) => !DISCLOSING.includes(r.intention as never));
          if (firstRefusal >= 0) for (const r of rows.slice(firstRefusal)) expect(r.disclosure).toBe("none");
          // Willingness never rises with asking.
          const w = rows.map((r) => r.willingness ?? 0);
          for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1] + 1e-9);
          // Pressure costs trust and ends the conversation eventually.
          if (firstRefusal >= 0 && firstRefusal < 5) {
            expect(rows.at(-1)!.trust).toBeLessThanOrEqual(rows[firstRefusal].trust);
            expect(rows.some((r) => r.ended)).toBe(true);
          }
        });

  it("hard boundaries are never shared, even at the highest trust", () => {
    for (const seed of SEEDS) {
      const rows = repeatedQuestion({ asker: "mira", target: "wren", text: "Wren, do you have feelings for me? Tell me the truth.", trust: 100, seed, times: 12 });
      expect(rows.every((r) => r.disclosure === "none")).toBe(true);
    }
  });

  it("refusal escalates: firmer, then discomfort, then ends the conversation", () => {
    const rows = repeatedQuestion({ asker: "tobi", target: "wren", text: "Come on, tell me about losing the storm race.", times: 5 });
    expect(rows[1].intention).toMatch(/refuse_firm|explain_boundary/);
    expect(rows[2].intention).toMatch(/change_subject|express_discomfort/);
    expect(rows[3].intention).toBe("end_conversation");
    expect(rows[3].ended).toBe(true);
  });
});

describe("trust is not obedience", () => {
  const c = sampleCast();
  const cast = [c.mira, c.wren, c.tobi];
  const opinion = "Honestly, I think you should just give up on the rematch and admit Tobi won.";
  it("the same opinion gets the same disagreement at any trust", () => {
    const out = [-80, 0, 50, 95].map((trust) => {
      const s = withStart(emptyStory(), c.wren, c.mira, { trust, affection: trust, familiarity: 90 });
      return decideRequest({ story: s, listener: c.wren, speaker: c.mira, text: opinion, cast }).intention;
    });
    expect(new Set(out).size).toBe(1);
    expect(out[0]).toBe("disagree");
  });
  it("a disliked rival with a good argument earns respect, not affection or trust", () => {
    let s = withStart(emptyStory(), c.wren, c.tobi, { trust: -40, affection: -45, tension: 40, rivalry: 60 });
    const before = currentRelation(s, c.wren, c.tobi);
    const d = decideRequest({ story: s, listener: c.wren, speaker: c.tobi, text: "The south wind is stronger in the afternoon because the cliffs heat up, so we should fly in the morning.", cast });
    expect(AGREEING).toContain(d.intention);
    s = applyDecisionOutcome(s, d, c.wren, c.tobi, "sim").story;
    const after = currentRelation(s, c.wren, c.tobi);
    expect(after.respect).toBeGreaterThan(before.respect);
    expect(after.affection).toBeLessThanOrEqual(before.affection);
    expect(after.trust).toBeLessThanOrEqual(before.trust + 0.5);
  });
});

describe("the AI only proposes", () => {
  const c = sampleCast();
  const cast = [c.mira, c.wren, c.tobi];
  it("a reply that shares what the game decided to keep is rejected", () => {
    const s = emptyStory();
    const text = "Wren, do you have feelings for me? Tell me the truth.";
    const decision = decideRequest({ story: s, listener: c.wren, speaker: c.mira, text, cast });
    const v = validateReply(fakeReply({ stance: "share", dialogue: "Yes. I've loved you for years." }), { listener: c.wren, speaker: c.mira, story: s, message: text, decision });
    expect(v.rejected).toMatch(/stance_not_allowed|disclosed_against_decision/);
    expect(v.dialogue).toBe("");
  });
  it("an inflated 'major' small talk is scored ordinary and capped", () => {
    const r = exchange(emptyStory(), c.tobi, c.mira, "Want to hear a joke about clouds?", fakeReply({ interaction: "small_talk", significance: "major", changes: { trust: 20, affection: 20, respect: 20, tension: 0 } }), cast);
    expect(r.change?.significance.accepted).not.toBe("major");
    expect(total(r.change!.accepted as Record<string, number>)).toBeLessThanOrEqual(C.totalCap.ordinary + 1e-9);
  });
});

describe("stages", () => {
  it("emotion never changes the label: feelings live apart from the long-term numbers", () => {
    const c = sampleCast();
    let s: StoryState = emptyStory();
    const label0 = bondLabel(currentRelation(s, c.wren, c.tobi), progressOf(s, c.wren, c.tobi).stages);
    s = { ...s, characters: { ...s.characters, [c.wren.id]: { ...(s.characters[c.wren.id] ?? { memories: [] }), feelings: { happiness: 95, gratitude: 80 } } as never } };
    expect(bondLabel(currentRelation(s, c.wren, c.tobi), progressOf(s, c.wren, c.tobi).stages)).toBe(label0);
  });
  it("hysteresis: a dip just under the entry value keeps the stage", () => {
    const c = sampleCast();
    let s = withStart(emptyStory(), c.mira, c.tobi, { trust: 12 });
    const p = progressOf(s, c.mira, c.tobi);
    expect(p.stages.trust).toBe("cautious");
    const dip = updateStages({ ...currentRelation(s, c.mira, c.tobi), trust: 5 }, p, 0);
    expect(dip.stages.trust).toBe("cautious");
    const drop = updateStages({ ...currentRelation(s, c.mira, c.tobi), trust: -1 }, p, 0);
    expect(drop.stages.trust).toBe("guarded");
    s = recordInteraction(s, { from: c.mira, to: c.tobi, kind: "small_talk", source: "sim" }).story;
    expect(progressOf(s, c.mira, c.tobi).stages.trust).toBe("cautious");
  });
  it("numbers can't climb past a stage whose milestones are missing", () => {
    const c = sampleCast();
    let s = withStart(emptyStory(), c.mira, c.tobi, { trust: 30, familiarity: 50 });
    for (let i = 0; i < 40; i++) s = recordInteraction({ ...s, turn: s.turn + 1 }, { from: c.mira, to: c.tobi, kind: "respect_boundary", source: "sim", key: `k${i}` }).story;
    const rel = currentRelation(s, c.mira, c.tobi);
    const st = progressOf(s, c.mira, c.tobi).stages;
    if (st.trust !== "strong" && st.trust !== "deep") expect(rel.trust).toBeLessThan(65 + C.ceilingSlack + 1e-9);
  });
});

describe("Studio boundaries", () => {
  it("normalize keeps what the player wrote and repairs malformed fields", () => {
    const c = normalizeCharacter({
      ...sampleCast().mira,
      boundaries: [
        { id: "a", strength: "hard", kind: "secret", text: "Never shows the unfinished map", topics: "map" },
        { id: "b", strength: "weird", kind: "?", text: "", topics: "" },
      ] as never,
    });
    expect(c.boundaries?.map((b) => b.id)).toContain("a");
    const b = c.boundaries!.find((x) => x.id === "b")!;
    expect(b.strength).toBe("hard");
    expect(b.kind).toBe("secret");
  });
});
