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

describe("completion kernel workflow control-state semantic attachment confirmation", () => {
  for (const scenario of [
    {
      action: "attach",
      completion: "attached",
      label: "Attach File Alpha",
      request: "Attach File Alpha.",
      summary: "Attached File Alpha.",
      target: "File Alpha",
      id: "file-alpha-attach",
      beforeState: "detached",
      afterState: "attached",
    },
    {
      action: "detach",
      completion: "detached",
      label: "Detach File Alpha",
      request: "Detach File Alpha.",
      summary: "Detached File Alpha.",
      target: "File Alpha",
      id: "file-alpha-detach",
      beforeState: "attached",
      afterState: "detached",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic attachment data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            822,
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
            823,
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
        args: { id: 822 },
        result: "Clicked element 822.",
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

  test("does not infer attach confirmation when semantic data-state was already attached", () => {
    const pre = workflowSnapshot({
      visibleContent: "File Alpha Attach File Alpha",
      pageContent: "File Alpha Attach File Alpha",
      elements: [
        dataStateActionButton(
          824,
          "Attach File Alpha",
          "attached",
          "file-alpha-attach",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "File Alpha Attach File Alpha",
      pageContent: "File Alpha Attach File Alpha",
      elements: [
        dataStateActionButton(
          825,
          "Attach File Alpha",
          "attached",
          "file-alpha-attach",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 824 },
      result: "Clicked element 824.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer detach confirmation when semantic data-state flips attached", () => {
    const pre = workflowSnapshot({
      visibleContent: "File Alpha Detach File Alpha",
      pageContent: "File Alpha Detach File Alpha",
      elements: [
        dataStateActionButton(
          826,
          "Detach File Alpha",
          "detached",
          "file-alpha-detach",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "File Alpha Detach File Alpha",
      pageContent: "File Alpha Detach File Alpha",
      elements: [
        dataStateActionButton(
          827,
          "Detach File Alpha",
          "attached",
          "file-alpha-detach",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 826 },
      result: "Clicked element 826.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
