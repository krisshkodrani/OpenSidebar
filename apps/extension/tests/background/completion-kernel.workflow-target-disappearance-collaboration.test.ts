import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

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

function actionButton(tag: number, label: string): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: key,
      "aria-label": label,
    },
    rect: { x: 500, y: tag * 20, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel collaboration workflow confirmation", () => {
  test("accepts copy confirmation from named link disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      pageContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      elements: [
        actionButton(561, "Copy Link Alpha"),
        actionButton(562, "Copy Link Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending copies Link Beta Copy Link Beta",
      pageContent: "Pending copies Link Beta Copy Link Beta",
      elements: [actionButton(562, "Copy Link Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Copy Link Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Copied Link Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "copy",
      targetLabel: "Link Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:copy:link-alpha",
        detail: expect.objectContaining({
          action: "copy",
          source: "target_disappearance",
          text: "Copied target no longer visible: Link Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects copy target-disappearance evidence for the wrong requested link", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      pageContent:
        "Pending copies Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      elements: [
        actionButton(561, "Copy Link Alpha"),
        actionButton(562, "Copy Link Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending copies Link Alpha Copy Link Alpha",
      pageContent: "Pending copies Link Alpha Copy Link Alpha",
      elements: [actionButton(561, "Copy Link Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Copy Link Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 562 },
      result: "Clicked element 562.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Copied Link Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "copy",
      targetLabel: "Link Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:copy:link-beta",
        detail: expect.objectContaining({
          action: "copy",
          source: "target_disappearance",
          text: "Copied target no longer visible: Link Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer copy confirmation while the named link remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending copies Link Alpha Copy Link Alpha",
      pageContent: "Pending copies Link Alpha Copy Link Alpha",
      elements: [actionButton(561, "Copy Link Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending copies Link Alpha Copy Link Alpha",
      pageContent: "Pending copies Link Alpha Copy Link Alpha",
      elements: [actionButton(561, "Copy Link Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer copy confirmation from a generic copy link control", () => {
    const genericCopyLinkButton: TaggedElement = {
      tag: 561,
      tagName: "button",
      role: "button",
      text: "Copy link",
      attributes: {
        id: "copy-link",
        "aria-label": "Copy link",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available links Link Alpha Copy link",
      pageContent: "Available links Link Alpha Copy link",
      elements: [genericCopyLinkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available links",
      pageContent: "Available links",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 561 },
      result: "Clicked element 561.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts share confirmation from named report disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      pageContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      elements: [
        actionButton(563, "Share Report Alpha"),
        actionButton(564, "Share Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Beta Share Report Beta",
      pageContent: "Pending shares Report Beta Share Report Beta",
      elements: [actionButton(564, "Share Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Share Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Shared Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "share",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:share:report-alpha",
        detail: expect.objectContaining({
          action: "share",
          source: "target_disappearance",
          text: "Shared target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects share target-disappearance evidence for the wrong requested report", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      pageContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      elements: [
        actionButton(563, "Share Report Alpha"),
        actionButton(564, "Share Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Share Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 564 },
      result: "Clicked element 564.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Shared Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "share",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:share:report-beta",
        detail: expect.objectContaining({
          action: "share",
          source: "target_disappearance",
          text: "Shared target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer share confirmation while the named report remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer share confirmation from a generic share report control", () => {
    const genericShareReportButton: TaggedElement = {
      tag: 563,
      tagName: "button",
      role: "button",
      text: "Share report",
      attributes: {
        id: "share-report",
        "aria-label": "Share report",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available reports Report Alpha Share report",
      pageContent: "Available reports Report Alpha Share report",
      elements: [genericShareReportButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available reports",
      pageContent: "Available reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts restore confirmation from named version disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      pageContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      elements: [
        actionButton(565, "Restore Version Alpha"),
        actionButton(566, "Restore Version Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived versions Version Beta Restore Version Beta",
      pageContent: "Archived versions Version Beta Restore Version Beta",
      elements: [actionButton(566, "Restore Version Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restore Version Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restored Version Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restore",
      targetLabel: "Version Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restore:version-alpha",
        detail: expect.objectContaining({
          action: "restore",
          source: "target_disappearance",
          text: "Restored target no longer visible: Version Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects restore target-disappearance evidence for the wrong requested version", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      pageContent:
        "Archived versions Version Alpha Restore Version Alpha Version Beta Restore Version Beta",
      elements: [
        actionButton(565, "Restore Version Alpha"),
        actionButton(566, "Restore Version Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived versions Version Alpha Restore Version Alpha",
      pageContent: "Archived versions Version Alpha Restore Version Alpha",
      elements: [actionButton(565, "Restore Version Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Restore Version Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 566 },
      result: "Clicked element 566.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Restored Version Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "restore",
      targetLabel: "Version Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:restore:version-beta",
        detail: expect.objectContaining({
          action: "restore",
          source: "target_disappearance",
          text: "Restored target no longer visible: Version Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer restore confirmation while the named version remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Archived versions Version Alpha Restore Version Alpha",
      pageContent: "Archived versions Version Alpha Restore Version Alpha",
      elements: [actionButton(565, "Restore Version Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived versions Version Alpha Restore Version Alpha",
      pageContent: "Archived versions Version Alpha Restore Version Alpha",
      elements: [actionButton(565, "Restore Version Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer restore confirmation from a generic restore backup control", () => {
    const genericRestoreBackupButton: TaggedElement = {
      tag: 565,
      tagName: "button",
      role: "button",
      text: "Restore backup",
      attributes: {
        id: "restore-backup",
        "aria-label": "Restore backup",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Archived backups Version Alpha Restore backup",
      pageContent: "Archived backups Version Alpha Restore backup",
      elements: [genericRestoreBackupButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Archived backups",
      pageContent: "Archived backups",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 565 },
      result: "Clicked element 565.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
