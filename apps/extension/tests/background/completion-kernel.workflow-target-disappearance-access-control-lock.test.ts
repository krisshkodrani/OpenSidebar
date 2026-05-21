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

describe("completion kernel lock target-disappearance access-control workflow confirmation", () => {
  test("accepts lock confirmation from named unlocked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      pageContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      elements: [
        actionButton(551, "Lock Account Alpha"),
        actionButton(552, "Lock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Beta Lock Account Beta",
      pageContent: "Unlocked accounts Account Beta Lock Account Beta",
      elements: [actionButton(552, "Lock Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:account-alpha",
        detail: expect.objectContaining({
          action: "lock",
          source: "target_disappearance",
          text: "Locked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects lock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      pageContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      elements: [
        actionButton(551, "Lock Account Alpha"),
        actionButton(552, "Lock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 552 },
      result: "Clicked element 552.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:account-beta",
        detail: expect.objectContaining({
          action: "lock",
          source: "target_disappearance",
          text: "Locked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer lock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer lock confirmation from a generic lock button", () => {
    const genericLockButton: TaggedElement = {
      tag: 551,
      tagName: "button",
      role: "button",
      text: "Lock",
      attributes: {
        id: "lock",
        "aria-label": "Lock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock",
      pageContent: "Unlocked accounts Account Alpha Lock",
      elements: [genericLockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts",
      pageContent: "Unlocked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
