import { describe, expect, test } from "bun:test";
import "../setup";
import { deriveVerifierFallbackDecision } from "../../src/background/orchestrator/verifier";

describe("Orchestrator verifier fallback", () => {
  test("returns accept for clearly successful output", () => {
    const decision = deriveVerifierFallbackDecision({
      taskQuery: "Find the price",
      objective: "Read product price",
      successCriteria: "Price text is extracted",
      output: "Completed successfully. Verified the product price is $19.99.",
    });

    expect(decision.decision).toBe("accept");
    expect(typeof decision.confidence).toBe("number");
    expect(decision.failureType).toBeUndefined();
  });

  test("returns reroute for blocked output", () => {
    const decision = deriveVerifierFallbackDecision({
      taskQuery: "Submit form",
      objective: "Submit checkout form",
      successCriteria: "Checkout submitted",
      output: "Access denied. Request blocked by anti-bot captcha.",
    });

    expect(decision.decision).toBe("reroute");
    expect(typeof decision.rerouteObjective).toBe("string");
    expect(decision.failureType).toBe("blocked");
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  test("returns retry when output is inconclusive", () => {
    const decision = deriveVerifierFallbackDecision({
      taskQuery: "Apply filter",
      objective: "Filter products by price",
      successCriteria: "Filtered list is visible",
      output: "Clicked some controls but not sure it worked.",
    });

    expect(decision.decision).toBe("retry");
    expect(decision.failureType).toBe("insufficient_evidence");
  });
});
