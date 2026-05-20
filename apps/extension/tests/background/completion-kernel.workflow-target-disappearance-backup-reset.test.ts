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

describe("completion kernel target-disappearance backup and reset workflow confirmation", () => {
  test("accepts backup confirmation from named database disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      pageContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      elements: [
        actionButton(504, "Back up Database Alpha"),
        actionButton(505, "Back up Database Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Beta Back up Database Beta",
      pageContent: "Backup queue Database Beta Back up Database Beta",
      elements: [actionButton(505, "Back up Database Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Back up Database Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Backed up Database Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "backup",
      targetLabel: "Database Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:backup:database-alpha",
        detail: expect.objectContaining({
          action: "backup",
          source: "target_disappearance",
          text: "Backed up target no longer visible: Database Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects backup target-disappearance evidence for the wrong requested database", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      pageContent:
        "Backup queue Database Alpha Back up Database Alpha Database Beta Back up Database Beta",
      elements: [
        actionButton(504, "Back up Database Alpha"),
        actionButton(505, "Back up Database Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Back up Database Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Backed up Database Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "backup",
      targetLabel: "Database Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:backup:database-beta",
        detail: expect.objectContaining({
          action: "backup",
          source: "target_disappearance",
          text: "Backed up target no longer visible: Database Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer backup confirmation while the named database remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up Database Alpha",
      pageContent: "Backup queue Database Alpha Back up Database Alpha",
      elements: [actionButton(504, "Back up Database Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer backup confirmation from a generic backup button", () => {
    const genericBackupButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Back up",
      attributes: {
        id: "backup",
        "aria-label": "Back up",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Backup queue Database Alpha Back up",
      pageContent: "Backup queue Database Alpha Back up",
      elements: [genericBackupButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Backup queue",
      pageContent: "Backup queue",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts reset confirmation from named credential disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      pageContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      elements: [
        actionButton(504, "Reset Password Alpha"),
        actionButton(505, "Reset Password Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Beta Reset Password Beta",
      pageContent: "Reset queue Password Beta Reset Password Beta",
      elements: [actionButton(505, "Reset Password Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reset Password Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reset Password Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reset",
      targetLabel: "Password Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reset:password-alpha",
        detail: expect.objectContaining({
          action: "reset",
          source: "target_disappearance",
          text: "Reset target no longer visible: Password Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reset target-disappearance evidence for the wrong requested credential", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      pageContent:
        "Reset queue Password Alpha Reset Password Alpha Password Beta Reset Password Beta",
      elements: [
        actionButton(504, "Reset Password Alpha"),
        actionButton(505, "Reset Password Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reset Password Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Reset Password Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reset",
      targetLabel: "Password Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reset:password-beta",
        detail: expect.objectContaining({
          action: "reset",
          source: "target_disappearance",
          text: "Reset target no longer visible: Password Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reset confirmation while the named credential remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset Password Alpha",
      pageContent: "Reset queue Password Alpha Reset Password Alpha",
      elements: [actionButton(504, "Reset Password Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reset confirmation from a generic reset button", () => {
    const genericResetButton: TaggedElement = {
      tag: 504,
      tagName: "button",
      role: "button",
      text: "Reset",
      attributes: {
        id: "reset",
        "aria-label": "Reset",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Reset queue Password Alpha Reset",
      pageContent: "Reset queue Password Alpha Reset",
      elements: [genericResetButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Reset queue",
      pageContent: "Reset queue",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 504 },
      result: "Clicked element 504.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

});
