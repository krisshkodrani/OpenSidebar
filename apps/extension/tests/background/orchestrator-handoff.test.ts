import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildAssumptionDriftSignal,
  buildExecutorParallelContext,
  buildExecutorInstruction,
  buildTaskStateBrief,
  buildVerifierContext,
  compactExecutorSummaryForNode,
  createRerouteNode,
  formatHandoffBrief,
  isVerificationTurnQuery,
  shouldUseVerificationTurnMode,
} from "../../src/background/orchestrator/handoff";
import { TaskNode } from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";

function makeNode(handoffArtifacts: TaskNode["handoffArtifacts"]): TaskNode {
  return {
    id: "node-1",
    role: "executor",
    description: "Fill checkout form",
    successCriteria: "Checkout form submitted",
    allowedTools: [ToolName.READ_PAGE, ToolName.TYPE_TEXT, ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts,
    reflexionLog: [],
    handoffDepth: 0,
    status: "pending",
    retries: 0,
  };
}

describe("Orchestrator handoff briefing", () => {
  test("formats recent artifacts into compact brief", () => {
    const brief = formatHandoffBrief([
      {
        role: "planner",
        phase: "planned",
        note: "Planner assigned objective: fill checkout form",
        timestamp: 1,
      },
      {
        role: "verifier",
        phase: "verifier_retry",
        note: "Submit button was clicked but success banner was not observed.",
        timestamp: 2,
      },
    ]);

    expect(brief).toContain("Planner (planner)");
    expect(brief).toContain("Verifier retry (verifier)");
  });

  test("injects handoff context into executor instruction", () => {
    const node = makeNode([
      {
        role: "planner",
        phase: "planned",
        note: "Start on shipping details step.",
        timestamp: 1,
      },
      {
        role: "executor",
        phase: "executor_finished",
        note: "Address completed, payment step pending.",
        timestamp: 2,
      },
    ]);
    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("Objective: Fill checkout form");
    expect(instruction).toContain("Success criteria: Checkout form submitted");
    expect(instruction).toContain("Handoff context:");
    expect(instruction).toContain("Planner assumptions (validate against current page before acting):");
    expect(instruction).toContain("Execution policy:");
    expect(instruction).toContain("Executor result (executor): Address completed");
    expect(instruction).toContain(
      "complete every requirement stated in the Objective and Success criteria",
    );
    expect(instruction).toContain(
      "do not call done() while an explicit requested step remains unfinished",
    );
  });

  test("propagates root answer and nondisclosure requirements to a decomposed worker", () => {
    const instruction = buildExecutorInstruction(
      makeNode([]),
      undefined,
      undefined,
      undefined,
      "Export the overdue record IDs and do not disclose unrelated records.",
    );

    expect(instruction).toContain(
      "Root response contract (applies across every decomposed step):",
    );
    expect(instruction).toContain(
      "Before an action replaces a view containing facts requested by the original user",
    );
    expect(instruction).toContain(
      "even when this node's local objective only asks you to navigate",
    );
    expect(instruction).toContain("Root-answer evidence:");
    expect(instruction).toContain(
      "do not disclose unrelated records",
    );
    expect(instruction).toContain("verified prior-step evidence");
  });

  test("omits empty task-state and reality sections from executor instruction", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(node);

    expect(instruction).not.toContain("Step-scoped task context:");
    expect(instruction).not.toContain("Reality check signal:");
  });

  test("includes task-state and reality sections when they are meaningful", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(
      node,
      "Completed / prior steps:\n- [completed] Add item to cart :: Cart updated",
      "Potential plan-reality drift: 1 assumption unmatched.",
    );

    expect(instruction).toContain("Step-scoped task context:");
    expect(instruction).toContain("Completed / prior steps:");
    expect(instruction).toContain("Reality check signal:");
    expect(instruction).toContain("Potential plan-reality drift");
  });

  test("injects environment-neutral parallel worker context", () => {
    const node = makeNode([]);
    node.parallelContract = {
      parallelism: "resource_bound",
      siblingAwareness: "summary",
      resourceHints: [
        {
          kind: "url",
          key: "alpha.example/dashboard",
          access: "read",
          confidence: 0.95,
          source: "repair",
        },
      ],
    };

    const sibling = makeNode([]);
    sibling.id = "node-2";
    sibling.description = "Read beta dashboard";
    sibling.status = "running";
    sibling.parallelContract = {
      parallelism: "independent",
      siblingAwareness: "summary",
      resourceHints: [
        {
          kind: "origin",
          key: "beta.example",
          access: "read",
          confidence: 0.9,
          source: "repair",
        },
      ],
    };

    const parallelContext = buildExecutorParallelContext({
      node,
      allNodes: [node, sibling],
      workerIndex: 1,
    });
    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      parallelContext,
    );

    expect(instruction).toContain("Parallel work context:");
    expect(instruction).toContain("worker index 1");
    expect(instruction).toContain("url:alpha.example/dashboard");
    expect(instruction).toContain("node-2 [running]: Read beta dashboard");
    expect(instruction).toContain("origin:beta.example");
    expect(instruction).not.toContain("tabId");
  });

  test("injects selected workflow skill into executor instruction", () => {
    const node = makeNode([]);
    node.selectedSkillId = "structured-form-fill";
    node.selectedSkillReason =
      "Task requires disciplined multi-field form entry before submission.";

    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("Selected workflow skill:");
    expect(instruction).toContain("structured-form-fill");
    expect(instruction).toContain("Skill procedure:");
    expect(instruction).toContain("call get_profile_fields for exact needed facts");
    expect(instruction).toContain("Skill evidence requirements:");
    expect(instruction).toContain("Skill execution contract:");
    expect(instruction).toContain("Sequence to preserve:");
    expect(instruction).toContain("Completion checks:");
    expect(instruction).toContain("Failure recovery rules:");
  });

  test("CRM ticket skill maps escalation to urgent priority when needed", () => {
    const node = makeNode([]);
    node.description =
      "Review TICKET-4271, escalate it if needed, and add an internal note";
    node.successCriteria =
      "Ticket escalation state and internal note are visible after save";
    node.selectedSkillId = "crm-ticket-update";
    node.selectedSkillReason =
      "Task requires reviewing customer impact and updating ticket fields.";

    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("Selected workflow skill:");
    expect(instruction).toContain("crm-ticket-update");
    expect(instruction).toContain("set it to Urgent");
    expect(instruction).toContain("escalation-equivalent field");
  });

  test("uses compact skill guidance for list-detail review loops", () => {
    const node = makeNode([]);
    node.description = "Review job listing #1";
    node.successCriteria = "Listing reviewed and returned to results";
    node.selectedSkillId = "list-detail-review-loop";
    node.selectedSkillReason =
      "Task requires repeated list-detail-return review without exploratory navigation.";

    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("Selected workflow skill:");
    expect(instruction).toContain("list-detail-review-loop");
    expect(instruction).toContain("Skill operating brief:");
    expect(instruction).toContain("visible listings as the candidate set");
    expect(instruction).toContain("Capture only fit-critical facts");
    expect(instruction).toContain("final recommendation can be synthesized from evidence");
    expect(instruction).not.toContain("Skill procedure:");
    expect(instruction).not.toContain("Skill evidence requirements:");
  });

  test("uses compact skill guidance for multi-tab checklist workflows", () => {
    const node = makeNode([]);
    node.description = "Buy the first procurement item and mark it complete";
    node.successCriteria = "Purchase confirmed and the checklist row is checked off";
    node.selectedSkillId = "multi-tab-checklist-workflow";
    node.selectedSkillReason =
      "Task requires repeating a checklist workflow across store tabs: open, purchase, return, and mark complete.";

    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("Selected workflow skill:");
    expect(instruction).toContain("multi-tab-checklist-workflow");
    expect(instruction).toContain("Skill operating brief:");
    expect(instruction).toContain("Open or reuse the matching target page in another tab");
    expect(instruction).toContain("Switch back to the source tab and mark or record only the completed item");
    expect(instruction).toContain(
      "Treat source-page progress markers, reviewed badges, counters, or row-complete state as sufficient evidence",
    );
    expect(instruction).not.toContain("Skill procedure:");
  });

  test("uses synthesis-first guidance for cross-tab compare", () => {
    const node = makeNode([]);
    node.description = "Compare the reviewed job listings and recommend the best matches";
    node.successCriteria = "Best matches identified with reasons";
    node.selectedSkillId = "cross-tab-compare";
    node.selectedSkillReason =
      "Task requires comparing facts gathered from multiple reviewed targets.";

    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("Selected workflow skill:");
    expect(instruction).toContain("cross-tab-compare");
    expect(instruction).toContain("Skill operating brief:");
    expect(instruction).toContain(
      "Use previously gathered step results and notes as the primary evidence source",
    );
    expect(instruction).toContain(
      "Avoid browser-history navigation or page hopping unless a specific target is still missing evidence.",
    );
    expect(instruction).not.toContain("Skill procedure:");
  });

  test("compacts list-detail executor summaries into short fit facts", () => {
    const compact = compactExecutorSummaryForNode(
      {
        description: "Review job listing #1",
        selectedSkillId: "list-detail-review-loop",
        result: undefined,
        error: undefined,
      },
      "Reviewed Senior Frontend Engineer at Nextera Tech. Hybrid role in Berlin with salary $150k-$180k. React, TypeScript, and GraphQL stack. Returned to listings after reading the description.",
    );

    expect(compact).toContain("Review job listing #1");
    expect(compact).toContain("location=hybrid");
    expect(compact).toContain("salary=$150k-$180k");
    expect(compact).toContain("stack=React/TypeScript/GraphQL");
    expect(compact).toContain("returned to listings");
    expect(compact.length).toBeLessThanOrEqual(220);
  });

  test("adds saved-profile policy when current step can use profile fields", () => {
    const node = makeNode([]);
    node.allowedTools = [
      ToolName.READ_PAGE,
      ToolName.GET_PROFILE_FIELDS,
      ToolName.TYPE_TEXT,
      ToolName.DONE,
    ];

    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      "Complete checkout using saved profile fields for full name and email",
      "Use my saved profile for checkout. identity.first_name, identity.last_name, identity.email.",
    );

    expect(instruction).toContain("PROFILE DATA POLICY:");
    expect(instruction).toContain("get_profile_fields");
    expect(instruction).toContain("Do not leave the current checkout or form page");
  });

  test("injects safe personal context separately from exact profile fields", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      "Review this job application",
      "Apply to this frontend job using my saved profile.",
      false,
      "PERSONAL CONTEXT:\n- professional_summary: Senior frontend engineer\n- job_preferences.remote: true",
    );

    expect(instruction).toContain("PERSONAL CONTEXT:");
    expect(instruction).toContain("professional_summary");
    expect(instruction).toContain("facts can fill exact matching fields");
    expect(instruction).toContain("JOB APPLICATION POLICY:");
  });

  test("preserves long job application original request literals", () => {
    const node = makeNode([]);
    const longAnswer = [
      "I care about Langfuse because it solves one of the most important practical problems in AI product engineering.",
      "",
      "My recent work has been focused on exactly this kind of problem space.",
      "",
      "FINAL_LITERAL_MARKER should remain visible after the normal compact-query cutoff.",
    ].join("\n");
    const originalQuery = [
      "Fill the application but dont send using these data",
      "| Field | Copy This |",
      "|---|---|",
      "| Name | Jordan Rivera |",
      "| Earliest Start Date | 2026-06-01 |",
      "",
      "## Why Do You Care About Langfuse?",
      "",
      longAnswer,
    ].join("\n");

    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      "Fill the job application fields",
      originalQuery,
    );

    expect(instruction).toContain("FINAL_LITERAL_MARKER");
    expect(instruction).toContain(
      "I care about Langfuse because it solves one of the most important practical problems in AI product engineering.\n\nMy recent work",
    );
    expect(instruction).toContain("preserve paragraph breaks and wording exactly");
  });

  test("adds Ashby-specific application policy for Ashby skill nodes", () => {
    const node = makeNode([]);
    node.selectedSkillId = "ashby-job-application-assistant";

    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      "Fill the Ashby application but do not submit",
      "Use the provided Why Do You Care About Langfuse answer exactly.",
    );

    expect(instruction).toContain("ASHBY APPLICATION POLICY:");
    expect(instruction).toContain("question-style labels as fields to fill");
    expect(instruction).toContain('read_element(attribute="value")');
    expect(instruction).toContain("Submit Application");
  });

  test("uses active plan objective override when provided", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      "Click the 'Add to cart' button next to Air Zoom Pegasus 41",
    );

    expect(instruction).toContain(
      "Objective: Click the 'Add to cart' button next to Air Zoom Pegasus 41",
    );
    expect(instruction).not.toContain("Objective: Fill checkout form");
    expect(instruction).toContain("Success criteria: Checkout form submitted");
  });

  test("detects verification follow-up queries", () => {
    expect(isVerificationTurnQuery("Did it work? What's the status now?")).toBe(
      true,
    );
    expect(isVerificationTurnQuery("Confirm the current status")).toBe(true);
    expect(
      isVerificationTurnQuery(
        "Fill in the email field, then click delete account and confirm the deletion.",
      ),
    ).toBe(false);
    expect(isVerificationTurnQuery("Click Save and continue")).toBe(false);
  });

  test("enables verification turn mode from follow-up wording", () => {
    expect(
      shouldUseVerificationTurnMode({
        originalQuery: "Confirm the current status",
      }),
    ).toBe(true);
    expect(
      shouldUseVerificationTurnMode({
        originalQuery: "Click Save and continue",
      }),
    ).toBe(false);
  });

  test("builds cross-node task state brief", () => {
    const nodes: TaskNode[] = [
      {
        id: "n1",
        role: "executor",
        description: "Collect shipping options",
        successCriteria: "Shipping methods are listed",
        allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "completed",
        retries: 0,
        result: "Found standard and express shipping.",
      },
      {
        id: "n2",
        role: "executor",
        description: "Apply discount code",
        successCriteria: "Discount is reflected in total",
        allowedTools: [ToolName.TYPE_TEXT, ToolName.CLICK_ELEMENT, ToolName.DONE],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "failed",
        retries: 1,
        error: "Coupon input rejected by site.",
      },
    ];

    const brief = buildTaskStateBrief(nodes, "n3", "verifier");
    expect(brief).toContain("[completed] Collect shipping options");
    expect(brief).toContain("[failed] Apply discount code");
  });

  test("builds executor task state brief without leaking future step details", () => {
    const nodes: TaskNode[] = [
      {
        id: "n1",
        role: "executor",
        description: "Add the item to the cart",
        successCriteria: "Item appears in cart",
        allowedTools: [ToolName.CLICK_ELEMENT, ToolName.DONE],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "completed",
        retries: 0,
        result: "Pegasus item added to cart.",
      },
      {
        id: "n2",
        role: "executor",
        description: "Apply SAVE10 and choose Express shipping",
        successCriteria: "Discount and shipping are selected",
        allowedTools: [ToolName.TYPE_TEXT, ToolName.CLICK_ELEMENT, ToolName.DONE],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "pending",
        retries: 0,
      },
      {
        id: "n3",
        role: "executor",
        description: "Fill checkout name and email",
        successCriteria: "Both fields are filled",
        allowedTools: [ToolName.TYPE_TEXT, ToolName.DONE],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "pending",
        retries: 0,
      },
    ];

    const brief = buildTaskStateBrief(nodes, "n-current", "executor");
    expect(brief).toContain("Completed / prior steps:");
    expect(brief).toContain("[completed] Add the item to the cart");
    expect(brief).toContain("Remaining future steps: 2");
    expect(brief).toContain(
      "Do NOT execute them until the current objective is verified complete.",
    );
    expect(brief).not.toContain("Apply SAVE10 and choose Express shipping");
    expect(brief).not.toContain("Fill checkout name and email");
  });

  test("builds rich comparison evidence context for cross-tab compare nodes", () => {
    const nodes: TaskNode[] = [
      {
        id: "n1",
        role: "executor",
        description: "Review job listing #1",
        successCriteria: "Listing reviewed",
        allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "completed",
        retries: 0,
        result:
          "Review job listing #1 :: location=remote; salary=$130K-$155K; stack=React/TypeScript/Frontend; returned to listings",
      },
      {
        id: "n2",
        role: "executor",
        description: "Review job listing #2",
        successCriteria: "Listing reviewed",
        allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
        dependencies: ["n1"],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "completed",
        retries: 0,
        result:
          "Review job listing #2 :: location=remote; salary=$140K; stack=Frontend; returned to listings",
      },
      {
        id: "n-compare",
        role: "executor",
        description: "Compare the reviewed job listings",
        successCriteria: "Best matches recommended",
        allowedTools: [ToolName.READ_PAGE, ToolName.UPDATE_NOTES, ToolName.DONE],
        dependencies: ["n2"],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "pending",
        retries: 0,
        selectedSkillId: "cross-tab-compare",
      },
    ];

    const brief = buildTaskStateBrief(
      nodes,
      "n-compare",
      "executor",
      nodes[2],
    );
    expect(brief).toContain("Completed comparison evidence:");
    expect(brief).toContain("Steps completed (2 total):");
    expect(brief).toContain("Review job listing #1");
    expect(brief).toContain("Review job listing #2");
  });

  test("builds verifier context with node and global handoff", () => {
    const node = makeNode([
      {
        role: "planner",
        phase: "planned",
        note: "Finalize checkout confirmation.",
        timestamp: 1,
      },
    ]);

    const context = buildVerifierContext(
      node,
      "- [completed] Prior node :: Captured billing details",
    );
    expect(context).toContain("Node handoff context:");
    expect(context).toContain("Global task context:");
    expect(context).toContain("Planner (planner): Finalize checkout confirmation.");
  });

  test("includes reduced skill verification contract for verifier", () => {
    const node = makeNode([]);
    node.selectedSkillId = "cross-tab-compare";

    const context = buildVerifierContext(node, "- [completed] Prior node :: Collected metrics");

    expect(context).toContain("Skill verification contract:");
    expect(context).toContain("Selected skill: cross-tab-compare");
    expect(context).toContain("Required evidence:");
    expect(context).toContain("Completion checks:");
    expect(context).toContain("Failure recovery:");
  });

  test("builds assumption drift signal when assumptions do not match snapshot", () => {
    const node = makeNode([]);
    node.assumptions = ["checkout confirmation visible", "order total present"];
    const signal = buildAssumptionDriftSignal(node, {
      title: "Product catalog",
      url: "https://shop.example.com/products",
      visibleContent: "Browse products and add to cart",
    });

    expect(signal).toContain("Potential plan-reality drift");
  });

  test("includes VERIFICATION CHECKPOINT when gate is present", () => {
    const node = makeNode([
      {
        role: "planner",
        phase: "planned",
        note: "Submit and verify",
        timestamp: 1,
      },
    ]);
    node.verificationGate = {
      trigger: "text 'Code accepted' visible",
      action: "call_done",
      pattern: "Code\\s+accepted",
    };
    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("VERIFICATION CHECKPOINT:");
    expect(instruction).toContain("text 'Code accepted' visible");
    expect(instruction).toContain("call done() immediately");
    expect(instruction).toContain("Do NOT continue executing");
  });

  test("adds verification-turn instructions for continuation follow-ups", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      undefined,
      "Did it work? What's the status now?",
      true,
    );

    expect(instruction).toContain("VERIFICATION TURN:");
    expect(instruction).toContain(
      "You must complete this turn using tool calls, not plain-text narration.",
    );
    expect(instruction).toContain('call done({"summary":"..."}) immediately');
    expect(instruction).toContain("Do not repeat the prior action");
  });

  test("compacts long original queries while preserving value-bearing literals", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      "Fill checkout using saved profile values",
      "Use my saved profile for checkout and keep the shipping speed unchanged. The name should stay John Doe, the email should be john.doe@example.com, and suggest Monday at 11 AM in the follow-up note. Also preserve the reference code \"SHIP-42\" while avoiding any unnecessary navigation. Add several extra descriptive sentences here so the full original request becomes much longer than the compact excerpt threshold and would otherwise bloat the executor prompt without adding more useful literals.",
    );

    expect(instruction).toContain("Original user request");
    expect(instruction).toContain("john.doe@example.com");
    expect(instruction).toContain("Monday at 11 AM");
    expect(instruction).toContain('"SHIP-42"');
    expect(instruction.length).toBeLessThan(2600);
  });

  test("preserves repeated whitespace inside quoted original request values", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(
      node,
      undefined,
      undefined,
      'Fill the form with Short description="Assessment : ATF Assessor".',
      'Create a new incident with a value of "Assessment :  ATF Assessor" for field "Short description".',
    );

    expect(instruction).toContain(
      'value of "Assessment :  ATF Assessor" for field "Short description"',
    );
  });

  test("includes advance_step action text for non-final gates", () => {
    const node = makeNode([]);
    node.verificationGate = {
      trigger: "URL contains /step3",
      action: "advance_step",
    };
    const instruction = buildExecutorInstruction(node);

    expect(instruction).toContain("VERIFICATION CHECKPOINT:");
    expect(instruction).toContain("advance to the next step");
  });

  test("omits VERIFICATION CHECKPOINT when no gate", () => {
    const node = makeNode([]);
    const instruction = buildExecutorInstruction(node);

    expect(instruction).not.toContain("VERIFICATION CHECKPOINT:");
  });

  test("creates a linked reroute node for handoff chaining", () => {
    const source = makeNode([
      {
        role: "verifier",
        phase: "verifier_reroute",
        note: "Site blocked checkout flow.",
        timestamp: 10,
      },
    ]);
    source.id = "node-source";
    source.handoffDepth = 1;

    const rerouted = createRerouteNode(
      source,
      "Complete checkout through alternate payment route",
      "Primary submit path blocked by anti-bot gate",
    );

    expect(rerouted.handoffFromNodeId).toBe("node-source");
    expect(rerouted.handoffDepth).toBe(2);
    expect(rerouted.dependencies).toEqual(["node-source"]);
    expect(rerouted.description).toContain("alternate payment route");
    expect(rerouted.handoffArtifacts[0].phase).toBe("verifier_reroute");
  });

  test("reroute preserves the ServiceNow record-form skill when page context is threaded", () => {
    const source = makeNode([]);
    // A merged ServiceNow record-form request (field/value pairs, "incident"),
    // but WorkArena-style: it never says the literal word "ServiceNow".
    source.description =
      'Create a new incident with a value of "EMAIL Server Down Again" for field "Short description", a value of "Joe Employee" for field "Caller".';
    source.successCriteria =
      "The incident record is submitted with the requested field values.";

    // With the live ServiceNow page context, re-selection keeps the SN skill.
    const withCtx = createRerouteNode(
      source,
      "Submit the incident form",
      "Form has not been submitted yet",
      {
        pageTitle: "Create INC0010443 | Incident | ServiceNow",
        pageUrl:
          "https://example.service-now.com/now/nav/ui/classic/params/target/incident.do",
        enabledSkillPackIds: ["servicenow-platform"],
      },
    );
    expect(withCtx.selectedSkillId).toBe("servicenow-record-form");

    // The pre-fix behavior: without page context the ServiceNow pack de-activates
    // (the goal never says "ServiceNow"), so a non-SN skill is chosen. This is the
    // regression the fix prevents.
    const withoutCtx = createRerouteNode(
      source,
      "Submit the incident form",
      "Form has not been submitted yet",
    );
    expect(withoutCtx.selectedSkillId).not.toBe("servicenow-record-form");
  });
});
