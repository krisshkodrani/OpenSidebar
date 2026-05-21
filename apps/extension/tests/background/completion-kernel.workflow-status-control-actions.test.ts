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

describe("completion kernel workflow status enable assignment control-action confirmation", () => {
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

});
