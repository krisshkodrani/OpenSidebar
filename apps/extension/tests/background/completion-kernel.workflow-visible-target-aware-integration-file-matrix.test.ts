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

describe("completion kernel target-aware visible integration/file workflow confirmation matrix", () => {
  for (const scenario of [
    {
      action: "connect",
      request: "Connect Integration Alpha.",
      summary: "Connected Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains disconnected. Integration Alpha connected successfully.",
      requestedEvidenceText: "Integration Alpha connected successfully.",
      otherVisible:
        "Integration Alpha remains disconnected. Integration Beta connected successfully.",
      otherEvidenceText: "Integration Beta connected successfully.",
      genericVisible: "Connection completed.",
      genericSummary: "Connection completed.",
    },
    {
      action: "disconnect",
      request: "Disconnect Integration Alpha.",
      summary: "Disconnected Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains connected. Integration Alpha disconnected successfully.",
      requestedEvidenceText: "Integration Alpha disconnected successfully.",
      otherVisible:
        "Integration Alpha remains connected. Integration Beta disconnected successfully.",
      otherEvidenceText: "Integration Beta disconnected successfully.",
      genericVisible: "Disconnection completed.",
      genericSummary: "Disconnection completed.",
    },
    {
      action: "sync",
      request: "Sync Integration Alpha.",
      summary: "Synced Integration Alpha.",
      targetLabel: "Integration Alpha",
      requestedVisible:
        "Integration Beta remains stale. Integration Alpha synced successfully.",
      requestedEvidenceText: "Integration Alpha synced successfully.",
      otherVisible:
        "Integration Alpha remains stale. Integration Beta synced successfully.",
      otherEvidenceText: "Integration Beta synced successfully.",
      genericVisible: "Sync completed.",
      genericSummary: "Sync completed.",
    },
    {
      action: "attach",
      request: "Attach File Alpha.",
      summary: "Attached File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains unattached. File Alpha attached successfully.",
      requestedEvidenceText: "File Alpha attached successfully.",
      otherVisible:
        "File Alpha remains unattached. File Beta attached successfully.",
      otherEvidenceText: "File Beta attached successfully.",
      genericVisible: "Attachment completed.",
      genericSummary: "Attachment completed.",
    },
    {
      action: "detach",
      request: "Detach File Alpha.",
      summary: "Detached File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains attached. File Alpha detached successfully.",
      requestedEvidenceText: "File Alpha detached successfully.",
      otherVisible:
        "File Alpha remains attached. File Beta detached successfully.",
      otherEvidenceText: "File Beta detached successfully.",
      genericVisible: "Detachment completed.",
      genericSummary: "Detachment completed.",
    },
  ] as const) {
    test(`accepts target-aware visible ${scenario.action} confirmation for the requested target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.requestedVisible,
        pageContent: scenario.requestedVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirmation_state",
            logicalKey: `workflow:confirmation:${scenario.action}`,
            detail: expect.objectContaining({
              action: scenario.action,
              source: "visible_text",
              text: scenario.requestedEvidenceText,
            }),
          }),
        ]),
      );
      expect(decision.status).toBe("accepted");
    });

    test(`rejects target-aware visible ${scenario.action} confirmation for a different target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.otherVisible,
        pageContent: scenario.otherVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "confirmation_state",
            logicalKey: `workflow:confirmation:${scenario.action}`,
            detail: expect.objectContaining({
              action: scenario.action,
              source: "visible_text",
              text: scenario.otherEvidenceText,
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

    test(`rejects targetless visible ${scenario.action} completion for a named target`, () => {
      const snap = workflowSnapshot({
        visibleContent: scenario.genericVisible,
        pageContent: scenario.genericVisible,
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: snap,
      });
      const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: snap,
        candidateSource: "model_done",
        summary: scenario.genericSummary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.targetLabel,
      });
      expect(decision).toMatchObject({
        status: "rejected",
        reason:
          "Workflow confirmation evidence is for a different target than the requested action.",
      });
    });
  }
});
