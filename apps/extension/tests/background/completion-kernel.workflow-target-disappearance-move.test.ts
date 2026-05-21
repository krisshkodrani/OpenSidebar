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

describe("completion kernel move target-disappearance object-change workflow confirmation", () => {
  test("accepts move confirmation from named card disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      pageContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      elements: [
        actionButton(525, "Move Card Alpha"),
        actionButton(526, "Move Card Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Beta Move Card Beta",
      pageContent: "Pending moves Card Beta Move Card Beta",
      elements: [actionButton(526, "Move Card Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Move Card Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Moved Card Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "move",
      targetLabel: "Card Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:move:card-alpha",
        detail: expect.objectContaining({
          action: "move",
          source: "target_disappearance",
          text: "Moved target no longer visible: Card Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects move target-disappearance evidence for the wrong requested card", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      pageContent:
        "Pending moves Card Alpha Move Card Alpha Card Beta Move Card Beta",
      elements: [
        actionButton(525, "Move Card Alpha"),
        actionButton(526, "Move Card Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Move Card Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 526 },
      result: "Clicked element 526.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Moved Card Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "move",
      targetLabel: "Card Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:move:card-beta",
        detail: expect.objectContaining({
          action: "move",
          source: "target_disappearance",
          text: "Moved target no longer visible: Card Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer move confirmation while the named card remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move Card Alpha",
      pageContent: "Pending moves Card Alpha Move Card Alpha",
      elements: [actionButton(525, "Move Card Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer move confirmation from a generic move button", () => {
    const genericMoveButton: TaggedElement = {
      tag: 525,
      tagName: "button",
      role: "button",
      text: "Move",
      attributes: {
        id: "move",
        "aria-label": "Move",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending moves Card Alpha Move",
      pageContent: "Pending moves Card Alpha Move",
      elements: [genericMoveButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending moves",
      pageContent: "Pending moves",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
