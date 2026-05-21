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
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "data-state": state,
    },
  };
}

describe("completion kernel workflow semantic data-state toggle confirmation", () => {
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
});
