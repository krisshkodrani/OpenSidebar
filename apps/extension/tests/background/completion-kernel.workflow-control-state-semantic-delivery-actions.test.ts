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

function stableActionButton(
  tag: number,
  label: string,
  id: string,
): TaggedElement {
  return {
    ...actionButton(tag, label),
    attributes: {
      id,
      "aria-label": label,
    },
  };
}

function dataStateActionButton(
  tag: number,
  label: string,
  state: string,
  id: string,
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "data-state": state,
    },
  };
}

describe("completion kernel workflow control-state semantic delivery action confirmation", () => {
  test("accepts send confirmation from semantic send data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          828,
          "Send Message Alpha",
          "draft",
          "message-alpha-send",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          829,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Send Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 828 },
      result: "Clicked element 828.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:control-state:message-alpha-send",
        detail: expect.objectContaining({
          action: "send",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to sent: Send Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer send confirmation when semantic data-state was already sent", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          830,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          831,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 830 },
      result: "Clicked element 830.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer send confirmation when semantic data-state flips draft", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          832,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          833,
          "Send Message Alpha",
          "draft",
          "message-alpha-send",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 832 },
      result: "Clicked element 832.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

});
