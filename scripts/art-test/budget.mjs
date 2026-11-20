// The spending guard for the asset test. It runs BEFORE every API request:
// a request is only made if, after it, the total stays within the approved limits
// even if this call costs the high-side estimate. Limits only change with the person's approval.

/** Batch 1 limits, proposed 2026-11-20 for 2 room concepts + window closed/open. Raise only after the person approves a new budget. */
export const APPROVED = { calls: 4, usd: 1.5 };

/** High-side per-image estimates for gpt-image-2.5-flare at high quality (pricing pages disagree; see the plan doc). */
export const EST = { "1024x1024": 0.21, "1536x1024": 0.17, "1024x1536": 0.17 };

/** Reserve per input image (concept references, or an earlier output being edited): input-image tokens, high side. */
export const EST_PER_INPUT = 0.05;
export const estimateFor = (size, inputs = 0) => (EST[size] === undefined ? undefined : EST[size] + inputs * EST_PER_INPUT);

/** Throws (and so blocks the request) if one more call of this size could pass the limits. */
export function assertWithinBudget(ledger, size, limits = APPROVED, inputs = 0) {
  const est = estimateFor(size, inputs);
  if (est === undefined) throw new Error(`No cost estimate for size ${size}: refusing to call.`);
  if (ledger.calls + 1 > limits.calls) throw new Error(`Budget stop: ${ledger.calls} of ${limits.calls} approved calls already used.`);
  if (ledger.usd + est > limits.usd + 1e-9) throw new Error(`Budget stop: $${ledger.usd.toFixed(2)} spent, this call could cost up to $${est.toFixed(2)}, approved total is $${limits.usd.toFixed(2)}.`);
}

/** Cost of a finished call from its reported usage tokens; falls back to the estimate when usage is missing. */
export function measuredCost(usage, size, inputs = 0) {
  const RATE = { textIn: 5 / 1e6, imageIn: 8 / 1e6, imageOut: 30 / 1e6 };
  const det = usage?.input_tokens_details ?? {};
  const m = (det.text_tokens ?? 0) * RATE.textIn + (det.image_tokens ?? 0) * RATE.imageIn + (usage?.output_tokens ?? 0) * RATE.imageOut;
  return m > 0 ? m : estimateFor(size, inputs);
}
