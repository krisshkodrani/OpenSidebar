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

describe("completion kernel tag target-disappearance tagging workflow confirmation", () => {
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
});
