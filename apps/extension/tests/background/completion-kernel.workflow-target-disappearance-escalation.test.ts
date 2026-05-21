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

describe("completion kernel target-disappearance escalation workflow confirmation", () => {
  test("accepts escalate confirmation from named incident disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      pageContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      elements: [
        actionButton(541, "Escalate Incident Alpha"),
        actionButton(542, "Escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Beta Escalate Incident Beta",
      pageContent: "Open incidents Incident Beta Escalate Incident Beta",
      elements: [actionButton(542, "Escalate Incident Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:incident-alpha",
        detail: expect.objectContaining({
          action: "escalate",
          source: "target_disappearance",
          text: "Escalated target no longer visible: Incident Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects escalate target-disappearance evidence for the wrong requested incident", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      pageContent:
        "Open incidents Incident Alpha Escalate Incident Alpha Incident Beta Escalate Incident Beta",
      elements: [
        actionButton(541, "Escalate Incident Alpha"),
        actionButton(542, "Escalate Incident Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:incident-beta",
        detail: expect.objectContaining({
          action: "escalate",
          source: "target_disappearance",
          text: "Escalated target no longer visible: Incident Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer escalate confirmation while the named incident remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha Escalate Incident Alpha",
      elements: [actionButton(541, "Escalate Incident Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer escalate confirmation from a generic escalate button", () => {
    const genericEscalateButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Escalate",
      attributes: {
        id: "escalate",
        "aria-label": "Escalate",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate",
      pageContent: "Open incidents Incident Alpha Escalate",
      elements: [genericEscalateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer escalate confirmation from a generic escalate incident control", () => {
    const genericEscalateIncidentButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Escalate incident",
      attributes: {
        id: "escalate-incident",
        "aria-label": "Escalate incident",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha Escalate incident",
      pageContent: "Open incidents Incident Alpha Escalate incident",
      elements: [genericEscalateIncidentButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not accept deescalate disappearance as escalate confirmation", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open incidents Incident Alpha De-escalate Incident Alpha",
      pageContent: "Open incidents Incident Alpha De-escalate Incident Alpha",
      elements: [actionButton(541, "De-escalate Incident Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open incidents",
      pageContent: "Open incidents",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: current,
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
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
    expect(decision).toMatchObject({
      status: "needs_verification",
      reason: "Requested action has no matching visible confirmation evidence yet.",
    });
  });

});

