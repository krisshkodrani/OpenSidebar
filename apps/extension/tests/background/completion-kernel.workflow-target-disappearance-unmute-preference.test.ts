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

describe("completion kernel target-disappearance unmute preference workflow confirmation", () => {
  test("accepts unmute confirmation from named muted target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      pageContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      elements: [
        actionButton(541, "Unmute Channel Alpha"),
        actionButton(542, "Unmute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Beta Unmute Channel Beta",
      pageContent: "Muted channels Channel Beta Unmute Channel Beta",
      elements: [actionButton(542, "Unmute Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unmute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unmuted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unmute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unmute:channel-alpha",
        detail: expect.objectContaining({
          action: "unmute",
          source: "target_disappearance",
          text: "Unmuted target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unmute target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      pageContent:
        "Muted channels Channel Alpha Unmute Channel Alpha Channel Beta Unmute Channel Beta",
      elements: [
        actionButton(541, "Unmute Channel Alpha"),
        actionButton(542, "Unmute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unmute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 542 },
      result: "Clicked element 542.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unmuted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unmute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unmute:channel-beta",
        detail: expect.objectContaining({
          action: "unmute",
          source: "target_disappearance",
          text: "Unmuted target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unmute confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      pageContent: "Muted channels Channel Alpha Unmute Channel Alpha",
      elements: [actionButton(541, "Unmute Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unmute confirmation from a generic unmute button", () => {
    const genericUnmuteButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Unmute",
      attributes: {
        id: "unmute",
        "aria-label": "Unmute",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Muted channels Channel Alpha Unmute",
      pageContent: "Muted channels Channel Alpha Unmute",
      elements: [genericUnmuteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Muted channels",
      pageContent: "Muted channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 541 },
      result: "Clicked element 541.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
