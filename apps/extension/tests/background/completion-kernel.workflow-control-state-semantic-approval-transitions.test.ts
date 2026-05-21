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

describe("completion kernel workflow control-state semantic approval transition confirmation", () => {
  for (const scenario of [
    {
      action: "approve",
      completion: "approved",
      label: "Approve Request Alpha",
      request: "Approve Request Alpha.",
      summary: "Approved Request Alpha.",
      target: "Request Alpha",
      id: "request-alpha-approval",
      beforeState: "pending",
      afterState: "approved",
    },
    {
      action: "reject",
      completion: "rejected",
      label: "Reject Request Alpha",
      request: "Reject Request Alpha.",
      summary: "Rejected Request Alpha.",
      target: "Request Alpha",
      id: "request-alpha-approval",
      beforeState: "pending",
      afterState: "rejected",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic approval data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            734,
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
            735,
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
        args: { id: 734 },
        result: "Clicked element 734.",
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

  test("does not infer approve confirmation when semantic data-state was already approved", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Approve Request Alpha",
      pageContent: "Request Alpha Approve Request Alpha",
      elements: [
        dataStateActionButton(
          736,
          "Approve Request Alpha",
          "approved",
          "request-alpha-approval",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Approve Request Alpha",
      pageContent: "Request Alpha Approve Request Alpha",
      elements: [
        dataStateActionButton(
          737,
          "Approve Request Alpha",
          "approved",
          "request-alpha-approval",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 736 },
      result: "Clicked element 736.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reject confirmation when semantic data-state flips approved", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Reject Request Alpha",
      pageContent: "Request Alpha Reject Request Alpha",
      elements: [
        dataStateActionButton(
          738,
          "Reject Request Alpha",
          "rejected",
          "request-alpha-approval",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Reject Request Alpha",
      pageContent: "Request Alpha Reject Request Alpha",
      elements: [
        dataStateActionButton(
          739,
          "Reject Request Alpha",
          "approved",
          "request-alpha-approval",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 738 },
      result: "Clicked element 738.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
