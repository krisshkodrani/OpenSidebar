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

describe("completion kernel target-aware visible assignment workflow confirmation", () => {
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
});
