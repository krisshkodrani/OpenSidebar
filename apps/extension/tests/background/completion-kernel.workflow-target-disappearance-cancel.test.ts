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

describe("completion kernel target-disappearance cancel workflow confirmation", () => {
  test("accepts cancel confirmation from named target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      pageContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      elements: [
        actionButton(547, "Cancel Request Alpha"),
        actionButton(548, "Cancel Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Beta Cancel Request Beta",
      pageContent: "Active requests Request Beta Cancel Request Beta",
      elements: [actionButton(548, "Cancel Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:request-alpha",
        detail: expect.objectContaining({
          action: "cancel",
          source: "target_disappearance",
          text: "Canceled target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects cancel target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      pageContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      elements: [
        actionButton(547, "Cancel Request Alpha"),
        actionButton(548, "Cancel Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 548 },
      result: "Clicked element 548.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:request-beta",
        detail: expect.objectContaining({
          action: "cancel",
          source: "target_disappearance",
          text: "Canceled target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer cancel confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer cancel confirmation from a generic cancel button", () => {
    const genericCancelButton: TaggedElement = {
      tag: 547,
      tagName: "button",
      role: "button",
      text: "Cancel",
      attributes: {
        id: "cancel",
        "aria-label": "Cancel",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel",
      pageContent: "Active requests Request Alpha Cancel",
      elements: [genericCancelButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests",
      pageContent: "Active requests",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
