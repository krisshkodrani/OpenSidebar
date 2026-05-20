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

describe("completion kernel target-disappearance operational workflow confirmation", () => {
  test("accepts unschedule confirmation from named scheduled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      elements: [
        actionButton(543, "Unschedule Report Alpha"),
        actionButton(544, "Unschedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Beta Unschedule Report Beta",
      pageContent:
        "Scheduled reports Report Beta Unschedule Report Beta",
      elements: [actionButton(544, "Unschedule Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unschedule Report Alpha.",
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
      summary: "Unscheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unschedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unschedule:report-alpha",
        detail: expect.objectContaining({
          action: "unschedule",
          source: "target_disappearance",
          text: "Unscheduled target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unschedule target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha Report Beta Unschedule Report Beta",
      elements: [
        actionButton(543, "Unschedule Report Alpha"),
        actionButton(544, "Unschedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      elements: [actionButton(543, "Unschedule Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unschedule Report Alpha.",
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
      summary: "Unscheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unschedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unschedule:report-beta",
        detail: expect.objectContaining({
          action: "unschedule",
          source: "target_disappearance",
          text: "Unscheduled target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unschedule confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      elements: [actionButton(543, "Unschedule Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      pageContent:
        "Scheduled reports Report Alpha Unschedule Report Alpha",
      elements: [actionButton(543, "Unschedule Report Alpha")],
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

  test("does not infer unschedule confirmation from a generic unschedule button", () => {
    const genericUnscheduleButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "Unschedule",
      attributes: {
        id: "unschedule",
        "aria-label": "Unschedule",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Scheduled reports Report Alpha Unschedule",
      pageContent: "Scheduled reports Report Alpha Unschedule",
      elements: [genericUnscheduleButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Scheduled reports",
      pageContent: "Scheduled reports",
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

  test("accepts unassign confirmation from named assigned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      pageContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      elements: [
        actionButton(545, "Unassign Ticket Alpha"),
        actionButton(546, "Unassign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Beta Unassign Ticket Beta",
      pageContent: "Assigned tickets Ticket Beta Unassign Ticket Beta",
      elements: [actionButton(546, "Unassign Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
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
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unassign:ticket-alpha",
        detail: expect.objectContaining({
          action: "unassign",
          source: "target_disappearance",
          text: "Unassigned target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unassign target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      pageContent:
        "Assigned tickets Ticket Alpha Unassign Ticket Alpha Ticket Beta Unassign Ticket Beta",
      elements: [
        actionButton(545, "Unassign Ticket Alpha"),
        actionButton(546, "Unassign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      elements: [actionButton(545, "Unassign Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
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
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unassign:ticket-beta",
        detail: expect.objectContaining({
          action: "unassign",
          source: "target_disappearance",
          text: "Unassigned target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unassign confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      elements: [actionButton(545, "Unassign Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Assigned tickets Ticket Alpha Unassign Ticket Alpha",
      elements: [actionButton(545, "Unassign Ticket Alpha")],
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

  test("does not infer unassign confirmation from a generic unassign button", () => {
    const genericUnassignButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Unassign",
      attributes: {
        id: "unassign",
        "aria-label": "Unassign",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Assigned tickets Ticket Alpha Unassign",
      pageContent: "Assigned tickets Ticket Alpha Unassign",
      elements: [genericUnassignButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Assigned tickets",
      pageContent: "Assigned tickets",
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

  test("accepts cancel confirmation from named target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      pageContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      elements: [
        actionButton(547, "Cancel Request Alpha"),
        actionButton(548, "Cancel Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Beta Cancel Request Beta",
      pageContent: "Active requests Request Beta Cancel Request Beta",
      elements: [actionButton(548, "Cancel Request Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Request Alpha.",
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
      summary: "Canceled Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:request-alpha",
        detail: expect.objectContaining({
          action: "cancel",
          source: "target_disappearance",
          text: "Canceled target no longer visible: Request Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects cancel target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      pageContent:
        "Active requests Request Alpha Cancel Request Alpha Request Beta Cancel Request Beta",
      elements: [
        actionButton(547, "Cancel Request Alpha"),
        actionButton(548, "Cancel Request Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Request Alpha.",
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
      summary: "Canceled Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:request-beta",
        detail: expect.objectContaining({
          action: "cancel",
          source: "target_disappearance",
          text: "Canceled target no longer visible: Request Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer cancel confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel Request Alpha",
      pageContent: "Active requests Request Alpha Cancel Request Alpha",
      elements: [actionButton(547, "Cancel Request Alpha")],
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

  test("does not infer cancel confirmation from a generic cancel button", () => {
    const genericCancelButton: TaggedElement = {
      tag: 547,
      tagName: "button",
      role: "button",
      text: "Cancel",
      attributes: {
        id: "cancel",
        "aria-label": "Cancel",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Active requests Request Alpha Cancel",
      pageContent: "Active requests Request Alpha Cancel",
      elements: [genericCancelButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Active requests",
      pageContent: "Active requests",
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

  test("accepts unlock confirmation from named locked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      pageContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      elements: [
        actionButton(549, "Unlock Account Alpha"),
        actionButton(550, "Unlock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts Account Beta Unlock Account Beta",
      pageContent: "Locked accounts Account Beta Unlock Account Beta",
      elements: [actionButton(550, "Unlock Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:account-alpha",
        detail: expect.objectContaining({
          action: "unlock",
          source: "target_disappearance",
          text: "Unlocked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unlock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      pageContent:
        "Locked accounts Account Alpha Unlock Account Alpha Account Beta Unlock Account Beta",
      elements: [
        actionButton(549, "Unlock Account Alpha"),
        actionButton(550, "Unlock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock Account Alpha",
      pageContent: "Locked accounts Account Alpha Unlock Account Alpha",
      elements: [actionButton(549, "Unlock Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 550 },
      result: "Clicked element 550.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:account-beta",
        detail: expect.objectContaining({
          action: "unlock",
          source: "target_disappearance",
          text: "Unlocked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unlock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock Account Alpha",
      pageContent: "Locked accounts Account Alpha Unlock Account Alpha",
      elements: [actionButton(549, "Unlock Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock Account Alpha",
      pageContent: "Locked accounts Account Alpha Unlock Account Alpha",
      elements: [actionButton(549, "Unlock Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlock confirmation from a generic unlock button", () => {
    const genericUnlockButton: TaggedElement = {
      tag: 549,
      tagName: "button",
      role: "button",
      text: "Unlock",
      attributes: {
        id: "unlock",
        "aria-label": "Unlock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Locked accounts Account Alpha Unlock",
      pageContent: "Locked accounts Account Alpha Unlock",
      elements: [genericUnlockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Locked accounts",
      pageContent: "Locked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 549 },
      result: "Clicked element 549.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts lock confirmation from named unlocked target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      pageContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      elements: [
        actionButton(551, "Lock Account Alpha"),
        actionButton(552, "Lock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Beta Lock Account Beta",
      pageContent: "Unlocked accounts Account Beta Lock Account Beta",
      elements: [actionButton(552, "Lock Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
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
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:account-alpha",
        detail: expect.objectContaining({
          action: "lock",
          source: "target_disappearance",
          text: "Locked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects lock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      pageContent:
        "Unlocked accounts Account Alpha Lock Account Alpha Account Beta Lock Account Beta",
      elements: [
        actionButton(551, "Lock Account Alpha"),
        actionButton(552, "Lock Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
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
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:account-beta",
        detail: expect.objectContaining({
          action: "lock",
          source: "target_disappearance",
          text: "Locked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer lock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      pageContent: "Unlocked accounts Account Alpha Lock Account Alpha",
      elements: [actionButton(551, "Lock Account Alpha")],
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

  test("does not infer lock confirmation from a generic lock button", () => {
    const genericLockButton: TaggedElement = {
      tag: 551,
      tagName: "button",
      role: "button",
      text: "Lock",
      attributes: {
        id: "lock",
        "aria-label": "Lock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unlocked accounts Account Alpha Lock",
      pageContent: "Unlocked accounts Account Alpha Lock",
      elements: [genericLockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlocked accounts",
      pageContent: "Unlocked accounts",
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

  test("accepts pause confirmation from named running target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      pageContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      elements: [
        actionButton(555, "Pause Job Alpha"),
        actionButton(556, "Pause Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Beta Pause Job Beta",
      pageContent: "Running jobs Job Beta Pause Job Beta",
      elements: [actionButton(556, "Pause Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pause:job-alpha",
        detail: expect.objectContaining({
          action: "pause",
          source: "target_disappearance",
          text: "Paused target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects pause target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      pageContent:
        "Running jobs Job Alpha Pause Job Alpha Job Beta Pause Job Beta",
      elements: [
        actionButton(555, "Pause Job Alpha"),
        actionButton(556, "Pause Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause Job Alpha",
      pageContent: "Running jobs Job Alpha Pause Job Alpha",
      elements: [actionButton(555, "Pause Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 556 },
      result: "Clicked element 556.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pause:job-beta",
        detail: expect.objectContaining({
          action: "pause",
          source: "target_disappearance",
          text: "Paused target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer pause confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause Job Alpha",
      pageContent: "Running jobs Job Alpha Pause Job Alpha",
      elements: [actionButton(555, "Pause Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause Job Alpha",
      pageContent: "Running jobs Job Alpha Pause Job Alpha",
      elements: [actionButton(555, "Pause Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer pause confirmation from a generic pause button", () => {
    const genericPauseButton: TaggedElement = {
      tag: 555,
      tagName: "button",
      role: "button",
      text: "Pause",
      attributes: {
        id: "pause",
        "aria-label": "Pause",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Pause",
      pageContent: "Running jobs Job Alpha Pause",
      elements: [genericPauseButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs",
      pageContent: "Running jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 555 },
      result: "Clicked element 555.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts resume confirmation from named paused target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      pageContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      elements: [
        actionButton(557, "Resume Job Alpha"),
        actionButton(558, "Resume Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs Job Beta Resume Job Beta",
      pageContent: "Paused jobs Job Beta Resume Job Beta",
      elements: [actionButton(558, "Resume Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:resume:job-alpha",
        detail: expect.objectContaining({
          action: "resume",
          source: "target_disappearance",
          text: "Resumed target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects resume target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      pageContent:
        "Paused jobs Job Alpha Resume Job Alpha Job Beta Resume Job Beta",
      elements: [
        actionButton(557, "Resume Job Alpha"),
        actionButton(558, "Resume Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume Job Alpha",
      pageContent: "Paused jobs Job Alpha Resume Job Alpha",
      elements: [actionButton(557, "Resume Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 558 },
      result: "Clicked element 558.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:resume:job-beta",
        detail: expect.objectContaining({
          action: "resume",
          source: "target_disappearance",
          text: "Resumed target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer resume confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume Job Alpha",
      pageContent: "Paused jobs Job Alpha Resume Job Alpha",
      elements: [actionButton(557, "Resume Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume Job Alpha",
      pageContent: "Paused jobs Job Alpha Resume Job Alpha",
      elements: [actionButton(557, "Resume Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer resume confirmation from a generic resume button", () => {
    const genericResumeButton: TaggedElement = {
      tag: 557,
      tagName: "button",
      role: "button",
      text: "Resume",
      attributes: {
        id: "resume",
        "aria-label": "Resume",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Paused jobs Job Alpha Resume",
      pageContent: "Paused jobs Job Alpha Resume",
      elements: [genericResumeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Paused jobs",
      pageContent: "Paused jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 557 },
      result: "Clicked element 557.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts start confirmation from named stopped target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      pageContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      elements: [
        actionButton(559, "Start Job Alpha"),
        actionButton(560, "Start Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Beta Start Job Beta",
      pageContent: "Stopped jobs Job Beta Start Job Beta",
      elements: [actionButton(560, "Start Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Start Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:job-alpha",
        detail: expect.objectContaining({
          action: "start",
          source: "target_disappearance",
          text: "Started target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects start target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      pageContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      elements: [
        actionButton(559, "Start Job Alpha"),
        actionButton(560, "Start Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Start Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 560 },
      result: "Clicked element 560.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:job-beta",
        detail: expect.objectContaining({
          action: "start",
          source: "target_disappearance",
          text: "Started target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer start confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer start confirmation from a generic start button", () => {
    const genericStartButton: TaggedElement = {
      tag: 559,
      tagName: "button",
      role: "button",
      text: "Start",
      attributes: {
        id: "start",
        "aria-label": "Start",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start",
      pageContent: "Stopped jobs Job Alpha Start",
      elements: [genericStartButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs",
      pageContent: "Stopped jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts stop confirmation from named running target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      pageContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      elements: [
        actionButton(561, "Stop Job Alpha"),
        actionButton(562, "Stop Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Beta Stop Job Beta",
      pageContent: "Running jobs Job Beta Stop Job Beta",
      elements: [actionButton(562, "Stop Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Stopped Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:job-alpha",
        detail: expect.objectContaining({
          action: "stop",
          source: "target_disappearance",
          text: "Stopped target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects stop target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      pageContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      elements: [
        actionButton(561, "Stop Job Alpha"),
        actionButton(562, "Stop Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 562 },
      result: "Clicked element 562.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Stopped Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:job-beta",
        detail: expect.objectContaining({
          action: "stop",
          source: "target_disappearance",
          text: "Stopped target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer stop confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer stop confirmation from a generic stop button", () => {
    const genericStopButton: TaggedElement = {
      tag: 561,
      tagName: "button",
      role: "button",
      text: "Stop",
      attributes: {
        id: "stop",
        "aria-label": "Stop",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop",
      pageContent: "Running jobs Job Alpha Stop",
      elements: [genericStopButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs",
      pageContent: "Running jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts assign confirmation from named unassigned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      pageContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      elements: [
        actionButton(563, "Assign Ticket Alpha"),
        actionButton(564, "Assign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Beta Assign Ticket Beta",
      pageContent: "Unassigned tickets Ticket Beta Assign Ticket Beta",
      elements: [actionButton(564, "Assign Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:ticket-alpha",
        detail: expect.objectContaining({
          action: "assign",
          source: "target_disappearance",
          text: "Assigned target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects assign target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      pageContent:
        "Unassigned tickets Ticket Alpha Assign Ticket Alpha Ticket Beta Assign Ticket Beta",
      elements: [
        actionButton(563, "Assign Ticket Alpha"),
        actionButton(564, "Assign Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 564 },
      result: "Clicked element 564.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:ticket-beta",
        detail: expect.objectContaining({
          action: "assign",
          source: "target_disappearance",
          text: "Assigned target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer assign confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      pageContent: "Unassigned tickets Ticket Alpha Assign Ticket Alpha",
      elements: [actionButton(563, "Assign Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer assign confirmation from a generic assign button", () => {
    const genericAssignButton: TaggedElement = {
      tag: 563,
      tagName: "button",
      role: "button",
      text: "Assign",
      attributes: {
        id: "assign",
        "aria-label": "Assign",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unassigned tickets Ticket Alpha Assign",
      pageContent: "Unassigned tickets Ticket Alpha Assign",
      elements: [genericAssignButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unassigned tickets",
      pageContent: "Unassigned tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts schedule confirmation from named unscheduled target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      pageContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      elements: [
        actionButton(565, "Schedule Report Alpha"),
        actionButton(566, "Schedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Beta Schedule Report Beta",
      pageContent: "Unscheduled reports Report Beta Schedule Report Beta",
      elements: [actionButton(566, "Schedule Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Schedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Scheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "schedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:schedule:report-alpha",
        detail: expect.objectContaining({
          action: "schedule",
          source: "target_disappearance",
          text: "Scheduled target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects schedule target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      pageContent:
        "Unscheduled reports Report Alpha Schedule Report Alpha Report Beta Schedule Report Beta",
      elements: [
        actionButton(565, "Schedule Report Alpha"),
        actionButton(566, "Schedule Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Schedule Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 566 },
      result: "Clicked element 566.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Scheduled Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "schedule",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:schedule:report-beta",
        detail: expect.objectContaining({
          action: "schedule",
          source: "target_disappearance",
          text: "Scheduled target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer schedule confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      pageContent: "Unscheduled reports Report Alpha Schedule Report Alpha",
      elements: [actionButton(565, "Schedule Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer schedule confirmation from a generic schedule button", () => {
    const genericScheduleButton: TaggedElement = {
      tag: 565,
      tagName: "button",
      role: "button",
      text: "Schedule",
      attributes: {
        id: "schedule",
        "aria-label": "Schedule",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unscheduled reports Report Alpha Schedule",
      pageContent: "Unscheduled reports Report Alpha Schedule",
      elements: [genericScheduleButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unscheduled reports",
      pageContent: "Unscheduled reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts revoke confirmation from named role disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      pageContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      elements: [
        actionButton(511, "Revoke Role Alpha"),
        actionButton(512, "Revoke Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Beta Revoke Role Beta",
      pageContent: "Roles Role Beta Revoke Role Beta",
      elements: [actionButton(512, "Revoke Role Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Revoke Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Revoked Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "revoke",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:revoke:role-alpha",
        detail: expect.objectContaining({
          action: "revoke",
          source: "target_disappearance",
          text: "Revoked target no longer visible: Role Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects revoke target-disappearance evidence for the wrong requested role", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      pageContent:
        "Roles Role Alpha Revoke Role Alpha Role Beta Revoke Role Beta",
      elements: [
        actionButton(511, "Revoke Role Alpha"),
        actionButton(512, "Revoke Role Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Revoke Role Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 512 },
      result: "Clicked element 512.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Revoked Role Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "revoke",
      targetLabel: "Role Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:revoke:role-beta",
        detail: expect.objectContaining({
          action: "revoke",
          source: "target_disappearance",
          text: "Revoked target no longer visible: Role Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer revoke confirmation while the named role remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke Role Alpha",
      pageContent: "Roles Role Alpha Revoke Role Alpha",
      elements: [actionButton(511, "Revoke Role Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer revoke confirmation from a generic revoke button", () => {
    const genericRevokeButton: TaggedElement = {
      tag: 511,
      tagName: "button",
      role: "button",
      text: "Revoke",
      attributes: {
        id: "revoke",
        "aria-label": "Revoke",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Roles Role Alpha Revoke",
      pageContent: "Roles Role Alpha Revoke",
      elements: [genericRevokeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Roles",
      pageContent: "Roles",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts block confirmation from named allowed target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      pageContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      elements: [
        actionButton(521, "Block User Alpha"),
        actionButton(522, "Block User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users User Beta Block User Beta",
      pageContent: "Allowed users User Beta Block User Beta",
      elements: [actionButton(522, "Block User Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Block User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Blocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "block",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:block:user-alpha",
        detail: expect.objectContaining({
          action: "block",
          source: "target_disappearance",
          text: "Blocked target no longer visible: User Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects block target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      pageContent:
        "Allowed users User Alpha Block User Alpha User Beta Block User Beta",
      elements: [
        actionButton(521, "Block User Alpha"),
        actionButton(522, "Block User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block User Alpha",
      pageContent: "Allowed users User Alpha Block User Alpha",
      elements: [actionButton(521, "Block User Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Block User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 522 },
      result: "Clicked element 522.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Blocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "block",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:block:user-beta",
        detail: expect.objectContaining({
          action: "block",
          source: "target_disappearance",
          text: "Blocked target no longer visible: User Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer block confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block User Alpha",
      pageContent: "Allowed users User Alpha Block User Alpha",
      elements: [actionButton(521, "Block User Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block User Alpha",
      pageContent: "Allowed users User Alpha Block User Alpha",
      elements: [actionButton(521, "Block User Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer block confirmation from a generic block button", () => {
    const genericBlockButton: TaggedElement = {
      tag: 521,
      tagName: "button",
      role: "button",
      text: "Block",
      attributes: {
        id: "block",
        "aria-label": "Block",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Allowed users User Alpha Block",
      pageContent: "Allowed users User Alpha Block",
      elements: [genericBlockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Allowed users",
      pageContent: "Allowed users",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 521 },
      result: "Clicked element 521.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unblock confirmation from named blocklist target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      pageContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      elements: [
        actionButton(513, "Unblock User Alpha"),
        actionButton(514, "Unblock User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Beta Unblock User Beta",
      pageContent: "Blocked users User Beta Unblock User Beta",
      elements: [actionButton(514, "Unblock User Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unblock User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unblocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unblock",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unblock:user-alpha",
        detail: expect.objectContaining({
          action: "unblock",
          source: "target_disappearance",
          text: "Unblocked target no longer visible: User Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unblock target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      pageContent:
        "Blocked users User Alpha Unblock User Alpha User Beta Unblock User Beta",
      elements: [
        actionButton(513, "Unblock User Alpha"),
        actionButton(514, "Unblock User Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unblock User Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 514 },
      result: "Clicked element 514.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unblocked User Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unblock",
      targetLabel: "User Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unblock:user-beta",
        detail: expect.objectContaining({
          action: "unblock",
          source: "target_disappearance",
          text: "Unblocked target no longer visible: User Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unblock confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock User Alpha",
      pageContent: "Blocked users User Alpha Unblock User Alpha",
      elements: [actionButton(513, "Unblock User Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unblock confirmation from a generic unblock button", () => {
    const genericUnblockButton: TaggedElement = {
      tag: 513,
      tagName: "button",
      role: "button",
      text: "Unblock",
      attributes: {
        id: "unblock",
        "aria-label": "Unblock",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Blocked users User Alpha Unblock",
      pageContent: "Blocked users User Alpha Unblock",
      elements: [genericUnblockButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Blocked users",
      pageContent: "Blocked users",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 513 },
      result: "Clicked element 513.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts suspend confirmation from named active target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      pageContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      elements: [
        actionButton(519, "Suspend Account Alpha"),
        actionButton(520, "Suspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts Account Beta Suspend Account Beta",
      pageContent: "Active accounts Account Beta Suspend Account Beta",
      elements: [actionButton(520, "Suspend Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Suspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Suspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "suspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:suspend:account-alpha",
        detail: expect.objectContaining({
          action: "suspend",
          source: "target_disappearance",
          text: "Suspended target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects suspend target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      pageContent:
        "Active accounts Account Alpha Suspend Account Alpha Account Beta Suspend Account Beta",
      elements: [
        actionButton(519, "Suspend Account Alpha"),
        actionButton(520, "Suspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend Account Alpha",
      pageContent: "Active accounts Account Alpha Suspend Account Alpha",
      elements: [actionButton(519, "Suspend Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Suspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 520 },
      result: "Clicked element 520.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Suspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "suspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:suspend:account-beta",
        detail: expect.objectContaining({
          action: "suspend",
          source: "target_disappearance",
          text: "Suspended target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer suspend confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend Account Alpha",
      pageContent: "Active accounts Account Alpha Suspend Account Alpha",
      elements: [actionButton(519, "Suspend Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend Account Alpha",
      pageContent: "Active accounts Account Alpha Suspend Account Alpha",
      elements: [actionButton(519, "Suspend Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer suspend confirmation from a generic suspend button", () => {
    const genericSuspendButton: TaggedElement = {
      tag: 519,
      tagName: "button",
      role: "button",
      text: "Suspend",
      attributes: {
        id: "suspend",
        "aria-label": "Suspend",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Active accounts Account Alpha Suspend",
      pageContent: "Active accounts Account Alpha Suspend",
      elements: [genericSuspendButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Active accounts",
      pageContent: "Active accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 519 },
      result: "Clicked element 519.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unsuspend confirmation from named suspended target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      pageContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      elements: [
        actionButton(515, "Unsuspend Account Alpha"),
        actionButton(516, "Unsuspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Beta Unsuspend Account Beta",
      pageContent: "Suspended accounts Account Beta Unsuspend Account Beta",
      elements: [actionButton(516, "Unsuspend Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsuspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsuspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsuspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsuspend:account-alpha",
        detail: expect.objectContaining({
          action: "unsuspend",
          source: "target_disappearance",
          text: "Unsuspended target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unsuspend target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      pageContent:
        "Suspended accounts Account Alpha Unsuspend Account Alpha Account Beta Unsuspend Account Beta",
      elements: [
        actionButton(515, "Unsuspend Account Alpha"),
        actionButton(516, "Unsuspend Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unsuspend Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 516 },
      result: "Clicked element 516.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unsuspended Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unsuspend",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unsuspend:account-beta",
        detail: expect.objectContaining({
          action: "unsuspend",
          source: "target_disappearance",
          text: "Unsuspended target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unsuspend confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      pageContent: "Suspended accounts Account Alpha Unsuspend Account Alpha",
      elements: [actionButton(515, "Unsuspend Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsuspend confirmation from a generic unsuspend button", () => {
    const genericUnsuspendButton: TaggedElement = {
      tag: 515,
      tagName: "button",
      role: "button",
      text: "Unsuspend",
      attributes: {
        id: "unsuspend",
        "aria-label": "Unsuspend",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Suspended accounts Account Alpha Unsuspend",
      pageContent: "Suspended accounts Account Alpha Unsuspend",
      elements: [genericUnsuspendButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Suspended accounts",
      pageContent: "Suspended accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 515 },
      result: "Clicked element 515.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

});
