// Lantern Room asset test: generate source art with the app's image model.
//
// SAFE BY DEFAULT: without --run it only prints the plan and the estimated cost.
// Before EVERY request, budget.mjs checks the approved limits (calls and dollars, counted across all runs
// in out/ledger.json). If one more call could pass them, the script stops without calling.
// Each call is counted at its high-side estimate BEFORE it is sent, then corrected to the measured cost.
// The key is read from the environment (your local .env.local); it is never printed or written anywhere.
//
//   node --env-file=.env.local scripts/art-test/generate.mjs --batch room                # dry run
//   node --env-file=.env.local scripts/art-test/generate.mjs --batch room --run          # 2 room concepts
//   node --env-file=.env.local scripts/art-test/generate.mjs --batch window-closed --run
//   node --env-file=.env.local scripts/art-test/generate.mjs --batch window-open --run   # edits window-closed.png
import fs from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import { JOBS } from "./prompts.mjs";
import { APPROVED, assertWithinBudget, estimateFor, measuredCost } from "./budget.mjs";

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
const QUALITY = "high";

const dir = path.dirname(new URL(import.meta.url).pathname);
const out = process.env.ART_TEST_OUT || path.join(dir, "out");
const refsDir = path.join(dir, "refs");
const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const run = process.argv.includes("--run");
const batch = arg("batch");

const jobs = JOBS.filter((j) => j.batch === batch);
if (!jobs.length) {
  console.error(`No jobs for --batch ${batch}. Batches: ${[...new Set(JOBS.map((j) => j.batch))].join(", ")}.`);
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
const ledgerPath = path.join(out, "ledger.json");
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : { calls: 0, usd: 0, log: [] };
const save = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
const inputsOf = (j) => [...(j.from ? [path.join(out, j.from)] : []), ...(j.refs ?? []).map((f) => path.join(refsDir, f))];

const est = jobs.reduce((s, j) => s + estimateFor(j.size, inputsOf(j).length), 0);
console.log(`Model ${MODEL}, quality ${QUALITY}. This batch: ${jobs.length} call(s), estimated up to $${est.toFixed(2)}.`);
console.log(`Approved limit: ${APPROVED.calls} calls / $${APPROVED.usd.toFixed(2)}. Used so far: ${ledger.calls} call(s), $${ledger.usd.toFixed(2)}.`);
for (const j of jobs) console.log(`  ${j.id.padEnd(18)} ${j.size} up to $${estimateFor(j.size, inputsOf(j).length).toFixed(2)} ${j.background.padEnd(11)} inputs: ${inputsOf(j).map((p) => path.basename(p)).join(", ") || "none"}`);
const missing = jobs.flatMap(inputsOf).filter((p) => !fs.existsSync(p));
if (missing.length) {
  console.error(`Missing input file(s): ${missing.map((p) => path.relative(process.cwd(), p)).join(", ")}`);
  process.exit(1);
}
if (!run) {
  console.log("\nDry run only: nothing was sent. Add --run to make the calls.");
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set. Run with: node --env-file=.env.local ...");
  process.exit(1);
}

// ART_TEST_FAKE_FETCH=1 swaps the network for a stub that records each request (used by budget.test.mjs).
const fakeFetch =
  process.env.ART_TEST_FAKE_FETCH === "1"
    ? async (url, init) => {
        if (!String(url).startsWith("http")) return fetch(url, init); // SDK-internal data: URLs, not API requests
        fs.appendFileSync(path.join(out, "requests.log"), `request ${String(url).slice(0, 80)}\n`);
        return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }), { headers: { "content-type": "application/json" } });
      }
    : undefined;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 300_000, maxRetries: 0, ...(fakeFetch ? { fetch: fakeFetch } : {}) });
const file = async (p) => toFile(fs.readFileSync(p), path.basename(p), { type: p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg" });

for (const j of jobs) {
  try {
    assertWithinBudget(ledger, j.size, APPROVED, inputsOf(j).length); // before every request, never after
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const inputs = inputsOf(j);
  const reserve = estimateFor(j.size, inputs.length);
  const params = { model: MODEL, prompt: j.prompt, size: j.size, quality: QUALITY, background: j.background, output_format: "png", n: 1 };
  const t0 = Date.now();
  // Reserve the high-side estimate first, so a crash mid-request can never let a later run go over.
  ledger.calls += 1;
  ledger.usd += reserve;
  save();
  const res = inputs.length ? await client.images.edit({ ...params, image: await Promise.all(inputs.map(file)) }) : await client.images.generate(params);
  const cost = measuredCost(res.usage, j.size, inputs.length);
  ledger.usd += cost - reserve;
  ledger.log.push({ id: j.id, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), usage: res.usage ?? null, usd: Number(cost.toFixed(4)) });
  save();
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) {
    console.error(`${j.id}: no image returned (still counted)`);
    continue;
  }
  fs.writeFileSync(path.join(out, `${j.id}.png`), Buffer.from(b64, "base64"));
  console.log(`${j.id}: saved, ~$${cost.toFixed(3)} (total $${ledger.usd.toFixed(2)}, ${ledger.calls} of ${APPROVED.calls} calls)`);
}
console.log(`\nDone. Images and ledger.json are in ${out}. Upload that folder to the thread.`);
