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

describe("completion kernel workflow control-state semantic escalation transition confirmation", () => {
  for (const scenario of [
    {
      action: "escalate",
      completion: "escalated",
      label: "Escalate Incident Alpha",
      request: "Escalate Incident Alpha.",
      summary: "Escalated Incident Alpha.",
      target: "Incident Alpha",
      id: "incident-alpha-escalation",
      beforeState: "normal",
      afterState: "escalated",
    },
    {
      action: "deescalate",
      completion: "de-escalated",
      label: "De-escalate Incident Alpha",
      request: "De-escalate Incident Alpha.",
      summary: "De-escalated Incident Alpha.",
      target: "Incident Alpha",
      id: "incident-alpha-escalation",
      beforeState: "escalated",
      afterState: "de-escalated",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic escalation data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            746,
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
            747,
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
        args: { id: 746 },
        result: "Clicked element 746.",
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

  test("does not infer escalate confirmation when semantic data-state was already escalated", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident Alpha Escalate Incident Alpha",
      pageContent: "Incident Alpha Escalate Incident Alpha",
      elements: [
        dataStateActionButton(
          748,
          "Escalate Incident Alpha",
          "escalated",
          "incident-alpha-escalation",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident Alpha Escalate Incident Alpha",
      pageContent: "Incident Alpha Escalate Incident Alpha",
      elements: [
        dataStateActionButton(
          749,
          "Escalate Incident Alpha",
          "escalated",
          "incident-alpha-escalation",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 748 },
      result: "Clicked element 748.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer deescalate confirmation when semantic data-state flips escalated", () => {
    const pre = workflowSnapshot({
      visibleContent: "Incident Alpha De-escalate Incident Alpha",
      pageContent: "Incident Alpha De-escalate Incident Alpha",
      elements: [
        dataStateActionButton(
          750,
          "De-escalate Incident Alpha",
          "normal",
          "incident-alpha-escalation",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Incident Alpha De-escalate Incident Alpha",
      pageContent: "Incident Alpha De-escalate Incident Alpha",
      elements: [
        dataStateActionButton(
          751,
          "De-escalate Incident Alpha",
          "escalated",
          "incident-alpha-escalation",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 750 },
      result: "Clicked element 750.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
