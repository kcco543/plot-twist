// Proves the spending guard runs before any request: node --test scripts/art-test/budget.test.mjs
// Uses a stub network (ART_TEST_FAKE_FETCH=1) and a throwaway output folder; no real API call is possible here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { APPROVED, EST, assertWithinBudget } from "./budget.mjs";

const script = path.join(path.dirname(new URL(import.meta.url).pathname), "generate.mjs");
const refs = path.join(path.dirname(new URL(import.meta.url).pathname), "refs");

test("guard allows a call that fits and blocks one that could pass the limits", () => {
  assert.doesNotThrow(() => assertWithinBudget({ calls: 0, usd: 0 }, "1536x1024"));
  assert.throws(() => assertWithinBudget({ calls: APPROVED.calls, usd: 0 }, "1536x1024"), /approved calls/);
  assert.throws(() => assertWithinBudget({ calls: 0, usd: APPROVED.usd - EST["1024x1024"] + 0.01 }, "1024x1024"), /approved total/);
  assert.throws(() => assertWithinBudget({ calls: 0, usd: APPROVED.usd - EST["1536x1024"] - 0.01 }, "1536x1024", APPROVED, 3), /approved total/);
  assert.throws(() => assertWithinBudget({ calls: 0, usd: 0 }, "2048x2048"), /No cost estimate/);
});

function runBatch(batch, ledger) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "art-test-"));
  if (ledger) fs.writeFileSync(path.join(out, "ledger.json"), JSON.stringify(ledger));
  fs.writeFileSync(path.join(out, "window-closed.png"), "x");
  let code = 0;
  try {
    execFileSync(process.execPath, [script, "--batch", batch, "--run"], { env: { ...process.env, OPENAI_API_KEY: "test-not-a-key", ART_TEST_FAKE_FETCH: "1", ART_TEST_OUT: out }, stdio: "pipe" });
  } catch (e) {
    code = e.status;
  }
  const log = path.join(out, "requests.log");
  const requests = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
  const after = JSON.parse(fs.readFileSync(path.join(out, "ledger.json"), "utf8"));
  return { code, requests, after };
}

test("no request is sent once the approved calls are used up", () => {
  const r = runBatch("window-open", { calls: APPROVED.calls, usd: 0, log: [] });
  assert.equal(r.code, 2);
  assert.equal(r.requests, 0);
  assert.equal(r.after.calls, APPROVED.calls);
});

test("no request is sent when the next call could pass the dollar limit", () => {
  const r = runBatch("window-open", { calls: 0, usd: APPROVED.usd - 0.05, log: [] });
  assert.equal(r.code, 2);
  assert.equal(r.requests, 0);
});

test("a call within the limits is sent once and counted", () => {
  const r = runBatch("window-open", null);
  assert.equal(r.code, 0);
  assert.equal(r.requests, 1);
  assert.equal(r.after.calls, 1);
});

test("a batch stops mid-way at the limit (room batch with one call left sends exactly one)", { skip: !fs.existsSync(path.join(refs, "02-indoor.png")) && "needs the concept images in refs/" }, () => {
  const r = runBatch("room", { calls: APPROVED.calls - 1, usd: 0, log: [] });
  assert.equal(r.code, 2);
  assert.equal(r.requests, 1);
  assert.equal(r.after.calls, APPROVED.calls);
});
