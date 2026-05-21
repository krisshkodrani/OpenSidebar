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

describe("completion kernel target-aware visible access-state administration workflow confirmation", () => {
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

});
