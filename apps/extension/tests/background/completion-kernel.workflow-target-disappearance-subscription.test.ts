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

describe("completion kernel target-disappearance subscription workflow confirmation", () => {
  test("accepts unsubscribe confirmation from named subscription disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      elements: [
        actionButton(527, "Unsubscribe from Channel Alpha"),
        actionButton(528, "Unsubscribe from Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Beta Unsubscribe from Channel Beta",
      pageContent:
        "Subscribed channels Channel Beta Unsubscribe from Channel Beta",
      elements: [actionButton(528, "Unsubscribe from Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsubscribe from Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsubscribed from Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsubscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsubscribe:channel-alpha",
        detail: expect.objectContaining({
          action: "unsubscribe",
          source: "target_disappearance",
          text: "Unsubscribed target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unsubscribe target-disappearance evidence for the wrong requested subscription", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha Channel Beta Unsubscribe from Channel Beta",
      elements: [
        actionButton(527, "Unsubscribe from Channel Alpha"),
        actionButton(528, "Unsubscribe from Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      elements: [actionButton(527, "Unsubscribe from Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsubscribe from Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 528 },
      result: "Clicked element 528.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsubscribed from Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsubscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsubscribe:channel-beta",
        detail: expect.objectContaining({
          action: "unsubscribe",
          source: "target_disappearance",
          text: "Unsubscribed target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unsubscribe confirmation while the named subscription remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      elements: [actionButton(527, "Unsubscribe from Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      pageContent:
        "Subscribed channels Channel Alpha Unsubscribe from Channel Alpha",
      elements: [actionButton(527, "Unsubscribe from Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsubscribe confirmation from a generic unsubscribe button", () => {
    const genericUnsubscribeButton: TaggedElement = {
      tag: 527,
      tagName: "button",
      role: "button",
      text: "Unsubscribe",
      attributes: {
        id: "unsubscribe",
        "aria-label": "Unsubscribe",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Subscribed channels Channel Alpha Unsubscribe",
      pageContent: "Subscribed channels Channel Alpha Unsubscribe",
      elements: [genericUnsubscribeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Subscribed channels",
      pageContent: "Subscribed channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 527 },
      result: "Clicked element 527.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts subscribe confirmation from named unsubscribed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      elements: [
        actionButton(531, "Subscribe to Channel Alpha"),
        actionButton(532, "Subscribe to Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Beta Subscribe to Channel Beta",
      pageContent:
        "Unsubscribed channels Channel Beta Subscribe to Channel Beta",
      elements: [actionButton(532, "Subscribe to Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Subscribe to Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Subscribed to Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "subscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:subscribe:channel-alpha",
        detail: expect.objectContaining({
          action: "subscribe",
          source: "target_disappearance",
          text: "Subscribed target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects subscribe target-disappearance evidence for the wrong requested subscription", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha Channel Beta Subscribe to Channel Beta",
      elements: [
        actionButton(531, "Subscribe to Channel Alpha"),
        actionButton(532, "Subscribe to Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      elements: [actionButton(531, "Subscribe to Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Subscribe to Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 532 },
      result: "Clicked element 532.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Subscribed to Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "subscribe",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:subscribe:channel-beta",
        detail: expect.objectContaining({
          action: "subscribe",
          source: "target_disappearance",
          text: "Subscribed target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer subscribe confirmation while the named subscription remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      elements: [actionButton(531, "Subscribe to Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      pageContent:
        "Unsubscribed channels Channel Alpha Subscribe to Channel Alpha",
      elements: [actionButton(531, "Subscribe to Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer subscribe confirmation from a generic subscribe button", () => {
    const genericSubscribeButton: TaggedElement = {
      tag: 531,
      tagName: "button",
      role: "button",
      text: "Subscribe",
      attributes: {
        id: "subscribe",
        "aria-label": "Subscribe",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unsubscribed channels Channel Alpha Subscribe",
      pageContent: "Unsubscribed channels Channel Alpha Subscribe",
      elements: [genericSubscribeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unsubscribed channels",
      pageContent: "Unsubscribed channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts follow confirmation from named unfollowed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      pageContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      elements: [
        actionButton(533, "Follow Topic Alpha"),
        actionButton(534, "Follow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Beta Follow Topic Beta",
      pageContent: "Unfollowed topics Topic Beta Follow Topic Beta",
      elements: [actionButton(534, "Follow Topic Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Follow Topic Alpha.",
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
      summary: "Followed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "follow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:follow:topic-alpha",
        detail: expect.objectContaining({
          action: "follow",
          source: "target_disappearance",
          text: "Followed target no longer visible: Topic Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects follow target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      pageContent:
        "Unfollowed topics Topic Alpha Follow Topic Alpha Topic Beta Follow Topic Beta",
      elements: [
        actionButton(533, "Follow Topic Alpha"),
        actionButton(534, "Follow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      pageContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      elements: [actionButton(533, "Follow Topic Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Follow Topic Alpha.",
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
      summary: "Followed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "follow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:follow:topic-beta",
        detail: expect.objectContaining({
          action: "follow",
          source: "target_disappearance",
          text: "Followed target no longer visible: Topic Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer follow confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      pageContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      elements: [actionButton(533, "Follow Topic Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      pageContent: "Unfollowed topics Topic Alpha Follow Topic Alpha",
      elements: [actionButton(533, "Follow Topic Alpha")],
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

  test("does not infer follow confirmation from a generic follow button", () => {
    const genericFollowButton: TaggedElement = {
      tag: 533,
      tagName: "button",
      role: "button",
      text: "Follow",
      attributes: {
        id: "follow",
        "aria-label": "Follow",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unfollowed topics Topic Alpha Follow",
      pageContent: "Unfollowed topics Topic Alpha Follow",
      elements: [genericFollowButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfollowed topics",
      pageContent: "Unfollowed topics",
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

  test("accepts unfollow confirmation from named followed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      pageContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      elements: [
        actionButton(529, "Unfollow Topic Alpha"),
        actionButton(530, "Unfollow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics Topic Beta Unfollow Topic Beta",
      pageContent: "Followed topics Topic Beta Unfollow Topic Beta",
      elements: [actionButton(530, "Unfollow Topic Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfollow Topic Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfollowed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfollow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfollow:topic-alpha",
        detail: expect.objectContaining({
          action: "unfollow",
          source: "target_disappearance",
          text: "Unfollowed target no longer visible: Topic Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unfollow target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      pageContent:
        "Followed topics Topic Alpha Unfollow Topic Alpha Topic Beta Unfollow Topic Beta",
      elements: [
        actionButton(529, "Unfollow Topic Alpha"),
        actionButton(530, "Unfollow Topic Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      pageContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      elements: [actionButton(529, "Unfollow Topic Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfollow Topic Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 530 },
      result: "Clicked element 530.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unfollowed Topic Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfollow",
      targetLabel: "Topic Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfollow:topic-beta",
        detail: expect.objectContaining({
          action: "unfollow",
          source: "target_disappearance",
          text: "Unfollowed target no longer visible: Topic Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unfollow confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      pageContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      elements: [actionButton(529, "Unfollow Topic Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      pageContent: "Followed topics Topic Alpha Unfollow Topic Alpha",
      elements: [actionButton(529, "Unfollow Topic Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unfollow confirmation from a generic unfollow button", () => {
    const genericUnfollowButton: TaggedElement = {
      tag: 529,
      tagName: "button",
      role: "button",
      text: "Unfollow",
      attributes: {
        id: "unfollow",
        "aria-label": "Unfollow",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Followed topics Topic Alpha Unfollow",
      pageContent: "Followed topics Topic Alpha Unfollow",
      elements: [genericUnfollowButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Followed topics",
      pageContent: "Followed topics",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
