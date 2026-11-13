import { describe, expect, it } from "vitest";
import { analysisUser, turnUser } from "@/lib/ai/server/prompts";
import { buildLocalProfile } from "@/lib/behavior/localAnalysis";
import { finishProfile } from "@/lib/behavior/schema";
import { reactionTendencies } from "@/lib/behavior/tendencies";
import { CHARACTER_TEXT_FIELDS } from "@/lib/types";
import { juniper, rook } from "./helpers";

const brief = (c: ReturnType<typeof juniper>) => ({
  id: c.id,
  fields: Object.fromEntries(CHARACTER_TEXT_FIELDS.map((f) => [f, c[f]])),
  traits: c.traits,
  lockedFields: c.lockedFields,
  profile: null,
});

describe("built-in analysis", () => {
  it("produces a valid profile in both languages", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const p = buildLocalProfile(juniper(), locale);
      expect(() => finishProfile(p)).not.toThrow();
      expect(p.summary).toContain("Juniper");
      expect(p.boundaries).toEqual(["Never reads other people's letters."]);
      expect(JSON.stringify(p)).not.toMatch(/analysis\.local|traits\.\w+\.(low|high)/); // every key translated
    }
  });

  it("reflects the sliders: an extroverted, empathetic character comforts more than they withdraw", () => {
    const j = reactionTendencies(juniper());
    const r = reactionTendencies(rook());
    expect(j.comfort).toBeGreaterThan(j.withdraw);
    expect(r.withdraw).toBeGreaterThan(j.withdraw);
    expect(r.investigate).toBeGreaterThan(j.investigate);
  });
});

describe("AI prompts use the right character data", () => {
  it("analysis prompt quotes the written profile verbatim, lists sliders and marks locked fields", () => {
    const c = juniper();
    const text = analysisUser({ locale: "zh-CN", world: "otherworld", character: brief(c), cast: [{ name: "Rook", relationships: "" }], mood: "anxious", memories: [{ eventType: "argument", withName: "Rook", note: null, importance: 2 }] });
    expect(text).toContain("Simplified Chinese");
    expect(text).toContain(c.personality);
    expect(text).toContain(`<rules locked="true">${c.rules}</rules>`);
    expect(text).toContain("introverted ↔ extroverted: 80");
    expect(text).toContain("Current mood: anxious");
    expect(text).toContain("argument with Rook");
  });

  it("turn prompt states the decided outcome and the allowed speakers", () => {
    const j = juniper();
    const r = rook();
    const text = turnUser({
      locale: "en",
      world: "modern",
      place: "street",
      placeDescription: "",
      beat: { kind: "event", type: "argument", reaction: "cooperate", approach: "warm", topic: null, outcome: null, moodBefore: "calm", moodAfter: "calm", bondChange: "closer", recalled: null },
      actor: brief(j),
      other: brief(r),
      bond: { affinity: 5, trust: 3 },
      memories: [],
      recentLines: ["An earlier line"],
    });
    expect(text).toContain("Actor's reaction (decided by the game): cooperate");
    expect(text).toContain(`Allowed speaker ids: narrator, ${j.id}, ${r.id}`);
    expect(text).toContain("An earlier line");
  });
});
