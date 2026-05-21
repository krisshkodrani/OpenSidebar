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

describe("completion kernel target-aware visible resource workflow confirmation matrix", () => {
  for (const scenario of [
    {
      action: "link",
      request: "Link Account Alpha.",
      summary: "Linked Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains separate. Account Alpha linked successfully.",
      requestedEvidenceText: "Account Alpha linked successfully.",
      otherVisible:
        "Account Alpha remains separate. Account Beta linked successfully.",
      otherEvidenceText: "Account Beta linked successfully.",
      genericVisible: "Link completed.",
      genericSummary: "Link completed.",
    },
    {
      action: "unlink",
      request: "Unlink Account Alpha.",
      summary: "Unlinked Account Alpha.",
      targetLabel: "Account Alpha",
      requestedVisible:
        "Account Beta remains linked. Account Alpha unlinked successfully.",
      requestedEvidenceText: "Account Alpha unlinked successfully.",
      otherVisible:
        "Account Alpha remains linked. Account Beta unlinked successfully.",
      otherEvidenceText: "Account Beta unlinked successfully.",
      genericVisible: "Unlink completed.",
      genericSummary: "Unlink completed.",
    },
    {
      action: "tag",
      request: "Tag Issue Alpha.",
      summary: "Tagged Issue Alpha.",
      targetLabel: "Issue Alpha",
      requestedVisible:
        "Issue Beta remains untagged. Issue Alpha tagged successfully.",
      requestedEvidenceText: "Issue Alpha tagged successfully.",
      otherVisible:
        "Issue Alpha remains untagged. Issue Beta tagged successfully.",
      otherEvidenceText: "Issue Beta tagged successfully.",
      genericVisible: "Tag completed.",
      genericSummary: "Tag completed.",
    },
    {
      action: "untag",
      request: "Untag Issue Alpha.",
      summary: "Untagged Issue Alpha.",
      targetLabel: "Issue Alpha",
      requestedVisible:
        "Issue Beta remains tagged. Issue Alpha untagged successfully.",
      requestedEvidenceText: "Issue Alpha untagged successfully.",
      otherVisible:
        "Issue Alpha remains tagged. Issue Beta untagged successfully.",
      otherEvidenceText: "Issue Beta untagged successfully.",
      genericVisible: "Untag completed.",
      genericSummary: "Untag completed.",
    },
    {
      action: "flag",
      request: "Flag Message Alpha.",
      summary: "Flagged Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains normal. Message Alpha flagged successfully.",
      requestedEvidenceText: "Message Alpha flagged successfully.",
      otherVisible:
        "Message Alpha remains normal. Message Beta flagged successfully.",
      otherEvidenceText: "Message Beta flagged successfully.",
      genericVisible: "Flag completed.",
      genericSummary: "Flag completed.",
    },
    {
      action: "unflag",
      request: "Unflag Message Alpha.",
      summary: "Unflagged Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains flagged. Message Alpha unflagged successfully.",
      requestedEvidenceText: "Message Alpha unflagged successfully.",
      otherVisible:
        "Message Alpha remains flagged. Message Beta unflagged successfully.",
      otherEvidenceText: "Message Beta unflagged successfully.",
      genericVisible: "Unflag completed.",
      genericSummary: "Unflag completed.",
    },
    {
      action: "duplicate",
      request: "Duplicate Record Alpha.",
      summary: "Duplicated Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains original. Record Alpha duplicated successfully.",
      requestedEvidenceText: "Record Alpha duplicated successfully.",
      otherVisible:
        "Record Alpha remains original. Record Beta duplicated successfully.",
      otherEvidenceText: "Record Beta duplicated successfully.",
      genericVisible: "Duplicate completed.",
      genericSummary: "Duplicate completed.",
    },
    {
      action: "restore",
      request: "Restore Record Alpha.",
      summary: "Restored Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains archived. Record Alpha restored successfully.",
      requestedEvidenceText: "Record Alpha restored successfully.",
      otherVisible:
        "Record Alpha remains archived. Record Beta restored successfully.",
      otherEvidenceText: "Record Beta restored successfully.",
      genericVisible: "Restore completed.",
      genericSummary: "Restore completed.",
    },
    {
      action: "create",
      request: "Create Record Alpha.",
      summary: "Created Record Alpha.",
      targetLabel: "Record Alpha",
      requestedVisible:
        "Record Beta remains absent. Record Alpha created successfully.",
      requestedEvidenceText: "Record Alpha created successfully.",
      otherVisible:
        "Record Alpha remains absent. Record Beta created successfully.",
      otherEvidenceText: "Record Beta created successfully.",
      genericVisible: "Create completed.",
      genericSummary: "Create completed.",
    },
    {
      action: "share",
      request: "Share Report Alpha.",
      summary: "Shared Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains private. Report Alpha shared successfully.",
      requestedEvidenceText: "Report Alpha shared successfully.",
      otherVisible:
        "Report Alpha remains private. Report Beta shared successfully.",
      otherEvidenceText: "Report Beta shared successfully.",
      genericVisible: "Share completed.",
      genericSummary: "Share completed.",
    },
    {
      action: "grant",
      request: "Grant Role Alpha.",
      summary: "Granted Role Alpha.",
      targetLabel: "Role Alpha",
      requestedVisible:
        "Role Beta remains unavailable. Role Alpha granted successfully.",
      requestedEvidenceText: "Role Alpha granted successfully.",
      otherVisible:
        "Role Alpha remains unavailable. Role Beta granted successfully.",
      otherEvidenceText: "Role Beta granted successfully.",
      genericVisible: "Grant completed.",
      genericSummary: "Grant completed.",
    },
    {
      action: "revoke",
      request: "Revoke Role Alpha.",
      summary: "Revoked Role Alpha.",
      targetLabel: "Role Alpha",
      requestedVisible:
        "Role Beta remains available. Role Alpha revoked successfully.",
      requestedEvidenceText: "Role Alpha revoked successfully.",
      otherVisible:
        "Role Alpha remains available. Role Beta revoked successfully.",
      otherEvidenceText: "Role Beta revoked successfully.",
      genericVisible: "Revocation completed.",
      genericSummary: "Revocation completed.",
    },
    {
      action: "install",
      request: "Install Package Alpha.",
      summary: "Installed Package Alpha.",
      targetLabel: "Package Alpha",
      requestedVisible:
        "Package Beta remains unavailable. Package Alpha installed successfully.",
      requestedEvidenceText: "Package Alpha installed successfully.",
      otherVisible:
        "Package Alpha remains unavailable. Package Beta installed successfully.",
      otherEvidenceText: "Package Beta installed successfully.",
      genericVisible: "Installation completed.",
      genericSummary: "Installation completed.",
    },
    {
      action: "uninstall",
      request: "Uninstall Package Alpha.",
      summary: "Uninstalled Package Alpha.",
      targetLabel: "Package Alpha",
      requestedVisible:
        "Package Beta remains installed. Package Alpha uninstalled successfully.",
      requestedEvidenceText: "Package Alpha uninstalled successfully.",
      otherVisible:
        "Package Alpha remains installed. Package Beta uninstalled successfully.",
      otherEvidenceText: "Package Beta uninstalled successfully.",
      genericVisible: "Uninstallation completed.",
      genericSummary: "Uninstallation completed.",
    },
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
    {
      action: "invite",
      request: "Invite Member Alpha.",
      summary: "Invited Member Alpha.",
      targetLabel: "Member Alpha",
      requestedVisible:
        "Member Beta remains uninvited. Member Alpha invited successfully.",
      requestedEvidenceText: "Member Alpha invited successfully.",
      otherVisible:
        "Member Alpha remains uninvited. Member Beta invited successfully.",
      otherEvidenceText: "Member Beta invited successfully.",
      genericVisible: "Invitation completed.",
      genericSummary: "Invitation completed.",
    },
    {
      action: "post",
      request: "Publish Article Alpha.",
      summary: "Published Article Alpha.",
      targetLabel: "Article Alpha",
      requestedVisible:
        "Article Beta remains draft. Article Alpha published successfully.",
      requestedEvidenceText: "Article Alpha published successfully.",
      otherVisible:
        "Article Alpha remains draft. Article Beta published successfully.",
      otherEvidenceText: "Article Beta published successfully.",
      genericVisible: "Publish completed.",
      genericSummary: "Publish completed.",
    },
    {
      action: "update",
      request: "Update Request Alpha.",
      summary: "Updated Request Alpha.",
      targetLabel: "Request Alpha",
      requestedVisible:
        "Request Beta remains stale. Request Alpha updated successfully.",
      requestedEvidenceText: "Request Alpha updated successfully.",
      otherVisible:
        "Request Alpha remains stale. Request Beta updated successfully.",
      otherEvidenceText: "Request Beta updated successfully.",
      genericVisible: "Update completed.",
      genericSummary: "Update completed.",
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
