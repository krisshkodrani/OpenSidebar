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

describe("completion kernel share target-disappearance collaboration workflow confirmation", () => {
  test("accepts share confirmation from named report disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      pageContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      elements: [
        actionButton(563, "Share Report Alpha"),
        actionButton(564, "Share Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Beta Share Report Beta",
      pageContent: "Pending shares Report Beta Share Report Beta",
      elements: [actionButton(564, "Share Report Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Share Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Shared Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "share",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:share:report-alpha",
        detail: expect.objectContaining({
          action: "share",
          source: "target_disappearance",
          text: "Shared target no longer visible: Report Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects share target-disappearance evidence for the wrong requested report", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      pageContent:
        "Pending shares Report Alpha Share Report Alpha Report Beta Share Report Beta",
      elements: [
        actionButton(563, "Share Report Alpha"),
        actionButton(564, "Share Report Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Share Report Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 564 },
      result: "Clicked element 564.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Shared Report Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "share",
      targetLabel: "Report Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:share:report-beta",
        detail: expect.objectContaining({
          action: "share",
          source: "target_disappearance",
          text: "Shared target no longer visible: Report Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer share confirmation while the named report remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Pending shares Report Alpha Share Report Alpha",
      pageContent: "Pending shares Report Alpha Share Report Alpha",
      elements: [actionButton(563, "Share Report Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer share confirmation from a generic share report control", () => {
    const genericShareReportButton: TaggedElement = {
      tag: 563,
      tagName: "button",
      role: "button",
      text: "Share report",
      attributes: {
        id: "share-report",
        "aria-label": "Share report",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Available reports Report Alpha Share report",
      pageContent: "Available reports Report Alpha Share report",
      elements: [genericShareReportButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Available reports",
      pageContent: "Available reports",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 563 },
      result: "Clicked element 563.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
