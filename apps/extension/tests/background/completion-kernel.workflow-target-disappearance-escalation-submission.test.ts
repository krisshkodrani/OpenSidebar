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

describe("completion kernel target-disappearance escalation and submission workflow confirmation", () => {
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

  test("accepts complete confirmation from named task disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK002 Mark TASK002 complete",
      pageContent: "Open tasks TASK002 Mark TASK002 complete",
      elements: [actionButton(546, "Mark TASK002 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task001",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK001",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects complete target-disappearance evidence for the wrong requested task", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      pageContent:
        "Open tasks TASK001 Mark TASK001 complete TASK002 Mark TASK002 complete",
      elements: [
        actionButton(545, "Mark TASK001 complete"),
        actionButton(546, "Mark TASK002 complete"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:task002",
        detail: expect.objectContaining({
          action: "complete",
          source: "target_disappearance",
          text: "Completed target no longer visible: TASK002",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer complete confirmation while the named task remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Mark TASK001 complete",
      pageContent: "Open tasks TASK001 Mark TASK001 complete",
      elements: [actionButton(545, "Mark TASK001 complete")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete button", () => {
    const genericCompleteButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete",
      attributes: {
        id: "complete",
        "aria-label": "Complete",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete",
      pageContent: "Open tasks TASK001 Complete",
      elements: [genericCompleteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation from a generic complete task control", () => {
    const genericCompleteTaskButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Complete task",
      attributes: {
        id: "complete-task",
        "aria-label": "Complete task",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tasks TASK001 Complete task",
      pageContent: "Open tasks TASK001 Complete task",
      elements: [genericCompleteTaskButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tasks",
      pageContent: "Open tasks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts submit confirmation from named request disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      pageContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      elements: [
        actionButton(547, "Submit Request Alpha"),
        actionButton(548, "Submit Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Beta Submit Request Beta",
      pageContent: "Draft requests Request Beta Submit Request Beta",
      elements: [actionButton(548, "Submit Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:request-alpha",
        detail: expect.objectContaining({
          action: "submit",
          source: "target_disappearance",
          text: "Submitted target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects submit target-disappearance evidence for the wrong requested request", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      pageContent:
        "Draft requests Request Alpha Submit Request Alpha Request Beta Submit Request Beta",
      elements: [
        actionButton(547, "Submit Request Alpha"),
        actionButton(548, "Submit Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 548 },
      result: "Clicked element 548.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:request-beta",
        detail: expect.objectContaining({
          action: "submit",
          source: "target_disappearance",
          text: "Submitted target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer submit confirmation while the named request remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit Request Alpha",
      pageContent: "Draft requests Request Alpha Submit Request Alpha",
      elements: [actionButton(547, "Submit Request Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer submit confirmation from a generic submit request control", () => {
    const genericSubmitRequestButton: TaggedElement = {
      tag: 547,
      tagName: "button",
      role: "button",
      text: "Submit request",
      attributes: {
        id: "submit-request",
        "aria-label": "Submit request",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Draft requests Request Alpha Submit request",
      pageContent: "Draft requests Request Alpha Submit request",
      elements: [genericSubmitRequestButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Draft requests",
      pageContent: "Draft requests",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 547 },
      result: "Clicked element 547.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});

