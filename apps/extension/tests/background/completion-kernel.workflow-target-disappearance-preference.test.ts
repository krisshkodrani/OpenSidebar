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

describe("completion kernel target-disappearance saved-item preference workflow confirmation", () => {
  test("accepts star confirmation from named unstarred target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      elements: [
        actionButton(537, "Star Repository Alpha"),
        actionButton(538, "Star Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Beta Star Repository Beta",
      pageContent:
        "Unstarred repositories Repository Beta Star Repository Beta",
      elements: [actionButton(538, "Star Repository Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:star:repository-alpha",
        detail: expect.objectContaining({
          action: "star",
          source: "target_disappearance",
          text: "Starred target no longer visible: Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects star target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha Repository Beta Star Repository Beta",
      elements: [
        actionButton(537, "Star Repository Alpha"),
        actionButton(538, "Star Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      elements: [actionButton(537, "Star Repository Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 538 },
      result: "Clicked element 538.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:star:repository-beta",
        detail: expect.objectContaining({
          action: "star",
          source: "target_disappearance",
          text: "Starred target no longer visible: Repository Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer star confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      elements: [actionButton(537, "Star Repository Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      pageContent:
        "Unstarred repositories Repository Alpha Star Repository Alpha",
      elements: [actionButton(537, "Star Repository Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer star confirmation from a generic star button", () => {
    const genericStarButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Star",
      attributes: {
        id: "star",
        "aria-label": "Star",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unstarred repositories Repository Alpha Star",
      pageContent: "Unstarred repositories Repository Alpha Star",
      elements: [genericStarButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unstarred repositories",
      pageContent: "Unstarred repositories",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

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

  test("accepts favorite confirmation from named unfavorited target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      pageContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      elements: [
        actionButton(541, "Favorite Report Alpha"),
        actionButton(542, "Favorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Beta Favorite Report Beta",
      pageContent: "Unfavorited reports Report Beta Favorite Report Beta",
      elements: [actionButton(542, "Favorite Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Favorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Favorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "favorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:favorite:report-alpha",
        detail: expect.objectContaining({
          action: "favorite",
          source: "target_disappearance",
          text: "Favorited target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects favorite target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      pageContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      elements: [
        actionButton(541, "Favorite Report Alpha"),
        actionButton(542, "Favorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Favorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Favorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "favorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:favorite:report-beta",
        detail: expect.objectContaining({
          action: "favorite",
          source: "target_disappearance",
          text: "Favorited target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer favorite confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer favorite confirmation from a generic favorite button", () => {
    const genericFavoriteButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Favorite",
      attributes: {
        id: "favorite",
        "aria-label": "Favorite",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite",
      pageContent: "Unfavorited reports Report Alpha Favorite",
      elements: [genericFavoriteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports",
      pageContent: "Unfavorited reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unfavorite confirmation from named favorited target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      elements: [
        actionButton(537, "Unfavorite Report Alpha"),
        actionButton(538, "Unfavorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Beta Unfavorite Report Beta",
      elements: [actionButton(538, "Unfavorite Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfavorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfavorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfavorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfavorite:report-alpha",
        detail: expect.objectContaining({
          action: "unfavorite",
          source: "target_disappearance",
          text: "Unfavorited target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unfavorite target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      elements: [
        actionButton(537, "Unfavorite Report Alpha"),
        actionButton(538, "Unfavorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfavorite Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 538 },
      result: "Clicked element 538.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfavorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfavorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfavorite:report-beta",
        detail: expect.objectContaining({
          action: "unfavorite",
          source: "target_disappearance",
          text: "Unfavorited target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unfavorite confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unfavorite confirmation from a generic unfavorite button", () => {
    const genericUnfavoriteButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Unfavorite",
      attributes: {
        id: "unfavorite",
        "aria-label": "Unfavorite",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Favorited reports Report Alpha Unfavorite",
      pageContent: "Favorited reports Report Alpha Unfavorite",
      elements: [genericUnfavoriteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Favorited reports",
      pageContent: "Favorited reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts pin confirmation from named unpinned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      pageContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      elements: [
        actionButton(543, "Pin Report Alpha"),
        actionButton(544, "Pin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Beta Pin Report Beta",
      pageContent: "Unpinned reports Report Beta Pin Report Beta",
      elements: [actionButton(544, "Pin Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pin:report-alpha",
        detail: expect.objectContaining({
          action: "pin",
          source: "target_disappearance",
          text: "Pinned target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects pin target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      pageContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      elements: [
        actionButton(543, "Pin Report Alpha"),
        actionButton(544, "Pin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 544 },
      result: "Clicked element 544.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pin:report-beta",
        detail: expect.objectContaining({
          action: "pin",
          source: "target_disappearance",
          text: "Pinned target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer pin confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer pin confirmation from a generic pin button", () => {
    const genericPinButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "Pin",
      attributes: {
        id: "pin",
        "aria-label": "Pin",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin",
      pageContent: "Unpinned reports Report Alpha Pin",
      elements: [genericPinButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports",
      pageContent: "Unpinned reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unpin confirmation from named pinned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      pageContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      elements: [
        actionButton(539, "Unpin Report Alpha"),
        actionButton(540, "Unpin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Beta Unpin Report Beta",
      pageContent: "Pinned reports Report Beta Unpin Report Beta",
      elements: [actionButton(540, "Unpin Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unpin Report Alpha.",
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
      summary: "Unpinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unpin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unpin:report-alpha",
        detail: expect.objectContaining({
          action: "unpin",
          source: "target_disappearance",
          text: "Unpinned target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unpin target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      pageContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      elements: [
        actionButton(539, "Unpin Report Alpha"),
        actionButton(540, "Unpin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unpin Report Alpha.",
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
      summary: "Unpinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unpin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unpin:report-beta",
        detail: expect.objectContaining({
          action: "unpin",
          source: "target_disappearance",
          text: "Unpinned target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unpin confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
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

  test("does not infer unpin confirmation from a generic unpin button", () => {
    const genericUnpinButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Unpin",
      attributes: {
        id: "unpin",
        "aria-label": "Unpin",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin",
      pageContent: "Pinned reports Report Alpha Unpin",
      elements: [genericUnpinButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports",
      pageContent: "Pinned reports",
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

  test("accepts mute confirmation from named unmuted target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      pageContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      elements: [
        actionButton(545, "Mute Channel Alpha"),
        actionButton(546, "Mute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Beta Mute Channel Beta",
      pageContent: "Unmuted channels Channel Beta Mute Channel Beta",
      elements: [actionButton(546, "Mute Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Muted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "mute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:mute:channel-alpha",
        detail: expect.objectContaining({
          action: "mute",
          source: "target_disappearance",
          text: "Muted target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects mute target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      pageContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      elements: [
        actionButton(545, "Mute Channel Alpha"),
        actionButton(546, "Mute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Muted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "mute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:mute:channel-beta",
        detail: expect.objectContaining({
          action: "mute",
          source: "target_disappearance",
          text: "Muted target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer mute confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer mute confirmation from a generic mute button", () => {
    const genericMuteButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Mute",
      attributes: {
        id: "mute",
        "aria-label": "Mute",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute",
      pageContent: "Unmuted channels Channel Alpha Mute",
      elements: [genericMuteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels",
      pageContent: "Unmuted channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unmute confirmation from named muted target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      pageContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      elements: [
        actionButton(541, "Unmute Channel Alpha"),
        actionButton(542, "Unmute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Beta Unmute Channel Beta",
      pageContent: "Muted channels Channel Beta Unmute Channel Beta",
      elements: [actionButton(542, "Unmute Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unmute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unmuted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unmute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unmute:channel-alpha",
        detail: expect.objectContaining({
          action: "unmute",
          source: "target_disappearance",
          text: "Unmuted target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unmute target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      pageContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      elements: [
        actionButton(541, "Unmute Channel Alpha"),
        actionButton(542, "Unmute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unmute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unmuted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unmute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unmute:channel-beta",
        detail: expect.objectContaining({
          action: "unmute",
          source: "target_disappearance",
          text: "Unmuted target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unmute confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unmute confirmation from a generic unmute button", () => {
    const genericUnmuteButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Unmute",
      attributes: {
        id: "unmute",
        "aria-label": "Unmute",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute",
      pageContent: "Muted channels Channel Alpha Unmute",
      elements: [genericUnmuteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels",
      pageContent: "Muted channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

});
