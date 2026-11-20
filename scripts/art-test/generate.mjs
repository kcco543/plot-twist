// Lantern Room asset test: generate source art with the app's image model.
//
// SAFE BY DEFAULT: without --run it only prints the plan and the estimated cost.
// Hard limits: 40 calls and $10 in total across all runs (tracked in out/ledger.json).
// The key is read from the environment; it is never printed or written anywhere.
//
//   node --env-file=.env.local scripts/art-test/generate.mjs --batch room            # dry run
//   node --env-file=.env.local scripts/art-test/generate.mjs --batch room --run      # real calls
//   ... --batch unlit --from scripts/art-test/out/room-probe-2.png --run             # edits an earlier output
//
// Batches, in order: room, window, unlit, turnaround, sprite, expressions (sprite/expressions need --from per character: add --only mira).
import fs from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import { JOBS } from "./prompts.mjs";

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
const QUALITY = "high";
const LIMIT_CALLS = 40;
const LIMIT_USD = 10;
// High-side per-image estimates (pricing pages disagree; see the plan doc). Measured cost is logged from usage tokens.
const EST = { "1024x1024": 0.21, "1536x1024": 0.17, "1024x1536": 0.17 };
const RATE = { textIn: 5 / 1e6, imageIn: 8 / 1e6, imageOut: 30 / 1e6 };

const dir = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(dir, "out");
const refsDir = path.join(dir, "refs");
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const run = process.argv.includes("--run");
const batch = arg("batch");
const only = arg("only");
const from = arg("from");

const jobs = JOBS.filter((j) => (!batch || j.batch === batch) && (!only || j.id.startsWith(only)));
if (!jobs.length) { console.error("No jobs match. Use --batch room|window|unlit|turnaround|sprite|expressions [--only mira]."); process.exit(1); }
if (jobs.some((j) => j.from) && !from) { console.error("This batch edits an earlier output: pass --from <png>."); process.exit(1); }

fs.mkdirSync(out, { recursive: true });
const ledgerPath = path.join(out, "ledger.json");
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : { calls: 0, usd: 0, log: [] };
const refs = fs.existsSync(refsDir) ? fs.readdirSync(refsDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).slice(0, 4) : [];

const est = jobs.reduce((s, j) => s + EST[j.size], 0);
console.log(`Model ${MODEL}, quality ${QUALITY}. ${jobs.length} call(s), estimated up to $${est.toFixed(2)}.`);
console.log(`Spent so far: ${ledger.calls} call(s), $${ledger.usd.toFixed(2)} of $${LIMIT_USD} / ${LIMIT_CALLS} calls.`);
for (const j of jobs) console.log(`  ${j.id.padEnd(24)} ${j.size} ${j.background}${j.refs ? ` + ${refs.length} style ref(s)` : ""}${j.from ? ` + ${path.basename(from)}` : ""}`);
if (ledger.calls + jobs.length > LIMIT_CALLS || ledger.usd + est > LIMIT_USD) { console.error("Stopping: this batch could pass the approved limits."); process.exit(1); }
if (!run) { console.log("\nDry run only. Add --run to make the calls."); process.exit(0); }
if (!process.env.OPENAI_API_KEY) { console.error("OPENAI_API_KEY is not set. Run with: node --env-file=.env.local ..."); process.exit(1); }

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 300_000, maxRetries: 0 });
const file = async (p) => toFile(fs.readFileSync(p), path.basename(p), { type: p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg" });

for (const j of jobs) {
  const inputs = [...(j.from ? [from] : []), ...(j.refs ? refs.map((f) => path.join(refsDir, f)) : [])];
  const params = { model: MODEL, prompt: j.prompt, size: j.size, quality: QUALITY, background: j.background, output_format: "png", n: 1 };
  const t0 = Date.now();
  const res = inputs.length
    ? await client.images.edit({ ...params, image: await Promise.all(inputs.map(file)) })
    : await client.images.generate(params);
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) { console.error(`${j.id}: no image returned`); continue; }
  fs.writeFileSync(path.join(out, `${j.id}.png`), Buffer.from(b64, "base64"));
  const u = res.usage ?? {};
  const det = u.input_tokens_details ?? {};
  const measured = (det.text_tokens ?? 0) * RATE.textIn + (det.image_tokens ?? 0) * RATE.imageIn + (u.output_tokens ?? 0) * RATE.imageOut;
  const cost = measured > 0 ? measured : EST[j.size];
  ledger.calls += 1;
  ledger.usd += cost;
  ledger.log.push({ id: j.id, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), usage: u, usd: Number(cost.toFixed(4)) });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  console.log(`${j.id}: saved, ~$${cost.toFixed(3)} (total $${ledger.usd.toFixed(2)}, ${ledger.calls} calls)`);
}
console.log(`\nDone. Images are in ${out}. Upload that folder (with ledger.json) to the thread.`);
