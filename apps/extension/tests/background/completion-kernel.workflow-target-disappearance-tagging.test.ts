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

describe("completion kernel target-disappearance tagging workflow confirmation", () => {
  test("accepts untag confirmation from named tagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      pageContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      elements: [
        actionButton(523, "Untag Issue Alpha"),
        actionButton(524, "Untag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues Issue Beta Untag Issue Beta",
      pageContent: "Tagged issues Issue Beta Untag Issue Beta",
      elements: [actionButton(524, "Untag Issue Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Untag Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Untagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "untag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:untag:issue-alpha",
        detail: expect.objectContaining({
          action: "untag",
          source: "target_disappearance",
          text: "Untagged target no longer visible: Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects untag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      pageContent:
        "Tagged issues Issue Alpha Untag Issue Alpha Issue Beta Untag Issue Beta",
      elements: [
        actionButton(523, "Untag Issue Alpha"),
        actionButton(524, "Untag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      pageContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      elements: [actionButton(523, "Untag Issue Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Untag Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 524 },
      result: "Clicked element 524.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Untagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "untag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:untag:issue-beta",
        detail: expect.objectContaining({
          action: "untag",
          source: "target_disappearance",
          text: "Untagged target no longer visible: Issue Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer untag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      pageContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      elements: [actionButton(523, "Untag Issue Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      pageContent: "Tagged issues Issue Alpha Untag Issue Alpha",
      elements: [actionButton(523, "Untag Issue Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer untag confirmation from a generic untag button", () => {
    const genericUntagButton: TaggedElement = {
      tag: 523,
      tagName: "button",
      role: "button",
      text: "Untag",
      attributes: {
        id: "untag",
        "aria-label": "Untag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Tagged issues Issue Alpha Untag",
      pageContent: "Tagged issues Issue Alpha Untag",
      elements: [genericUntagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Tagged issues",
      pageContent: "Tagged issues",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 523 },
      result: "Clicked element 523.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts tag confirmation from named untagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      pageContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      elements: [
        actionButton(527, "Tag Issue Alpha"),
        actionButton(528, "Tag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues Issue Beta Tag Issue Beta",
      pageContent: "Untagged issues Issue Beta Tag Issue Beta",
      elements: [actionButton(528, "Tag Issue Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Tag Issue Alpha.",
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
      summary: "Tagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "tag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:tag:issue-alpha",
        detail: expect.objectContaining({
          action: "tag",
          source: "target_disappearance",
          text: "Tagged target no longer visible: Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects tag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      pageContent:
        "Untagged issues Issue Alpha Tag Issue Alpha Issue Beta Tag Issue Beta",
      elements: [
        actionButton(527, "Tag Issue Alpha"),
        actionButton(528, "Tag Issue Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      pageContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      elements: [actionButton(527, "Tag Issue Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Tag Issue Alpha.",
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
      summary: "Tagged Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "tag",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:tag:issue-beta",
        detail: expect.objectContaining({
          action: "tag",
          source: "target_disappearance",
          text: "Tagged target no longer visible: Issue Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer tag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      pageContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      elements: [actionButton(527, "Tag Issue Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      pageContent: "Untagged issues Issue Alpha Tag Issue Alpha",
      elements: [actionButton(527, "Tag Issue Alpha")],
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

  test("does not infer tag confirmation from a generic tag button", () => {
    const genericTagButton: TaggedElement = {
      tag: 527,
      tagName: "button",
      role: "button",
      text: "Tag",
      attributes: {
        id: "tag",
        "aria-label": "Tag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Untagged issues Issue Alpha Tag",
      pageContent: "Untagged issues Issue Alpha Tag",
      elements: [genericTagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Untagged issues",
      pageContent: "Untagged issues",
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

  test("accepts unflag confirmation from named flagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      pageContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      elements: [
        actionButton(525, "Unflag Message Alpha"),
        actionButton(526, "Unflag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages Message Beta Unflag Message Beta",
      pageContent: "Flagged messages Message Beta Unflag Message Beta",
      elements: [actionButton(526, "Unflag Message Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unflag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
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
        logicalKey: "workflow:confirmation:unflag:message-alpha",
        detail: expect.objectContaining({
          action: "unflag",
          source: "target_disappearance",
          text: "Unflagged target no longer visible: Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unflag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      pageContent:
        "Flagged messages Message Alpha Unflag Message Alpha Message Beta Unflag Message Beta",
      elements: [
        actionButton(525, "Unflag Message Alpha"),
        actionButton(526, "Unflag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag Message Alpha",
      pageContent: "Flagged messages Message Alpha Unflag Message Alpha",
      elements: [actionButton(525, "Unflag Message Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unflag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 526 },
      result: "Clicked element 526.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
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
        logicalKey: "workflow:confirmation:unflag:message-beta",
        detail: expect.objectContaining({
          action: "unflag",
          source: "target_disappearance",
          text: "Unflagged target no longer visible: Message Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unflag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag Message Alpha",
      pageContent: "Flagged messages Message Alpha Unflag Message Alpha",
      elements: [actionButton(525, "Unflag Message Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag Message Alpha",
      pageContent: "Flagged messages Message Alpha Unflag Message Alpha",
      elements: [actionButton(525, "Unflag Message Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unflag confirmation from a generic unflag button", () => {
    const genericUnflagButton: TaggedElement = {
      tag: 525,
      tagName: "button",
      role: "button",
      text: "Unflag",
      attributes: {
        id: "unflag",
        "aria-label": "Unflag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Flagged messages Message Alpha Unflag",
      pageContent: "Flagged messages Message Alpha Unflag",
      elements: [genericUnflagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Flagged messages",
      pageContent: "Flagged messages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 525 },
      result: "Clicked element 525.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts flag confirmation from named unflagged target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      pageContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      elements: [
        actionButton(529, "Flag Message Alpha"),
        actionButton(530, "Flag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages Message Beta Flag Message Beta",
      pageContent: "Unflagged messages Message Beta Flag Message Beta",
      elements: [actionButton(530, "Flag Message Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Flag Message Alpha.",
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
        logicalKey: "workflow:confirmation:flag:message-alpha",
        detail: expect.objectContaining({
          action: "flag",
          source: "target_disappearance",
          text: "Flagged target no longer visible: Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects flag target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      pageContent:
        "Unflagged messages Message Alpha Flag Message Alpha Message Beta Flag Message Beta",
      elements: [
        actionButton(529, "Flag Message Alpha"),
        actionButton(530, "Flag Message Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag Message Alpha",
      pageContent: "Unflagged messages Message Alpha Flag Message Alpha",
      elements: [actionButton(529, "Flag Message Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Flag Message Alpha.",
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
        logicalKey: "workflow:confirmation:flag:message-beta",
        detail: expect.objectContaining({
          action: "flag",
          source: "target_disappearance",
          text: "Flagged target no longer visible: Message Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer flag confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag Message Alpha",
      pageContent: "Unflagged messages Message Alpha Flag Message Alpha",
      elements: [actionButton(529, "Flag Message Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag Message Alpha",
      pageContent: "Unflagged messages Message Alpha Flag Message Alpha",
      elements: [actionButton(529, "Flag Message Alpha")],
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

  test("does not infer flag confirmation from a generic flag button", () => {
    const genericFlagButton: TaggedElement = {
      tag: 529,
      tagName: "button",
      role: "button",
      text: "Flag",
      attributes: {
        id: "flag",
        "aria-label": "Flag",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unflagged messages Message Alpha Flag",
      pageContent: "Unflagged messages Message Alpha Flag",
      elements: [genericFlagButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unflagged messages",
      pageContent: "Unflagged messages",
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
