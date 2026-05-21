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

describe("completion kernel workflow tag/flag data-state confirmation", () => {
  test("accepts tag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          666,
          "Tag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          667,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Tag Record Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 666 },
      result: "Clicked element 666.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Tagged Record Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "tag",
      targetLabel: "Record Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:tag:control-state:record-alpha-tag",
        detail: expect.objectContaining({
          action: "tag",
          source: "control_state_change",
          targetText: "Record Alpha",
          text: "Control state changed to tagged: Tag Record Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts untag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          668,
          "Untag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          669,
          "Untag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Untag Record Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 668 },
      result: "Clicked element 668.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Untagged Record Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "untag",
      targetLabel: "Record Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:untag:control-state:record-alpha-tag",
        detail: expect.objectContaining({
          action: "untag",
          source: "control_state_change",
          targetText: "Record Alpha",
          text: "Control state changed to untagged: Untag Record Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts flag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          670,
          "Flag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          671,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Flag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 670 },
      result: "Clicked element 670.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Flagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "flag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:flag:control-state:message-alpha-flag",
        detail: expect.objectContaining({
          action: "flag",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to flagged: Flag Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unflag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          672,
          "Unflag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          673,
          "Unflag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unflag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 672 },
      result: "Clicked element 672.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unflagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unflag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unflag:control-state:message-alpha-flag",
        detail: expect.objectContaining({
          action: "unflag",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to unflagged: Unflag Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer tag confirmation when data-state was already tagged", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          666,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          667,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 666 },
      result: "Clicked element 666.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer untag confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          668,
          "Untag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          669,
          "Untag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 668 },
      result: "Clicked element 668.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer flag confirmation when data-state was already flagged", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          670,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          671,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 670 },
      result: "Clicked element 670.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unflag confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          672,
          "Unflag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          673,
          "Unflag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 672 },
      result: "Clicked element 672.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
