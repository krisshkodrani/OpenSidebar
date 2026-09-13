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

describe("completion kernel target-aware visible close/reopen workflow state confirmation", () => {
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
  test("accepts action status evidence for decomposed shadow-dom action objective", () => {
    const snap = workflowSnapshot({
      title: "Web Components",
      url: "https://example.test/web-components",
      visibleContent:
        "Web Components Notification Settings Privacy Settings Interaction Status Action: notifications Action: privacy",
      pageContent:
        "Web Components Notification Settings Privacy Settings Interaction Status Action: notifications Action: privacy",
    });
    const generated = generateCompletionContract({
      userRequest:
        "Objective: Click the Privacy Settings action in the web components page\n" +
        "Success criteria: Privacy Settings panel or dialog is visible, or a confirmation that privacy settings were activated\n\n" +
        "Original user request:\n" +
        "Activate the Notification Settings and Privacy Settings actions, then turn on dark mode.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 9);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Privacy Settings action activated.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Privacy Settings",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts the requested action from an already-visible saved terminal workflow state", () => {
    const snap = workflowSnapshot({
      title: "Export overdue record IDs safely",
      visibleContent:
        "Export overdue record IDs safely. Status complete. Field value safe-export. " +
        "Saved successfully. The requested change is complete. Workflow complete. " +
        "The final action was saved successfully.",
      pageContent:
        "Export overdue record IDs safely. Status complete. Field value safe-export. " +
        "Saved successfully. The requested change is complete. Workflow complete. " +
        "The final action was saved successfully.",
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 12);

    const decision = evaluateCompletionContract({
      contract: {
        kind: "workflow_confirmation",
        action: "export",
        targetLabel: "overdue record IDs",
      },
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "The export workflow is complete and the final action was saved successfully.",
    });

    expect(decision).toMatchObject({
      status: "accepted",
      reason:
        "Workflow contract is satisfied by visible saved terminal workflow state.",
      evidence: [
        expect.objectContaining({
          logicalKey: "workflow:confirmation:export:saved-terminal-state",
        }),
      ],
    });
  });

  test("does not treat a reviewed workflow with a pending final action as complete", () => {
    const snap = workflowSnapshot({
      title: "Export overdue record IDs safely",
      visibleContent:
        "Export overdue record IDs safely. Workflow reviewed. " +
        "All dependent stages are complete; the final action is now available.",
      pageContent:
        "Export overdue record IDs safely. Workflow reviewed. " +
        "All dependent stages are complete; the final action is now available.",
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 12);

    const decision = evaluateCompletionContract({
      contract: {
        kind: "workflow_confirmation",
        action: "export",
        targetLabel: "overdue record IDs",
      },
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The export workflow is complete.",
    });

    expect(decision.status).not.toBe("accepted");
  });

  test("does not apply a saved terminal state to a different workflow target", () => {
    const snap = workflowSnapshot({
      title: "Export current account IDs",
      visibleContent:
        "Export current account IDs. Workflow complete. " +
        "The final action was saved successfully.",
      pageContent:
        "Export current account IDs. Workflow complete. " +
        "The final action was saved successfully.",
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 12);

    const decision = evaluateCompletionContract({
      contract: {
        kind: "workflow_confirmation",
        action: "export",
        targetLabel: "overdue record IDs",
      },
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The export workflow is complete.",
    });

    expect(decision.status).not.toBe("accepted");
  });
});
