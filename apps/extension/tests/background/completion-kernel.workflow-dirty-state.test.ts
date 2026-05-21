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

describe("completion kernel workflow dirty-state confirmation", () => {
  test("accepts save confirmation from cleared dirty-state indicator", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved changes Save changes",
      pageContent: "Settings Unsaved changes Save changes",
      elements: [actionButton(701, "Save changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Save changes",
      pageContent: "Settings Save changes",
      elements: [actionButton(701, "Save changes")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save changes.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 701 },
      result: "Clicked element 701.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved changes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "save",
          source: "dirty_indicator_cleared",
          text: "Unsaved-changes indicator is no longer visible.",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware save confirmation from cleared dirty-state indicator", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft Alpha Unsaved changes Save Draft Alpha Draft Beta Unsaved changes",
      pageContent:
        "Draft Alpha Unsaved changes Save Draft Alpha Draft Beta Unsaved changes",
      elements: [actionButton(703, "Save Draft Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft Alpha Save Draft Alpha Draft Beta",
      pageContent: "Draft Alpha Save Draft Alpha Draft Beta",
      elements: [actionButton(703, "Save Draft Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 703 },
      result: "Clicked element 703.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "save",
          source: "dirty_indicator_cleared",
          targetText: "Draft Alpha",
          text: "Unsaved-changes indicator is no longer visible.",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware save dirty-state confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft Alpha Unsaved changes Draft Beta Unsaved changes Save Draft Beta",
      pageContent:
        "Draft Alpha Unsaved changes Draft Beta Unsaved changes Save Draft Beta",
      elements: [actionButton(704, "Save Draft Beta")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft Alpha Draft Beta Save Draft Beta",
      pageContent: "Draft Alpha Draft Beta Save Draft Beta",
      elements: [actionButton(704, "Save Draft Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 704 },
      result: "Clicked element 704.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "save",
          source: "dirty_indicator_cleared",
          targetText: "Draft Beta",
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

  test("keeps generic dirty-state save confirmation valid for a named target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Draft Alpha Unsaved changes Save changes",
      pageContent: "Draft Alpha Unsaved changes Save changes",
      elements: [actionButton(705, "Save changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft Alpha Save changes",
      pageContent: "Draft Alpha Save changes",
      elements: [actionButton(705, "Save changes")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 705 },
      result: "Clicked element 705.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:dirty-indicator-cleared",
        detail: expect.objectContaining({
          action: "save",
          source: "dirty_indicator_cleared",
          text: "Unsaved-changes indicator is no longer visible.",
        }),
      }),
    ]);
    expect((evidence[0]?.detail as { targetText?: string }).targetText).toBe(
      undefined,
    );
    expect(decision.status).toBe("accepted");
  });

  test("does not infer save confirmation while dirty-state indicator remains", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Unsaved changes Save changes",
      pageContent: "Settings Unsaved changes Save changes",
      elements: [actionButton(701, "Save changes")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Unsaved changes Save changes",
      pageContent: "Settings Unsaved changes Save changes",
      elements: [actionButton(701, "Save changes")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 701 },
      result: "Clicked element 701.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });

    expect(evidence).toEqual([]);
  });

});
