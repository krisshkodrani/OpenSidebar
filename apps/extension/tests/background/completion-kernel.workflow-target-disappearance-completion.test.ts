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

describe("completion kernel target-disappearance complete workflow confirmation", () => {
  test("accepts complete confirmation from named task disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK002 Mark TASK002 complete",
      pageContent: "Open tasks TASK002 Mark TASK002 complete",
      elements: [actionButton(546, "Mark TASK002 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task001",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK001",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects complete target-disappearance evidence for the wrong requested task", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task002",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK002",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer complete confirmation while the named task remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete button", () => {
    const genericCompleteButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete",
      attributes: {
        id: "complete",
        "aria-label": "Complete",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete",
      pageContent: "Open tasks TASK001 Complete",
      elements: [genericCompleteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete task control", () => {
    const genericCompleteTaskButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete task",
      attributes: {
        id: "complete-task",
        "aria-label": "Complete task",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete task",
      pageContent: "Open tasks TASK001 Complete task",
      elements: [genericCompleteTaskButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
