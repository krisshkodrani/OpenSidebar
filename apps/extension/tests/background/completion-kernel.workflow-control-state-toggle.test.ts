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

describe("completion kernel workflow control-state toggle confirmation", () => {
  test("accepts star confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(628, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(629, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 628 },
      result: "Clicked element 628.",
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

  test("accepts unstar confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Unstar Issue Alpha",
      pageContent: "Issue Alpha Unstar Issue Alpha",
      elements: [
        statefulActionButton(630, "Unstar Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Unstar Issue Alpha",
      pageContent: "Issue Alpha Unstar Issue Alpha",
      elements: [
        statefulActionButton(631, "Unstar Issue Alpha", false, "issue-alpha-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unstar Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unstarred Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unstar",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unstar:control-state:issue-alpha-star",
        detail: expect.objectContaining({
          action: "unstar",
          source: "control_state_change",
          targetText: "Issue Alpha",
          text: "Control state changed to unstarred: Unstar Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware pressed-toggle confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Issue Beta Star Issue Beta",
      pageContent: "Issue Alpha Issue Beta Star Issue Beta",
      elements: [
        statefulActionButton(632, "Star Issue Beta", false, "issue-beta-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Issue Beta Star Issue Beta",
      pageContent: "Issue Alpha Issue Beta Star Issue Beta",
      elements: [
        statefulActionButton(633, "Star Issue Beta", true, "issue-beta-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 632 },
      result: "Clicked element 632.",
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
        logicalKey: "workflow:confirmation:star:control-state:issue-beta-star",
        detail: expect.objectContaining({
          action: "star",
          source: "control_state_change",
          targetText: "Issue Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer star confirmation when pressed state was already on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(628, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(629, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 628 },
      result: "Clicked element 628.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer star confirmation when pressed state flips off", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(628, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(629, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 628 },
      result: "Clicked element 628.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts like confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(644, "Like Comment Alpha", false, "comment-alpha-like"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(645, "Like Comment Alpha", true, "comment-alpha-like"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Like Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 644 },
      result: "Clicked element 644.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Liked Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "like",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:like:control-state:comment-alpha-like",
        detail: expect.objectContaining({
          action: "like",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to liked: Like Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlike confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Unlike Comment Alpha",
      pageContent: "Comment Alpha Unlike Comment Alpha",
      elements: [
        statefulActionButton(
          646,
          "Unlike Comment Alpha",
          true,
          "comment-alpha-like",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Unlike Comment Alpha",
      pageContent: "Comment Alpha Unlike Comment Alpha",
      elements: [
        statefulActionButton(
          647,
          "Unlike Comment Alpha",
          false,
          "comment-alpha-like",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlike Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 646 },
      result: "Clicked element 646.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unliked Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlike",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unlike:control-state:comment-alpha-like",
        detail: expect.objectContaining({
          action: "unlike",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to unliked: Unlike Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware like confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Like Comment Beta",
      pageContent: "Comment Alpha Comment Beta Like Comment Beta",
      elements: [
        statefulActionButton(648, "Like Comment Beta", false, "comment-beta-like"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Like Comment Beta",
      pageContent: "Comment Alpha Comment Beta Like Comment Beta",
      elements: [
        statefulActionButton(649, "Like Comment Beta", true, "comment-beta-like"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Like Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 648 },
      result: "Clicked element 648.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Liked Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "like",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        logicalKey: "workflow:confirmation:like:control-state:comment-beta-like",
        detail: expect.objectContaining({
          action: "like",
          source: "control_state_change",
          targetText: "Comment Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer like confirmation when pressed state was already on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(644, "Like Comment Alpha", true, "comment-alpha-like"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(645, "Like Comment Alpha", true, "comment-alpha-like"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 644 },
      result: "Clicked element 644.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts upvote confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          650,
          "Upvote Comment Alpha",
          false,
          "comment-alpha-upvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          651,
          "Upvote Comment Alpha",
          true,
          "comment-alpha-upvote",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Upvote Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Upvoted Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upvote",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:upvote:control-state:comment-alpha-upvote",
        detail: expect.objectContaining({
          action: "upvote",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to upvoted: Upvote Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts downvote confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Downvote Comment Alpha",
      pageContent: "Comment Alpha Downvote Comment Alpha",
      elements: [
        statefulActionButton(
          652,
          "Downvote Comment Alpha",
          false,
          "comment-alpha-downvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Downvote Comment Alpha",
      pageContent: "Comment Alpha Downvote Comment Alpha",
      elements: [
        statefulActionButton(
          653,
          "Downvote Comment Alpha",
          true,
          "comment-alpha-downvote",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Downvote Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 652 },
      result: "Clicked element 652.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Downvoted Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "downvote",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:downvote:control-state:comment-alpha-downvote",
        detail: expect.objectContaining({
          action: "downvote",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to downvoted: Downvote Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware upvote confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      pageContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      elements: [
        statefulActionButton(
          654,
          "Upvote Comment Beta",
          false,
          "comment-beta-upvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      pageContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      elements: [
        statefulActionButton(
          655,
          "Upvote Comment Beta",
          true,
          "comment-beta-upvote",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Upvote Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Upvoted Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upvote",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        logicalKey:
          "workflow:confirmation:upvote:control-state:comment-beta-upvote",
        detail: expect.objectContaining({
          action: "upvote",
          source: "control_state_change",
          targetText: "Comment Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer upvote confirmation when pressed state was already on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          650,
          "Upvote Comment Alpha",
          true,
          "comment-alpha-upvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          651,
          "Upvote Comment Alpha",
          true,
          "comment-alpha-upvote",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

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
