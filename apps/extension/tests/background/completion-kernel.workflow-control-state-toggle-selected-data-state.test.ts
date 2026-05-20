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

  for (const scenario of [
    {
      action: "subscribe",
      completion: "subscribed",
      label: "Subscribe to Channel Alpha",
      request: "Subscribe to Channel Alpha.",
      summary: "Subscribed to Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
      beforeState: "unsubscribed",
      afterState: "subscribed",
    },
    {
      action: "unsubscribe",
      completion: "unsubscribed",
      label: "Unsubscribe from Channel Alpha",
      request: "Unsubscribe from Channel Alpha.",
      summary: "Unsubscribed from Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
      beforeState: "subscribed",
      afterState: "unsubscribed",
    },
    {
      action: "follow",
      completion: "followed",
      label: "Follow Project Alpha",
      request: "Follow Project Alpha.",
      summary: "Followed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
      beforeState: "unfollowed",
      afterState: "followed",
    },
    {
      action: "unfollow",
      completion: "unfollowed",
      label: "Unfollow Project Alpha",
      request: "Unfollow Project Alpha.",
      summary: "Unfollowed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
      beforeState: "followed",
      afterState: "unfollowed",
    },
    {
      action: "bookmark",
      completion: "bookmarked",
      label: "Bookmark Article Alpha",
      request: "Bookmark Article Alpha.",
      summary: "Bookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
      beforeState: "unbookmarked",
      afterState: "bookmarked",
    },
    {
      action: "unbookmark",
      completion: "unbookmarked",
      label: "Unbookmark Article Alpha",
      request: "Unbookmark Article Alpha.",
      summary: "Unbookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
      beforeState: "bookmarked",
      afterState: "unbookmarked",
    },
    {
      action: "favorite",
      completion: "favorited",
      label: "Favorite Article Alpha",
      request: "Favorite Article Alpha.",
      summary: "Favorited Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-favorite",
      beforeState: "unfavorited",
      afterState: "favorited",
    },
    {
      action: "unfavorite",
      completion: "unfavorited",
      label: "Unfavorite Article Alpha",
      request: "Unfavorite Article Alpha.",
      summary: "Unfavorited Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-favorite",
      beforeState: "favorited",
      afterState: "unfavorited",
    },
    {
      action: "watch",
      completion: "watched",
      label: "Watch Repository Alpha",
      request: "Watch Repository Alpha.",
      summary: "Watched Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-watch",
      beforeState: "unwatched",
      afterState: "watched",
    },
    {
      action: "unwatch",
      completion: "unwatched",
      label: "Unwatch Repository Alpha",
      request: "Unwatch Repository Alpha.",
      summary: "Unwatched Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-watch",
      beforeState: "watched",
      afterState: "unwatched",
    },
    {
      action: "star",
      completion: "starred",
      label: "Star Repository Alpha",
      request: "Star Repository Alpha.",
      summary: "Starred Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-star",
      beforeState: "unstarred",
      afterState: "starred",
    },
    {
      action: "unstar",
      completion: "unstarred",
      label: "Unstar Repository Alpha",
      request: "Unstar Repository Alpha.",
      summary: "Unstarred Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-star",
      beforeState: "starred",
      afterState: "unstarred",
    },
    {
      action: "pin",
      completion: "pinned",
      label: "Pin Report Alpha",
      request: "Pin Report Alpha.",
      summary: "Pinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
      beforeState: "unpinned",
      afterState: "pinned",
    },
    {
      action: "unpin",
      completion: "unpinned",
      label: "Unpin Report Alpha",
      request: "Unpin Report Alpha.",
      summary: "Unpinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
      beforeState: "pinned",
      afterState: "unpinned",
    },
    {
      action: "mute",
      completion: "muted",
      label: "Mute Thread Alpha",
      request: "Mute Thread Alpha.",
      summary: "Muted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
      beforeState: "unmuted",
      afterState: "muted",
    },
    {
      action: "unmute",
      completion: "unmuted",
      label: "Unmute Thread Alpha",
      request: "Unmute Thread Alpha.",
      summary: "Unmuted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
      beforeState: "muted",
      afterState: "unmuted",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            674,
            scenario.label,
            scenario.beforeState,
            scenario.id,
          ),
        ],
      });
      const current = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            675,
            scenario.label,
            scenario.afterState,
            scenario.id,
          ),
        ],
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: current,
      });
      const evidence = deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 674 },
        result: "Clicked element 674.",
        preActionSnapshot: pre,
        currentSnapshot: current,
        turn: 11,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: current,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.target,
      });
      expect(evidence).toEqual([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: `workflow:confirmation:${scenario.action}:control-state:${scenario.id}`,
          detail: expect.objectContaining({
            action: scenario.action,
            source: "control_state_change",
            targetText: scenario.target,
            text: `Control state changed to ${scenario.completion}: ${scenario.label}`,
          }),
        }),
      ]);
      expect(decision.status).toBe("accepted");
    });
  }

  test("does not infer subscribe confirmation when semantic data-state was already subscribed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Channel Alpha Subscribe to Channel Alpha",
      pageContent: "Channel Alpha Subscribe to Channel Alpha",
      elements: [
        dataStateActionButton(
          674,
          "Subscribe to Channel Alpha",
          "subscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Channel Alpha Subscribe to Channel Alpha",
      pageContent: "Channel Alpha Subscribe to Channel Alpha",
      elements: [
        dataStateActionButton(
          675,
          "Subscribe to Channel Alpha",
          "subscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 674 },
      result: "Clicked element 674.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsubscribe confirmation when semantic data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Channel Alpha Unsubscribe from Channel Alpha",
      pageContent: "Channel Alpha Unsubscribe from Channel Alpha",
      elements: [
        dataStateActionButton(
          676,
          "Unsubscribe from Channel Alpha",
          "unsubscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Channel Alpha Unsubscribe from Channel Alpha",
      pageContent: "Channel Alpha Unsubscribe from Channel Alpha",
      elements: [
        dataStateActionButton(
          677,
          "Unsubscribe from Channel Alpha",
          "subscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 676 },
      result: "Clicked element 676.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer pin confirmation when semantic data-state was already pinned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Pin Report Alpha",
      pageContent: "Report Alpha Pin Report Alpha",
      elements: [
        dataStateActionButton(
          678,
          "Pin Report Alpha",
          "pinned",
          "report-alpha-pin",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Pin Report Alpha",
      pageContent: "Report Alpha Pin Report Alpha",
      elements: [
        dataStateActionButton(
          679,
          "Pin Report Alpha",
          "pinned",
          "report-alpha-pin",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 678 },
      result: "Clicked element 678.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unmute confirmation when semantic data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Thread Alpha Unmute Thread Alpha",
      pageContent: "Thread Alpha Unmute Thread Alpha",
      elements: [
        dataStateActionButton(
          680,
          "Unmute Thread Alpha",
          "unmuted",
          "thread-alpha-mute",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Thread Alpha Unmute Thread Alpha",
      pageContent: "Thread Alpha Unmute Thread Alpha",
      elements: [
        dataStateActionButton(
          681,
          "Unmute Thread Alpha",
          "muted",
          "thread-alpha-mute",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 680 },
      result: "Clicked element 680.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
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

