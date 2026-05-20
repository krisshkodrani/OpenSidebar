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

describe("completion kernel target-disappearance favorite preference workflow confirmation", () => {
  test("accepts favorite confirmation from named unfavorited target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      pageContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      elements: [
        actionButton(541, "Favorite Report Alpha"),
        actionButton(542, "Favorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Beta Favorite Report Beta",
      pageContent: "Unfavorited reports Report Beta Favorite Report Beta",
      elements: [actionButton(542, "Favorite Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Favorite Report Alpha.",
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
      summary: "Favorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "favorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:favorite:report-alpha",
        detail: expect.objectContaining({
          action: "favorite",
          source: "target_disappearance",
          text: "Favorited target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects favorite target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      pageContent:
        "Unfavorited reports Report Alpha Favorite Report Alpha Report Beta Favorite Report Beta",
      elements: [
        actionButton(541, "Favorite Report Alpha"),
        actionButton(542, "Favorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Favorite Report Alpha.",
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
      summary: "Favorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "favorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:favorite:report-beta",
        detail: expect.objectContaining({
          action: "favorite",
          source: "target_disappearance",
          text: "Favorited target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer favorite confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      pageContent: "Unfavorited reports Report Alpha Favorite Report Alpha",
      elements: [actionButton(541, "Favorite Report Alpha")],
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

  test("does not infer favorite confirmation from a generic favorite button", () => {
    const genericFavoriteButton: TaggedElement = {
      tag: 541,
      tagName: "button",
      role: "button",
      text: "Favorite",
      attributes: {
        id: "favorite",
        "aria-label": "Favorite",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Unfavorited reports Report Alpha Favorite",
      pageContent: "Unfavorited reports Report Alpha Favorite",
      elements: [genericFavoriteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Unfavorited reports",
      pageContent: "Unfavorited reports",
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

  test("accepts unfavorite confirmation from named favorited target disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      elements: [
        actionButton(537, "Unfavorite Report Alpha"),
        actionButton(538, "Unfavorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Beta Unfavorite Report Beta",
      elements: [actionButton(538, "Unfavorite Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfavorite Report Alpha.",
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
      summary: "Unfavorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfavorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfavorite:report-alpha",
        detail: expect.objectContaining({
          action: "unfavorite",
          source: "target_disappearance",
          text: "Unfavorited target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects unfavorite target-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha Report Beta Unfavorite Report Beta",
      elements: [
        actionButton(537, "Unfavorite Report Alpha"),
        actionButton(538, "Unfavorite Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unfavorite Report Alpha.",
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
      summary: "Unfavorited Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unfavorite",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unfavorite:report-beta",
        detail: expect.objectContaining({
          action: "unfavorite",
          source: "target_disappearance",
          text: "Unfavorited target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer unfavorite confirmation while the named target remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      pageContent:
        "Favorited reports Report Alpha Unfavorite Report Alpha",
      elements: [actionButton(537, "Unfavorite Report Alpha")],
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

  test("does not infer unfavorite confirmation from a generic unfavorite button", () => {
    const genericUnfavoriteButton: TaggedElement = {
      tag: 537,
      tagName: "button",
      role: "button",
      text: "Unfavorite",
      attributes: {
        id: "unfavorite",
        "aria-label": "Unfavorite",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Favorited reports Report Alpha Unfavorite",
      pageContent: "Favorited reports Report Alpha Unfavorite",
      elements: [genericUnfavoriteButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Favorited reports",
      pageContent: "Favorited reports",
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
