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

describe("completion kernel flag target-disappearance flagging workflow confirmation", () => {
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
