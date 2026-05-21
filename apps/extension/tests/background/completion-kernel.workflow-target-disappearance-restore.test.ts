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

describe("completion kernel target-disappearance restore workflow confirmation", () => {
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
