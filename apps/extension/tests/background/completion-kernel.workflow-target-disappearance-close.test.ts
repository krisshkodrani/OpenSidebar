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

describe("completion kernel target-disappearance close workflow confirmation", () => {
  test("accepts close confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      pageContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      elements: [
        actionButton(537, "Close Ticket Alpha"),
        actionButton(538, "Close Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Beta Close Ticket Beta",
      pageContent: "Open tickets Ticket Beta Close Ticket Beta",
      elements: [actionButton(538, "Close Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Close Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:ticket-alpha",
        detail: expect.objectContaining({
          action: "close",
          source: "target_disappearance",
          text: "Closed target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects close target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      pageContent:
        "Open tickets Ticket Alpha Close Ticket Alpha Ticket Beta Close Ticket Beta",
      elements: [
        actionButton(537, "Close Ticket Alpha"),
        actionButton(538, "Close Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Close Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 538 },
      result: "Clicked element 538.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:close:ticket-beta",
        detail: expect.objectContaining({
          action: "close",
          source: "target_disappearance",
          text: "Closed target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer close confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      pageContent: "Open tickets Ticket Alpha Close Ticket Alpha",
      elements: [actionButton(537, "Close Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer close confirmation from a generic close button", () => {
    const genericCloseButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Close",
      attributes: {
        id: "close",
        "aria-label": "Close",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Open tickets Ticket Alpha Close",
      pageContent: "Open tickets Ticket Alpha Close",
      elements: [genericCloseButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Open tickets",
      pageContent: "Open tickets",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer close workflow confirmation from a generic close dialog control", () => {
    const closeDialogButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Close dialog",
      attributes: {
        id: "close-dialog",
        "aria-label": "Close dialog",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Settings dialog Close dialog",
      pageContent: "Settings dialog Close dialog",
      elements: [closeDialogButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings",
      pageContent: "Settings",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 537 },
      result: "Clicked element 537.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
