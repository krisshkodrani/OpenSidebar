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

describe("completion kernel collaboration duplication and invitation workflow confirmation", () => {
  test("accepts duplicate confirmation from named template disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        actionButton(567, "Duplicate Template Alpha"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Beta Duplicate Template Beta",
      elements: [actionButton(568, "Duplicate Template Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:duplicate:template-alpha",
        detail: expect.objectContaining({
          action: "duplicate",
          source: "target_disappearance",
          text: "Duplicated target no longer visible: Template Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects duplicate target-disappearance evidence for the wrong requested template", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        actionButton(567, "Duplicate Template Alpha"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 568 },
      result: "Clicked element 568.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:duplicate:template-beta",
        detail: expect.objectContaining({
          action: "duplicate",
          source: "target_disappearance",
          text: "Duplicated target no longer visible: Template Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer duplicate confirmation while the named template remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer duplicate confirmation from a generic duplicate template control", () => {
    const genericDuplicateTemplateButton: TaggedElement = {
      tag: 567,
      tagName: "button",
      role: "button",
      text: "Duplicate template",
      attributes: {
        id: "duplicate-template",
        "aria-label": "Duplicate template",
      },
      rect: { x: 500, y: 80, width: 150, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available templates Template Alpha Duplicate template",
      pageContent: "Available templates Template Alpha Duplicate template",
      elements: [genericDuplicateTemplateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available work",
      pageContent: "Available work",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

});
