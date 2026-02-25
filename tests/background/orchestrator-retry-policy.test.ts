import { describe, expect, test } from "vitest";

import { decideRetryPolicy } from "../../src/background/orchestrator/retry-policy";

describe("Orchestrator retry policy", () => {
  test("fails fast for blocked reasons", () => {
    const decision = decideRetryPolicy(
      {
        source: "verifier",
        reason: "Access denied by captcha wall",
      },
      0,
    );

    expect(decision.retryClass).toBe("blocked");
    expect(decision.maxRetries).toBe(0);
    expect(decision.shouldRetry).toBe(false);
  });

  test("treats drift/stale as state mismatch with no direct retries", () => {
    const decision = decideRetryPolicy(
      {
        source: "verifier",
        reason: "State diverged from expected flow",
        driftDetected: true,
        staleSignalCount: 1,
      },
      0,
    );

    expect(decision.retryClass).toBe("state_mismatch");
    expect(decision.maxRetries).toBe(0);
    expect(decision.shouldRetry).toBe(false);
  });

  test("allows bounded retries for transient executor failures", () => {
    const first = decideRetryPolicy(
      {
        source: "executor",
        errorMessage: "Request timed out with connection reset",
      },
      0,
    );
    const second = decideRetryPolicy(
      {
        source: "executor",
        errorMessage: "Request timed out with connection reset",
      },
      1,
    );
    const third = decideRetryPolicy(
      {
        source: "executor",
        errorMessage: "Request timed out with connection reset",
      },
      2,
    );

    expect(first.retryClass).toBe("transient");
    expect(first.shouldRetry).toBe(true);
    expect(second.shouldRetry).toBe(true);
    expect(third.shouldRetry).toBe(false);
  });

  test("uses verifier failure taxonomy over text heuristics", () => {
    const decision = decideRetryPolicy(
      {
        source: "verifier",
        reason: "Generic failure message",
        failureType: "blocked",
        confidence: 0.9,
      },
      0,
    );

    expect(decision.retryClass).toBe("blocked");
    expect(decision.shouldRetry).toBe(false);
  });

  test("allows one extra retry for low-confidence inconclusive verdicts", () => {
    const first = decideRetryPolicy(
      {
        source: "verifier",
        reason: "Not enough evidence",
        failureType: "insufficient_evidence",
        confidence: 0.2,
      },
      0,
    );
    const second = decideRetryPolicy(
      {
        source: "verifier",
        reason: "Not enough evidence",
        failureType: "insufficient_evidence",
        confidence: 0.2,
      },
      1,
    );
    const third = decideRetryPolicy(
      {
        source: "verifier",
        reason: "Not enough evidence",
        failureType: "insufficient_evidence",
        confidence: 0.2,
      },
      2,
    );

    expect(first.retryClass).toBe("inconclusive");
    expect(first.shouldRetry).toBe(true);
    expect(second.shouldRetry).toBe(true);
    expect(third.shouldRetry).toBe(false);
  });
});
