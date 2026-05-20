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

describe("completion kernel target-disappearance reopen workflow confirmation", () => {
  test("accepts reopen confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      pageContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      elements: [
        actionButton(539, "Reopen Ticket Alpha"),
        actionButton(540, "Reopen Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Beta Reopen Ticket Beta",
      pageContent: "Closed tickets Ticket Beta Reopen Ticket Beta",
      elements: [actionButton(540, "Reopen Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Ticket Alpha.",
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
      summary: "Reopened Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:ticket-alpha",
        detail: expect.objectContaining({
          action: "reopen",
          source: "target_disappearance",
          text: "Reopened target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects reopen target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      pageContent:
        "Closed tickets Ticket Alpha Reopen Ticket Alpha Ticket Beta Reopen Ticket Beta",
      elements: [
        actionButton(539, "Reopen Ticket Alpha"),
        actionButton(540, "Reopen Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Reopen Ticket Alpha.",
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
      summary: "Reopened Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "reopen",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:reopen:ticket-beta",
        detail: expect.objectContaining({
          action: "reopen",
          source: "target_disappearance",
          text: "Reopened target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer reopen confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Closed tickets Ticket Alpha Reopen Ticket Alpha",
      elements: [actionButton(539, "Reopen Ticket Alpha")],
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

  test("does not infer reopen confirmation from a generic reopen button", () => {
    const genericReopenButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Reopen",
      attributes: {
        id: "reopen",
        "aria-label": "Reopen",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen",
      pageContent: "Closed tickets Ticket Alpha Reopen",
      elements: [genericReopenButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets",
      pageContent: "Closed tickets",
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

  test("does not infer reopen confirmation from a generic reopen ticket control", () => {
    const genericReopenTicketButton: TaggedElement = {
      tag: 539,
      tagName: "button",
      role: "button",
      text: "Reopen ticket",
      attributes: {
        id: "reopen-ticket",
        "aria-label": "Reopen ticket",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Closed tickets Ticket Alpha Reopen ticket",
      pageContent: "Closed tickets Ticket Alpha Reopen ticket",
      elements: [genericReopenTicketButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Closed tickets",
      pageContent: "Closed tickets",
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
});
