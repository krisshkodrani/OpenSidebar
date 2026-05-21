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

describe("completion kernel target-disappearance status lifecycle workflow confirmation", () => {
  test("accepts rollback confirmation from named release disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      pageContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      elements: [
        actionButton(531, "Rollback Release Alpha"),
        actionButton(532, "Rollback Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Beta Rollback Release Beta",
      pageContent: "Pending rollbacks Release Beta Rollback Release Beta",
      elements: [actionButton(532, "Rollback Release Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rollback Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rolled back Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rollback",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rollback:release-alpha",
        detail: expect.objectContaining({
          action: "rollback",
          source: "target_disappearance",
          text: "Rolled back target no longer visible: Release Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects rollback target-disappearance evidence for the wrong requested release", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      pageContent:
        "Pending rollbacks Release Alpha Rollback Release Alpha Release Beta Rollback Release Beta",
      elements: [
        actionButton(531, "Rollback Release Alpha"),
        actionButton(532, "Rollback Release Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Rollback Release Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 532 },
      result: "Clicked element 532.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Rolled back Release Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "rollback",
      targetLabel: "Release Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:rollback:release-beta",
        detail: expect.objectContaining({
          action: "rollback",
          source: "target_disappearance",
          text: "Rolled back target no longer visible: Release Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer rollback confirmation while the named release remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      pageContent: "Pending rollbacks Release Alpha Rollback Release Alpha",
      elements: [actionButton(531, "Rollback Release Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer rollback confirmation from a generic rollback button", () => {
    const genericRollbackButton: TaggedElement = {
      tag: 531,
      tagName: "button",
      role: "button",
      text: "Rollback",
      attributes: {
        id: "rollback",
        "aria-label": "Rollback",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending rollbacks Release Alpha Rollback",
      pageContent: "Pending rollbacks Release Alpha Rollback",
      elements: [genericRollbackButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending rollbacks",
      pageContent: "Pending rollbacks",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 531 },
      result: "Clicked element 531.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

});
