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

describe("completion kernel workflow status escalation control-action confirmation", () => {
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
});
