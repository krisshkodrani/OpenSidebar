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

describe("completion kernel workflow reject/close/reopen/cancel status confirmation", () => {
  test("accepts deny confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ002 Status: Pending Deny request",
      pageContent: "Request REQ002 Status: Pending Deny request",
      elements: [actionButton(603, "Deny request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ002 Status: Denied",
      pageContent: "Request REQ002 Status: Denied",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Deny the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 603 },
      result: "Clicked element 603.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Denied the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reject:status:status-denied",
        detail: expect.objectContaining({
          action: "reject",
          source: "status_change",
          text: "Status: Denied",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resolve confirmation from same-page state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC001 State: In Progress Resolve incident",
      pageContent: "Incident INC001 State: In Progress Resolve incident",
      elements: [actionButton(602, "Resolve incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC001 State: Resolved",
      pageContent: "Incident INC001 State: Resolved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Resolve the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 602 },
      result: "Clicked element 602.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resolved the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:status:state-resolved",
        detail: expect.objectContaining({
          action: "close",
          source: "status_change",
          text: "State: Resolved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts reopen confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Closed Reopen incident",
      pageContent: "Incident INC003 Status: Closed Reopen incident",
      elements: [actionButton(604, "Reopen incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Open",
      pageContent: "Incident INC003 Status: Open",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen the incident.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 604 },
      result: "Clicked element 604.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reopened the incident.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:status:status-open",
        detail: expect.objectContaining({
          action: "reopen",
          source: "status_change",
          text: "Status: Open",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer reopen confirmation when status was already open", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Open Reopen incident",
      pageContent: "Incident INC003 Status: Open Reopen incident",
      elements: [actionButton(604, "Reopen incident")],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident INC003 Status: Open",
      pageContent: "Incident INC003 Status: Open",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 604 },
      result: "Clicked element 604.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts cancel confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Active Cancel order",
      pageContent: "Order ORD004 Status: Active Cancel order",
      elements: [actionButton(607, "Cancel order")],
    });
    const current = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Cancelled",
      pageContent: "Order ORD004 Status: Cancelled",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel the order.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Cancelled the order.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:status:status-cancelled",
        detail: expect.objectContaining({
          action: "cancel",
          source: "status_change",
          text: "Status: Cancelled",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer cancel confirmation when status was already canceled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Canceled Cancel order",
      pageContent: "Order ORD004 Status: Canceled Cancel order",
      elements: [actionButton(607, "Cancel order")],
    });
    const current = workflowSnapshot({
      visibleContent: "Order ORD004 Status: Canceled",
      pageContent: "Order ORD004 Status: Canceled",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 607 },
      result: "Clicked element 607.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts reject-class status change with denial successful wording", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ003 Status: Pending Deny request",
      pageContent: "Request REQ003 Status: Pending Deny request",
      elements: [actionButton(604, "Deny request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ003 Status: Denial successful",
      pageContent: "Request REQ003 Status: Denial successful",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Deny the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 604 },
      result: "Clicked element 604.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 12,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Denial successful.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        logicalKey: "workflow:confirmation:reject:status:status-denial-successful",
        detail: expect.objectContaining({
          action: "reject",
          source: "status_change",
          text: "Status: Denial successful",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });
});
