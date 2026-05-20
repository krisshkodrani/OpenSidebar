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

function stableActionButton(
  tag: number,
  label: string,
  id: string,
): TaggedElement {
  return {
    ...actionButton(tag, label),
    attributes: {
      id,
      "aria-label": label,
    },
  };
}

describe("completion kernel workflow status confirmation", () => {
  test("accepts approve confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Awaiting approval Approve request",
      pageContent: "Request REQ001 Status: Awaiting approval Approve request",
      elements: [actionButton(601, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved",
      pageContent: "Request REQ001 Status: Approved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 601 },
      result: "Clicked element 601.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:status:status-approved",
        detail: expect.objectContaining({
          action: "approve",
          source: "status_change",
          text: "Status: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware approve status-change confirmation for the requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Request Alpha Status: Awaiting approval\nRequest Beta Status: Awaiting approval\nApprove request",
      pageContent:
        "Request Alpha Status: Awaiting approval\nRequest Beta Status: Awaiting approval\nApprove request",
      elements: [actionButton(602, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Request Alpha Status: Approved\nRequest Beta Status: Awaiting approval",
      pageContent:
        "Request Alpha Status: Approved\nRequest Beta Status: Awaiting approval",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
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
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:status:status-approved",
        detail: expect.objectContaining({
          action: "approve",
          source: "status_change",
          targetText: "Request Alpha",
          text: "Status: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware approve status-change confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Request Alpha Status: Awaiting approval\nRequest Beta Status: Awaiting approval\nApprove request",
      pageContent:
        "Request Alpha Status: Awaiting approval\nRequest Beta Status: Awaiting approval\nApprove request",
      elements: [actionButton(602, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Request Alpha Status: Awaiting approval\nRequest Beta Status: Approved",
      pageContent:
        "Request Alpha Status: Awaiting approval\nRequest Beta Status: Approved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
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
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:status:status-approved",
        detail: expect.objectContaining({
          action: "approve",
          source: "status_change",
          targetText: "Request Beta",
          text: "Status: Approved",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic approve status-change confirmation valid for a named target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Status: Awaiting approval Approve request",
      pageContent: "Status: Awaiting approval Approve request",
      elements: [actionButton(602, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Status: Approved",
      pageContent: "Status: Approved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
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
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:status:status-approved",
        detail: expect.objectContaining({
          action: "approve",
          source: "status_change",
          text: "Status: Approved",
        }),
      }),
    ]);
    expect((evidence[0]?.detail as { targetText?: string }).targetText).toBe(
      undefined,
    );
    expect(decision.status).toBe("accepted");
  });

  test("does not infer status-change confirmation when status was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved Approve request",
      pageContent: "Request REQ001 Status: Approved Approve request",
      elements: [actionButton(601, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved",
      pageContent: "Request REQ001 Status: Approved",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 601 },
      result: "Clicked element 601.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts approve confirmation from same-control label change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Awaiting approval Approve request",
      pageContent: "Request REQ001 Awaiting approval Approve request",
      elements: [
        stableActionButton(607, "Approve request", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
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
      summary: "Approved the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:approve:control:request-approval-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware control-label confirmation for the requested target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval",
      pageContent: "Request Alpha Awaiting approval",
      elements: [
        stableActionButton(630, "Approve Request Alpha", "approve-alpha-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Approved",
      pageContent: "Request Alpha Approved",
      elements: [stableActionButton(630, "Approved", "approve-alpha-action")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:control:approve-alpha-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          targetText: "Request Alpha",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware control-label confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval Request Beta Awaiting approval",
      pageContent: "Request Alpha Awaiting approval Request Beta Awaiting approval",
      elements: [
        stableActionButton(630, "Approve Request Beta", "approve-beta-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval Request Beta Approved",
      pageContent: "Request Alpha Awaiting approval Request Beta Approved",
      elements: [stableActionButton(630, "Approved", "approve-beta-action")],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:approve:control:approve-beta-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          targetText: "Request Beta",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic control-label confirmation valid for a named target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Awaiting approval Approve request",
      pageContent: "Request Alpha Awaiting approval Approve request",
      elements: [
        stableActionButton(630, "Approve request", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Approved",
      pageContent: "Request Alpha Approved",
      elements: [
        stableActionButton(630, "Approved", "request-approval-action"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:approve:control:request-approval-action",
        detail: expect.objectContaining({
          action: "approve",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Approved",
        }),
      }),
    ]);
    expect((evidence[0]?.detail as { targetText?: string }).targetText).toBe(
      undefined,
    );
    expect(decision.status).toBe("accepted");
  });

  test("does not infer control-label confirmation when label was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        stableActionButton(607, "Approved", "request-approval-action"),
      ],
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

  test("does not infer control-label confirmation without stable identity", () => {
    const preButton = actionButton(607, "Approve request");
    const currentButton = actionButton(607, "Approved");
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Awaiting approval Approve request",
      pageContent: "Request REQ001 Awaiting approval Approve request",
      elements: [
        {
          ...preButton,
          attributes: { "aria-label": "Approve request" },
        },
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Approved",
      pageContent: "Request REQ001 Approved",
      elements: [
        {
          ...currentButton,
          attributes: { "aria-label": "Approved" },
        },
      ],
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

  test("accepts update confirmation from same-control up-to-date label change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Edit mode Apply changes",
      pageContent: "Settings Edit mode Apply changes",
      elements: [stableActionButton(608, "Apply changes", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const generated = generateCompletionContract({
      userRequest: "Apply changes.",
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
      summary: "Applied changes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:update:control:settings-apply",
        detail: expect.objectContaining({
          action: "update",
          source: "control_label_change",
          text: "Control label changed to confirmed state: Up to date",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer up-to-date update confirmation when label was already final", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Up to date",
      pageContent: "Settings Up to date",
      elements: [stableActionButton(608, "Up to date", "settings-apply")],
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

  test("accepts approval-complete summary for approve status-change evidence", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Awaiting approval Approve request",
      pageContent: "Request REQ001 Status: Awaiting approval Approve request",
      elements: [actionButton(601, "Approve request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ001 Status: Approved",
      pageContent: "Request REQ001 Status: Approved",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 601 },
      result: "Clicked element 601.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Approval completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(decision.status).toBe("accepted");
  });

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

  test("accepts pause confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Running Pause job",
      pageContent: "Sync job SYNC001 Status: Running Pause job",
      elements: [actionButton(624, "Pause job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused",
      pageContent: "Sync job SYNC001 Status: Paused",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Pause the job.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Paused the job.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pause:status:status-paused",
        detail: expect.objectContaining({
          action: "pause",
          source: "status_change",
          text: "Status: Paused",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resume confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused Resume job",
      pageContent: "Sync job SYNC001 Status: Paused Resume job",
      elements: [actionButton(625, "Resume job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Running",
      pageContent: "Sync job SYNC001 Status: Running",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Resume the job.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 625 },
      result: "Clicked element 625.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resumed the job.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:resume:status:status-running",
        detail: expect.objectContaining({
          action: "resume",
          source: "status_change",
          text: "Status: Running",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer pause confirmation when status was already paused", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused Pause job",
      pageContent: "Sync job SYNC001 Status: Paused Pause job",
      elements: [actionButton(624, "Pause job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused",
      pageContent: "Sync job SYNC001 Status: Paused",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps paused status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Sync Matrix",
      url: "https://example.test/sync",
      visibleContent: "Sync Matrix Sync paused: Yes Owner: platform operations",
      pageContent:
        "Sync Matrix Sync paused: Yes. Owner: platform operations. The page explains job coverage, sync policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer sync questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the sync paused?",
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
      expectedAnswerLabel: "sync paused",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts start confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped Start service",
      pageContent: "Worker service SVC001 Status: Stopped Start service",
      elements: [actionButton(626, "Start service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Running",
      pageContent: "Worker service SVC001 Status: Running",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Start the service.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 626 },
      result: "Clicked element 626.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started the service.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:status:status-running",
        detail: expect.objectContaining({
          action: "start",
          source: "status_change",
          text: "Status: Running",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts stop confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Running Stop service",
      pageContent: "Worker service SVC001 Status: Running Stop service",
      elements: [actionButton(627, "Stop service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped",
      pageContent: "Worker service SVC001 Status: Stopped",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop the service.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 627 },
      result: "Clicked element 627.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Stopped the service.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:status:status-stopped",
        detail: expect.objectContaining({
          action: "stop",
          source: "status_change",
          text: "Status: Stopped",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer stop confirmation when status was already stopped", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped Stop service",
      pageContent: "Worker service SVC001 Status: Stopped Stop service",
      elements: [actionButton(627, "Stop service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped",
      pageContent: "Worker service SVC001 Status: Stopped",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 627 },
      result: "Clicked element 627.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps stopped status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Service Matrix",
      url: "https://example.test/service",
      visibleContent: "Service Matrix Service stopped: Yes Owner: platform operations",
      pageContent:
        "Service Matrix Service stopped: Yes. Owner: platform operations. The page explains service coverage, service policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer service questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the service stopped?",
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
      expectedAnswerLabel: "service stopped",
    });
    expect(decision.status).toBe("accepted");
  });

  test("keeps restart requirement questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Service Matrix",
      url: "https://example.test/service",
      visibleContent:
        "Service Matrix Restart required: No Owner: platform operations",
      pageContent:
        "Service Matrix Restart required: No. Owner: platform operations. The page explains service coverage, restart policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer service questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is restart required?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "restart required",
    });
    expect(decision.status).toBe("accepted");
  });

  test("keeps refresh rate questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Monitor Matrix",
      url: "https://example.test/monitor",
      visibleContent:
        "Monitor Matrix Refresh rate: 60Hz Owner: platform operations",
      pageContent:
        "Monitor Matrix Refresh rate: 60Hz. Owner: platform operations. The page explains monitor coverage, refresh policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer monitor questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the refresh rate?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "refresh rate",
    });
    expect(decision.status).toBe("accepted");
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
