import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveVerifierFallbackDecision,
  programmaticVerify,
  validateEvidenceSufficiency,
} from "../../src/background/orchestrator/verifier";
import { ToolName } from "../../src/types";

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

  test("fallback skips reroute for blocked output when executor completed", () => {
    const decision = deriveVerifierFallbackDecision({
      taskQuery: "Summarize page",
      objective: "Summarize this page",
      successCriteria: "Page summarized",
      output: "Page not found — this is a 404 error page.",
      executorOutcome: "completed",
    });
    // Should NOT reroute — "not found" is page content, not failure
    expect(decision.decision).not.toBe("reroute");
  });

  test("accepts with low confidence when executor completed but verifier LLM failed", () => {
    const decision = deriveVerifierFallbackDecision({
      taskQuery: "Summarize page",
      objective: "Summarize this page",
      successCriteria: "Page summarized",
      output: "This is a blog about cooking recipes with 12 posts visible.",
      executorOutcome: "completed",
    });
    expect(decision.decision).toBe("accept");
    expect(decision.confidence).toBeGreaterThanOrEqual(0.5);
    expect(decision.reason).toContain("answer-aligned");
  });

  test("does not retry completed checkout-style steps without deterministic evidence", () => {
    const decision = deriveVerifierFallbackDecision({
      taskQuery: "Complete checkout",
      objective: "Place the order",
      successCriteria: "Order confirmation is visible",
      output: "Filled the form fields and reviewed the page.",
      executorOutcome: "completed",
    });
    expect(decision.decision).toBe("accept");
    expect(decision.reason).toContain("replay side effects");
    expect(decision.confidence).toBeLessThan(0.5);
  });

  test("uses programmatic success evidence before fallback accept", () => {
    const decision = deriveVerifierFallbackDecision({
      taskQuery: "Complete checkout",
      objective: "Place the order",
      successCriteria: "Order confirmation is visible",
      output: "Completed successfully and verified the order confirmation.",
      executorOutcome: "completed",
      evidence: [
        {
          claim: "Order confirmation page became visible",
          basis: "tool_output",
          confidence: 0.92,
        },
      ],
      previousUrl: "https://example.com/checkout",
      currentUrl: "https://example.com/confirmation",
      previousTitle: "Checkout",
      currentTitle: "Order Confirmed",
    });
    expect(decision.decision).toBe("accept");
    expect(decision.reason).toContain("DOM change");
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
  test("accepts when required typed evidence is sufficient", () => {
    const result = programmaticVerify({
      output: "Configured and submitted.",
      objective: "Create a ServiceNow incident",
      successCriteria: "Record submitted",
      requiredEvidenceTypes: ["submit_succeeded", "record_identity_observed"],
      evidence: [
        {
          event: {
            type: "submit_succeeded",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt: "2026-05-01T00:00:00.000Z",
            supportsTaskGoal: true,
          },
        },
        {
          event: {
            type: "record_identity_observed",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt: "2026-05-01T00:00:00.000Z",
            supportsTaskGoal: true,
            detail: { recordNumber: "INC0010001" },
          },
        },
      ],
    });

    expect(result?.decision).toBe("accept");
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("validateEvidenceSufficiency reports missing and conflict events", () => {
    const result = validateEvidenceSufficiency(
      ["submit_succeeded", "record_identity_observed"],
      [
        {
          event: {
            type: "submit_succeeded",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt: "2026-05-01T00:00:00.000Z",
            supportsTaskGoal: true,
          },
        },
        {
          event: {
            type: "uncertainty_detected",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt: "2026-05-01T00:00:00.000Z",
            supportsTaskGoal: false,
          },
        },
      ],
    );

    expect(result.sufficient).toBe(false);
    expect(result.missing).toEqual(["record_identity_observed"]);
    expect(result.conflicts).toHaveLength(1);
  });

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

  test("does not retry completed read-only summaries just because page content mentions errors", () => {
    const result = programmaticVerify({
      output:
        "TICKET-4271 has been read and analyzed. The issue is that CSV export fails with a Request Timeout error after 30 seconds. Status is Open and priority is High.",
      objective: "Read and analyze TICKET-4271 to determine if escalation is needed",
      successCriteria:
        "Ticket details visible including title CSV Export Timeout, description, current status, and priority level",
      evidence: [
        {
          claim:
            "TICKET-4271 details were read: CSV Export Timeout, status Open, priority High.",
          basis: "tool_output",
          confidence: 1,
        },
      ],
      previousUrl: "https://example.com/support-ticket",
      currentUrl: "https://example.com/support-ticket",
      executorOutcome: "completed",
    });
    expect(result?.decision).not.toBe("retry");
  });

  test("returns accept for success + URL change", () => {
    const result = programmaticVerify({
      output: "Successfully completed the checkout process",
      objective: "Finish checkout",
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
      objective: "Add item to cart",
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

  test("returns accept for explicit order confirmation details without DOM change", () => {
    const result = programmaticVerify({
      output:
        "Successfully purchased the first item. Order confirmed with order number ORD-12345 for $79.99.",
      objective: "Purchase the first item in the store tab",
      successCriteria: "Purchase confirmation or order complete for first item",
      previousUrl: "https://example.com/store",
      currentUrl: "https://example.com/store",
      previousTitle: "TechDirect",
      currentTitle: "TechDirect",
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("accept");
    expect(result!.reason).toContain("explicit completion evidence");
  });

  test("returns accept for explicit new-tab creation details without DOM change", () => {
    const result = programmaticVerify({
      output:
        "Successfully opened the second item's store in a new tab. The new tab (ID: 1727714004) contains the OfficeHub store URL.",
      objective: "Open the second item's store in a new tab",
      successCriteria: "New tab opened with store URL for second procurement item",
      previousUrl: "https://example.com/procurement",
      currentUrl: "https://example.com/procurement",
      previousTitle: "Procurement List",
      currentTitle: "Procurement List",
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("accept");
    expect(result!.reason).toContain("explicit completion evidence");
  });

  test("returns accept for trusted ServiceNow form submit evidence", () => {
    const result = programmaticVerify({
      output: "Trusted ServiceNow form helper submitted record CHG0000021.",
      objective:
        "Create a new change request and submit the form after setting the requested fields.",
      successCriteria:
        "The form submission completes and a created record, confirmation, or resulting item page is visible.",
      requiredEvidenceTypes: ["submit_succeeded", "record_identity_observed"],
      evidence: [
        {
          event: {
            type: "submit_succeeded",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt: "2026-05-01T00:00:00.000Z",
            supportsTaskGoal: true,
            detail: { recordNumber: "CHG0000021" },
          },
        },
        {
          event: {
            type: "record_identity_observed",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt: "2026-05-01T00:00:00.000Z",
            supportsTaskGoal: true,
            detail: { recordNumber: "CHG0000021" },
          },
        },
      ],
      previousUrl:
        "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/change_request.do",
      currentUrl:
        "https://workarenapublic16.service-now.com/now/nav/ui/classic/params/target/change_request.do",
      previousTitle: "Create CHG0041411 | Change Request | ServiceNow",
      currentTitle: "Create CHG0041412 | Change Request | ServiceNow",
      executorOutcome: "completed",
    });

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("accept");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
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

  test("skips blocked markers when executor completed successfully", () => {
    const result = programmaticVerify({
      output: "This is a Page not found page with a support guide link.",
      successCriteria: "Page summarized",
      executorOutcome: "completed",
    });
    expect(result).toBeNull(); // Falls through to LLM verification
  });

  test("blocked markers still fire when executor did not complete", () => {
    const result = programmaticVerify({
      output: "Page not found, access denied",
      successCriteria: "Form submitted",
      executorOutcome: "stopped",
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("reroute");
  });

  test("error with success marker does not short-circuit to retry", () => {
    // When both error and success markers present, success takes priority
    // for DOM-change accept path
    const result = programmaticVerify({
      output: "Error occurred but task completed successfully",
      objective: "Complete the task",
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

  test("does not accept success plus DOM change when output contradicts the target step", () => {
    const result = programmaticVerify({
      output: "Completed successfully. Verified Warehouse Gamma page 3 is visible.",
      objective: "Navigate to Warehouse Beta page 2",
      successCriteria: "Warehouse Beta page 2 visible",
      previousUrl: "https://example.com/go-back?step=1",
      currentUrl: "https://example.com/go-back?step=3",
      previousTitle: "Warehouse Alpha",
      currentTitle: "Warehouse Gamma",
    });
    expect(result).toBeNull();
  });
});
