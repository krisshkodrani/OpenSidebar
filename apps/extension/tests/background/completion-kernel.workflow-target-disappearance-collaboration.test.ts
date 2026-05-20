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

function rowElement(tag: number, text: string): TaggedElement {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "tr",
    role: "row",
    text,
    attributes: {
      id: `row-${key}`,
    },
    rect: { x: 0, y: tag * 20, width: 600, height: 32 },
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

  test("accepts duplicate confirmation from named template disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        actionButton(567, "Duplicate Template Alpha"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Beta Duplicate Template Beta",
      elements: [actionButton(568, "Duplicate Template Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:duplicate:template-alpha",
        detail: expect.objectContaining({
          action: "duplicate",
          source: "target_disappearance",
          text: "Duplicated target no longer visible: Template Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects duplicate target-disappearance evidence for the wrong requested template", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        actionButton(567, "Duplicate Template Alpha"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 568 },
      result: "Clicked element 568.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:duplicate:template-beta",
        detail: expect.objectContaining({
          action: "duplicate",
          source: "target_disappearance",
          text: "Duplicated target no longer visible: Template Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts duplicate confirmation from a newly visible duplicate row", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated Template Beta Duplicate Template Beta",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated Template Beta Duplicate Template Beta",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Copy Duplicated"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "duplicate",
      targetLabel: "Template Alpha",
    });
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:duplicate:row:template-alpha",
          detail: expect.objectContaining({
            action: "duplicate",
            source: "duplicate_row_state",
            targetText: "Template Alpha",
            text: "Duplicated row visible: Template Alpha",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts copy confirmation from a newly visible copied row", () => {
    const pre = workflowSnapshot({
      visibleContent: "Links Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      pageContent: "Links Link Alpha Copy Link Alpha Link Beta Copy Link Beta",
      elements: [
        rowElement(661, "Link Alpha"),
        actionButton(567, "Copy Link Alpha"),
        rowElement(662, "Link Beta"),
        actionButton(568, "Copy Link Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Links Link Alpha Copy Link Alpha Link Alpha Copy Link Beta Copy Link Beta",
      pageContent:
        "Links Link Alpha Copy Link Alpha Link Alpha Copy Link Beta Copy Link Beta",
      elements: [
        rowElement(661, "Link Alpha"),
        actionButton(567, "Copy Link Alpha"),
        rowElement(663, "Link Alpha Copy"),
        rowElement(662, "Link Beta"),
        actionButton(568, "Copy Link Beta"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Copy Link Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
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
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:copy:row:link-alpha",
          detail: expect.objectContaining({
            action: "copy",
            source: "duplicate_row_state",
            targetText: "Link Alpha",
            text: "Copied row visible: Link Alpha",
          }),
        }),
      ]),
    );
    expect(decision.status).toBe("accepted");
  });

  test("rejects duplicate row-state evidence for the wrong requested template", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta Template Beta Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Beta Duplicate Template Beta Template Beta Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(662, "Template Beta"),
        actionButton(568, "Duplicate Template Beta"),
        rowElement(663, "Template Beta Copy Duplicated"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Duplicate Template Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 568 },
      result: "Clicked element 568.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Duplicated Template Alpha.",
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "workflow:confirmation:duplicate:row:template-beta",
          detail: expect.objectContaining({
            action: "duplicate",
            source: "duplicate_row_state",
            targetText: "Template Beta",
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

  test("does not infer duplicate row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Templates Template Alpha Duplicate Template Alpha",
      pageContent: "Templates Template Alpha Duplicate Template Alpha",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "duplicate_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer duplicate row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Copy Duplicated"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Copy Duplicated",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Copy Duplicated"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "duplicate_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer duplicate row-state evidence without duplicate state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Templates Template Alpha Duplicate Template Alpha",
      pageContent: "Templates Template Alpha Duplicate Template Alpha",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Active",
      pageContent:
        "Templates Template Alpha Duplicate Template Alpha Template Alpha Active",
      elements: [
        rowElement(661, "Template Alpha"),
        actionButton(567, "Duplicate Template Alpha"),
        rowElement(663, "Template Alpha Active"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            source: "duplicate_row_state",
          }),
        }),
      ]),
    );
  });

  test("does not infer duplicate confirmation while the named template remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      pageContent:
        "Pending duplicate jobs Template Alpha Duplicate Template Alpha",
      elements: [actionButton(567, "Duplicate Template Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer duplicate confirmation from a generic duplicate template control", () => {
    const genericDuplicateTemplateButton: TaggedElement = {
      tag: 567,
      tagName: "button",
      role: "button",
      text: "Duplicate template",
      attributes: {
        id: "duplicate-template",
        "aria-label": "Duplicate template",
      },
      rect: { x: 500, y: 80, width: 150, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available templates Template Alpha Duplicate template",
      pageContent: "Available templates Template Alpha Duplicate template",
      elements: [genericDuplicateTemplateButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available work",
      pageContent: "Available work",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 567 },
      result: "Clicked element 567.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts invite confirmation from named member disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      pageContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      elements: [
        actionButton(569, "Invite Member Alpha"),
        actionButton(570, "Invite Member Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Beta Invite Member Beta",
      pageContent: "Pending invitations Member Beta Invite Member Beta",
      elements: [actionButton(570, "Invite Member Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "invite",
      targetLabel: "Member Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:member-alpha",
        detail: expect.objectContaining({
          action: "invite",
          source: "target_disappearance",
          text: "Invited target no longer visible: Member Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects invite target-disappearance evidence for the wrong requested member", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      pageContent:
        "Pending invitations Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      elements: [
        actionButton(569, "Invite Member Alpha"),
        actionButton(570, "Invite Member Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Invite Member Alpha",
      pageContent: "Pending invitations Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 570 },
      result: "Clicked element 570.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "invite",
      targetLabel: "Member Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:member-beta",
        detail: expect.objectContaining({
          action: "invite",
          source: "target_disappearance",
          text: "Invited target no longer visible: Member Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer invite confirmation while the named member remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Invite Member Alpha",
      pageContent: "Pending invitations Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Invite Member Alpha",
      pageContent: "Pending invitations Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite confirmation from a generic invite member control", () => {
    const genericInviteMemberButton: TaggedElement = {
      tag: 569,
      tagName: "button",
      role: "button",
      text: "Invite member",
      attributes: {
        id: "invite-member",
        "aria-label": "Invite member",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite member",
      pageContent: "Members Member Alpha Invite member",
      elements: [genericInviteMemberButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Members",
      pageContent: "Members",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts invite confirmation from visible pending invitation row", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [rowElement(641, "Member Alpha Pending invitation")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "invite",
      targetLabel: "Member Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:row:member-alpha",
        detail: expect.objectContaining({
          action: "invite",
          source: "invite_row_state",
          targetText: "Member Alpha",
          text: "Invitation row visible: Member Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects invite row-state evidence for the wrong requested member", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Members Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      pageContent:
        "Members Member Alpha Invite Member Alpha Member Beta Invite Member Beta",
      elements: [
        actionButton(569, "Invite Member Alpha"),
        actionButton(570, "Invite Member Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Beta Pending invitation",
      pageContent: "Pending invitations Member Beta Pending invitation",
      elements: [rowElement(641, "Member Beta Pending invitation")],
    });
    const generated = generateCompletionContract({
      userRequest: "Invite Member Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 570 },
      result: "Clicked element 570.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Invited Member Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:invite:row:member-beta",
        detail: expect.objectContaining({
          action: "invite",
          source: "invite_row_state",
          targetText: "Member Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer invite row-state evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite row-state evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending invitations Member Alpha Pending invitation Members Member Alpha Invite Member Alpha",
      pageContent:
        "Pending invitations Member Alpha Pending invitation Members Member Alpha Invite Member Alpha",
      elements: [
        rowElement(641, "Member Alpha Pending invitation"),
        actionButton(569, "Invite Member Alpha"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending invitations Member Alpha Pending invitation",
      pageContent: "Pending invitations Member Alpha Pending invitation",
      elements: [rowElement(641, "Member Alpha Pending invitation")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite row-state evidence without invitation state text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Members Member Alpha Invite Member Alpha",
      pageContent: "Members Member Alpha Invite Member Alpha",
      elements: [actionButton(569, "Invite Member Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Members Member Alpha Viewer",
      pageContent: "Members Member Alpha Viewer",
      elements: [rowElement(641, "Member Alpha Viewer")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 569 },
      result: "Clicked element 569.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
