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

describe("completion kernel target-disappearance unstar workflow confirmation", () => {
  test("accepts unstar confirmation from named starred target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      elements: [
        actionButton(533, "Unstar Repository Alpha"),
        actionButton(534, "Unstar Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Beta Unstar Repository Beta",
      pageContent:
        "Starred repositories Repository Beta Unstar Repository Beta",
      elements: [actionButton(534, "Unstar Repository Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unstar Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unstarred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unstar",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unstar:repository-alpha",
        detail: expect.objectContaining({
          action: "unstar",
          source: "target_disappearance",
          text: "Unstarred target no longer visible: Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unstar target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha Repository Beta Unstar Repository Beta",
      elements: [
        actionButton(533, "Unstar Repository Alpha"),
        actionButton(534, "Unstar Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      elements: [actionButton(533, "Unstar Repository Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unstar Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 534 },
      result: "Clicked element 534.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unstarred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unstar",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unstar:repository-beta",
        detail: expect.objectContaining({
          action: "unstar",
          source: "target_disappearance",
          text: "Unstarred target no longer visible: Repository Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unstar confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      elements: [actionButton(533, "Unstar Repository Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      pageContent:
        "Starred repositories Repository Alpha Unstar Repository Alpha",
      elements: [actionButton(533, "Unstar Repository Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unstar confirmation from a generic unstar button", () => {
    const genericUnstarButton: TaggedElement = {
      tag: 533,
      tagName: "button",
      role: "button",
      text: "Unstar",
      attributes: {
        id: "unstar",
        "aria-label": "Unstar",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Starred repositories Repository Alpha Unstar",
      pageContent: "Starred repositories Repository Alpha Unstar",
      elements: [genericUnstarButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Starred repositories",
      pageContent: "Starred repositories",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 533 },
      result: "Clicked element 533.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
