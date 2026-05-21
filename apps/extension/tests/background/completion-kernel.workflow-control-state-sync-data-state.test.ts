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

describe("completion kernel workflow control-state sync data-state confirmation", () => {
  test("accepts sync confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "unsynced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Sync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Synced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:sync:control-state:integration-alpha-sync",
        detail: expect.objectContaining({
          action: "sync",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to synced: Sync Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resync confirmation from stale data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Resync Integration Alpha",
      pageContent: "Integration Alpha Resync Integration Alpha",
      elements: [
        dataStateActionButton(
          660,
          "Resync Integration Alpha",
          "stale",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Resync Integration Alpha",
      pageContent: "Integration Alpha Resync Integration Alpha",
      elements: [
        dataStateActionButton(
          661,
          "Resync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Resync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 660 },
      result: "Clicked element 660.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resynced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:sync:control-state:integration-alpha-sync",
        detail: expect.objectContaining({
          action: "sync",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to synced: Resync Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer sync confirmation when data-state was already synced", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer sync confirmation when data-state flips stale", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "stale",
          "integration-alpha-sync",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
