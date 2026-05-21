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

describe("completion kernel save target-disappearance workflow confirmation", () => {
  test("accepts save confirmation from named draft disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      pageContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      elements: [
        actionButton(551, "Save Draft Alpha"),
        actionButton(552, "Save Draft Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Beta Save Draft Beta",
      pageContent: "Pending drafts Draft Beta Save Draft Beta",
      elements: [actionButton(552, "Save Draft Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:draft-alpha",
        detail: expect.objectContaining({
          action: "save",
          source: "target_disappearance",
          text: "Saved target no longer visible: Draft Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects save target-disappearance evidence for the wrong requested draft", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      pageContent:
        "Pending drafts Draft Alpha Save Draft Alpha Draft Beta Save Draft Beta",
      elements: [
        actionButton(551, "Save Draft Alpha"),
        actionButton(552, "Save Draft Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Save Draft Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 552 },
      result: "Clicked element 552.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Saved Draft Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
      targetLabel: "Draft Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:save:draft-beta",
        detail: expect.objectContaining({
          action: "save",
          source: "target_disappearance",
          text: "Saved target no longer visible: Draft Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer save confirmation while the named draft remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save Draft Alpha",
      pageContent: "Pending drafts Draft Alpha Save Draft Alpha",
      elements: [actionButton(551, "Save Draft Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer save confirmation from a generic save draft control", () => {
    const genericSaveDraftButton: TaggedElement = {
      tag: 551,
      tagName: "button",
      role: "button",
      text: "Save draft",
      attributes: {
        id: "save-draft",
        "aria-label": "Save draft",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending drafts Draft Alpha Save draft",
      pageContent: "Pending drafts Draft Alpha Save draft",
      elements: [genericSaveDraftButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending drafts",
      pageContent: "Pending drafts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 551 },
      result: "Clicked element 551.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
