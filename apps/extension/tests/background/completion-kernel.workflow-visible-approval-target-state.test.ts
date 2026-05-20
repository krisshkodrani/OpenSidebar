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

describe("completion kernel target-aware visible approval workflow state confirmation", () => {
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
});
