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
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      "aria-label": label,
    },
    rect: { x: 0, y: tag * 20, width: 120, height: 28 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel workflow update dirty-state confirmation", () => {
  test("accepts update confirmation from cleared standalone unsaved indicator", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved Apply changes",
      pageContent: "Settings Unsaved Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Apply changes",
      pageContent: "Settings Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });
    const generated = generateCompletionContract({
      userRequest: "Apply changes.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 702 },
      result: "Clicked element 702.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 13,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Applied changes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "update",
          source: "dirty_indicator_cleared",
          text: "Unsaved-changes indicator is no longer visible.",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware update dirty-state confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Profile Alpha Unsaved Profile Beta Unsaved Apply Profile Beta",
      pageContent:
        "Profile Alpha Unsaved Profile Beta Unsaved Apply Profile Beta",
      elements: [actionButton(706, "Apply Profile Beta")],
    });
    const current = workflowSnapshot({
      visibleContent: "Profile Alpha Profile Beta Apply Profile Beta",
      pageContent: "Profile Alpha Profile Beta Apply Profile Beta",
      elements: [actionButton(706, "Apply Profile Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Apply Profile Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 706 },
      result: "Clicked element 706.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 13,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Applied Profile Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
      targetLabel: "Profile Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "update",
          source: "dirty_indicator_cleared",
          targetText: "Profile Beta",
          text: "Unsaved-changes indicator is no longer visible.",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer update confirmation while standalone unsaved indicator remains", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved Apply changes",
      pageContent: "Settings Unsaved Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Unsaved Apply changes",
      pageContent: "Settings Unsaved Apply changes",
      elements: [actionButton(702, "Apply changes")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 702 },
      result: "Clicked element 702.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 13,
    });

    expect(evidence).toEqual([]);
  });
});
