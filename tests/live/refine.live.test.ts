/**
 * LIVE feedback-refinement checks against Claude. A few cents; skipped unless asked:
 *
 *   RUN_LIVE_AI=1 npx vitest run tests/live/refine.live.test.ts
 *
 * Reads ANTHROPIC_API_KEY from the environment or .env.local (never printed).
 * Goes through /api/ai/refine exactly like the Character Studio, and writes
 * every proposal to tests/live/refine-last-run.md so a person can read them.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildLocalProfile } from "@/lib/behavior/localAnalysis";
import type { BehaviorProfile, Character } from "@/lib/types";
import { makeChar } from "../helpers";

const ROOT = path.join(__dirname, "..", "..");
if (process.env.RUN_LIVE_AI === "1" && existsSync(path.join(ROOT, ".env.local"))) {
  for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const LIVE = process.env.RUN_LIVE_AI === "1" && !!process.env.ANTHROPIC_API_KEY;
const OUT = path.join(__dirname, "refine-last-run.md");

const shyProfile = (c: Character): BehaviorProfile => ({
  ...buildLocalProfile(c, "en"),
  summary: "Juno is timid and passive, avoids people and rarely speaks up.",
  socialStyle: "Shy and withdrawn with everyone; avoids conversation.",
  coreTraits: [
    { label: "Timid", evidence: "Quiet in the café", source: "written" },
    { label: "Loves astronomy", evidence: "Goals mention the observatory", source: "written" },
  ],
  motivations: ["Finish building the rooftop telescope"],
  reactionTendencies: { confront: 10, deflect: 60, withdraw: 85, comfort: 30, joke: 10, investigate: 40, act: 20, cooperate: 40 },
});

describe.skipIf(!LIVE)("live feedback refinement (Claude)", () => {
  let POST: (r: Request) => Promise<Response>;
  let briefFor: typeof import("@/lib/ai/client").briefFor;
  beforeAll(async () => {
    ({ POST } = await import("@/app/api/ai/refine/route"));
    ({ briefFor } = await import("@/lib/ai/client"));
    writeFileSync(OUT, `# Refine live run ${new Date().toISOString()}\n`);
  });
  const juno = () =>
    makeChar({ id: "c-juno", name: "Juno", personality: "Quiet in new places. Loyal.", goals: "Finish building the rooftop telescope.", rules: "Never breaks a promise.", speakingStyle: "Short sentences.", lockedFields: ["name", "rules"] });
  const call = async (c: Character, profile: BehaviorProfile, feedback: string, locale: "en" | "zh-CN" = "en", keepCanon = false) => {
    const res = await POST(new Request("http://x/api/ai/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale, world: "modern", character: briefFor({ ...c, behavior: null }), profile, feedback, keepCanon, earlier: [] }) }));
    const data = await res.json();
    expect(res.status, JSON.stringify(data)).toBe(200);
    appendFileSync(OUT, `\n## ${feedback}\n\n**Understood:** ${data.interpretation}\n\n${data.changes.map((x: { section: string; before: string; after: string }) => `- ${x.section}: ${x.before} → ${x.after}`).join("\n")}\n\nKept: ${data.kept.join("; ")}\n\nConflicts: ${JSON.stringify(data.canonConflicts)}\n`);
    return data;
  };

  it("corrects an overly shy reading and keeps unrelated conclusions", async () => {
    const c = juno();
    const p = shyProfile(c);
    const d = await call(c, p, "Juno is reserved around strangers, but becomes playful and talkative around close friends. They are not timid or passive.");
    expect(d.profile.reactionTendencies.withdraw).toBeLessThan(p.reactionTendencies.withdraw);
    expect(JSON.stringify(d.profile).toLowerCase()).toMatch(/friend/);
    expect(d.profile.summary.toLowerCase()).not.toMatch(/\btimid and passive\b/);
    expect(JSON.stringify(d.profile).toLowerCase()).toMatch(/telescope/);
    expect(d.profile.summary).not.toContain("They are not timid or passive."); // integrated, not pasted
  }, 120_000);

  it("corrects an overly aggressive reading", async () => {
    const c = juno();
    const p: BehaviorProfile = { ...shyProfile(c), summary: "Juno is combative and picks fights.", reactionTendencies: { confront: 90, deflect: 20, withdraw: 10, comfort: 10, joke: 20, investigate: 40, act: 60, cooperate: 15 } };
    const d = await call(c, p, "Juno isn't aggressive. They stand firm when someone is treated unfairly, but they never start fights.");
    expect(d.profile.reactionTendencies.confront).toBeLessThan(90);
  }, 120_000);

  it("refines speech style (Chinese feedback)", async () => {
    const c = juno();
    const d = await call(c, shyProfile(c), "虽然这个角色不擅长表达感情，但他并不冷漠。他会通过实际行动表达关心，说话简短但会偶尔开个冷笑话。", "zh-CN");
    expect(d.changes.some((x: { section: string }) => ["speech", "socialStyle", "summary", "emotionalPatterns"].includes(x.section))).toBe(true);
    expect(/[一-鿿]/.test(d.interpretation)).toBe(true);
    // Locked canon stays in the player's own words, even in a Chinese revision.
    if (JSON.stringify(shyProfile(c)).includes("Never breaks a promise")) expect(JSON.stringify(d.profile)).toContain("Never breaks a promise");
  }, 120_000);

  it("flags feedback that contradicts locked canon, and leaves it out when told to keep canon", async () => {
    const c = juno();
    const d = await call(c, shyProfile(c), "Juno breaks promises whenever it suits them.");
    expect(d.canonConflicts.length).toBeGreaterThan(0);
    expect(d.canonConflicts[0].field).toBe("rules");
    const kept = await call(c, shyProfile(c), "Juno breaks promises whenever it suits them.", "en", true);
    expect(kept.canonConflicts).toEqual([]);
  }, 200_000);
});
