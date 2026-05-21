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

describe("completion kernel target-disappearance link workflow confirmation", () => {
  test("accepts link confirmation from named relationship disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      pageContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      elements: [
        actionButton(511, "Link Account Alpha"),
        actionButton(512, "Link Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Beta Link Account Beta",
      pageContent: "Unlinked accounts Account Beta Link Account Beta",
      elements: [actionButton(512, "Link Account Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Linked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "link",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:link:account-alpha",
        detail: expect.objectContaining({
          action: "link",
          source: "target_disappearance",
          text: "Linked target no longer visible: Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects link target-disappearance evidence for the wrong requested relationship", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      pageContent:
        "Unlinked accounts Account Alpha Link Account Alpha Account Beta Link Account Beta",
      elements: [
        actionButton(511, "Link Account Alpha"),
        actionButton(512, "Link Account Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 512 },
      result: "Clicked element 512.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Linked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "link",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:link:account-beta",
        detail: expect.objectContaining({
          action: "link",
          source: "target_disappearance",
          text: "Linked target no longer visible: Account Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer link confirmation while the named relationship remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link Account Alpha",
      pageContent: "Unlinked accounts Account Alpha Link Account Alpha",
      elements: [actionButton(511, "Link Account Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer link confirmation from a generic link button", () => {
    const genericLinkButton: TaggedElement = {
      tag: 511,
      tagName: "button",
      role: "button",
      text: "Link",
      attributes: {
        id: "link",
        "aria-label": "Link",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unlinked accounts Account Alpha Link",
      pageContent: "Unlinked accounts Account Alpha Link",
      elements: [genericLinkButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unlinked accounts",
      pageContent: "Unlinked accounts",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 511 },
      result: "Clicked element 511.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
