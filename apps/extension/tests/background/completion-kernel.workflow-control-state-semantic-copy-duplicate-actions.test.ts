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

describe("completion kernel workflow control-state semantic copy and duplicate action confirmation", () => {
  for (const scenario of [
    {
      action: "copy",
      completion: "copied",
      label: "Copy Link Alpha",
      request: "Copy Link Alpha.",
      summary: "Copied Link Alpha.",
      target: "Link Alpha",
      id: "link-alpha-copy",
      beforeState: "ready",
      afterState: "copied",
    },
    {
      action: "duplicate",
      completion: "duplicated",
      label: "Duplicate Template Alpha",
      request: "Duplicate Template Alpha.",
      summary: "Duplicated Template Alpha.",
      target: "Template Alpha",
      id: "template-alpha-duplicate",
      beforeState: "ready",
      afterState: "duplicated",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic copy data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            810,
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
            811,
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
        args: { id: 810 },
        result: "Clicked element 810.",
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

  test("does not infer copy confirmation when semantic data-state was already copied", () => {
    const pre = workflowSnapshot({
      visibleContent: "Link Alpha Copy Link Alpha",
      pageContent: "Link Alpha Copy Link Alpha",
      elements: [
        dataStateActionButton(
          812,
          "Copy Link Alpha",
          "copied",
          "link-alpha-copy",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Link Alpha Copy Link Alpha",
      pageContent: "Link Alpha Copy Link Alpha",
      elements: [
        dataStateActionButton(
          813,
          "Copy Link Alpha",
          "copied",
          "link-alpha-copy",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 812 },
      result: "Clicked element 812.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer duplicate confirmation when semantic data-state flips ready", () => {
    const pre = workflowSnapshot({
      visibleContent: "Template Alpha Duplicate Template Alpha",
      pageContent: "Template Alpha Duplicate Template Alpha",
      elements: [
        dataStateActionButton(
          814,
          "Duplicate Template Alpha",
          "duplicated",
          "template-alpha-duplicate",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Template Alpha Duplicate Template Alpha",
      pageContent: "Template Alpha Duplicate Template Alpha",
      elements: [
        dataStateActionButton(
          815,
          "Duplicate Template Alpha",
          "ready",
          "template-alpha-duplicate",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 814 },
      result: "Clicked element 814.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
