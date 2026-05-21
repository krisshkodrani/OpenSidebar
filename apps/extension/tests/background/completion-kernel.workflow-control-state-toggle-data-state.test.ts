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

describe("completion kernel workflow control-state data-state toggle confirmation", () => {
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
