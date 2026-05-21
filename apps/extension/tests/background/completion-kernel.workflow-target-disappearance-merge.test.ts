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

describe("completion kernel merge target-disappearance object-change workflow confirmation", () => {
  test("accepts merge confirmation from named ticket disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      pageContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      elements: [
        actionButton(529, "Merge Ticket Alpha"),
        actionButton(530, "Merge Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Beta Merge Ticket Beta",
      pageContent: "Pending merges Ticket Beta Merge Ticket Beta",
      elements: [actionButton(530, "Merge Ticket Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Merge Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Merged Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "merge",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:merge:ticket-alpha",
        detail: expect.objectContaining({
          action: "merge",
          source: "target_disappearance",
          text: "Merged target no longer visible: Ticket Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects merge target-disappearance evidence for the wrong requested ticket", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      pageContent:
        "Pending merges Ticket Alpha Merge Ticket Alpha Ticket Beta Merge Ticket Beta",
      elements: [
        actionButton(529, "Merge Ticket Alpha"),
        actionButton(530, "Merge Ticket Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Merge Ticket Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 530 },
      result: "Clicked element 530.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Merged Ticket Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "merge",
      targetLabel: "Ticket Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:merge:ticket-beta",
        detail: expect.objectContaining({
          action: "merge",
          source: "target_disappearance",
          text: "Merged target no longer visible: Ticket Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer merge confirmation while the named ticket remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      pageContent: "Pending merges Ticket Alpha Merge Ticket Alpha",
      elements: [actionButton(529, "Merge Ticket Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer merge confirmation from a generic merge button", () => {
    const genericMergeButton: TaggedElement = {
      tag: 529,
      tagName: "button",
      role: "button",
      text: "Merge",
      attributes: {
        id: "merge",
        "aria-label": "Merge",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Pending merges Ticket Alpha Merge",
      pageContent: "Pending merges Ticket Alpha Merge",
      elements: [genericMergeButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending merges",
      pageContent: "Pending merges",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 529 },
      result: "Clicked element 529.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
