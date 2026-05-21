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

describe("completion kernel target-aware visible job-control workflow confirmation", () => {
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
});
