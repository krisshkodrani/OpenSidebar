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

describe("completion kernel visible action-class workflow confirmation", () => {
  test("accepts submit-class workflow confirmation after visible submit completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Submit completed.",
      pageContent: "Submit completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submit completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({ action: "submit" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts send-class workflow confirmation after visible send completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Send completed.",
      pageContent: "Send completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Send the message.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Send completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:send",
          detail: expect.objectContaining({ action: "send" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts post-class workflow confirmation after visible publish completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Publish completed.",
      pageContent: "Publish completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Publish the announcement.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Publish completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:post",
          detail: expect.objectContaining({ action: "post" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts save-class workflow confirmation after visible save completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Save completed.",
      pageContent: "Save completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Save the settings.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Save completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "save",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:save",
          detail: expect.objectContaining({ action: "save" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts update-class workflow confirmation after visible update completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Update completed.",
      pageContent: "Update completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Update the settings.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Update completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "update",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:update",
          detail: expect.objectContaining({ action: "update" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts restart-class workflow confirmation after visible restart success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Service restarted successfully.",
      pageContent: "Service restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart the service.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted the service successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({ action: "restart" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts restart-class workflow confirmation after visible restart completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Restart completed.",
      pageContent: "Restart completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart the workflow.",
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
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({ action: "restart" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts refresh-class workflow confirmation after visible refresh success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Report refreshed successfully.",
      pageContent: "Report refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh the report.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed the report successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({ action: "refresh" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts refresh-class workflow confirmation after visible refresh completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Refresh completed.",
      pageContent: "Refresh completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh the dashboard.",
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
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({ action: "refresh" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts dismiss-class workflow confirmation after visible dismiss completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Dismiss completed.",
      pageContent: "Dismiss completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Dismiss the popup.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Dismiss completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:dismiss",
          detail: expect.objectContaining({ action: "dismiss" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });
});
