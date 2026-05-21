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
  attribute:
    | "data-state"
    | "data-selected"
    | "data-checked"
    | "data-pressed" = "data-state",
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      [attribute]: state,
    },
  };
}

describe("completion kernel workflow control-state install data-state confirmation", () => {
  test("accepts install confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          654,
          "Install Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          655,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Install Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Installed Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "install",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:install:control-state:package-alpha-install",
        detail: expect.objectContaining({
          action: "install",
          source: "control_state_change",
          targetText: "Package Alpha",
          text: "Control state changed to installed: Install Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts uninstall confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          656,
          "Uninstall Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          657,
          "Uninstall Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 656 },
      result: "Clicked element 656.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
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
        logicalKey:
          "workflow:confirmation:uninstall:control-state:package-alpha-install",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "control_state_change",
          targetText: "Package Alpha",
          text: "Control state changed to uninstalled: Uninstall Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer install confirmation when data-state was already installed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          654,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          655,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer uninstall confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          656,
          "Uninstall Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          657,
          "Uninstall Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 656 },
      result: "Clicked element 656.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
