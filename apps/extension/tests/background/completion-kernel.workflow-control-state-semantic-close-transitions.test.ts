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

describe("completion kernel workflow control-state semantic close transition confirmation", () => {
  for (const scenario of [
    {
      action: "close",
      completion: "closed",
      label: "Close Ticket Alpha",
      request: "Close Ticket Alpha.",
      summary: "Closed Ticket Alpha.",
      target: "Ticket Alpha",
      id: "ticket-alpha-close",
      beforeState: "open",
      afterState: "closed",
    },
    {
      action: "reopen",
      completion: "reopened",
      label: "Reopen Ticket Alpha",
      request: "Reopen Ticket Alpha.",
      summary: "Reopened Ticket Alpha.",
      target: "Ticket Alpha",
      id: "ticket-alpha-close",
      beforeState: "closed",
      afterState: "open",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic close data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            740,
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
            741,
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
        args: { id: 740 },
        result: "Clicked element 740.",
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

  test("does not infer close confirmation when semantic data-state was already closed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Close Ticket Alpha",
      pageContent: "Ticket Alpha Close Ticket Alpha",
      elements: [
        dataStateActionButton(
          742,
          "Close Ticket Alpha",
          "closed",
          "ticket-alpha-close",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Close Ticket Alpha",
      pageContent: "Ticket Alpha Close Ticket Alpha",
      elements: [
        dataStateActionButton(
          743,
          "Close Ticket Alpha",
          "closed",
          "ticket-alpha-close",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 742 },
      result: "Clicked element 742.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reopen confirmation when semantic data-state flips closed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Ticket Alpha Reopen Ticket Alpha",
      elements: [
        dataStateActionButton(
          744,
          "Reopen Ticket Alpha",
          "open",
          "ticket-alpha-close",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Reopen Ticket Alpha",
      pageContent: "Ticket Alpha Reopen Ticket Alpha",
      elements: [
        dataStateActionButton(
          745,
          "Reopen Ticket Alpha",
          "closed",
          "ticket-alpha-close",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 744 },
      result: "Clicked element 744.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
