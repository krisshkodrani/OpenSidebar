import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

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

describe("completion kernel target-aware visible workflow state confirmation", () => {
  test("accepts target-aware visible restart confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Beta remains stopped. Service Alpha restarted successfully.",
      pageContent:
        "Service Beta remains stopped. Service Alpha restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({
            action: "restart",
            source: "visible_text",
            text: "Service Alpha restarted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible restart confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Alpha remains stopped. Service Beta restarted successfully.",
      pageContent:
        "Service Alpha remains stopped. Service Beta restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({
            action: "restart",
            source: "visible_text",
            text: "Service Beta restarted successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible restart completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Restart completed.",
      pageContent: "Restart completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restart completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible refresh confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Beta is stale. Report Alpha refreshed successfully.",
      pageContent:
        "Report Beta is stale. Report Alpha refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({
            action: "refresh",
            source: "visible_text",
            text: "Report Alpha refreshed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible refresh confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Alpha is stale. Report Beta refreshed successfully.",
      pageContent:
        "Report Alpha is stale. Report Beta refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({
            action: "refresh",
            source: "visible_text",
            text: "Report Beta refreshed successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible refresh completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Refresh completed.",
      pageContent: "Refresh completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refresh completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts reject-class workflow confirmation after visible denial success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Request denied successfully.",
      pageContent: "Request denied successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Deny the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Denied the request successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({ action: "reject" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts approve-class workflow confirmation after visible approval completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval completed.",
      pageContent: "Approval completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({ action: "approve" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts reject-class workflow confirmation after visible rejection completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Rejection completed.",
      pageContent: "Rejection completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejection completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({ action: "reject" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts approve-class workflow confirmation with successful noun summary", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval successful.",
      pageContent: "Approval successful.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval successful.",
    });

    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible approve confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains pending. Request Alpha approved successfully.",
      pageContent:
        "Request Beta remains pending. Request Alpha approved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({
            action: "approve",
            source: "visible_text",
            text: "Request Alpha approved successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible approve confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains pending. Request Beta approved successfully.",
      pageContent:
        "Request Alpha remains pending. Request Beta approved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({
            action: "approve",
            source: "visible_text",
            text: "Request Beta approved successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible approval completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval completed.",
      pageContent: "Approval completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible reject confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains pending. Request Alpha rejected successfully.",
      pageContent:
        "Request Beta remains pending. Request Alpha rejected successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({
            action: "reject",
            source: "visible_text",
            text: "Request Alpha rejected successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible reject confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains pending. Request Beta rejected successfully.",
      pageContent:
        "Request Alpha remains pending. Request Beta rejected successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({
            action: "reject",
            source: "visible_text",
            text: "Request Beta rejected successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible rejection completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Rejection completed.",
      pageContent: "Rejection completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejection completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts close-class workflow confirmation after visible resolution success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Incident resolved successfully.",
      pageContent: "Incident resolved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resolve the incident.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resolved the incident successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({ action: "close" }),
        }),
      ]),
    );
    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:dismiss",
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts close-class workflow confirmation after visible close completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Close completed.",
      pageContent: "Close completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close the incident.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Close completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({ action: "close" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible close confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains open. Incident Alpha closed successfully.",
      pageContent:
        "Incident Beta remains open. Incident Alpha closed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({
            action: "close",
            source: "visible_text",
            text: "Incident Alpha closed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible close confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains open. Incident Beta closed successfully.",
      pageContent:
        "Incident Alpha remains open. Incident Beta closed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:close",
          detail: expect.objectContaining({
            action: "close",
            source: "visible_text",
            text: "Incident Beta closed successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible close completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Close completed.",
      pageContent: "Close completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Close Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Close completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible reopen confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains closed. Incident Alpha reopened successfully.",
      pageContent:
        "Incident Beta remains closed. Incident Alpha reopened successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Reopened Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reopen",
          detail: expect.objectContaining({
            action: "reopen",
            source: "visible_text",
            text: "Incident Alpha reopened successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible reopen confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains closed. Incident Beta reopened successfully.",
      pageContent:
        "Incident Alpha remains closed. Incident Beta reopened successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Reopened Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reopen",
          detail: expect.objectContaining({
            action: "reopen",
            source: "visible_text",
            text: "Incident Beta reopened successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible reopen completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Reopen completed.",
      pageContent: "Reopen completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Reopen completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts cancel-class workflow confirmation after visible cancellation completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Cancellation completed.",
      pageContent: "Cancellation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel the order.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Cancellation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:cancel",
          detail: expect.objectContaining({ action: "cancel" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible cancel confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Order Beta remains active. Order Alpha canceled successfully.",
      pageContent: "Order Beta remains active. Order Alpha canceled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Canceled Order Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:cancel",
          detail: expect.objectContaining({
            action: "cancel",
            source: "visible_text",
            text: "Order Alpha canceled successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible cancel confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Order Alpha remains active. Order Beta canceled successfully.",
      pageContent: "Order Alpha remains active. Order Beta canceled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Canceled Order Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:cancel",
          detail: expect.objectContaining({
            action: "cancel",
            source: "visible_text",
            text: "Order Beta canceled successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible cancellation completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Cancellation completed.",
      pageContent: "Cancellation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Cancellation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible enable confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Beta remains disabled. Feature Alpha enabled successfully.",
      pageContent:
        "Feature Beta remains disabled. Feature Alpha enabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:enable",
          detail: expect.objectContaining({
            action: "enable",
            source: "visible_text",
            text: "Feature Alpha enabled successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible enable confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Alpha remains disabled. Feature Beta enabled successfully.",
      pageContent:
        "Feature Alpha remains disabled. Feature Beta enabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:enable",
          detail: expect.objectContaining({
            action: "enable",
            source: "visible_text",
            text: "Feature Beta enabled successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible enable completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Enable completed.",
      pageContent: "Enable completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Enable completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible disable confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Beta remains enabled. Feature Alpha disabled successfully.",
      pageContent:
        "Feature Beta remains enabled. Feature Alpha disabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:disable",
          detail: expect.objectContaining({
            action: "disable",
            source: "visible_text",
            text: "Feature Alpha disabled successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible disable confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Feature Alpha remains enabled. Feature Beta disabled successfully.",
      pageContent:
        "Feature Alpha remains enabled. Feature Beta disabled successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Disabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:disable",
          detail: expect.objectContaining({
            action: "disable",
            source: "visible_text",
            text: "Feature Beta disabled successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible disable completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Disable completed.",
      pageContent: "Disable completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Disable Feature Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Disable completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
      targetLabel: "Feature Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible lock confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Beta remains unlocked. Account Alpha locked successfully.",
      pageContent:
        "Account Beta remains unlocked. Account Alpha locked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:lock",
          detail: expect.objectContaining({
            action: "lock",
            source: "visible_text",
            text: "Account Alpha locked successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible lock confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Alpha remains unlocked. Account Beta locked successfully.",
      pageContent:
        "Account Alpha remains unlocked. Account Beta locked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Locked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:lock",
          detail: expect.objectContaining({
            action: "lock",
            source: "visible_text",
            text: "Account Beta locked successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible lock completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Lock completed.",
      pageContent: "Lock completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Lock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Lock completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
      targetLabel: "Account Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible unlock confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Beta remains locked. Account Alpha unlocked successfully.",
      pageContent:
        "Account Beta remains locked. Account Alpha unlocked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unlock",
          detail: expect.objectContaining({
            action: "unlock",
            source: "visible_text",
            text: "Account Alpha unlocked successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible unlock confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Account Alpha remains locked. Account Beta unlocked successfully.",
      pageContent:
        "Account Alpha remains locked. Account Beta unlocked successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unlocked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unlock",
          detail: expect.objectContaining({
            action: "unlock",
            source: "visible_text",
            text: "Account Beta unlocked successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible unlock completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Unlock completed.",
      pageContent: "Unlock completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock Account Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unlock completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
      targetLabel: "Account Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible assign confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Beta remains unassigned. Ticket Alpha assigned successfully.",
      pageContent:
        "Ticket Beta remains unassigned. Ticket Alpha assigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:assign",
          detail: expect.objectContaining({
            action: "assign",
            source: "visible_text",
            text: "Ticket Alpha assigned successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible assign confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Alpha remains unassigned. Ticket Beta assigned successfully.",
      pageContent:
        "Ticket Alpha remains unassigned. Ticket Beta assigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Assigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:assign",
          detail: expect.objectContaining({
            action: "assign",
            source: "visible_text",
            text: "Ticket Beta assigned successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible assignment completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Assignment completed.",
      pageContent: "Assignment completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Assign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Assignment completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "assign",
      targetLabel: "Ticket Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible unassign confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Beta remains assigned. Ticket Alpha unassigned successfully.",
      pageContent:
        "Ticket Beta remains assigned. Ticket Alpha unassigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unassign",
          detail: expect.objectContaining({
            action: "unassign",
            source: "visible_text",
            text: "Ticket Alpha unassigned successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible unassign confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Ticket Alpha remains assigned. Ticket Beta unassigned successfully.",
      pageContent:
        "Ticket Alpha remains assigned. Ticket Beta unassigned successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unassigned Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:unassign",
          detail: expect.objectContaining({
            action: "unassign",
            source: "visible_text",
            text: "Ticket Beta unassigned successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible unassign completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Unassign completed.",
      pageContent: "Unassign completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Unassign Ticket Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Unassign completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unassign",
      targetLabel: "Ticket Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible escalate confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains open. Incident Alpha escalated successfully.",
      pageContent:
        "Incident Beta remains open. Incident Alpha escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:escalate",
          detail: expect.objectContaining({
            action: "escalate",
            source: "visible_text",
            text: "Incident Alpha escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible escalate confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains open. Incident Beta escalated successfully.",
      pageContent:
        "Incident Alpha remains open. Incident Beta escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:escalate",
          detail: expect.objectContaining({
            action: "escalate",
            source: "visible_text",
            text: "Incident Beta escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible escalation completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Escalation completed.",
      pageContent: "Escalation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible deescalate confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains escalated. Incident Alpha de-escalated successfully.",
      pageContent:
        "Incident Beta remains escalated. Incident Alpha de-escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:deescalate",
          detail: expect.objectContaining({
            action: "deescalate",
            source: "visible_text",
            text: "Incident Alpha de-escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible deescalate confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains escalated. Incident Beta de-escalated successfully.",
      pageContent:
        "Incident Alpha remains escalated. Incident Beta de-escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:deescalate",
          detail: expect.objectContaining({
            action: "deescalate",
            source: "visible_text",
            text: "Incident Beta de-escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible deescalation completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "De-escalation completed.",
      pageContent: "De-escalation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible pause confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Beta remains running. Job Alpha paused successfully.",
      pageContent:
        "Job Beta remains running. Job Alpha paused successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:pause",
          detail: expect.objectContaining({
            action: "pause",
            source: "visible_text",
            text: "Job Alpha paused successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible pause confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Alpha remains running. Job Beta paused successfully.",
      pageContent:
        "Job Alpha remains running. Job Beta paused successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Paused Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:pause",
          detail: expect.objectContaining({
            action: "pause",
            source: "visible_text",
            text: "Job Beta paused successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible pause completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Pause completed.",
      pageContent: "Pause completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Pause Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Pause completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
      targetLabel: "Job Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible resume confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Beta remains paused. Job Alpha resumed successfully.",
      pageContent:
        "Job Beta remains paused. Job Alpha resumed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:resume",
          detail: expect.objectContaining({
            action: "resume",
            source: "visible_text",
            text: "Job Alpha resumed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible resume confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Job Alpha remains paused. Job Beta resumed successfully.",
      pageContent:
        "Job Alpha remains paused. Job Beta resumed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resumed Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:resume",
          detail: expect.objectContaining({
            action: "resume",
            source: "visible_text",
            text: "Job Beta resumed successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible resume completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Resume completed.",
      pageContent: "Resume completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Resume Job Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Resume completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
      targetLabel: "Job Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible start confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Beta remains stopped. Service Alpha started successfully.",
      pageContent:
        "Service Beta remains stopped. Service Alpha started successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Start Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Started Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:start",
          detail: expect.objectContaining({
            action: "start",
            source: "visible_text",
            text: "Service Alpha started successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible start confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Alpha remains stopped. Service Beta started successfully.",
      pageContent:
        "Service Alpha remains stopped. Service Beta started successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Start Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Started Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:start",
          detail: expect.objectContaining({
            action: "start",
            source: "visible_text",
            text: "Service Beta started successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible start completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Start completed.",
      pageContent: "Start completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Start Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Start completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Service Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible stop confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Beta remains running. Service Alpha stopped successfully.",
      pageContent:
        "Service Beta remains running. Service Alpha stopped successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Stopped Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:stop",
          detail: expect.objectContaining({
            action: "stop",
            source: "visible_text",
            text: "Service Alpha stopped successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible stop confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Alpha remains running. Service Beta stopped successfully.",
      pageContent:
        "Service Alpha remains running. Service Beta stopped successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Stopped Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:stop",
          detail: expect.objectContaining({
            action: "stop",
            source: "visible_text",
            text: "Service Beta stopped successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible stop completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Stop completed.",
      pageContent: "Stop completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Stop completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Service Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible submit confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains draft. Request Alpha submitted successfully.",
      pageContent:
        "Request Beta remains draft. Request Alpha submitted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({
            action: "submit",
            source: "visible_text",
            text: "Request Alpha submitted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible submit confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains draft. Request Beta submitted successfully.",
      pageContent:
        "Request Alpha remains draft. Request Beta submitted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({
            action: "submit",
            source: "visible_text",
            text: "Request Beta submitted successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible submission completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Submission completed.",
      pageContent: "Submission completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submission completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible complete confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Task TASK002 remains incomplete. Task TASK001 completed successfully.",
      pageContent:
        "Task TASK002 remains incomplete. Task TASK001 completed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:complete",
          detail: expect.objectContaining({
            action: "complete",
            source: "visible_text",
            text: "Task TASK001 completed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible complete confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Task TASK001 remains incomplete. Task TASK002 completed successfully.",
      pageContent:
        "Task TASK001 remains incomplete. Task TASK002 completed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:complete",
          detail: expect.objectContaining({
            action: "complete",
            source: "visible_text",
            text: "Task TASK002 completed successfully.",
          }),
        }),
      ]),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects targetless visible complete completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Completion successful.",
      pageContent: "Completion successful.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Completion successful.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });
});
