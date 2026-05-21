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
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "data-state": state,
    },
  };
}

describe("completion kernel workflow control-state restart/refresh confirmation", () => {
  for (const scenario of [
    {
      action: "restart",
      completion: "restarted",
      label: "Restart Service Alpha",
      request: "Restart Service Alpha.",
      summary: "Restarted Service Alpha.",
      target: "Service Alpha",
      id: "service-alpha-restart",
      beforeState: "running",
      afterState: "restarted",
    },
    {
      action: "refresh",
      completion: "refreshed",
      label: "Refresh Report Alpha",
      request: "Refresh Report Alpha.",
      summary: "Refreshed Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-refresh",
      beforeState: "stale",
      afterState: "refreshed",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic operation data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            764,
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
            765,
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
        args: { id: 764 },
        result: "Clicked element 764.",
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

  test("does not infer restart confirmation when semantic data-state was already restarted", () => {
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Restart Service Alpha",
      pageContent: "Service Alpha Restart Service Alpha",
      elements: [
        dataStateActionButton(
          766,
          "Restart Service Alpha",
          "restarted",
          "service-alpha-restart",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Service Alpha Restart Service Alpha",
      pageContent: "Service Alpha Restart Service Alpha",
      elements: [
        dataStateActionButton(
          767,
          "Restart Service Alpha",
          "restarted",
          "service-alpha-restart",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 766 },
      result: "Clicked element 766.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer refresh confirmation when semantic data-state flips stale", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Refresh Report Alpha",
      pageContent: "Report Alpha Refresh Report Alpha",
      elements: [
        dataStateActionButton(
          768,
          "Refresh Report Alpha",
          "refreshed",
          "report-alpha-refresh",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Refresh Report Alpha",
      pageContent: "Report Alpha Refresh Report Alpha",
      elements: [
        dataStateActionButton(
          769,
          "Refresh Report Alpha",
          "stale",
          "report-alpha-refresh",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 768 },
      result: "Clicked element 768.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
