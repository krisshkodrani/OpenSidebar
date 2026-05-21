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

describe("completion kernel target-disappearance follow workflow confirmation", () => {
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
