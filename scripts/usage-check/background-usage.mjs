/**
 * BACKGROUND USAGE CHECK — proves (or disproves) that idle screens, walking
 * and character autonomy make no Anthropic requests, and counts the requests
 * that player actions make. Uses the mock Anthropic server, so it costs nothing.
 *
 *   1. node scripts/usage-check/mock-anthropic.mjs 4555
 *   2. ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://127.0.0.1:4555 AI_USAGE_DASHBOARD=1 npx next start -p 3100
 *      (or `next dev`)
 *   3. node scripts/usage-check/background-usage.mjs http://localhost:3100 http://127.0.0.1:4555 [idleSeconds]
 *
 * Prints one line per scenario with the number of Anthropic requests it caused,
 * then a JSON summary. Exits 1 if an idle scenario caused any request.
 */
import { createRequire } from "node:module";

// Playwright is not a project dependency: install it once with `npm i -D playwright` (or use a global install).
const { chromium } = createRequire(import.meta.url)("playwright");

const APP = process.argv[2] ?? "http://localhost:3100";
const MOCK = process.argv[3] ?? "http://127.0.0.1:4555";
const IDLE_MS = Number(process.argv[4] ?? 45) * 1000;
const SHOTS = process.env.SHOTS_DIR;

const count = async () => (await (await fetch(`${MOCK}/__count`)).json()).total;
const results = [];
let failed = false;

async function scenario(name, fn, { expectZero = false } = {}) {
  const before = await count();
  const t0 = Date.now();
  const note = await fn();
  const n = (await count()) - before;
  const secs = Math.round((Date.now() - t0) / 1000);
  results.push({ scenario: name, anthropicRequests: n, seconds: secs, ...(note ? { note } : {}) });
  const bad = expectZero && n > 0;
  if (bad) failed = true;
  console.log(`${bad ? "FAIL" : "ok  "}  ${name.padEnd(46)} ${String(n).padStart(2)} request(s) in ${secs}s${note ? `  (${note})` : ""}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
await scenario("1. Homepage idle", async () => {
  await page.goto(APP);
  await page.waitForTimeout(IDLE_MS);
  await shot("1-home");
}, { expectZero: true });

// Make a world with two characters (no AI involved).
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

await scenario("2. Character Studio idle", async () => {
  await page.waitForTimeout(IDLE_MS);
  await shot("2-studio");
}, { expectZero: true });

await page.getByRole("button", { name: /Build world/ }).click();
await page.waitForTimeout(2000);
await page.getByText("Town & Street").click();
await page.getByRole("link", { name: /^Play$/ }).or(page.getByRole("button", { name: /^Play$/ })).first().click();
await page.waitForTimeout(3000);

await scenario("3+4. Play Mode idle, characters act on their own", async () => {
  await shot("3-play-start");
  const a = await page.locator("[data-stage-view]").first().screenshot();
  await page.waitForTimeout(IDLE_MS * 2);
  const b = await page.locator("[data-stage-view]").first().screenshot();
  await shot("3-play-after-idle");
  return Buffer.compare(a, b) === 0 ? "stage did not change" : "stage changed while idle (characters moved/animated)";
}, { expectZero: true });

await scenario("Story button: Observe (Balanced = built-in)", async () => {
  await page.getByRole("button", { name: /^Observe$/ }).click();
  await page.waitForTimeout(3000);
});

await scenario("Story button: Talk, pressed twice quickly", async () => {
  await page.getByRole("button", { name: /^Talk$/ }).first().dblclick();
  await page.waitForTimeout(4000);
  return "expect 1 request: the second press is ignored while the first is running";
});

await scenario("5+6. Start a conversation, send one message", async () => {
  await page.getByRole("button", { name: /Talk to/ }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Tobi$/ }).click();
  // Walk over, face each other, topics appear.
  const askElse = page.getByRole("button", { name: /Ask Something Else/i }).first();
  await askElse.waitFor({ timeout: 20000 });
  await shot("5-conversation-open");
  await askElse.click();
  await page.getByPlaceholder(/Type in English/).fill("Do you like the floating market?");
  await page.getByRole("button", { name: /^Send$/ }).click();
  await page.getByRole("button", { name: /End conversation/i }).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot("6-reply");
});

await scenario("7. Finish the conversation", async () => {
  const end = page.getByRole("button", { name: /End conversation/i }).first();
  if (await end.isVisible().catch(() => false)) await end.click();
  else return "no End conversation button found";
  await page.waitForTimeout(5000);
  await shot("7-ended");
}, { expectZero: true });

await scenario("8. Refresh the page, then idle", async () => {
  await page.reload();
  await page.waitForTimeout(IDLE_MS);
  await shot("8-after-refresh");
}, { expectZero: true });

await scenario("Usage dashboard open, idle", async () => {
  await page.goto(`${APP}/dev/usage`);
  await page.waitForTimeout(Math.min(IDLE_MS, 15000));
  await shot("9-dashboard");
}, { expectZero: true });

await browser.close();
console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
