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

describe("completion kernel workflow control-state semantic lifecycle action confirmation", () => {
  for (const scenario of [
    {
      action: "post",
      completion: "published",
      label: "Publish Article Alpha",
      request: "Publish Article Alpha.",
      summary: "Published Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-publish",
      beforeState: "draft",
      afterState: "published",
    },
    {
      action: "submit",
      completion: "submitted",
      label: "Submit Request Alpha",
      request: "Submit Request Alpha.",
      summary: "Submitted Request Alpha.",
      target: "Request Alpha",
      id: "request-alpha-submit",
      beforeState: "draft",
      afterState: "submitted",
    },
    {
      action: "complete",
      completion: "completed",
      label: "Mark Task Alpha complete",
      request: "Mark Task Alpha complete.",
      summary: "Marked Task Alpha complete.",
      target: "Task Alpha",
      id: "task-alpha-complete",
      beforeState: "in-progress",
      afterState: "completed",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic lifecycle data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            782,
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
            783,
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
        args: { id: 782 },
        result: "Clicked element 782.",
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

  test("does not infer publish confirmation when semantic data-state was already published", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Alpha Publish Article Alpha",
      pageContent: "Article Alpha Publish Article Alpha",
      elements: [
        dataStateActionButton(
          784,
          "Publish Article Alpha",
          "published",
          "article-alpha-publish",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Alpha Publish Article Alpha",
      pageContent: "Article Alpha Publish Article Alpha",
      elements: [
        dataStateActionButton(
          785,
          "Publish Article Alpha",
          "published",
          "article-alpha-publish",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 784 },
      result: "Clicked element 784.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer submit confirmation when semantic data-state flips draft", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Submit Request Alpha",
      pageContent: "Request Alpha Submit Request Alpha",
      elements: [
        dataStateActionButton(
          786,
          "Submit Request Alpha",
          "submitted",
          "request-alpha-submit",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Submit Request Alpha",
      pageContent: "Request Alpha Submit Request Alpha",
      elements: [
        dataStateActionButton(
          787,
          "Submit Request Alpha",
          "draft",
          "request-alpha-submit",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 786 },
      result: "Clicked element 786.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer complete confirmation when semantic data-state flips incomplete", () => {
    const pre = workflowSnapshot({
      visibleContent: "Task Alpha Mark Task Alpha complete",
      pageContent: "Task Alpha Mark Task Alpha complete",
      elements: [
        dataStateActionButton(
          788,
          "Mark Task Alpha complete",
          "completed",
          "task-alpha-complete",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Task Alpha Mark Task Alpha complete",
      pageContent: "Task Alpha Mark Task Alpha complete",
      elements: [
        dataStateActionButton(
          789,
          "Mark Task Alpha complete",
          "in-progress",
          "task-alpha-complete",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 788 },
      result: "Clicked element 788.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
