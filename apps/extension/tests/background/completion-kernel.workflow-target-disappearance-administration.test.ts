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

describe("completion kernel target-disappearance administration workflow confirmation", () => {
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
