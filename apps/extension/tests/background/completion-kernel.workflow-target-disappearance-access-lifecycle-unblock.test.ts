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

describe("completion kernel unblock target-disappearance access-lifecycle workflow confirmation", () => {
  test("accepts unblock confirmation from named blocklist target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      pageContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      elements: [
        actionButton(513, "Unblock User Alpha"),
        actionButton(514, "Unblock User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Beta Unblock User Beta",
      pageContent: "Blocked users User Beta Unblock User Beta",
      elements: [actionButton(514, "Unblock User Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unblock User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unblocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unblock",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unblock:user-alpha",
        detail: expect.objectContaining({
          action: "unblock",
          source: "target_disappearance",
          text: "Unblocked target no longer visible: User Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unblock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      pageContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      elements: [
        actionButton(513, "Unblock User Alpha"),
        actionButton(514, "Unblock User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unblock User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 514 },
      result: "Clicked element 514.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unblocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unblock",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unblock:user-beta",
        detail: expect.objectContaining({
          action: "unblock",
          source: "target_disappearance",
          text: "Unblocked target no longer visible: User Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unblock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unblock confirmation from a generic unblock button", () => {
    const genericUnblockButton: TaggedElement = {
      tag: 513,
      tagName: "button",
      role: "button",
      text: "Unblock",
      attributes: {
        id: "unblock",
        "aria-label": "Unblock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock",
      pageContent: "Blocked users User Alpha Unblock",
      elements: [genericUnblockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users",
      pageContent: "Blocked users",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
