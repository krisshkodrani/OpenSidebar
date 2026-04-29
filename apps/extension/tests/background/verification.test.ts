import { describe, test, expect } from "vitest";
import "../setup";
import {
  assessDoneSummary,
  assessWorkflowDoneGuard,
  checkSummaryStepCoherence,
  checkVerificationGate,
  detectAdmission,
} from "../../src/background/agent/verification";
import type { VerificationGate } from "../../src/background/orchestrator/types";

describe("checkVerificationGate", () => {
  test("returns matched=false when no gate provided", () => {
    const result = checkVerificationGate(["some result"], undefined);
    expect(result.matched).toBe(false);
    expect(result.evidence).toBe("");
  });

  test("returns matched=false when gate is null", () => {
    const result = checkVerificationGate(["some result"], null);
    expect(result.matched).toBe(false);
  });

  test("matches via regex pattern", () => {
    const gate: VerificationGate = {
      trigger: "code accepted",
      action: "call_done",
      pattern: "Code\\s+accepted",
    };
    const result = checkVerificationGate(
      ["Error: not found", "Code accepted! Your submission was correct."],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("Code accepted");
  });

  test("matches via substring when no regex pattern", () => {
    const gate: VerificationGate = {
      trigger: "successfully submitted",
      action: "advance_step",
    };
    const result = checkVerificationGate(
      ["Form successfully submitted. Redirecting..."],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("successfully submitted");
  });

  test("matches via substring with multiple trigger phrases", () => {
    const gate: VerificationGate = {
      trigger: "order confirmed, payment received, checkout complete",
      action: "call_done",
    };
    const result = checkVerificationGate(
      ["Thank you! Your payment received."],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("payment received");
  });

  test("returns matched=false when no trigger matches", () => {
    const gate: VerificationGate = {
      trigger: "task completed",
      action: "call_done",
    };
    const result = checkVerificationGate(
      ["Clicked button", "Page loaded"],
      gate,
    );
    expect(result.matched).toBe(false);
  });

  test("falls back to substring match on invalid regex", () => {
    const gate: VerificationGate = {
      trigger: "code accepted",
      action: "call_done",
      pattern: "[invalid(regex",
    };
    const result = checkVerificationGate(
      ["The code accepted by the system"],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("code accepted");
  });

  test("matches URL-based trigger when currentUrl is provided", () => {
    const gate: VerificationGate = {
      trigger: "URL contains /step6",
      action: "call_done",
    };
    // Tool results don't mention /step6, but the current URL does
    const result = checkVerificationGate(
      ["Clicked submit button"],
      gate,
      "https://example.com/step6?version=2",
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("/step6");
  });

  test("URL-based regex pattern matches against currentUrl", () => {
    const gate: VerificationGate = {
      trigger: "navigate to step 6",
      action: "call_done",
      pattern: "/step6",
    };
    const result = checkVerificationGate(
      ["Form submitted"],
      gate,
      "https://example.com/step6?version=2",
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("/step6");
  });

  test("filters out short trigger phrases (<=3 chars)", () => {
    const gate: VerificationGate = {
      trigger: "ok, yes, successfully saved",
      action: "advance_step",
    };
    // "ok" and "yes" are <=3 chars, only "successfully saved" should be checked
    const result = checkVerificationGate(["Data ok"], gate);
    expect(result.matched).toBe(false);
  });
});

describe("assessDoneSummary", () => {
  // --- Layer 1: should BLOCK (confident: false) ---
  test("detects 'didn't update' as failure", () => {
    const r = assessDoneSummary(
      "Attempted to add to cart but cart count didn't update",
    );
    expect(r.confident).toBe(false);
  });

  test("detects 'not visible' as failure", () => {
    const r = assessDoneSummary("The item is not visible in the cart");
    expect(r.confident).toBe(false);
  });

  test("detects 'could not verify' as failure", () => {
    const r = assessDoneSummary("Could not verify the coupon was applied");
    expect(r.confident).toBe(false);
  });

  test("detects 'unable to' as failure", () => {
    const r = assessDoneSummary("Unable to complete the checkout step");
    expect(r.confident).toBe(false);
  });

  test("detects 'no change' as failure", () => {
    const r = assessDoneSummary("Clicked the button but no change occurred");
    expect(r.confident).toBe(false);
  });

  test("detects 'attempt failed' as failure", () => {
    const r = assessDoneSummary("The attempt failed to add the second item");
    expect(r.confident).toBe(false);
  });

  test("detects 'not added' as failure", () => {
    const r = assessDoneSummary("Second item not added to the cart");
    expect(r.confident).toBe(false);
  });

  test("detects 'error with' as failure", () => {
    const r = assessDoneSummary("There was an error with the form submission");
    expect(r.confident).toBe(false);
  });

  // --- Should PASS (confident: true) ---
  test("passes clean success summary", () => {
    const r = assessDoneSummary(
      "Added both items to cart and applied the coupon code",
    );
    expect(r.confident).toBe(true);
  });

  test("passes neutral summary", () => {
    const r = assessDoneSummary(
      "Completed checkout with express shipping selected",
    );
    expect(r.confident).toBe(true);
  });

  test("passes empty summary", () => {
    const r = assessDoneSummary("");
    expect(r.confident).toBe(true);
  });

  // --- Success override: hedged language should PASS ---
  test("success override: 'successfully added' overrides 'didn't update'", () => {
    const r = assessDoneSummary(
      "Successfully added the item to cart, though the counter didn't update visually",
    );
    expect(r.confident).toBe(true);
  });

  test("success override: 'has been applied' overrides 'not visible'", () => {
    const r = assessDoneSummary(
      "The coupon has been applied, discount not visible in total yet",
    );
    expect(r.confident).toBe(true);
  });

  test("success override: form fields filled with 'unable to' literal stays confident", () => {
    const r = assessDoneSummary(
      'All requested form fields have been successfully filled. Description: "Multiple employees have reported that they are unable to send/receive email."',
    );
    expect(r.confident).toBe(true);
  });

  test("does not treat non-failure 'unable to' field values as admission", () => {
    const r = assessDoneSummary(
      "Description is set to Multiple employees have reported that they are unable to send/receive email.",
    );
    expect(r.confident).toBe(true);
  });

  test("success override: 'is now in' overrides failure signal", () => {
    const r = assessDoneSummary(
      "Item is now in the cart, but cart count didn't update",
    );
    expect(r.confident).toBe(true);
  });

  test("success override: 'done the step' overrides failure signal", () => {
    const r = assessDoneSummary(
      "Done this step, though no confirmation was visible",
    );
    expect(r.confident).toBe(true);
  });

  // --- Pure failure without success override stays blocked ---
  test("failure without override: 'cart count didn't update' stays blocked", () => {
    const r = assessDoneSummary(
      "The cart count didn't update after clicking add",
    );
    expect(r.confident).toBe(false);
  });
});

describe("assessWorkflowDoneGuard", () => {
  test("rejects chart pages without an extracted value", () => {
    const result = assessWorkflowDoneGuard({
      query: "Tell me the value shown in the incident chart.",
      summary: "The incident chart page is open and visible.",
      selectedSkillId: "chart-value-extraction",
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("concrete extracted value");
  });

  test("allows chart summaries with a concrete value", () => {
    const result = assessWorkflowDoneGuard({
      query: "Tell me the value shown in the incident chart.",
      summary: "The chart value for Critical incidents is 12.",
      selectedSkillId: "chart-value-extraction",
    });
    expect(result.blocked).toBe(false);
  });

  test("rejects single chart answers with supporting numeric details", () => {
    const result = assessWorkflowDoneGuard({
      query:
        'What is the value of "IBM" in the "Configuration Item by Manufacturer" chart (in percent)?',
      summary:
        'The percentage value for "IBM" is 2.76% based on 54 items out of 1,953 total.',
      selectedSkillId: "chart-value-extraction",
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("one numeric answer");
  });

  test("allows chart max answers with a label and one count", () => {
    const result = assessWorkflowDoneGuard({
      query:
        'What is the maximum value in the "Unanswered Questions by Assigned User" chart? Give me both the label and the count. If there are many, pick one.',
      summary: "Alva Pennigton: 21",
      selectedSkillId: "chart-value-extraction",
    });
    expect(result.blocked).toBe(false);
  });

  test("rejects chart max answers that include tie and axis numbers", () => {
    const result = assessWorkflowDoneGuard({
      query:
        'What is the maximum value in the "Unanswered Questions by Assigned User" chart? Give me both the label and the count. If there are many, pick one.',
      summary:
        "Alva Pennigton has 21, tied with Bess Marso at 21; the chart shows 8 users and an axis range of 0-22.",
      selectedSkillId: "chart-value-extraction",
    });
    expect(result.blocked).toBe(true);
  });

  test("allows dashboard answers that explicitly request multiple numbers", () => {
    const result = assessWorkflowDoneGuard({
      query:
        "Get the Open Tickets number from the support dashboard and the Active Campaigns number from the marketing dashboard, then tell me both numbers.",
      summary: "Open Tickets: 12. Active Campaigns: 8.",
      selectedSkillId: "chart-value-extraction",
    });
    expect(result.blocked).toBe(false);
  });

  test("rejects opened knowledge articles without the requested answer", () => {
    const result = assessWorkflowDoneGuard({
      query:
        "Search the knowledge base and answer the password reset question.",
      summary: "Opened the relevant KB article.",
      selectedSkillId: "search-answer-extraction",
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("requested answer");
  });

  test("allows knowledge summaries that provide the answer", () => {
    const result = assessWorkflowDoneGuard({
      query:
        "Search the knowledge base and answer the password reset question.",
      summary:
        "The article says users should reset the password from Account Settings.",
      selectedSkillId: "search-answer-extraction",
    });
    expect(result.blocked).toBe(false);
  });

  test("rejects filter builder opened without applied filter", () => {
    const result = assessWorkflowDoneGuard({
      query: "Filter the incident list to show priority 1 records.",
      summary: "The filter builder is open and ready.",
      selectedSkillId: "list-filter-workflow",
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("filter to be applied");
  });

  test("allows applied list filters", () => {
    const result = assessWorkflowDoneGuard({
      query: "Filter the incident list to show priority 1 records.",
      summary: "The priority 1 filter is applied and the results updated.",
      selectedSkillId: "list-filter-workflow",
    });
    expect(result.blocked).toBe(false);
  });

  test("rejects list opened without verified sort state", () => {
    const result = assessWorkflowDoneGuard({
      query: "Sort the incident list by Updated descending.",
      summary: "The incident list is open and visible.",
      selectedSkillId: "list-sort-workflow",
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("verified sort state");
  });

  test("allows verified list sort state", () => {
    const result = assessWorkflowDoneGuard({
      query: "Sort the incident list by Updated descending.",
      summary: "The incident list is sorted by Updated in descending order.",
      selectedSkillId: "list-sort-workflow",
    });
    expect(result.blocked).toBe(false);
  });

  test("rejects catalog detail pages without request confirmation", () => {
    const result = assessWorkflowDoneGuard({
      query: "Order a standard laptop from the service catalog.",
      summary:
        "The catalog item detail page is open with configuration options visible.",
      selectedSkillId: "catalog-order-workflow",
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("confirmation evidence");
  });

  test("allows catalog request confirmations", () => {
    const result = assessWorkflowDoneGuard({
      query: "Order a standard laptop from the service catalog.",
      summary:
        "The standard laptop request was submitted and confirmation REQ0012345 is visible.",
      selectedSkillId: "catalog-order-workflow",
    });
    expect(result.blocked).toBe(false);
  });
});

describe("checkSummaryStepCoherence", () => {
  const shopSteps = [
    "Add Novablast 4 to cart",
    "Add CloudStrike 8 to cart",
    "Apply coupon SAVE10",
    "Checkout",
  ];

  test("blocks when summary mentions wrong step's distinctive token", () => {
    const r = checkSummaryStepCoherence({
      summary: "Novablast 4 successfully added to cart",
      currentStepIndex: 1, // CloudStrike step
      stepDescriptions: shopSteps,
    });
    expect(r.coherent).toBe(false);
    expect(r.reason).toContain("novablast");
    expect(r.reason).toContain("step 1");
  });

  test("passes when summary matches current step", () => {
    const r = checkSummaryStepCoherence({
      summary: "CloudStrike 8 added to cart successfully",
      currentStepIndex: 1,
      stepDescriptions: shopSteps,
    });
    expect(r.coherent).toBe(true);
  });

  test("passes when current step has no distinctive tokens", () => {
    // "Checkout" → tokenizeStepText returns ["checkout"], which is unique
    // Use a step that shares all its tokens
    const steps = ["Click next button", "Click submit button", "Verify result"];
    const r = checkSummaryStepCoherence({
      summary: "Clicked the button",
      currentStepIndex: 0,
      stepDescriptions: steps,
    });
    // "click" and "button" are stopwords, "next"/"submit" are distinctive
    // but summary doesn't mention "next" either — however current step has distinctive "next"
    // and summary doesn't have it, but also no wrong-step token → coherent
    expect(r.coherent).toBe(true);
  });

  test("passes for single-step plan", () => {
    const r = checkSummaryStepCoherence({
      summary: "Done with everything",
      currentStepIndex: 0,
      stepDescriptions: ["Add item to cart"],
    });
    expect(r.coherent).toBe(true);
  });

  test("passes for negative step index", () => {
    const r = checkSummaryStepCoherence({
      summary: "Wrong step",
      currentStepIndex: -1,
      stepDescriptions: shopSteps,
    });
    expect(r.coherent).toBe(true);
  });

  test("passes when summary mentions current step AND wrong step", () => {
    // If summary mentions both, it has current step tokens → pass
    const r = checkSummaryStepCoherence({
      summary: "CloudStrike 8 added. Previously added Novablast 4.",
      currentStepIndex: 1,
      stepDescriptions: shopSteps,
    });
    expect(r.coherent).toBe(true);
  });

  test("blocks coupon summary on cart step", () => {
    const r = checkSummaryStepCoherence({
      summary: "Applied coupon SAVE10 successfully",
      currentStepIndex: 0, // Novablast step
      stepDescriptions: shopSteps,
    });
    expect(r.coherent).toBe(false);
    expect(r.reason).toContain("step 3"); // coupon is step index 2 → "step 3"
  });
});

describe("detectAdmission", () => {
  test("detects success admission: task completed", () => {
    const result = detectAdmission(
      "The task completed successfully. All steps are done.",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("success");
    expect(result!.match).toContain("task completed");
  });

  test("detects success admission: code accepted", () => {
    const result = detectAdmission(
      "I can see that the code accepted by the system.",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("success");
  });

  test("detects success admission: has been submitted", () => {
    const result = detectAdmission("The form has been submitted successfully.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("success");
  });

  test("detects failure admission: I'm unable to find", () => {
    const result = detectAdmission(
      "I'm unable to find the element on the page.",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("failure");
  });

  test("detects failure admission: I cannot locate", () => {
    const result = detectAdmission("I cannot locate the submit button.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("failure");
  });

  test("detects failure admission: I've exhausted all", () => {
    const result = detectAdmission("I've exhausted all possible approaches.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("failure");
  });

  test("returns null for normal reasoning text", () => {
    const result = detectAdmission(
      "I need to click the submit button and then verify the form was sent.",
    );
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = detectAdmission("");
    expect(result).toBeNull();
  });

  test("returns null for tool-planning text", () => {
    const result = detectAdmission(
      "Next I will scroll down and look for the checkout form.",
    );
    expect(result).toBeNull();
  });
});
