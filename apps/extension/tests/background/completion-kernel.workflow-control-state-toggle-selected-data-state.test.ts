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

function selectedActionButton(
  tag: number,
  label: string,
  selected: boolean,
  id: string,
  attribute: "aria-selected" | "selected" = "aria-selected",
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      [attribute]: String(selected),
    },
  };
}

function dataStateActionButton(
  tag: number,
  label: string,
  state: string,
  id: string,
  attribute:
    | "data-state"
    | "data-selected"
    | "data-checked"
    | "data-pressed" = "data-state",
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      [attribute]: state,
    },
  };
}

describe("completion kernel workflow control-state selected and data-state toggle confirmation", () => {
  test("accepts star confirmation from aria-selected control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(636, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(637, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 636 },
      result: "Clicked element 636.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:star:control-state:issue-alpha-star",
        detail: expect.objectContaining({
          action: "star",
          source: "control_state_change",
          targetText: "Issue Alpha",
          text: "Control state changed to starred: Star Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unbookmark confirmation from selected control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Alpha Unbookmark Article Alpha",
      pageContent: "Article Alpha Unbookmark Article Alpha",
      elements: [
        selectedActionButton(
          638,
          "Unbookmark Article Alpha",
          true,
          "article-alpha-bookmark",
          "selected",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Alpha Unbookmark Article Alpha",
      pageContent: "Article Alpha Unbookmark Article Alpha",
      elements: [
        selectedActionButton(
          639,
          "Unbookmark Article Alpha",
          false,
          "article-alpha-bookmark",
          "selected",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unbookmark Article Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 638 },
      result: "Clicked element 638.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unbookmarked Article Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unbookmark",
      targetLabel: "Article Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unbookmark:control-state:article-alpha-bookmark",
        detail: expect.objectContaining({
          action: "unbookmark",
          source: "control_state_change",
          targetText: "Article Alpha",
          text: "Control state changed to unbookmarked: Unbookmark Article Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer star confirmation when aria-selected was already true", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(636, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(637, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 636 },
      result: "Clicked element 636.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer star confirmation when aria-selected flips off", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(636, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(637, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 636 },
      result: "Clicked element 636.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts bookmark confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          640,
          "Bookmark Article Beta",
          "unchecked",
          "article-beta-bookmark",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          641,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Bookmark Article Beta.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Bookmarked Article Beta.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "bookmark",
      targetLabel: "Article Beta",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:bookmark:control-state:article-beta-bookmark",
        detail: expect.objectContaining({
          action: "bookmark",
          source: "control_state_change",
          targetText: "Article Beta",
          text: "Control state changed to bookmarked: Bookmark Article Beta",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unwatch confirmation from data-selected control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Repository Alpha Unwatch Repository Alpha",
      pageContent: "Repository Alpha Unwatch Repository Alpha",
      elements: [
        dataStateActionButton(
          642,
          "Unwatch Repository Alpha",
          "true",
          "repository-alpha-watch",
          "data-selected",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Repository Alpha Unwatch Repository Alpha",
      pageContent: "Repository Alpha Unwatch Repository Alpha",
      elements: [
        dataStateActionButton(
          643,
          "Unwatch Repository Alpha",
          "false",
          "repository-alpha-watch",
          "data-selected",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unwatch Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 642 },
      result: "Clicked element 642.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unwatched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unwatch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unwatch:control-state:repository-alpha-watch",
        detail: expect.objectContaining({
          action: "unwatch",
          source: "control_state_change",
          targetText: "Repository Alpha",
          text: "Control state changed to unwatched: Unwatch Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer bookmark confirmation when data-state was already checked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          640,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          641,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer bookmark confirmation when data-state flips off", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          640,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          641,
          "Bookmark Article Beta",
          "unchecked",
          "article-beta-bookmark",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});

