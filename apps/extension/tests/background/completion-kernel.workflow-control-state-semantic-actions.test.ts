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

describe("completion kernel workflow control-state semantic cancellation and archive action confirmation", () => {
  test("accepts cancel confirmation from semantic cancel data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          752,
          "Cancel Order Alpha",
          "active",
          "order-alpha-cancel",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          753,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 752 },
      result: "Clicked element 752.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled Order Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:control-state:order-alpha-cancel",
        detail: expect.objectContaining({
          action: "cancel",
          source: "control_state_change",
          targetText: "Order Alpha",
          text: "Control state changed to canceled: Cancel Order Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer cancel confirmation when semantic data-state was already canceled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          754,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          755,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 754 },
      result: "Clicked element 754.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer cancel confirmation when semantic data-state flips active", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          756,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          757,
          "Cancel Order Alpha",
          "active",
          "order-alpha-cancel",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 756 },
      result: "Clicked element 756.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "archive",
      completion: "archived",
      label: "Archive Report Alpha",
      request: "Archive Report Alpha.",
      summary: "Archived Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-archive",
      beforeState: "active",
      afterState: "archived",
    },
    {
      action: "restore",
      completion: "restored",
      label: "Restore Version Alpha",
      request: "Restore Version Alpha.",
      summary: "Restored Version Alpha.",
      target: "Version Alpha",
      id: "version-alpha-archive",
      beforeState: "archived",
      afterState: "active",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic archive data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            758,
            scenario.label,
            scenario.beforeState,
            scenario.id,
          ),
        ],
      });
      const current = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            759,
            scenario.label,
            scenario.afterState,
            scenario.id,
          ),
        ],
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: current,
      });
      const evidence = deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 758 },
        result: "Clicked element 758.",
        preActionSnapshot: pre,
        currentSnapshot: current,
        turn: 11,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: current,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.target,
      });
      expect(evidence).toEqual([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: `workflow:confirmation:${scenario.action}:control-state:${scenario.id}`,
          detail: expect.objectContaining({
            action: scenario.action,
            source: "control_state_change",
            targetText: scenario.target,
            text: `Control state changed to ${scenario.completion}: ${scenario.label}`,
          }),
        }),
      ]);
      expect(decision.status).toBe("accepted");
    });
  }

  test("does not infer archive confirmation when semantic data-state was already archived", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Archive Report Alpha",
      pageContent: "Report Alpha Archive Report Alpha",
      elements: [
        dataStateActionButton(
          760,
          "Archive Report Alpha",
          "archived",
          "report-alpha-archive",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Archive Report Alpha",
      pageContent: "Report Alpha Archive Report Alpha",
      elements: [
        dataStateActionButton(
          761,
          "Archive Report Alpha",
          "archived",
          "report-alpha-archive",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 760 },
      result: "Clicked element 760.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer restore confirmation when semantic data-state flips archived", () => {
    const pre = workflowSnapshot({
      visibleContent: "Version Alpha Restore Version Alpha",
      pageContent: "Version Alpha Restore Version Alpha",
      elements: [
        dataStateActionButton(
          762,
          "Restore Version Alpha",
          "active",
          "version-alpha-archive",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Version Alpha Restore Version Alpha",
      pageContent: "Version Alpha Restore Version Alpha",
      elements: [
        dataStateActionButton(
          763,
          "Restore Version Alpha",
          "archived",
          "version-alpha-archive",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 762 },
      result: "Clicked element 762.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
