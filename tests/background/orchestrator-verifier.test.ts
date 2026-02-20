import { describe, expect, test } from "bun:test";
import "../setup";
import {
  deriveVerifierFallbackDecision,
  programmaticVerify,
} from "../../src/background/orchestrator/verifier";

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

describe("programmaticVerify", () => {
  test("returns reroute for blocked markers", () => {
    const result = programmaticVerify({
      output: "Page shows captcha verification required",
      successCriteria: "Form submitted",
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("reroute");
    expect(result!.failureType).toBe("blocked");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("returns retry for error + no DOM change", () => {
    const result = programmaticVerify({
      output: "Error: unable to locate the submit button",
      successCriteria: "Form submitted",
      previousUrl: "https://example.com/form",
      currentUrl: "https://example.com/form",
      previousTitle: "Form Page",
      currentTitle: "Form Page",
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("retry");
    expect(result!.failureType).toBe("transient");
  });

  test("returns accept for success + URL change", () => {
    const result = programmaticVerify({
      output: "Successfully completed the checkout process",
      successCriteria: "Checkout confirmed",
      previousUrl: "https://example.com/checkout",
      currentUrl: "https://example.com/confirmation",
      previousTitle: "Checkout",
      currentTitle: "Order Confirmed",
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("accept");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test("returns accept for success + structured evidence", () => {
    const result = programmaticVerify({
      output: "Task completed successfully",
      successCriteria: "Item added to cart",
      evidence: [
        {
          claim: "Item added to cart successfully",
          basis: "tool_output",
          confidence: 0.9,
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("accept");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test("returns null for ambiguous output", () => {
    const result = programmaticVerify({
      output: "Clicked the button and waited for the page to update",
      successCriteria: "Form submitted",
      previousUrl: "https://example.com/form",
      currentUrl: "https://example.com/form",
    });
    expect(result).toBeNull();
  });

  test("returns null for empty output", () => {
    const result = programmaticVerify({
      output: "",
      successCriteria: "Something done",
    });
    expect(result).toBeNull();
  });

  test("returns null for whitespace-only output", () => {
    const result = programmaticVerify({
      output: "   ",
      successCriteria: "Something done",
    });
    expect(result).toBeNull();
  });

  test("error with success marker does not short-circuit to retry", () => {
    // When both error and success markers present, success takes priority
    // for DOM-change accept path
    const result = programmaticVerify({
      output: "Error occurred but task completed successfully",
      successCriteria: "Task done",
      previousUrl: "https://example.com/start",
      currentUrl: "https://example.com/done",
    });
    // The blocked check runs first but doesn't match. Error markers present
    // but success markers also present, so the error-only check won't match.
    // Then success + DOM change → accept.
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("accept");
  });
});
