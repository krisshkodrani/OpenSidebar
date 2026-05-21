import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildCompletionRecoveryHint,
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

describe("completion kernel visible workflow confirmation", () => {
  test("accepts workflow confirmation after visible delete success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account deleted successfully.",
      pageContent: "Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted the account successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({ action: "delete" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts delete-class workflow confirmation after visible delete completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Delete completed.",
      pageContent: "Delete completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Delete completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({ action: "delete" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts archive-class workflow confirmation after visible archive completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Archive completed.",
      pageContent: "Archive completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Archive the report.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Archive completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:archive",
          detail: expect.objectContaining({ action: "archive" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible delete confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Warehouse Beta remains visible. Warehouse Alpha deleted successfully.",
      pageContent:
        "Warehouse Beta remains visible. Warehouse Alpha deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({
            action: "delete",
            source: "visible_text",
            text: "Warehouse Alpha deleted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible delete confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Warehouse Alpha remains visible. Warehouse Beta deleted successfully.",
      pageContent:
        "Warehouse Alpha remains visible. Warehouse Beta deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted Warehouse Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
          detail: expect.objectContaining({
            action: "delete",
            source: "visible_text",
            text: "Warehouse Beta deleted successfully.",
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

  test("rejects targetless visible delete completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Delete completed.",
      pageContent: "Delete completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete Warehouse Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Delete completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "delete",
      targetLabel: "Warehouse Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("rejects target-aware visible archive confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Alpha remains visible. Report Beta archived successfully.",
      pageContent:
        "Report Alpha remains visible. Report Beta archived successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Archive Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Archived Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:archive",
          detail: expect.objectContaining({
            action: "archive",
            source: "visible_text",
            text: "Report Beta archived successfully.",
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

  test("rejects targetless visible archive completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Archive completed.",
      pageContent: "Archive completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Archive Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Archive completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "archive",
      targetLabel: "Report Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("requires verification for workflow confirmation without visible success", () => {
    const snap = workflowSnapshot();
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 7),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted the account successfully.",
    });

    expect(decision.status).toBe("needs_verification");
    expect(buildCompletionRecoveryHint(decision)).toContain("Verify");
  });

  test("does not generate workflow confirmation contracts for browser tab management", () => {
    const generated = generateCompletionContract({
      userRequest: "Close the current tab quickly.",
      snapshot: workflowSnapshot(),
    });

    expect(generated).toBeNull();
  });

  test("does not accept workflow confirmation when summary names the wrong action", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account deleted successfully.",
      pageContent: "Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 7),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Saved the account settings.",
    });

    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept workflow confirmation when summary negates the action", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account deleted successfully.",
      pageContent: "Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 7),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The account was not deleted.",
    });

    expect(decision.status).toBe("inconclusive");
  });

  test("does not infer visible workflow confirmation from negated success wording", () => {
    const snap = workflowSnapshot({
      visibleContent: "Account was not deleted successfully.",
      pageContent: "Account was not deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Deleted the account successfully.",
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
        }),
      ]),
    );
    expect(decision.status).toBe("needs_verification");
  });

  test("does not treat unrelated no wording as workflow negation", () => {
    const snap = workflowSnapshot({
      visibleContent: "No errors. Account deleted successfully.",
      pageContent: "No errors. Account deleted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Delete the account and confirm it is gone.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No errors. Deleted the account successfully.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:delete",
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });
});
