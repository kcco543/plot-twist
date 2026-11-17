import { describe, expect, it } from "vitest";
import { isBillingError } from "@/lib/ai/server/image";

describe("image service errors", () => {
  it("tells running out of credits apart from a rate limit", () => {
    expect(isBillingError({ status: 429, code: "insufficient_quota", message: "You exceeded your current quota" })).toBe(true);
    expect(isBillingError({ status: 429, code: "credit_balance_exhausted", message: "" })).toBe(true);
    expect(isBillingError({ status: 400, code: "billing_hard_limit_reached", message: "Billing hard limit has been reached" })).toBe(true);
    expect(isBillingError({ status: 402 })).toBe(true);
    expect(isBillingError({ status: 429, code: "rate_limit_exceeded", message: "Rate limit reached for requests" })).toBe(false);
  });
});
