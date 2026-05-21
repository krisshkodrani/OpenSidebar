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

describe("completion kernel unsuspend target-disappearance access-lifecycle workflow confirmation", () => {
  test("accepts unsuspend confirmation from named suspended target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      pageContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      elements: [
        actionButton(515, "Unsuspend Account Alpha"),
        actionButton(516, "Unsuspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Beta Unsuspend Account Beta",
      pageContent: "Suspended accounts Account Beta Unsuspend Account Beta",
      elements: [actionButton(516, "Unsuspend Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsuspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsuspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsuspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsuspend:account-alpha",
        detail: expect.objectContaining({
          action: "unsuspend",
          source: "target_disappearance",
          text: "Unsuspended target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unsuspend target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      pageContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      elements: [
        actionButton(515, "Unsuspend Account Alpha"),
        actionButton(516, "Unsuspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsuspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 516 },
      result: "Clicked element 516.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsuspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsuspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsuspend:account-beta",
        detail: expect.objectContaining({
          action: "unsuspend",
          source: "target_disappearance",
          text: "Unsuspended target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unsuspend confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsuspend confirmation from a generic unsuspend button", () => {
    const genericUnsuspendButton: TaggedElement = {
      tag: 515,
      tagName: "button",
      role: "button",
      text: "Unsuspend",
      attributes: {
        id: "unsuspend",
        "aria-label": "Unsuspend",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend",
      pageContent: "Suspended accounts Account Alpha Unsuspend",
      elements: [genericUnsuspendButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts",
      pageContent: "Suspended accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
