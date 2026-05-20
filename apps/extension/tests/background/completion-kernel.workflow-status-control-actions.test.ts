import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
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
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      "aria-label": label,
    },
    rect: { x: 0, y: tag * 20, width: 120, height: 28 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel workflow status control-action confirmation", () => {
  test("accepts enable confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled Enable MFA",
      pageContent: "Security MFA Status: Disabled Enable MFA",
      elements: [actionButton(608, "Enable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled",
      pageContent: "Security MFA Status: Enabled",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:status:status-enabled",
        detail: expect.objectContaining({
          action: "enable",
          source: "status_change",
          text: "Status: Enabled",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts disable confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled Disable MFA",
      pageContent: "Security MFA Status: Enabled Disable MFA",
      elements: [actionButton(609, "Disable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled",
      pageContent: "Security MFA Status: Disabled",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 609 },
      result: "Clicked element 609.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:status:status-disabled",
        detail: expect.objectContaining({
          action: "disable",
          source: "status_change",
          text: "Status: Disabled",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer enable confirmation when status was already enabled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled Enable MFA",
      pageContent: "Security MFA Status: Enabled Enable MFA",
      elements: [actionButton(608, "Enable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Enabled",
      pageContent: "Security MFA Status: Enabled",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 608 },
      result: "Clicked element 608.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disable confirmation when status was already disabled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled Disable MFA",
      pageContent: "Security MFA Status: Disabled Disable MFA",
      elements: [actionButton(609, "Disable MFA")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security MFA Status: Disabled",
      pageContent: "Security MFA Status: Disabled",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 609 },
      result: "Clicked element 609.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts assign confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Open Assign ticket",
      pageContent: "Ticket INC005 Status: Open Assign ticket",
      elements: [actionButton(610, "Assign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned",
      pageContent: "Ticket INC005 Status: Assigned",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Assign the ticket.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 610 },
      result: "Clicked element 610.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Assigned the ticket.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:assign:status:status-assigned",
        detail: expect.objectContaining({
          action: "assign",
          source: "status_change",
          text: "Status: Assigned",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unassign confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned Unassign ticket",
      pageContent: "Ticket INC005 Status: Assigned Unassign ticket",
      elements: [actionButton(611, "Unassign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Unassigned",
      pageContent: "Ticket INC005 Status: Unassigned",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign the ticket.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 611 },
      result: "Clicked element 611.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unassigned the ticket.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unassign:status:status-unassigned",
        detail: expect.objectContaining({
          action: "unassign",
          source: "status_change",
          text: "Status: Unassigned",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer assign confirmation when status was already assigned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned Assign ticket",
      pageContent: "Ticket INC005 Status: Assigned Assign ticket",
      elements: [actionButton(610, "Assign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Assigned",
      pageContent: "Ticket INC005 Status: Assigned",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 610 },
      result: "Clicked element 610.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unassign confirmation when status was already unassigned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Unassigned Unassign ticket",
      pageContent: "Ticket INC005 Status: Unassigned Unassign ticket",
      elements: [actionButton(611, "Unassign ticket")],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket INC005 Status: Unassigned",
      pageContent: "Ticket INC005 Status: Unassigned",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 611 },
      result: "Clicked element 611.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps assigned status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Ticket Matrix",
      url: "https://example.test/tickets",
      visibleContent: "Ticket Matrix Assigned: Priya Shah Priority: High",
      pageContent:
        "Ticket Matrix Assigned: Priya Shah. Priority: High. The page explains assignment coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer ticket questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Priya Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "assigned",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts escalate confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Open Escalate incident",
      pageContent: "Incident INC006 Status: Open Escalate incident",
      elements: [actionButton(612, "Escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated",
      pageContent: "Incident INC006 Status: Escalated",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 612 },
      result: "Clicked element 612.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Escalated the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:escalate:status:status-escalated",
        detail: expect.objectContaining({
          action: "escalate",
          source: "status_change",
          text: "Status: Escalated",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts deescalate confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated De-escalate incident",
      pageContent: "Incident INC006 Status: Escalated De-escalate incident",
      elements: [actionButton(613, "De-escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: De-escalated",
      pageContent: "Incident INC006 Status: De-escalated",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 613 },
      result: "Clicked element 613.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "De-escalated the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:deescalate:status:status-de-escalated",
        detail: expect.objectContaining({
          action: "deescalate",
          source: "status_change",
          text: "Status: De-escalated",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer escalate confirmation when status was already escalated", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated Escalate incident",
      pageContent: "Incident INC006 Status: Escalated Escalate incident",
      elements: [actionButton(612, "Escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: Escalated",
      pageContent: "Incident INC006 Status: Escalated",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 612 },
      result: "Clicked element 612.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation when status was already deescalated", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Incident INC006 Status: De-escalated De-escalate incident",
      pageContent:
        "Incident INC006 Status: De-escalated De-escalate incident",
      elements: [actionButton(613, "De-escalate incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC006 Status: De-escalated",
      pageContent: "Incident INC006 Status: De-escalated",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 613 },
      result: "Clicked element 613.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps escalation owner questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Escalation owner: platform operations Priority: High",
      pageContent:
        "Support Matrix Escalation owner: platform operations. Priority: High. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the escalation owner?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "platform operations",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "escalation owner",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts lock confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Active Lock account",
      pageContent: "Account ACCT001 Status: Active Lock account",
      elements: [actionButton(614, "Lock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked",
      pageContent: "Account ACCT001 Status: Locked",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 614 },
      result: "Clicked element 614.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:status:status-locked",
        detail: expect.objectContaining({
          action: "lock",
          source: "status_change",
          text: "Status: Locked",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlock confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked Unlock account",
      pageContent: "Account ACCT001 Status: Locked Unlock account",
      elements: [actionButton(615, "Unlock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked",
      pageContent: "Account ACCT001 Status: Unlocked",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 615 },
      result: "Clicked element 615.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:status:status-unlocked",
        detail: expect.objectContaining({
          action: "unlock",
          source: "status_change",
          text: "Status: Unlocked",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer lock confirmation when status was already locked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked Lock account",
      pageContent: "Account ACCT001 Status: Locked Lock account",
      elements: [actionButton(614, "Lock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked",
      pageContent: "Account ACCT001 Status: Locked",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 614 },
      result: "Clicked element 614.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlock confirmation when status was already unlocked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked Unlock account",
      pageContent: "Account ACCT001 Status: Unlocked Unlock account",
      elements: [actionButton(615, "Unlock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked",
      pageContent: "Account ACCT001 Status: Unlocked",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 615 },
      result: "Clicked element 615.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps locked status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Account Matrix",
      url: "https://example.test/accounts",
      visibleContent: "Account Matrix Account locked: Yes Priority: High",
      pageContent:
        "Account Matrix Account locked: Yes. Priority: High. The page explains access coverage, account policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer account questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the account locked?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "account locked",
    });
    expect(decision.status).toBe("accepted");
  });
});
