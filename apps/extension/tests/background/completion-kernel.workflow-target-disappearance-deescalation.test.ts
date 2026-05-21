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

describe("completion kernel target-disappearance deescalation workflow confirmation", () => {
  test("accepts deescalate confirmation from named incident disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      elements: [
        actionButton(543, "De-escalate Incident Alpha"),
        actionButton(544, "De-escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Beta De-escalate Incident Beta",
      elements: [actionButton(544, "De-escalate Incident Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-alpha",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects deescalate target-disappearance evidence for the wrong requested incident", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha Incident Beta De-escalate Incident Beta",
      elements: [
        actionButton(543, "De-escalate Incident Alpha"),
        actionButton(544, "De-escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent:
        "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 544 },
      result: "Clicked element 544.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:deescalate:incident-beta",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "target_disappearance",
          text: "De-escalated target no longer visible: Incident Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer deescalate confirmation while the named incident remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Escalated incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(543, "De-escalate Incident Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation from a generic deescalate button", () => {
    const genericDeescalateButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "De-escalate",
      attributes: {
        id: "de-escalate",
        "aria-label": "De-escalate",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate",
      pageContent: "Escalated incidents Incident Alpha De-escalate",
      elements: [genericDeescalateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents",
      pageContent: "Escalated incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation from a generic deescalate incident control", () => {
    const genericDeescalateIncidentButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "De-escalate incident",
      attributes: {
        id: "de-escalate-incident",
        "aria-label": "De-escalate incident",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Escalated incidents Incident Alpha De-escalate incident",
      pageContent: "Escalated incidents Incident Alpha De-escalate incident",
      elements: [genericDeescalateIncidentButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Escalated incidents",
      pageContent: "Escalated incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
