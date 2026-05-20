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

describe("completion kernel target-disappearance pin and mute preference workflow confirmation", () => {
  test("accepts pin confirmation from named unpinned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      pageContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      elements: [
        actionButton(543, "Pin Report Alpha"),
        actionButton(544, "Pin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Beta Pin Report Beta",
      pageContent: "Unpinned reports Report Beta Pin Report Beta",
      elements: [actionButton(544, "Pin Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pin:report-alpha",
        detail: expect.objectContaining({
          action: "pin",
          source: "target_disappearance",
          text: "Pinned target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects pin target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      pageContent:
        "Unpinned reports Report Alpha Pin Report Alpha Report Beta Pin Report Beta",
      elements: [
        actionButton(543, "Pin Report Alpha"),
        actionButton(544, "Pin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Pin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 544 },
      result: "Clicked element 544.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Pinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pin:report-beta",
        detail: expect.objectContaining({
          action: "pin",
          source: "target_disappearance",
          text: "Pinned target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer pin confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin Report Alpha",
      pageContent: "Unpinned reports Report Alpha Pin Report Alpha",
      elements: [actionButton(543, "Pin Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer pin confirmation from a generic pin button", () => {
    const genericPinButton: TaggedElement = {
      tag: 543,
      tagName: "button",
      role: "button",
      text: "Pin",
      attributes: {
        id: "pin",
        "aria-label": "Pin",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unpinned reports Report Alpha Pin",
      pageContent: "Unpinned reports Report Alpha Pin",
      elements: [genericPinButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unpinned reports",
      pageContent: "Unpinned reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 543 },
      result: "Clicked element 543.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts unpin confirmation from named pinned target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      pageContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      elements: [
        actionButton(539, "Unpin Report Alpha"),
        actionButton(540, "Unpin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Beta Unpin Report Beta",
      pageContent: "Pinned reports Report Beta Unpin Report Beta",
      elements: [actionButton(540, "Unpin Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unpin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unpinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unpin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unpin:report-alpha",
        detail: expect.objectContaining({
          action: "unpin",
          source: "target_disappearance",
          text: "Unpinned target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unpin target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      pageContent:
        "Pinned reports Report Alpha Unpin Report Alpha Report Beta Unpin Report Beta",
      elements: [
        actionButton(539, "Unpin Report Alpha"),
        actionButton(540, "Unpin Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unpin Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 540 },
      result: "Clicked element 540.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unpinned Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unpin",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unpin:report-beta",
        detail: expect.objectContaining({
          action: "unpin",
          source: "target_disappearance",
          text: "Unpinned target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unpin confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin Report Alpha",
      pageContent: "Pinned reports Report Alpha Unpin Report Alpha",
      elements: [actionButton(539, "Unpin Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unpin confirmation from a generic unpin button", () => {
    const genericUnpinButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Unpin",
      attributes: {
        id: "unpin",
        "aria-label": "Unpin",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pinned reports Report Alpha Unpin",
      pageContent: "Pinned reports Report Alpha Unpin",
      elements: [genericUnpinButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pinned reports",
      pageContent: "Pinned reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 539 },
      result: "Clicked element 539.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts mute confirmation from named unmuted target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      pageContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      elements: [
        actionButton(545, "Mute Channel Alpha"),
        actionButton(546, "Mute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Beta Mute Channel Beta",
      pageContent: "Unmuted channels Channel Beta Mute Channel Beta",
      elements: [actionButton(546, "Mute Channel Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Muted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "mute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:mute:channel-alpha",
        detail: expect.objectContaining({
          action: "mute",
          source: "target_disappearance",
          text: "Muted target no longer visible: Channel Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects mute target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      pageContent:
        "Unmuted channels Channel Alpha Mute Channel Alpha Channel Beta Mute Channel Beta",
      elements: [
        actionButton(545, "Mute Channel Alpha"),
        actionButton(546, "Mute Channel Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Mute Channel Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 546 },
      result: "Clicked element 546.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Muted Channel Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "mute",
      targetLabel: "Channel Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:mute:channel-beta",
        detail: expect.objectContaining({
          action: "mute",
          source: "target_disappearance",
          text: "Muted target no longer visible: Channel Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer mute confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      pageContent: "Unmuted channels Channel Alpha Mute Channel Alpha",
      elements: [actionButton(545, "Mute Channel Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer mute confirmation from a generic mute button", () => {
    const genericMuteButton: TaggedElement = {
      tag: 545,
      tagName: "button",
      role: "button",
      text: "Mute",
      attributes: {
        id: "mute",
        "aria-label": "Mute",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unmuted channels Channel Alpha Mute",
      pageContent: "Unmuted channels Channel Alpha Mute",
      elements: [genericMuteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unmuted channels",
      pageContent: "Unmuted channels",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 545 },
      result: "Clicked element 545.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

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

