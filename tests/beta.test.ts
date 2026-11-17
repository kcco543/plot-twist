import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/server/claude", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/server/claude")>();
  return { ...real, structuredCall: vi.fn() };
});

import { AiError, structuredCall } from "@/lib/ai/server/claude";
import { accessCodes, betaRequired, BETA_COOKIE, codeId, matchCode, signPass, verifyPass } from "@/lib/beta/token";
import { resetMemoryQuota } from "@/lib/ai/server/quota";
import { resetTalkLimits } from "@/lib/ai/server/limits";
import { POST as unlock } from "@/app/api/beta/unlock/route";
import { POST as turn } from "@/app/api/ai/turn/route";
import { POST as map } from "@/app/api/ai/map/route";
import { GET as status } from "@/app/api/ai/status/route";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";
import { juniper, rook } from "./helpers";
import { CHARACTER_TEXT_FIELDS } from "@/lib/types";

const mocked = vi.mocked(structuredCall);
const env = process.env as Record<string, string | undefined>;
const saved = { ...process.env };

const brief = (c: ReturnType<typeof juniper>) => ({ id: c.id, fields: Object.fromEntries(CHARACTER_TEXT_FIELDS.map((f) => [f, c[f]])), traits: c.traits, lockedFields: c.lockedFields, profile: null });
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
  recentLines: [],
};
const req = (url: string, body: unknown, cookie?: string, ip = "203.0.113.7") =>
  new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } });

async function getPass(ip = "203.0.113.7"): Promise<string> {
  const res = await unlock(req("http://x/api/beta/unlock", { code: "owl-lantern-42" }, undefined, ip));
  expect(res.status).toBe(200);
  const set = res.headers.get("set-cookie")!;
  expect(set).toContain("HttpOnly");
  expect(set).toContain("Secure");
  return set.split(";")[0];
}

beforeEach(() => {
  env.NODE_ENV = "production";
  env.BETA_ACCESS_CODES = "owl-lantern-42, second-code-99";
  env.ANTHROPIC_API_KEY = "sk-test-secret";
  delete env.BETA_OPEN;
  resetMemoryQuota();
  resetTalkLimits();
  mocked.mockReset();
  mocked.mockResolvedValue({ lines: [{ speaker: "narrator", text: "The street hums." }], memoryNote: "" });
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete env[k];
  Object.assign(process.env, saved);
});

describe("beta pass", () => {
  it("is required in production, optional in development without codes", () => {
    expect(betaRequired({ NODE_ENV: "production" })).toBe(true);
    expect(betaRequired({ NODE_ENV: "production", BETA_OPEN: "1" })).toBe(false);
    expect(betaRequired({ NODE_ENV: "development" })).toBe(false);
    expect(betaRequired({ NODE_ENV: "development", BETA_ACCESS_CODES: "abcdef" })).toBe(true);
  });
  it("ignores codes shorter than 6 characters", () => {
    expect(accessCodes({ BETA_ACCESS_CODES: "abc, longenough" })).toEqual(["longenough"]);
  });
  it("matches codes case-insensitively and rejects others", async () => {
    expect(await matchCode("OWL-LANTERN-42")).toBe("owl-lantern-42");
    expect(await matchCode("owl-lantern-4")).toBeNull();
  });
  it("rejects tampered, expired and revoked passes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = (await signPass({ t: "tester1", c: await codeId("owl-lantern-42"), i: now }))!;
    expect(await verifyPass(good)).toMatchObject({ t: "tester1" });
    const [body, sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "tester2", c: await codeId("owl-lantern-42"), i: now })).toString("base64url");
    expect(await verifyPass(`${forged}.${sig}`)).toBeNull();
    expect(await verifyPass(`${body}.${sig.slice(0, -2)}xx`)).toBeNull();
    const old = (await signPass({ t: "tester1", c: await codeId("owl-lantern-42"), i: now - 31 * 86400 }))!;
    expect(await verifyPass(old)).toBeNull();
    // Removing a code from BETA_ACCESS_CODES revokes the passes it gave out.
    const second = (await signPass({ t: "t3", c: await codeId("second-code-99"), i: now }))!;
    expect(await verifyPass(second, { ...process.env, BETA_ACCESS_CODES: "owl-lantern-42", BETA_COOKIE_SECRET: "x" })).toBeNull();
  });
});

describe("/api/beta/unlock", () => {
  it("never reveals the codes and limits wrong guesses per network", async () => {
    for (let i = 0; i < 8; i++) {
      const res = await unlock(req("http://x", { code: `wrong-${i}` }, undefined, "198.51.100.1"));
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain("owl");
    }
    const blocked = await unlock(req("http://x", { code: "owl-lantern-42" }, undefined, "198.51.100.1"));
    expect(blocked.status).toBe(429);
  }, 10_000);
  it("is closed when no codes are configured", async () => {
    env.BETA_ACCESS_CODES = "";
    expect((await unlock(req("http://x", { code: "anything" }))).status).toBe(503);
  });
});

describe("AI routes behind the beta", () => {
  it("refuse without a pass and never call the AI", async () => {
    const res = await turn(req("http://x/api/ai/turn", turnBody));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("beta_locked");
    expect(mocked).not.toHaveBeenCalled();
  });
  it("work with a pass, then stop at the daily allowance", async () => {
    env.BETA_TEXT_PER_DAY = "3";
    const cookie = await getPass();
    for (let i = 0; i < 3; i++) expect((await turn(req("http://x/api/ai/turn", turnBody, cookie))).status).toBe(200);
    const res = await turn(req("http://x/api/ai/turn", turnBody, cookie));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("quota");
    expect(mocked).toHaveBeenCalledTimes(3);
  });
  it("a fresh pass on the same network doesn't reset the allowance past 3x", async () => {
    env.BETA_TEXT_PER_DAY = "1";
    for (let i = 0; i < 3; i++) expect((await turn(req("http://x/api/ai/turn", turnBody, await getPass()))).status).toBe(200);
    expect((await turn(req("http://x/api/ai/turn", turnBody, await getPass()))).status).toBe(429);
  });
  it("the site-wide limit stops everyone", async () => {
    env.BETA_TEXT_DAILY_LIMIT = "2";
    expect((await turn(req("http://x/api/ai/turn", turnBody, await getPass("192.0.2.1"), "192.0.2.1"))).status).toBe(200);
    expect((await turn(req("http://x/api/ai/turn", turnBody, await getPass("192.0.2.2"), "192.0.2.2"))).status).toBe(200);
    const res = await turn(req("http://x/api/ai/turn", turnBody, await getPass("192.0.2.3"), "192.0.2.3"));
    expect(res.status).toBe(429);
  });
  it("gives the allowance back when nothing reached the provider", async () => {
    env.BETA_TEXT_PER_DAY = "1";
    const cookie = await getPass();
    mocked.mockRejectedValueOnce(new AiError("billing", "The Anthropic account has no credits left"));
    const failed = await turn(req("http://x/api/ai/turn", turnBody, cookie));
    expect(failed.status).toBe(402);
    // Public builds never echo provider details.
    expect((await failed.json()).message).not.toMatch(/Anthropic/);
    expect((await turn(req("http://x/api/ai/turn", turnBody, cookie))).status).toBe(200);
  });
  it("image generation is off by default in the beta, even with a pass and a key", async () => {
    env.OPENAI_API_KEY = "sk-test-openai";
    const res = await map(req("http://x/api/ai/map", { description: "a quiet harbour", type: "street", world: null }, await getPass()));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("ai_off");
  });
  it("status reports AI off until unlocked, and never leaks keys", async () => {
    const locked = await (await status(new Request("http://x"))).json();
    expect(locked).toMatchObject({ text: false, image: false, beta: { required: true, unlocked: false, textAvailable: true } });
    const cookie = await getPass();
    const open = await status(new Request("http://x", { headers: { cookie } }));
    const text = await open.text();
    expect(JSON.parse(text)).toMatchObject({ text: true, beta: { unlocked: true, allowance: { text: 60, images: 0 } } });
    expect(text).not.toContain("sk-test");
  });
});

describe("middleware", () => {
  it("blocks AI routes without a pass and hides development tools", async () => {
    expect((await middleware(new NextRequest("http://x/api/ai/talk", { method: "POST" }))).status).toBe(401);
    expect((await middleware(new NextRequest("http://x/api/ai/status"))).status).toBe(200);
    expect((await middleware(new NextRequest("http://x/dev/usage"))).status).toBe(404);
    expect((await middleware(new NextRequest("http://x/api/dev/usage"))).status).toBe(404);
    const cookie = await getPass();
    const ok = await middleware(new NextRequest("http://x/api/ai/talk", { method: "POST", headers: { cookie } }));
    expect(ok.status).toBe(200);
    expect(cookie.startsWith(`${BETA_COOKIE}=`)).toBe(true);
  });
});
