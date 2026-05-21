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

describe("completion kernel workflow operational control-state confirmation", () => {
  for (const scenario of [
    {
      action: "pause",
      completion: "paused",
      label: "Pause Job Alpha",
      request: "Pause Job Alpha.",
      summary: "Paused Job Alpha.",
      target: "Job Alpha",
      id: "job-alpha-pause",
      beforeState: "running",
      afterState: "paused",
    },
    {
      action: "resume",
      completion: "resumed",
      label: "Resume Job Alpha",
      request: "Resume Job Alpha.",
      summary: "Resumed Job Alpha.",
      target: "Job Alpha",
      id: "job-alpha-resume",
      beforeState: "paused",
      afterState: "running",
    },
    {
      action: "start",
      completion: "started",
      label: "Start Service Alpha",
      request: "Start Service Alpha.",
      summary: "Started Service Alpha.",
      target: "Service Alpha",
      id: "service-alpha-start",
      beforeState: "stopped",
      afterState: "running",
    },
    {
      action: "stop",
      completion: "stopped",
      label: "Stop Service Alpha",
      request: "Stop Service Alpha.",
      summary: "Stopped Service Alpha.",
      target: "Service Alpha",
      id: "service-alpha-stop",
      beforeState: "running",
      afterState: "stopped",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from operational data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            682,
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
            683,
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
        args: { id: 682 },
        result: "Clicked element 682.",
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

  test("does not infer pause confirmation when operational data-state was already paused", () => {
    const pre = workflowSnapshot({
      visibleContent: "Job Alpha Pause Job Alpha",
      pageContent: "Job Alpha Pause Job Alpha",
      elements: [
        dataStateActionButton(
          684,
          "Pause Job Alpha",
          "paused",
          "job-alpha-pause",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Job Alpha Pause Job Alpha",
      pageContent: "Job Alpha Pause Job Alpha",
      elements: [
        dataStateActionButton(
          685,
          "Pause Job Alpha",
          "paused",
          "job-alpha-pause",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 684 },
      result: "Clicked element 684.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer resume confirmation when operational data-state flips to paused", () => {
    const pre = workflowSnapshot({
      visibleContent: "Job Alpha Resume Job Alpha",
      pageContent: "Job Alpha Resume Job Alpha",
      elements: [
        dataStateActionButton(
          686,
          "Resume Job Alpha",
          "running",
          "job-alpha-resume",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Job Alpha Resume Job Alpha",
      pageContent: "Job Alpha Resume Job Alpha",
      elements: [
        dataStateActionButton(
          687,
          "Resume Job Alpha",
          "paused",
          "job-alpha-resume",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 686 },
      result: "Clicked element 686.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer start confirmation when operational data-state was already running", () => {
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Start Service Alpha",
      pageContent: "Service Alpha Start Service Alpha",
      elements: [
        dataStateActionButton(
          688,
          "Start Service Alpha",
          "running",
          "service-alpha-start",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Service Alpha Start Service Alpha",
      pageContent: "Service Alpha Start Service Alpha",
      elements: [
        dataStateActionButton(
          689,
          "Start Service Alpha",
          "running",
          "service-alpha-start",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 688 },
      result: "Clicked element 688.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer stop confirmation when operational data-state flips to running", () => {
    const pre = workflowSnapshot({
      visibleContent: "Service Alpha Stop Service Alpha",
      pageContent: "Service Alpha Stop Service Alpha",
      elements: [
        dataStateActionButton(
          690,
          "Stop Service Alpha",
          "stopped",
          "service-alpha-stop",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Service Alpha Stop Service Alpha",
      pageContent: "Service Alpha Stop Service Alpha",
      elements: [
        dataStateActionButton(
          691,
          "Stop Service Alpha",
          "running",
          "service-alpha-stop",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 690 },
      result: "Clicked element 690.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
