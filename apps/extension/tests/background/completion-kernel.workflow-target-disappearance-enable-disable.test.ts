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

describe("completion kernel enable and disable target-disappearance access-control workflow confirmation", () => {
  test("accepts enable confirmation from named disabled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      pageContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      elements: [
        actionButton(553, "Enable Feature Alpha"),
        actionButton(554, "Enable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features Feature Beta Enable Feature Beta",
      pageContent: "Disabled features Feature Beta Enable Feature Beta",
      elements: [actionButton(554, "Enable Feature Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:feature-alpha",
        detail: expect.objectContaining({
          action: "enable",
          source: "target_disappearance",
          text: "Enabled target no longer visible: Feature Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects enable target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      pageContent:
        "Disabled features Feature Alpha Enable Feature Alpha Feature Beta Enable Feature Beta",
      elements: [
        actionButton(553, "Enable Feature Alpha"),
        actionButton(554, "Enable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable Feature Alpha",
      pageContent: "Disabled features Feature Alpha Enable Feature Alpha",
      elements: [actionButton(553, "Enable Feature Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 554 },
      result: "Clicked element 554.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:feature-beta",
        detail: expect.objectContaining({
          action: "enable",
          source: "target_disappearance",
          text: "Enabled target no longer visible: Feature Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer enable confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable Feature Alpha",
      pageContent: "Disabled features Feature Alpha Enable Feature Alpha",
      elements: [actionButton(553, "Enable Feature Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable Feature Alpha",
      pageContent: "Disabled features Feature Alpha Enable Feature Alpha",
      elements: [actionButton(553, "Enable Feature Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer enable confirmation from a generic enable button", () => {
    const genericEnableButton: TaggedElement = {
      tag: 553,
      tagName: "button",
      role: "button",
      text: "Enable",
      attributes: {
        id: "enable",
        "aria-label": "Enable",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Disabled features Feature Alpha Enable",
      pageContent: "Disabled features Feature Alpha Enable",
      elements: [genericEnableButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Disabled features",
      pageContent: "Disabled features",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts disable confirmation from named enabled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      pageContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      elements: [
        actionButton(553, "Disable Feature Alpha"),
        actionButton(554, "Disable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features Feature Beta Disable Feature Beta",
      pageContent: "Enabled features Feature Beta Disable Feature Beta",
      elements: [actionButton(554, "Disable Feature Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:feature-alpha",
        detail: expect.objectContaining({
          action: "disable",
          source: "target_disappearance",
          text: "Disabled target no longer visible: Feature Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects disable target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      pageContent:
        "Enabled features Feature Alpha Disable Feature Alpha Feature Beta Disable Feature Beta",
      elements: [
        actionButton(553, "Disable Feature Alpha"),
        actionButton(554, "Disable Feature Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable Feature Alpha",
      pageContent: "Enabled features Feature Alpha Disable Feature Alpha",
      elements: [actionButton(553, "Disable Feature Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 554 },
      result: "Clicked element 554.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:feature-beta",
        detail: expect.objectContaining({
          action: "disable",
          source: "target_disappearance",
          text: "Disabled target no longer visible: Feature Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer disable confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable Feature Alpha",
      pageContent: "Enabled features Feature Alpha Disable Feature Alpha",
      elements: [actionButton(553, "Disable Feature Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable Feature Alpha",
      pageContent: "Enabled features Feature Alpha Disable Feature Alpha",
      elements: [actionButton(553, "Disable Feature Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disable confirmation from a generic disable button", () => {
    const genericDisableButton: TaggedElement = {
      tag: 553,
      tagName: "button",
      role: "button",
      text: "Disable",
      attributes: {
        id: "disable",
        "aria-label": "Disable",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Enabled features Feature Alpha Disable",
      pageContent: "Enabled features Feature Alpha Disable",
      elements: [genericDisableButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Enabled features",
      pageContent: "Enabled features",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 553 },
      result: "Clicked element 553.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
