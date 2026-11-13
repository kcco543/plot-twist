import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/claude", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/claude")>();
  return { ...real, structuredCall: vi.fn() };
});

import { structuredCall } from "@/lib/ai/server/claude";
import { POST as turn } from "@/app/api/ai/turn/route";
import { POST as analyze } from "@/app/api/ai/analyze/route";
import { POST as sprite } from "@/app/api/ai/sprite/route";
import { GET as status } from "@/app/api/ai/status/route";
import { buildLocalProfile } from "@/lib/behavior/localAnalysis";
import { CHARACTER_TEXT_FIELDS } from "@/lib/types";
import { juniper, rook } from "./helpers";

const mocked = vi.mocked(structuredCall);
const brief = (c: ReturnType<typeof juniper>) => ({ id: c.id, fields: Object.fromEntries(CHARACTER_TEXT_FIELDS.map((f) => [f, c[f]])), traits: c.traits, lockedFields: c.lockedFields, profile: null });
const json = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const turnBody = {
  locale: "en",
  world: "otherworld",
  place: "street",
  placeDescription: "",
  beat: { kind: "event", type: "argument", reaction: "confront", approach: "direct", topic: null, outcome: null, moodBefore: "calm", moodAfter: "irritated", bondChange: "further", recalled: null },
  actor: brief(juniper()),
  other: brief(rook()),
  bond: { affinity: -6, trust: -2 },
  memories: [],
  recentLines: ["I'm not letting that slide, Rook."],
};

afterEach(() => {
  mocked.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe("/api/ai/status", () => {
  it("reports unconfigured services without leaking anything", async () => {
    const res = await status();
    expect(await res.json()).toEqual({ text: false, image: false, textModel: null, imageModel: null });
  });
  it("reports configured services by model name only", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-secret";
    const body = JSON.stringify(await (await status()).json());
    expect(body).toContain("claude-opus-5-5");
    expect(body).not.toContain("sk-test-secret");
  });
});

describe("/api/ai/turn validation", () => {
  it("drops unknown speakers and lines that repeat recent dialogue", async () => {
    mocked.mockResolvedValue({
      lines: [
        { speaker: "c-juniper", text: "I'm not letting that slide, Rook!" },
        { speaker: "someone-else", text: "I'm a new character the AI invented." },
        { speaker: "c-rook", text: "Then say what you actually mean." },
        { speaker: "narrator", text: "The street goes very quiet." },
      ],
      memoryNote: "Argued with Rook about honesty.",
    });
    const res = await turn(json(turnBody));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.lines.map((l: { speaker: string }) => l.speaker)).toEqual(["c-rook", "narrator"]);
  });

  it("rejects output that is all repeats so the game falls back to built-in lines", async () => {
    mocked.mockResolvedValue({ lines: [{ speaker: "c-juniper", text: "I'm not letting that slide, Rook." }], memoryNote: "" });
    const res = await turn(json(turnBody));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_output");
  });

  it("rejects malformed requests", async () => {
    const res = await turn(json({ ...turnBody, beat: { ...turnBody.beat, reaction: "explode" } }));
    expect(res.status).toBe(400);
  });

  it("returns 503 not_configured when no key is set", async () => {
    const real = await vi.importActual<typeof import("@/lib/ai/server/claude")>("@/lib/ai/server/claude");
    mocked.mockImplementation(real.structuredCall);
    const res = await turn(json(turnBody));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });
});

describe("/api/ai/analyze", () => {
  it("validates and clamps the AI profile", async () => {
    const p = buildLocalProfile(juniper(), "en");
    mocked.mockResolvedValue({ ...p, reactionTendencies: { ...p.reactionTendencies, confront: 250 } });
    const res = await analyze(json({ locale: "en", world: null, character: brief(juniper()), cast: [], mood: "calm", memories: [] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.profile.reactionTendencies.confront).toBe(100);
  });
});

describe("/api/ai/sprite upload checks", () => {
  const form = (bytes: ArrayLike<number>, type = "image/png") => {
    const f = new FormData();
    f.set("image", new Blob([new Uint8Array(bytes)], { type }), "x");
    return new Request("http://x", { method: "POST", body: f });
  };
  it("rejects files that aren't really PNG/JPG/WebP, whatever their type says", async () => {
    const res = await sprite(form(new TextEncoder().encode("<svg></svg>"), "image/png"));
    expect(res.status).toBe(415);
  });
  it("rejects files over 8 MB", async () => {
    const res = await sprite(form(new Uint8Array(8 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
  });
  it("says generation is unavailable when no image API is configured", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const res = await sprite(form(png));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });
});
