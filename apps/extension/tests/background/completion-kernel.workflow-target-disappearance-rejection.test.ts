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

describe("completion kernel reject target-disappearance workflow confirmation", () => {
  test("accepts reject confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      pageContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      elements: [
        actionButton(535, "Reject Request Alpha"),
        actionButton(536, "Reject Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Beta Reject Request Beta",
      pageContent: "Pending rejections Request Beta Reject Request Beta",
      elements: [actionButton(536, "Reject Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:request-alpha",
        detail: expect.objectContaining({
          action: "reject",
          source: "target_disappearance",
          text: "Rejected target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reject target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      pageContent:
        "Pending rejections Request Alpha Reject Request Alpha Request Beta Reject Request Beta",
      elements: [
        actionButton(535, "Reject Request Alpha"),
        actionButton(536, "Reject Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 536 },
      result: "Clicked element 536.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:request-beta",
        detail: expect.objectContaining({
          action: "reject",
          source: "target_disappearance",
          text: "Rejected target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reject confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject Request Alpha",
      pageContent: "Pending rejections Request Alpha Reject Request Alpha",
      elements: [actionButton(535, "Reject Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reject confirmation from a generic reject button", () => {
    const genericRejectButton: TaggedElement = {
      tag: 535,
      tagName: "button",
      role: "button",
      text: "Reject",
      attributes: {
        id: "reject",
        "aria-label": "Reject",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending rejections Request Alpha Reject",
      pageContent: "Pending rejections Request Alpha Reject",
      elements: [genericRejectButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rejections",
      pageContent: "Pending rejections",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 535 },
      result: "Clicked element 535.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
