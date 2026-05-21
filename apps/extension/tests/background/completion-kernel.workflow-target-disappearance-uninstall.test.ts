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

describe("completion kernel uninstall target-disappearance package workflow confirmation", () => {
  test("accepts uninstall confirmation from named package disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      pageContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      elements: [
        actionButton(505, "Uninstall Package Alpha"),
        actionButton(506, "Uninstall Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Beta Uninstall Package Beta",
      pageContent: "Packages Package Beta Uninstall Package Beta",
      elements: [actionButton(506, "Uninstall Package Beta")],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uninstalled Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "uninstall",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:uninstall:package-alpha",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "target_disappearance",
          text: "Uninstalled target no longer visible: Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects uninstall target-disappearance evidence for the wrong requested package", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      pageContent:
        "Packages Package Alpha Uninstall Package Alpha Package Beta Uninstall Package Beta",
      elements: [
        actionButton(505, "Uninstall Package Alpha"),
        actionButton(506, "Uninstall Package Beta"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 506 },
      result: "Clicked element 506.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uninstalled Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "uninstall",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:uninstall:package-beta",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "target_disappearance",
          text: "Uninstalled target no longer visible: Package Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer uninstall confirmation while the named package remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall Package Alpha",
      pageContent: "Packages Package Alpha Uninstall Package Alpha",
      elements: [actionButton(505, "Uninstall Package Alpha")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer uninstall confirmation from a generic uninstall button", () => {
    const genericUninstallButton: TaggedElement = {
      tag: 505,
      tagName: "button",
      role: "button",
      text: "Uninstall",
      attributes: {
        id: "uninstall",
        "aria-label": "Uninstall",
      },
      rect: { x: 500, y: 80, width: 120, height: 32 },
      isVisible: true,
      isDisabled: false,
    };
    const pre = workflowSnapshot({
      visibleContent: "Packages Package Alpha Uninstall",
      pageContent: "Packages Package Alpha Uninstall",
      elements: [genericUninstallButton],
    });
    const current = workflowSnapshot({
      visibleContent: "Packages",
      pageContent: "Packages",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 505 },
      result: "Clicked element 505.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
