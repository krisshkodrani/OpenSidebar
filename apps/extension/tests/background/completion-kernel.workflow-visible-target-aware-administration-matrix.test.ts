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

describe("completion kernel target-aware visible administration workflow confirmation matrix", () => {
  for (const scenario of [
    {
      action: "schedule",
      request: "Schedule Report Alpha.",
      summary: "Scheduled Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unscheduled. Report Alpha scheduled successfully.",
      requestedEvidenceText: "Report Alpha scheduled successfully.",
      otherVisible:
        "Report Alpha remains unscheduled. Report Beta scheduled successfully.",
      otherEvidenceText: "Report Beta scheduled successfully.",
      genericVisible: "Schedule completed.",
      genericSummary: "Schedule completed.",
    },
    {
      action: "unschedule",
      request: "Unschedule Report Alpha.",
      summary: "Unscheduled Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains scheduled. Report Alpha unscheduled successfully.",
      requestedEvidenceText: "Report Alpha unscheduled successfully.",
      otherVisible:
        "Report Alpha remains scheduled. Report Beta unscheduled successfully.",
      otherEvidenceText: "Report Beta unscheduled successfully.",
      genericVisible: "Unschedule completed.",
      genericSummary: "Unschedule completed.",
    },
    {
      action: "deploy",
      request: "Deploy Release Alpha.",
      summary: "Deployed Release Alpha.",
      targetLabel: "Release Alpha",
      requestedVisible:
        "Release Beta remains staged. Release Alpha deployed successfully.",
      requestedEvidenceText: "Release Alpha deployed successfully.",
      otherVisible:
        "Release Alpha remains staged. Release Beta deployed successfully.",
      otherEvidenceText: "Release Beta deployed successfully.",
      genericVisible: "Deployment completed.",
      genericSummary: "Deployment completed.",
    },
    {
      action: "rollback",
      request: "Rollback Release Alpha.",
      summary: "Rolled back Release Alpha.",
      targetLabel: "Release Alpha",
      requestedVisible:
        "Release Beta remains active. Release Alpha rolled back successfully.",
      requestedEvidenceText: "Release Alpha rolled back successfully.",
      otherVisible:
        "Release Alpha remains active. Release Beta rolled back successfully.",
      otherEvidenceText: "Release Beta rolled back successfully.",
      genericVisible: "Rollback completed.",
      genericSummary: "Rollback completed.",
    },
    {
      action: "backup",
      request: "Back up Database Alpha.",
      summary: "Backed up Database Alpha.",
      targetLabel: "Database Alpha",
      requestedVisible:
        "Database Beta remains unbacked. Database Alpha backed up successfully.",
      requestedEvidenceText: "Database Alpha backed up successfully.",
      otherVisible:
        "Database Alpha remains unbacked. Database Beta backed up successfully.",
      otherEvidenceText: "Database Beta backed up successfully.",
      genericVisible: "Backup completed.",
      genericSummary: "Backup completed.",
    },
    {
      action: "reset",
      request: "Reset Password Alpha.",
      summary: "Reset Password Alpha.",
      targetLabel: "Password Alpha",
      requestedVisible:
        "Password Beta remains unchanged. Password Alpha reset successfully.",
      requestedEvidenceText: "Password Alpha reset successfully.",
      otherVisible:
        "Password Alpha remains unchanged. Password Beta reset successfully.",
      otherEvidenceText: "Password Beta reset successfully.",
      genericVisible: "Reset completed.",
      genericSummary: "Reset completed.",
    },
    {
      action: "suspend",
      request: "Suspend Account Alpha.",
      summary: "Suspended Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains active. Account Alpha suspended successfully.",
      requestedEvidenceText: "Account Alpha suspended successfully.",
      otherVisible:
        "Account Alpha remains active. Account Beta suspended successfully.",
      otherEvidenceText: "Account Beta suspended successfully.",
      genericVisible: "Suspension completed.",
      genericSummary: "Suspension completed.",
    },
    {
      action: "unsuspend",
      request: "Unsuspend Account Alpha.",
      summary: "Unsuspended Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains suspended. Account Alpha unsuspended successfully.",
      requestedEvidenceText: "Account Alpha unsuspended successfully.",
      otherVisible:
        "Account Alpha remains suspended. Account Beta unsuspended successfully.",
      otherEvidenceText: "Account Beta unsuspended successfully.",
      genericVisible: "Unsuspend completed.",
      genericSummary: "Unsuspend completed.",
    },
    {
      action: "block",
      request: "Block User Alpha.",
      summary: "Blocked User Alpha.",
      targetLabel: "User Alpha",
      requestedVisible:
        "User Beta remains allowed. User Alpha blocked successfully.",
      requestedEvidenceText: "User Alpha blocked successfully.",
      otherVisible:
        "User Alpha remains allowed. User Beta blocked successfully.",
      otherEvidenceText: "User Beta blocked successfully.",
      genericVisible: "Block completed.",
      genericSummary: "Block completed.",
    },
    {
      action: "unblock",
      request: "Unblock User Alpha.",
      summary: "Unblocked User Alpha.",
      targetLabel: "User Alpha",
      requestedVisible:
        "User Beta remains blocked. User Alpha unblocked successfully.",
      requestedEvidenceText: "User Alpha unblocked successfully.",
      otherVisible:
        "User Alpha remains blocked. User Beta unblocked successfully.",
      otherEvidenceText: "User Beta unblocked successfully.",
      genericVisible: "Unblock completed.",
      genericSummary: "Unblock completed.",
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
