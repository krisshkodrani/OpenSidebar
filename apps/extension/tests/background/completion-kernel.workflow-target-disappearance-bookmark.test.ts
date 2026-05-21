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

describe("completion kernel target-disappearance bookmark workflow confirmation", () => {
  test("accepts bookmark confirmation from named unbookmarked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      pageContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      elements: [
        actionButton(539, "Bookmark Page Alpha"),
        actionButton(540, "Bookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Beta Bookmark Page Beta",
      pageContent: "Unbookmarked pages Page Beta Bookmark Page Beta",
      elements: [actionButton(540, "Bookmark Page Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Bookmark Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Bookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "bookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:bookmark:page-alpha",
        detail: expect.objectContaining({
          action: "bookmark",
          source: "target_disappearance",
          text: "Bookmarked target no longer visible: Page Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects bookmark target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      pageContent:
        "Unbookmarked pages Page Alpha Bookmark Page Alpha Page Beta Bookmark Page Beta",
      elements: [
        actionButton(539, "Bookmark Page Alpha"),
        actionButton(540, "Bookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      pageContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      elements: [actionButton(539, "Bookmark Page Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Bookmark Page Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 540 },
      result: "Clicked element 540.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Bookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "bookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:bookmark:page-beta",
        detail: expect.objectContaining({
          action: "bookmark",
          source: "target_disappearance",
          text: "Bookmarked target no longer visible: Page Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer bookmark confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      pageContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      elements: [actionButton(539, "Bookmark Page Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      pageContent: "Unbookmarked pages Page Alpha Bookmark Page Alpha",
      elements: [actionButton(539, "Bookmark Page Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer bookmark confirmation from a generic bookmark button", () => {
    const genericBookmarkButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Bookmark",
      attributes: {
        id: "bookmark",
        "aria-label": "Bookmark",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unbookmarked pages Page Alpha Bookmark",
      pageContent: "Unbookmarked pages Page Alpha Bookmark",
      elements: [genericBookmarkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unbookmarked pages",
      pageContent: "Unbookmarked pages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unbookmark confirmation from named bookmarked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      pageContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      elements: [
        actionButton(535, "Unbookmark Page Alpha"),
        actionButton(536, "Unbookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Beta Unbookmark Page Beta",
      pageContent: "Bookmarked pages Page Beta Unbookmark Page Beta",
      elements: [actionButton(536, "Unbookmark Page Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unbookmark Page Alpha.",
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
      summary: "Unbookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unbookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unbookmark:page-alpha",
        detail: expect.objectContaining({
          action: "unbookmark",
          source: "target_disappearance",
          text: "Unbookmarked target no longer visible: Page Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unbookmark target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      pageContent:
        "Bookmarked pages Page Alpha Unbookmark Page Alpha Page Beta Unbookmark Page Beta",
      elements: [
        actionButton(535, "Unbookmark Page Alpha"),
        actionButton(536, "Unbookmark Page Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      pageContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      elements: [actionButton(535, "Unbookmark Page Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unbookmark Page Alpha.",
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
      summary: "Unbookmarked Page Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unbookmark",
      targetLabel: "Page Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unbookmark:page-beta",
        detail: expect.objectContaining({
          action: "unbookmark",
          source: "target_disappearance",
          text: "Unbookmarked target no longer visible: Page Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unbookmark confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      pageContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      elements: [actionButton(535, "Unbookmark Page Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      pageContent: "Bookmarked pages Page Alpha Unbookmark Page Alpha",
      elements: [actionButton(535, "Unbookmark Page Alpha")],
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

  test("does not infer unbookmark confirmation from a generic unbookmark button", () => {
    const genericUnbookmarkButton: TaggedElement = {
      tag: 535,
      tagName: "button",
      role: "button",
      text: "Unbookmark",
      attributes: {
        id: "unbookmark",
        "aria-label": "Unbookmark",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Bookmarked pages Page Alpha Unbookmark",
      pageContent: "Bookmarked pages Page Alpha Unbookmark",
      elements: [genericUnbookmarkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Bookmarked pages",
      pageContent: "Bookmarked pages",
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
