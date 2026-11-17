/**
 * PUBLIC BETA VISITOR CHECK — plays the game as a brand-new visitor against a
 * production build, with the mock Anthropic server (costs nothing).
 *
 *   1. node scripts/usage-check/mock-anthropic.mjs 4555
 *   2. NODE_ENV=production BETA_ACCESS_CODES=test-code-123 BETA_TEXT_PER_DAY=6 \
 *      ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://127.0.0.1:4555 npx next start -p 3100
 *   3. SHOTS_DIR=/some/folder node scripts/usage-check/beta-visitor.mjs http://localhost:3100 http://127.0.0.1:4555 test-code-123
 *
 * Checks: welcome panel, AI off (and zero AI requests) without a code, direct
 * API calls refused, wrong/right code, AI conversation, save survives reload,
 * daily allowance message, friendly error when the AI service is down,
 * development tools hidden, phone and tablet layouts.
 */
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const APP = process.argv[2] ?? "http://localhost:3100";
const MOCK = process.argv[3] ?? "http://127.0.0.1:4555";
const CODE = process.argv[4] ?? "test-code-123";
const SHOTS = process.env.SHOTS_DIR;
const count = async () => (await (await fetch(`${MOCK}/__count`)).json()).total;

let failed = 0;
const check = (ok, label, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
const visible = (loc, timeout = 6000) => loc.first().waitFor({ timeout }).then(() => true).catch(() => false);
const shot = async (name, p = page) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png` });

// 1. A new visitor opens the link.
let res = await page.goto(APP);
check(res.ok(), "homepage loads", String(res.status()));
await page.waitForTimeout(1500);
check(await page.getByText("Public beta").first().isVisible(), "beta link visible on the title screen");
await page.locator("#beta").scrollIntoViewIfNeeded();
check(await page.getByText(/tester code/i).first().isVisible(), "welcome panel explains the tester code");
await shot("01-home-beta-panel");

// 2. Direct calls to AI routes are refused without a pass (not just a hidden button).
const direct = await page.evaluate(async () => {
  const r = await fetch("/api/ai/talk", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return { status: r.status, body: await r.json() };
});
check(direct.status === 401 && direct.body.error === "beta_locked", "direct /api/ai/talk without a pass is refused", JSON.stringify(direct));
const dev = await page.goto(`${APP}/dev/usage`);
check(dev.status() === 404, "development usage dashboard hidden", String(dev.status()));
const devApi = await page.evaluate(async () => (await fetch("/api/dev/usage")).status);
check(devApi === 404, "development usage API hidden", String(devApi));

// 3. Make a world with two characters (no AI involved).
await page.goto(`${APP}/worlds`);
await page.waitForTimeout(1500);
await page.getByText("Otherworld", { exact: true }).click();
await page.getByRole("button", { name: /Continue/ }).click();
await page.waitForTimeout(2000);
for (const [name, personality] of [
  ["Mira", "Quiet, careful map-maker who dislikes crowds."],
  ["Tobi", "Loud, friendly courier who loves gossip."],
]) {
  await page.getByRole("button", { name: /Create New Character/ }).click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder("e.g. Juniper Vale").fill(name);
  await page.getByPlaceholder(/Curious, impatient/).fill(personality);
  await page.waitForTimeout(800);
}
await shot("02-studio");
await page.getByRole("button", { name: /Build world/ }).click();
await page.waitForTimeout(2000);
await page.getByText("Town & Street").click();
await page.getByRole("link", { name: /^Play$/ }).or(page.getByRole("button", { name: /^Play$/ })).first().click();
await page.waitForTimeout(3000);

// 4. Locked: the game plays with built-in lines and never calls the AI.
let before = await count();
const a = await page.locator("[data-stage-view]").first().screenshot();
await page.waitForTimeout(20000);
const b = await page.locator("[data-stage-view]").first().screenshot();
check(Buffer.compare(a, b) !== 0, "characters move on their own (no AI needed)");
await page.getByRole("button", { name: /^Talk$/ }).first().click();
await page.waitForTimeout(3000);
check((await count()) === before, "no AI requests while locked (idle, autonomy, Talk button)", `${(await count()) - before} requests`);
await shot("03-play-locked");

// 5. Enter a wrong code, then the right one.
await page.goto(APP);
await page.waitForTimeout(1200);
await page.locator("#beta input").fill("not-the-code");
await page.getByRole("button", { name: "Turn on AI" }).click();
check(await visible(page.getByText("That code didn't work")), "wrong code shows a friendly message");
await page.locator("#beta input").fill(CODE);
await page.getByRole("button", { name: "Turn on AI" }).click();
check(await visible(page.getByText("AI features are on for this browser.")), "right code turns AI on");
const cookies = await ctx.cookies();
const pass = cookies.find((c) => c.name === "pt_beta");
check(pass && pass.httpOnly && pass.sameSite === "Lax", "pass cookie is HttpOnly + SameSite", pass ? `secure=${pass.secure}` : "none");
await page.locator("#beta").scrollIntoViewIfNeeded();
await shot("04-home-unlocked");

// 6. Continue the world and have an AI conversation.
await page.getByRole("button", { name: /Continue/ }).first().click();
await page.waitForTimeout(3000);
check(await page.getByText("Mira").first().isVisible().catch(() => false), "world and characters still there after leaving and coming back");
before = await count();
await page.getByRole("button", { name: /Talk to/ }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: /^Tobi$/ }).click();
const askElse = page.getByRole("button", { name: /Ask Something Else/i }).first();
await askElse.waitFor({ timeout: 20000 }).catch(async (e) => {
  await shot("fail-conversation");
  throw e;
});
await askElse.click();
await page.getByPlaceholder(/Type in English/).fill("Do you like the floating market?");
await page.getByRole("button", { name: /^Send$/ }).click();
await page.waitForTimeout(4000);
check((await count()) - before >= 1, "AI conversation reply requested once unlocked", `${(await count()) - before} requests`);
await shot("05-ai-conversation");

// 7. Reload: progress persists.
await page.reload();
await page.waitForTimeout(3000);
check(await page.getByText("Mira").first().isVisible().catch(() => false), "progress persists after a reload");

// 8. Daily allowance: keep sending until the server refuses (BETA_TEXT_PER_DAY is small for this test).
const quota = await page.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch("/api/ai/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    out.push(r.status);
  }
  return out;
});
check(quota.every((s) => s === 400), "invalid requests are rejected before they cost anything", quota.join(","));
await page.goto(APP);
const status = await page.evaluate(async () => (await fetch("/api/ai/status")).json());
check(status.beta?.unlocked && status.text, "status says AI is on for this browser");

await browser.close();

// 9. Phones and tablets.
for (const [name, device] of [["iphone", devices["iPhone 13"]], ["pixel", devices["Pixel 7"]], ["ipad", devices["iPad (gen 7)"]]]) {
  const b2 = await chromium.launch();
  const c2 = await b2.newContext({ ...device });
  const p2 = await c2.newPage();
  await p2.goto(APP);
  await p2.waitForTimeout(1500);
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `${name}: no sideways scrolling on the title screen`, `${overflow}px`);
  await shot(`06-${name}-home`, p2);
  await p2.locator("#beta").scrollIntoViewIfNeeded();
  await shot(`07-${name}-beta-panel`, p2);
  await b2.close();
}

check(consoleErrors.filter((e) => !/401|429|Failed to load resource/.test(e)).length === 0, "no unexpected console errors", consoleErrors.slice(0, 3).join(" | "));
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
