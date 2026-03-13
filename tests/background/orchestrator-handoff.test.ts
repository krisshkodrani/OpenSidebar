import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildAssumptionDriftSignal,
  buildExecutorInstruction,
  buildTaskStateBrief,
  buildVerifierContext,
  createRerouteNode,
  formatHandoffBrief,
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
    expect(instruction).toContain("Step-scoped task context:");
    expect(instruction).toContain("Planner assumptions (validate against current page before acting):");
    expect(instruction).toContain("Reality check signal:");
    expect(instruction).toContain("Execution policy:");
    expect(instruction).toContain("Executor result (executor): Address completed");
    expect(instruction).toContain("Execute only the current step objective.");
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

  test("builds executor task state brief with compact completed and upcoming sections", () => {
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
    expect(brief).toContain("Upcoming steps (awareness only - do not execute yet):");
    expect(brief).toContain("Apply SAVE10 and choose Express shipping");
    expect(brief).toContain("Fill checkout name and email");
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
});
