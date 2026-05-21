import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

function workflowSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Account Settings",
    url: "https://example.test/account",
    visibleContent: "Account settings",
    pageContent: "Account settings",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function actionButton(tag: number, label: string): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: key,
      "aria-label": label,
    },
    rect: { x: 500, y: tag * 20, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel target-disappearance administration workflow confirmation", () => {
  test("accepts assign confirmation from named unassigned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      pageContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      elements: [
        actionButton(563, "Assign Ticket Alpha"),
        actionButton(564, "Assign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Beta Assign Ticket Beta",
      pageContent: "Unassigned tickets Ticket Beta Assign Ticket Beta",
      elements: [actionButton(564, "Assign Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:ticket-alpha",
        detail: expect.objectContaining({
          action: "assign",
          source: "target_disappearance",
          text: "Assigned target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects assign target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      pageContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      elements: [
        actionButton(563, "Assign Ticket Alpha"),
        actionButton(564, "Assign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 564 },
      result: "Clicked element 564.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:ticket-beta",
        detail: expect.objectContaining({
          action: "assign",
          source: "target_disappearance",
          text: "Assigned target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer assign confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer assign confirmation from a generic assign button", () => {
    const genericAssignButton: TaggedElement = {
      tag: 563,
      tagName: "button",
      role: "button",
      text: "Assign",
      attributes: {
        id: "assign",
        "aria-label": "Assign",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign",
      pageContent: "Unassigned tickets Ticket Alpha Assign",
      elements: [genericAssignButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets",
      pageContent: "Unassigned tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts schedule confirmation from named unscheduled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      pageContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      elements: [
        actionButton(565, "Schedule Report Alpha"),
        actionButton(566, "Schedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Beta Schedule Report Beta",
      pageContent: "Unscheduled reports Report Beta Schedule Report Beta",
      elements: [actionButton(566, "Schedule Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Schedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Scheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "schedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:schedule:report-alpha",
        detail: expect.objectContaining({
          action: "schedule",
          source: "target_disappearance",
          text: "Scheduled target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects schedule target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      pageContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      elements: [
        actionButton(565, "Schedule Report Alpha"),
        actionButton(566, "Schedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Schedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 566 },
      result: "Clicked element 566.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Scheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "schedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:schedule:report-beta",
        detail: expect.objectContaining({
          action: "schedule",
          source: "target_disappearance",
          text: "Scheduled target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer schedule confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer schedule confirmation from a generic schedule button", () => {
    const genericScheduleButton: TaggedElement = {
      tag: 565,
      tagName: "button",
      role: "button",
      text: "Schedule",
      attributes: {
        id: "schedule",
        "aria-label": "Schedule",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule",
      pageContent: "Unscheduled reports Report Alpha Schedule",
      elements: [genericScheduleButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports",
      pageContent: "Unscheduled reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

});
