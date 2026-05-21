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

});
