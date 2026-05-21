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

describe("completion kernel target-disappearance unwatch workflow confirmation", () => {
  test("accepts unwatch confirmation from named watched target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      elements: [
        actionButton(531, "Unwatch Repository Alpha"),
        actionButton(532, "Unwatch Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Beta Unwatch Repository Beta",
      pageContent:
        "Watched repositories Repository Beta Unwatch Repository Beta",
      elements: [actionButton(532, "Unwatch Repository Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unwatch Repository Alpha.",
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
      summary: "Unwatched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unwatch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unwatch:repository-alpha",
        detail: expect.objectContaining({
          action: "unwatch",
          source: "target_disappearance",
          text: "Unwatched target no longer visible: Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unwatch target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha Repository Beta Unwatch Repository Beta",
      elements: [
        actionButton(531, "Unwatch Repository Alpha"),
        actionButton(532, "Unwatch Repository Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      elements: [actionButton(531, "Unwatch Repository Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unwatch Repository Alpha.",
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
      summary: "Unwatched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unwatch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unwatch:repository-beta",
        detail: expect.objectContaining({
          action: "unwatch",
          source: "target_disappearance",
          text: "Unwatched target no longer visible: Repository Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unwatch confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      elements: [actionButton(531, "Unwatch Repository Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      pageContent:
        "Watched repositories Repository Alpha Unwatch Repository Alpha",
      elements: [actionButton(531, "Unwatch Repository Alpha")],
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

  test("does not infer unwatch confirmation from a generic unwatch button", () => {
    const genericUnwatchButton: TaggedElement = {
      tag: 531,
      tagName: "button",
      role: "button",
      text: "Unwatch",
      attributes: {
        id: "unwatch",
        "aria-label": "Unwatch",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Watched repositories Repository Alpha Unwatch",
      pageContent: "Watched repositories Repository Alpha Unwatch",
      elements: [genericUnwatchButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Watched repositories",
      pageContent: "Watched repositories",
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
