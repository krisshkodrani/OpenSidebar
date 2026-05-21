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

describe("completion kernel workflow vote control-state toggle confirmation", () => {
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
});
