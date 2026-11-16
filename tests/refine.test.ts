import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "./fakeBrowser";
import { acceptBlockers, acceptProposal, canonSentences, changedSections, pinLockedCanon, lastAccepted, reconcileChanges, rejectProposal, restoreRevision, versionOf, withProposal, type AnalysisProposal } from "@/lib/behavior/refine";
import { buildLocalProfile } from "@/lib/behavior/localAnalysis";
import { approvedBehavior } from "@/lib/character/model";
import type { BehaviorProfile, BehaviorRecord } from "@/lib/types";
import { rook } from "./helpers";

const base = (): BehaviorRecord => ({ profile: buildLocalProfile(rook(), "en"), source: "ai", status: "approved", inputHash: "h", locale: "en", createdAt: 1, approvedAt: 1 });
const proposal = (r: BehaviorRecord, patch: Partial<BehaviorProfile>, extra: Partial<AnalysisProposal> = {}): AnalysisProposal => ({
  id: `p${Math.random()}`,
  at: 2,
  feedback: "Not timid: playful with close friends.",
  sourceVersion: versionOf(r),
  interpretation: "Reserved with strangers, playful with friends.",
  changes: [],
  kept: [],
  ambiguities: [],
  canonConflicts: [],
  keepCanon: false,
  profile: { ...r.profile, ...patch },
  source: "ai",
  ...extra,
});

describe("feedback refinement: accept, reject, restore", () => {
  it("correcting an overly shy reading: accepted revision becomes the active (approved) profile, unrelated parts kept", () => {
    let r = base();
    const before = r.profile;
    r = withProposal(r, proposal(r, { socialStyle: "Reserved with strangers; playful and talkative with close friends.", reactionTendencies: { ...before.reactionTendencies, withdraw: 20, joke: 70 } }));
    expect(r.profile).toBe(before); // nothing applied yet
    r = acceptProposal(r, false);
    expect(r.profile.socialStyle).toMatch(/playful/);
    expect(r.profile.reactionTendencies.withdraw).toBe(20);
    expect(r.profile.motivations).toEqual(before.motivations);
    expect(r.profile.speech).toEqual(before.speech);
    expect(versionOf(r)).toBe(2);
    expect(r.revisions!.at(-1)).toMatchObject({ status: "accepted", sourceVersion: 1, resultVersion: 2, feedback: "Not timid: playful with close friends." });
    expect(r.revisions!.at(-1)!.previous).toEqual(before);
    expect(approvedBehavior({ ...rook(), behavior: r })!.profile.socialStyle).toMatch(/playful/);
  });

  it("correcting an overly aggressive reading and refining speech style", () => {
    let r = base();
    r = withProposal(r, proposal(r, { reactionTendencies: { ...r.profile.reactionTendencies, confront: 15, comfort: 60 } }));
    r = acceptProposal(r, false);
    r = withProposal(r, proposal(r, { speech: { ...r.profile.speech, register: "Soft, few words, dry jokes", length: "terse" } }));
    r = acceptProposal(r, false);
    expect(r.profile.reactionTendencies.confront).toBe(15);
    expect(r.profile.speech.length).toBe("terse");
    expect(versionOf(r)).toBe(3);
  });

  it("rejecting an incorrect revision changes nothing but the history", () => {
    let r = base();
    const before = r.profile;
    r = withProposal(r, proposal(r, { summary: "Wrong reading" }));
    r = rejectProposal(r);
    expect(r.profile).toEqual(before);
    expect(versionOf(r)).toBe(1);
    expect(r.proposal).toBeNull();
    expect(r.revisions!.at(-1)).toMatchObject({ status: "rejected", accepted: null });
  });

  it("restoring an earlier revision (and undoing the restore)", () => {
    let r = base();
    const v1 = r.profile;
    r = acceptProposal(withProposal(r, proposal(r, { summary: "v2" })), false);
    r = acceptProposal(withProposal(r, proposal(r, { summary: "v3" })), false);
    r = restoreRevision(r, lastAccepted(r)!.id, "previous", "x1");
    expect(r.profile.summary).toBe("v2");
    r = restoreRevision(r, r.revisions![0].id, "previous", "x2");
    expect(r.profile).toEqual(v1);
    r = restoreRevision(r, lastAccepted(r)!.id, "previous", "x3"); // undo the restore
    expect(r.profile.summary).toBe("v2");
    expect(versionOf(r)).toBe(6);
  });

  it("locked canon conflicts and ambiguous readings block Accept until resolved", () => {
    let r = base();
    r = withProposal(r, proposal(r, { summary: "x" }, { canonConflicts: [{ field: "rules", canon: "Never lies.", feedback: "lies all the time", note: "" }] }));
    expect(acceptBlockers(r, r.proposal!, true)).toContain("canon");
    expect(acceptProposal(r, true)).toBe(r);
    r = withProposal(r, proposal(r, { summary: "x" }, { keepCanon: true, ambiguities: [{ question: "q", interpretation: "i" }] }));
    expect(acceptBlockers(r, r.proposal!, false)).toEqual(["ambiguous"]);
    expect(acceptProposal(r, true).profile.summary).toBe("x");
  });

  it("a proposal made from an older version is stale", () => {
    let r = base();
    const old = proposal(r, { summary: "old" });
    r = acceptProposal(withProposal(r, proposal(r, { summary: "newer" })), false);
    r = withProposal(r, old);
    expect(acceptBlockers(r, old, true)).toEqual(["stale"]);
  });

  it("the change list always shows every real change", () => {
    const a = base().profile;
    const b = { ...a, socialStyle: "changed", decisionStyle: "changed too" };
    expect(changedSections(a, b)).toEqual(["decisionStyle", "socialStyle"]);
    const out = reconcileChanges(a, b, [{ section: "socialStyle", before: "x", after: "changed", why: "fb" }, { section: "summary", before: "", after: "", why: "claimed" }]);
    expect(out.map((c) => c.section).sort()).toEqual(["decisionStyle", "socialStyle"]);
  });
});

describe("refine route (developer TEST replies, no key)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_TALK_MOCK", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  it("returns a proposal (labelled mock) and flags feedback that contradicts a locked field", async () => {
    const { POST } = await import("@/app/api/ai/refine/route");
    const { briefFor } = await import("@/lib/ai/client");
    const c = { ...rook(), rules: "Never tells anyone about the storm night.", lockedFields: ["name", "rules"] as never };
    const call = (feedback: string, keepCanon = false) =>
      POST(new Request("http://x/api/ai/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: "en", world: "modern", character: briefFor(c), profile: base().profile, feedback, keepCanon, earlier: [] }) })).then((r) => r.json());
    const ok = await call("Less shy, more playful with friends.");
    expect(ok.source).toBe("mock");
    expect(ok.canonConflicts).toEqual([]);
    expect(ok.changes.length).toBeGreaterThan(0);
    const clash = await call("Actually Rook tells everyone about the storm night, not secret at all.");
    expect(clash.canonConflicts[0].field).toBe("rules");
    expect((await call("Actually Rook tells everyone about the storm night, not secret at all.", true)).canonConflicts).toEqual([]);
  });
});

describe("refinement only changes the active world's character", () => {
  beforeEach(() => fakeBrowser());
  it("world A's accepted revision doesn't reach world B or the library", async () => {
    vi.resetModules();
    const saves = await import("@/lib/saves/worldSaves");
    const lib = await import("@/lib/library/characterLibrary");
    const tpl = lib.libraryActions.createBlank();
    lib.libraryActions.update(tpl.id, { name: "Mira", behavior: null });
    const a = saves.createWorld();
    const b = saves.createWorld();
    const enter = async (id: string) => {
      saves.enterWorld(id, "/studio");
      vi.resetModules();
      return { game: await import("@/lib/gameStore"), lib: await import("@/lib/library/characterLibrary") };
    };
    let g = await enter(a.id);
    const inA = g.game.gameActions.addFromLibrary(g.lib.getLibrary().templates[0]);
    g.game.gameActions.updateCharacter(inA.id, { behavior: base() });
    g = await enter(b.id);
    const inB = g.game.gameActions.addFromLibrary(g.lib.getLibrary().templates[0]);
    g.game.gameActions.updateCharacter(inB.id, { behavior: base() });
    g = await enter(a.id);
    const rec = g.game.getSave().characters[0].behavior!;
    g.game.gameActions.updateCharacter(inA.id, { behavior: acceptProposal(withProposal(rec, proposal(rec, { summary: "Refined in A" })), false) });
    g = await enter(a.id);
    expect(g.game.getSave().characters[0].behavior!.profile.summary).toBe("Refined in A");
    g = await enter(b.id);
    expect(g.game.getSave().characters[0].behavior!.profile.summary).not.toBe("Refined in A");
    expect(g.lib.getLibrary().templates[0].behavior ?? null).toBeNull();
  });
});

describe("locked canon stays word for word", () => {
  const p0 = (): BehaviorProfile => ({
    ...buildLocalProfile(rook(), "en"),
    summary: "Juno is quiet. Never breaks a promise.",
    decisionStyle: "Decides slowly; Never breaks a promise, even when it costs them.",
    boundaries: ["Never breaks a promise.", "Won't talk about their sister."],
    motivations: ["Finish building the rooftop telescope"],
  });

  it("splits locked text into sentences and skips tiny fragments", () => {
    expect(canonSentences(["Never breaks a promise. Loyal.\n绝不食言。"])).toEqual(["Never breaks a promise", "绝不食言"]);
  });

  it("puts back a locked rule the revision translated, in place of the translation", () => {
    const before = p0();
    const after: BehaviorProfile = { ...before, summary: "朱诺话少，但会用行动表达关心。绝不违背承诺。", decisionStyle: "做决定很慢；绝不违背承诺。", boundaries: ["绝不违背承诺。", "Won't talk about their sister."], socialStyle: "用行动关心别人。" };
    const { profile, pinned } = pinLockedCanon(before, after, canonSentences(["Never breaks a promise."]));
    expect(pinned).toEqual(["Never breaks a promise"]);
    expect(profile.boundaries).toEqual(["Never breaks a promise.", "Won't talk about their sister."]);
    expect(profile.decisionStyle).toBe(before.decisionStyle);
    expect(profile.summary).toContain("Never breaks a promise");
    expect(profile.summary).toContain("朱诺话少"); // the feedback's change to the summary is kept
    expect(profile.socialStyle).toBe("用行动关心别人。"); // unlocked change untouched
  });

  it("leaves a revision alone when the canon is already verbatim, and adds a dropped one back within the list limit", () => {
    const before = p0();
    expect(pinLockedCanon(before, before, ["Never breaks a promise"]).pinned).toEqual([]);
    const after: BehaviorProfile = { ...before, boundaries: ["a", "b", "c", "d", "e", "f", "g", "h"] };
    const { profile } = pinLockedCanon(before, after, ["Never breaks a promise"]);
    expect(profile.boundaries).toHaveLength(8);
    expect(profile.boundaries[0]).toBe("Never breaks a promise.");
  });
});
