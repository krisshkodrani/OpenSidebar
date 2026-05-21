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

function statefulActionButton(
  tag: number,
  label: string,
  pressed: boolean,
  id: string,
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "aria-pressed": String(pressed),
    },
  };
}

describe("completion kernel workflow preference control-state toggle confirmation", () => {
  for (const scenario of [
    {
      action: "bookmark",
      completion: "bookmarked",
      label: "Bookmark Article Alpha",
      request: "Bookmark Article Alpha.",
      summary: "Bookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
    },
    {
      action: "unbookmark",
      completion: "unbookmarked",
      label: "Unbookmark Article Alpha",
      request: "Unbookmark Article Alpha.",
      summary: "Unbookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "follow",
      completion: "followed",
      label: "Follow Project Alpha",
      request: "Follow Project Alpha.",
      summary: "Followed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
    },
    {
      action: "unfollow",
      completion: "unfollowed",
      label: "Unfollow Project Alpha",
      request: "Unfollow Project Alpha.",
      summary: "Unfollowed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "subscribe",
      completion: "subscribed",
      label: "Subscribe to Channel Alpha",
      request: "Subscribe to Channel Alpha.",
      summary: "Subscribed to Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
    },
    {
      action: "unsubscribe",
      completion: "unsubscribed",
      label: "Unsubscribe from Channel Alpha",
      request: "Unsubscribe from Channel Alpha.",
      summary: "Unsubscribed from Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "pin",
      completion: "pinned",
      label: "Pin Report Alpha",
      request: "Pin Report Alpha.",
      summary: "Pinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
    },
    {
      action: "unpin",
      completion: "unpinned",
      label: "Unpin Report Alpha",
      request: "Unpin Report Alpha.",
      summary: "Unpinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "mute",
      completion: "muted",
      label: "Mute Thread Alpha",
      request: "Mute Thread Alpha.",
      summary: "Muted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
    },
    {
      action: "unmute",
      completion: "unmuted",
      label: "Unmute Thread Alpha",
      request: "Unmute Thread Alpha.",
      summary: "Unmuted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
      initiallyPressed: true,
      finallyPressed: false,
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from pressed control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          statefulActionButton(
            634,
            scenario.label,
            scenario.initiallyPressed ?? false,
            scenario.id,
          ),
        ],
      });
      const current = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          statefulActionButton(
            635,
            scenario.label,
            scenario.finallyPressed ?? true,
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
        args: { id: 634 },
        result: "Clicked element 634.",
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

});
