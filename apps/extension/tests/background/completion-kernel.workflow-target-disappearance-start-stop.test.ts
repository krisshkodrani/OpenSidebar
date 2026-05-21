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

describe("completion kernel start and stop target-disappearance job-control workflow confirmation", () => {
  test("accepts start confirmation from named stopped target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      pageContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      elements: [
        actionButton(559, "Start Job Alpha"),
        actionButton(560, "Start Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Beta Start Job Beta",
      pageContent: "Stopped jobs Job Beta Start Job Beta",
      elements: [actionButton(560, "Start Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Start Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:job-alpha",
        detail: expect.objectContaining({
          action: "start",
          source: "target_disappearance",
          text: "Started target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects start target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      pageContent:
        "Stopped jobs Job Alpha Start Job Alpha Job Beta Start Job Beta",
      elements: [
        actionButton(559, "Start Job Alpha"),
        actionButton(560, "Start Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Start Job Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 560 },
      result: "Clicked element 560.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Started Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:job-beta",
        detail: expect.objectContaining({
          action: "start",
          source: "target_disappearance",
          text: "Started target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer start confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start Job Alpha",
      pageContent: "Stopped jobs Job Alpha Start Job Alpha",
      elements: [actionButton(559, "Start Job Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer start confirmation from a generic start button", () => {
    const genericStartButton: TaggedElement = {
      tag: 559,
      tagName: "button",
      role: "button",
      text: "Start",
      attributes: {
        id: "start",
        "aria-label": "Start",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Stopped jobs Job Alpha Start",
      pageContent: "Stopped jobs Job Alpha Start",
      elements: [genericStartButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Stopped jobs",
      pageContent: "Stopped jobs",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 559 },
      result: "Clicked element 559.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts stop confirmation from named running target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      pageContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      elements: [
        actionButton(561, "Stop Job Alpha"),
        actionButton(562, "Stop Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Beta Stop Job Beta",
      pageContent: "Running jobs Job Beta Stop Job Beta",
      elements: [actionButton(562, "Stop Job Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Job Alpha.",
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
      summary: "Stopped Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:job-alpha",
        detail: expect.objectContaining({
          action: "stop",
          source: "target_disappearance",
          text: "Stopped target no longer visible: Job Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects stop target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      pageContent:
        "Running jobs Job Alpha Stop Job Alpha Job Beta Stop Job Beta",
      elements: [
        actionButton(561, "Stop Job Alpha"),
        actionButton(562, "Stop Job Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop Job Alpha.",
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
      summary: "Stopped Job Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
      targetLabel: "Job Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:job-beta",
        detail: expect.objectContaining({
          action: "stop",
          source: "target_disappearance",
          text: "Stopped target no longer visible: Job Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer stop confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop Job Alpha",
      pageContent: "Running jobs Job Alpha Stop Job Alpha",
      elements: [actionButton(561, "Stop Job Alpha")],
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

  test("does not infer stop confirmation from a generic stop button", () => {
    const genericStopButton: TaggedElement = {
      tag: 561,
      tagName: "button",
      role: "button",
      text: "Stop",
      attributes: {
        id: "stop",
        "aria-label": "Stop",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Running jobs Job Alpha Stop",
      pageContent: "Running jobs Job Alpha Stop",
      elements: [genericStopButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Running jobs",
      pageContent: "Running jobs",
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
});
