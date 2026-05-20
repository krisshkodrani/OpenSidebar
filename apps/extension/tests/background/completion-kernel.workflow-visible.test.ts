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

  for (const scenario of [
    {
      action: "save",
      request: "Save Draft Alpha.",
      summary: "Saved Draft Alpha.",
      targetLabel: "Draft Alpha",
      requestedVisible:
        "Draft Beta remains unsaved. Draft Alpha saved successfully.",
      requestedEvidenceText: "Draft Alpha saved successfully.",
      otherVisible: "Draft Alpha remains unsaved. Draft Beta saved successfully.",
      otherEvidenceText: "Draft Beta saved successfully.",
      genericVisible: "Save completed.",
      genericSummary: "Save completed.",
    },
    {
      action: "send",
      request: "Send Message Alpha.",
      summary: "Sent Message Alpha.",
      targetLabel: "Message Alpha",
      requestedVisible:
        "Message Beta remains draft. Message Alpha sent successfully.",
      requestedEvidenceText: "Message Alpha sent successfully.",
      otherVisible:
        "Message Alpha remains draft. Message Beta sent successfully.",
      otherEvidenceText: "Message Beta sent successfully.",
      genericVisible: "Send completed.",
      genericSummary: "Send completed.",
    },
    {
      action: "export",
      request: "Export Report Alpha.",
      summary: "Exported Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains available. Report Alpha exported successfully.",
      requestedEvidenceText: "Report Alpha exported successfully.",
      otherVisible:
        "Report Alpha remains available. Report Beta exported successfully.",
      otherEvidenceText: "Report Beta exported successfully.",
      genericVisible: "Export completed.",
      genericSummary: "Export completed.",
    },
    {
      action: "download",
      request: "Download File Alpha.",
      summary: "Downloaded File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta remains available. File Alpha downloaded successfully.",
      requestedEvidenceText: "File Alpha downloaded successfully.",
      otherVisible:
        "File Alpha remains available. File Beta downloaded successfully.",
      otherEvidenceText: "File Beta downloaded successfully.",
      genericVisible: "Download completed.",
      genericSummary: "Download completed.",
    },
    {
      action: "upload",
      request: "Upload Attachment Alpha.",
      summary: "Uploaded Attachment Alpha.",
      targetLabel: "Attachment Alpha",
      requestedVisible:
        "Attachment Beta remains pending. Attachment Alpha uploaded successfully.",
      requestedEvidenceText: "Attachment Alpha uploaded successfully.",
      otherVisible:
        "Attachment Alpha remains pending. Attachment Beta uploaded successfully.",
      otherEvidenceText: "Attachment Beta uploaded successfully.",
      genericVisible: "Upload completed.",
      genericSummary: "Upload completed.",
    },
    {
      action: "import",
      request: "Import Contacts Alpha.",
      summary: "Imported Contacts Alpha.",
      targetLabel: "Contacts Alpha",
      requestedVisible:
        "Contacts Beta remains pending. Contacts Alpha imported successfully.",
      requestedEvidenceText: "Contacts Alpha imported successfully.",
      otherVisible:
        "Contacts Alpha remains pending. Contacts Beta imported successfully.",
      otherEvidenceText: "Contacts Beta imported successfully.",
      genericVisible: "Import completed.",
      genericSummary: "Import completed.",
    },
    {
      action: "copy",
      request: "Copy Link Alpha.",
      summary: "Copied Link Alpha.",
      targetLabel: "Link Alpha",
      requestedVisible:
        "Link Beta remains available. Link Alpha copied successfully.",
      requestedEvidenceText: "Link Alpha copied successfully.",
      otherVisible:
        "Link Alpha remains available. Link Beta copied successfully.",
      otherEvidenceText: "Link Beta copied successfully.",
      genericVisible: "Copied to clipboard.",
      genericSummary: "Copy completed.",
    },
    {
      action: "transfer",
      request: "Transfer Ticket Alpha.",
      summary: "Transferred Ticket Alpha.",
      targetLabel: "Ticket Alpha",
      requestedVisible:
        "Ticket Beta remains in the queue. Ticket Alpha transferred successfully.",
      requestedEvidenceText: "Ticket Alpha transferred successfully.",
      otherVisible:
        "Ticket Alpha remains in the queue. Ticket Beta transferred successfully.",
      otherEvidenceText: "Ticket Beta transferred successfully.",
      genericVisible: "Transfer completed.",
      genericSummary: "Transfer completed.",
    },
    {
      action: "move",
      request: "Move Card Alpha.",
      summary: "Moved Card Alpha.",
      targetLabel: "Card Alpha",
      requestedVisible:
        "Card Beta remains in Backlog. Card Alpha moved successfully.",
      requestedEvidenceText: "Card Alpha moved successfully.",
      otherVisible:
        "Card Alpha remains in Backlog. Card Beta moved successfully.",
      otherEvidenceText: "Card Beta moved successfully.",
      genericVisible: "Move completed.",
      genericSummary: "Move completed.",
    },
    {
      action: "rename",
      request: "Rename File Alpha.",
      summary: "Renamed File Alpha.",
      targetLabel: "File Alpha",
      requestedVisible:
        "File Beta keeps its name. File Alpha renamed successfully.",
      requestedEvidenceText: "File Alpha renamed successfully.",
      otherVisible:
        "File Alpha keeps its name. File Beta renamed successfully.",
      otherEvidenceText: "File Beta renamed successfully.",
      genericVisible: "Rename completed.",
      genericSummary: "Rename completed.",
    },
    {
      action: "merge",
      request: "Merge Pull Request Alpha.",
      summary: "Merged Pull Request Alpha.",
      targetLabel: "Pull Request Alpha",
      requestedVisible:
        "Pull Request Beta remains open. Pull Request Alpha merged successfully.",
      requestedEvidenceText: "Pull Request Alpha merged successfully.",
      otherVisible:
        "Pull Request Alpha remains open. Pull Request Beta merged successfully.",
      otherEvidenceText: "Pull Request Beta merged successfully.",
      genericVisible: "Merge completed.",
      genericSummary: "Merge completed.",
    },
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
      action: "subscribe",
      request: "Subscribe to Channel Alpha.",
      summary: "Subscribed to Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains inactive. Channel Alpha subscribed successfully.",
      requestedEvidenceText: "Channel Alpha subscribed successfully.",
      otherVisible:
        "Channel Alpha remains inactive. Channel Beta subscribed successfully.",
      otherEvidenceText: "Channel Beta subscribed successfully.",
      genericVisible: "Subscription completed.",
      genericSummary: "Subscription completed.",
    },
    {
      action: "unsubscribe",
      request: "Unsubscribe from Channel Alpha.",
      summary: "Unsubscribed from Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains active. Channel Alpha unsubscribed successfully.",
      requestedEvidenceText: "Channel Alpha unsubscribed successfully.",
      otherVisible:
        "Channel Alpha remains active. Channel Beta unsubscribed successfully.",
      otherEvidenceText: "Channel Beta unsubscribed successfully.",
      genericVisible: "Unsubscription completed.",
      genericSummary: "Unsubscription completed.",
    },
    {
      action: "pin",
      request: "Pin Report Alpha.",
      summary: "Pinned Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unpinned. Report Alpha pinned successfully.",
      requestedEvidenceText: "Report Alpha pinned successfully.",
      otherVisible:
        "Report Alpha remains unpinned. Report Beta pinned successfully.",
      otherEvidenceText: "Report Beta pinned successfully.",
      genericVisible: "Pin completed.",
      genericSummary: "Pin completed.",
    },
    {
      action: "unpin",
      request: "Unpin Report Alpha.",
      summary: "Unpinned Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains pinned. Report Alpha unpinned successfully.",
      requestedEvidenceText: "Report Alpha unpinned successfully.",
      otherVisible:
        "Report Alpha remains pinned. Report Beta unpinned successfully.",
      otherEvidenceText: "Report Beta unpinned successfully.",
      genericVisible: "Unpin completed.",
      genericSummary: "Unpin completed.",
    },
    {
      action: "mute",
      request: "Mute Channel Alpha.",
      summary: "Muted Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains audible. Channel Alpha muted successfully.",
      requestedEvidenceText: "Channel Alpha muted successfully.",
      otherVisible:
        "Channel Alpha remains audible. Channel Beta muted successfully.",
      otherEvidenceText: "Channel Beta muted successfully.",
      genericVisible: "Mute completed.",
      genericSummary: "Mute completed.",
    },
    {
      action: "unmute",
      request: "Unmute Channel Alpha.",
      summary: "Unmuted Channel Alpha.",
      targetLabel: "Channel Alpha",
      requestedVisible:
        "Channel Beta remains muted. Channel Alpha unmuted successfully.",
      requestedEvidenceText: "Channel Alpha unmuted successfully.",
      otherVisible:
        "Channel Alpha remains muted. Channel Beta unmuted successfully.",
      otherEvidenceText: "Channel Beta unmuted successfully.",
      genericVisible: "Unmute completed.",
      genericSummary: "Unmute completed.",
    },
    {
      action: "follow",
      request: "Follow Topic Alpha.",
      summary: "Followed Topic Alpha.",
      targetLabel: "Topic Alpha",
      requestedVisible:
        "Topic Beta remains unfollowed. Topic Alpha followed successfully.",
      requestedEvidenceText: "Topic Alpha followed successfully.",
      otherVisible:
        "Topic Alpha remains unfollowed. Topic Beta followed successfully.",
      otherEvidenceText: "Topic Beta followed successfully.",
      genericVisible: "Follow completed.",
      genericSummary: "Follow completed.",
    },
    {
      action: "unfollow",
      request: "Unfollow Topic Alpha.",
      summary: "Unfollowed Topic Alpha.",
      targetLabel: "Topic Alpha",
      requestedVisible:
        "Topic Beta remains followed. Topic Alpha unfollowed successfully.",
      requestedEvidenceText: "Topic Alpha unfollowed successfully.",
      otherVisible:
        "Topic Alpha remains followed. Topic Beta unfollowed successfully.",
      otherEvidenceText: "Topic Beta unfollowed successfully.",
      genericVisible: "Unfollow completed.",
      genericSummary: "Unfollow completed.",
    },
    {
      action: "bookmark",
      request: "Bookmark Page Alpha.",
      summary: "Bookmarked Page Alpha.",
      targetLabel: "Page Alpha",
      requestedVisible:
        "Page Beta remains unbookmarked. Page Alpha bookmarked successfully.",
      requestedEvidenceText: "Page Alpha bookmarked successfully.",
      otherVisible:
        "Page Alpha remains unbookmarked. Page Beta bookmarked successfully.",
      otherEvidenceText: "Page Beta bookmarked successfully.",
      genericVisible: "Bookmark completed.",
      genericSummary: "Bookmark completed.",
    },
    {
      action: "unbookmark",
      request: "Unbookmark Page Alpha.",
      summary: "Unbookmarked Page Alpha.",
      targetLabel: "Page Alpha",
      requestedVisible:
        "Page Beta remains bookmarked. Page Alpha unbookmarked successfully.",
      requestedEvidenceText: "Page Alpha unbookmarked successfully.",
      otherVisible:
        "Page Alpha remains bookmarked. Page Beta unbookmarked successfully.",
      otherEvidenceText: "Page Beta unbookmarked successfully.",
      genericVisible: "Unbookmark completed.",
      genericSummary: "Unbookmark completed.",
    },
    {
      action: "favorite",
      request: "Favorite Report Alpha.",
      summary: "Favorited Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains unfavorited. Report Alpha favorited successfully.",
      requestedEvidenceText: "Report Alpha favorited successfully.",
      otherVisible:
        "Report Alpha remains unfavorited. Report Beta favorited successfully.",
      otherEvidenceText: "Report Beta favorited successfully.",
      genericVisible: "Favorite completed.",
      genericSummary: "Favorite completed.",
    },
    {
      action: "unfavorite",
      request: "Unfavorite Report Alpha.",
      summary: "Unfavorited Report Alpha.",
      targetLabel: "Report Alpha",
      requestedVisible:
        "Report Beta remains favorited. Report Alpha unfavorited successfully.",
      requestedEvidenceText: "Report Alpha unfavorited successfully.",
      otherVisible:
        "Report Alpha remains favorited. Report Beta unfavorited successfully.",
      otherEvidenceText: "Report Beta unfavorited successfully.",
      genericVisible: "Unfavorite completed.",
      genericSummary: "Unfavorite completed.",
    },
    {
      action: "watch",
      request: "Watch Repository Alpha.",
      summary: "Watched Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains unwatched. Repository Alpha watched successfully.",
      requestedEvidenceText: "Repository Alpha watched successfully.",
      otherVisible:
        "Repository Alpha remains unwatched. Repository Beta watched successfully.",
      otherEvidenceText: "Repository Beta watched successfully.",
      genericVisible: "Watch completed.",
      genericSummary: "Watch completed.",
    },
    {
      action: "unwatch",
      request: "Unwatch Repository Alpha.",
      summary: "Unwatched Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains watched. Repository Alpha unwatched successfully.",
      requestedEvidenceText: "Repository Alpha unwatched successfully.",
      otherVisible:
        "Repository Alpha remains watched. Repository Beta unwatched successfully.",
      otherEvidenceText: "Repository Beta unwatched successfully.",
      genericVisible: "Unwatch completed.",
      genericSummary: "Unwatch completed.",
    },
    {
      action: "star",
      request: "Star Repository Alpha.",
      summary: "Starred Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains unstarred. Repository Alpha starred successfully.",
      requestedEvidenceText: "Repository Alpha starred successfully.",
      otherVisible:
        "Repository Alpha remains unstarred. Repository Beta starred successfully.",
      otherEvidenceText: "Repository Beta starred successfully.",
      genericVisible: "Star completed.",
      genericSummary: "Star completed.",
    },
    {
      action: "unstar",
      request: "Unstar Repository Alpha.",
      summary: "Unstarred Repository Alpha.",
      targetLabel: "Repository Alpha",
      requestedVisible:
        "Repository Beta remains starred. Repository Alpha unstarred successfully.",
      requestedEvidenceText: "Repository Alpha unstarred successfully.",
      otherVisible:
        "Repository Alpha remains starred. Repository Beta unstarred successfully.",
      otherEvidenceText: "Repository Beta unstarred successfully.",
      genericVisible: "Unstar completed.",
      genericSummary: "Unstar completed.",
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

  test("accepts target-aware visible restart confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Beta remains stopped. Service Alpha restarted successfully.",
      pageContent:
        "Service Beta remains stopped. Service Alpha restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({
            action: "restart",
            source: "visible_text",
            text: "Service Alpha restarted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible restart confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Service Alpha remains stopped. Service Beta restarted successfully.",
      pageContent:
        "Service Alpha remains stopped. Service Beta restarted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Restarted Service Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restart",
      targetLabel: "Service Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:restart",
          detail: expect.objectContaining({
            action: "restart",
            source: "visible_text",
            text: "Service Beta restarted successfully.",
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

  test("rejects targetless visible restart completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Restart completed.",
      pageContent: "Restart completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Restart Service Alpha.",
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
      targetLabel: "Service Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible refresh confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Beta is stale. Report Alpha refreshed successfully.",
      pageContent:
        "Report Beta is stale. Report Alpha refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({
            action: "refresh",
            source: "visible_text",
            text: "Report Alpha refreshed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible refresh confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Report Alpha is stale. Report Beta refreshed successfully.",
      pageContent:
        "Report Alpha is stale. Report Beta refreshed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Refreshed Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "refresh",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:refresh",
          detail: expect.objectContaining({
            action: "refresh",
            source: "visible_text",
            text: "Report Beta refreshed successfully.",
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

  test("rejects targetless visible refresh completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Refresh completed.",
      pageContent: "Refresh completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Refresh Report Alpha.",
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
      targetLabel: "Report Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts reject-class workflow confirmation after visible denial success", () => {
    const snap = workflowSnapshot({
      visibleContent: "Request denied successfully.",
      pageContent: "Request denied successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Deny the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Denied the request successfully.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({ action: "reject" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts approve-class workflow confirmation after visible approval completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval completed.",
      pageContent: "Approval completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({ action: "approve" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts reject-class workflow confirmation after visible rejection completion", () => {
    const snap = workflowSnapshot({
      visibleContent: "Rejection completed.",
      pageContent: "Rejection completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejection completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({ action: "reject" }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts approve-class workflow confirmation with successful noun summary", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval successful.",
      pageContent: "Approval successful.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve the request.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval successful.",
    });

    expect(decision.status).toBe("accepted");
  });

  test("accepts target-aware visible approve confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains pending. Request Alpha approved successfully.",
      pageContent:
        "Request Beta remains pending. Request Alpha approved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({
            action: "approve",
            source: "visible_text",
            text: "Request Alpha approved successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible approve confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains pending. Request Beta approved successfully.",
      pageContent:
        "Request Alpha remains pending. Request Beta approved successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approved Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:approve",
          detail: expect.objectContaining({
            action: "approve",
            source: "visible_text",
            text: "Request Beta approved successfully.",
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

  test("rejects targetless visible approval completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Approval completed.",
      pageContent: "Approval completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Approve Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Approval completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "approve",
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible reject confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains pending. Request Alpha rejected successfully.",
      pageContent:
        "Request Beta remains pending. Request Alpha rejected successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({
            action: "reject",
            source: "visible_text",
            text: "Request Alpha rejected successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible reject confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains pending. Request Beta rejected successfully.",
      pageContent:
        "Request Alpha remains pending. Request Beta rejected successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejected Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:reject",
          detail: expect.objectContaining({
            action: "reject",
            source: "visible_text",
            text: "Request Beta rejected successfully.",
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

  test("rejects targetless visible rejection completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Rejection completed.",
      pageContent: "Rejection completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Reject Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Rejection completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reject",
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

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
      visibleContent: "Order Beta remains active. Order Alpha canceled successfully.",
      pageContent: "Order Beta remains active. Order Alpha canceled successfully.",
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
      visibleContent: "Order Alpha remains active. Order Beta canceled successfully.",
      pageContent: "Order Alpha remains active. Order Beta canceled successfully.",
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

  test("accepts target-aware visible escalate confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains open. Incident Alpha escalated successfully.",
      pageContent:
        "Incident Beta remains open. Incident Alpha escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:escalate",
          detail: expect.objectContaining({
            action: "escalate",
            source: "visible_text",
            text: "Incident Alpha escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible escalate confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains open. Incident Beta escalated successfully.",
      pageContent:
        "Incident Alpha remains open. Incident Beta escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:escalate",
          detail: expect.objectContaining({
            action: "escalate",
            source: "visible_text",
            text: "Incident Beta escalated successfully.",
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

  test("rejects targetless visible escalation completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Escalation completed.",
      pageContent: "Escalation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Escalation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "escalate",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible deescalate confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Beta remains escalated. Incident Alpha de-escalated successfully.",
      pageContent:
        "Incident Beta remains escalated. Incident Alpha de-escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:deescalate",
          detail: expect.objectContaining({
            action: "deescalate",
            source: "visible_text",
            text: "Incident Alpha de-escalated successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible deescalate confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Incident Alpha remains escalated. Incident Beta de-escalated successfully.",
      pageContent:
        "Incident Alpha remains escalated. Incident Beta de-escalated successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalated Incident Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:deescalate",
          detail: expect.objectContaining({
            action: "deescalate",
            source: "visible_text",
            text: "Incident Beta de-escalated successfully.",
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

  test("rejects targetless visible deescalation completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "De-escalation completed.",
      pageContent: "De-escalation completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "De-escalate Incident Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "De-escalation completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "deescalate",
      targetLabel: "Incident Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

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

  test("accepts target-aware visible submit confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Beta remains draft. Request Alpha submitted successfully.",
      pageContent:
        "Request Beta remains draft. Request Alpha submitted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({
            action: "submit",
            source: "visible_text",
            text: "Request Alpha submitted successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible submit confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Request Alpha remains draft. Request Beta submitted successfully.",
      pageContent:
        "Request Alpha remains draft. Request Beta submitted successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submitted Request Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:submit",
          detail: expect.objectContaining({
            action: "submit",
            source: "visible_text",
            text: "Request Beta submitted successfully.",
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

  test("rejects targetless visible submission completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Submission completed.",
      pageContent: "Submission completed.",
    });
    const generated = generateCompletionContract({
      userRequest: "Submit Request Alpha.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Submission completed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
      targetLabel: "Request Alpha",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts target-aware visible complete confirmation for the requested target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Task TASK002 remains incomplete. Task TASK001 completed successfully.",
      pageContent:
        "Task TASK002 remains incomplete. Task TASK001 completed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:complete",
          detail: expect.objectContaining({
            action: "complete",
            source: "visible_text",
            text: "Task TASK001 completed successfully.",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware visible complete confirmation for a different target", () => {
    const snap = workflowSnapshot({
      visibleContent:
        "Task TASK001 remains incomplete. Task TASK002 completed successfully.",
      pageContent:
        "Task TASK001 remains incomplete. Task TASK002 completed successfully.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          logicalKey: "workflow:confirmation:complete",
          detail: expect.objectContaining({
            action: "complete",
            source: "visible_text",
            text: "Task TASK002 completed successfully.",
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

  test("rejects targetless visible complete completion for a named target", () => {
    const snap = workflowSnapshot({
      visibleContent: "Completion successful.",
      pageContent: "Completion successful.",
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Completion successful.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
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
