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

function stableActionButton(
  tag: number,
  label: string,
  id: string,
): TaggedElement {
  return {
    ...actionButton(tag, label),
    attributes: {
      id,
      "aria-label": label,
    },
  };
}

describe("completion kernel update workflow control-label confirmation", () => {
  test("accepts update confirmation from same-control up-to-date label change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Edit mode Apply changes",
      pageContent: "Settings Edit mode Apply changes",
      elements: [stableActionButton(608, "Apply changes", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const generated = generateCompletionContract({
      userRequest: "Apply changes.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey: "workflow:confirmation:update:control:settings-apply",
        detail: expect.objectContaining({
          action: "update",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Up to date",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer up-to-date update confirmation when label was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
