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

describe("completion kernel target-aware visible cancel workflow state confirmation", () => {
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
      visibleContent:
        "Order Beta remains active. Order Alpha canceled successfully.",
      pageContent:
        "Order Beta remains active. Order Alpha canceled successfully.",
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
      visibleContent:
        "Order Alpha remains active. Order Beta canceled successfully.",
      pageContent:
        "Order Alpha remains active. Order Beta canceled successfully.",
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
});
