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

describe("completion kernel workflow control-state semantic object-change confirmation", () => {
  for (const scenario of [
    {
      action: "transfer",
      completion: "transferred",
      label: "Transfer Case Alpha",
      request: "Transfer Case Alpha.",
      summary: "Transferred Case Alpha.",
      target: "Case Alpha",
      id: "case-alpha-transfer",
      beforeState: "pending",
      afterState: "transferred",
    },
    {
      action: "move",
      completion: "moved",
      label: "Move Card Alpha",
      request: "Move Card Alpha.",
      summary: "Moved Card Alpha.",
      target: "Card Alpha",
      id: "card-alpha-move",
      beforeState: "unmoved",
      afterState: "moved",
    },
    {
      action: "rename",
      completion: "renamed",
      label: "Rename Page Alpha",
      request: "Rename Page Alpha.",
      summary: "Renamed Page Alpha.",
      target: "Page Alpha",
      id: "page-alpha-rename",
      beforeState: "old-name",
      afterState: "renamed",
    },
    {
      action: "merge",
      completion: "merged",
      label: "Merge Ticket Alpha",
      request: "Merge Ticket Alpha.",
      summary: "Merged Ticket Alpha.",
      target: "Ticket Alpha",
      id: "ticket-alpha-merge",
      beforeState: "separate",
      afterState: "merged",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic object-change data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            816,
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
            817,
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
        args: { id: 816 },
        result: "Clicked element 816.",
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

  test("does not infer transfer confirmation when semantic data-state was already transferred", () => {
    const pre = workflowSnapshot({
      visibleContent: "Case Alpha Transfer Case Alpha",
      pageContent: "Case Alpha Transfer Case Alpha",
      elements: [
        dataStateActionButton(
          818,
          "Transfer Case Alpha",
          "transferred",
          "case-alpha-transfer",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Case Alpha Transfer Case Alpha",
      pageContent: "Case Alpha Transfer Case Alpha",
      elements: [
        dataStateActionButton(
          819,
          "Transfer Case Alpha",
          "transferred",
          "case-alpha-transfer",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 818 },
      result: "Clicked element 818.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer merge confirmation when semantic data-state flips separate", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Merge Ticket Alpha",
      pageContent: "Ticket Alpha Merge Ticket Alpha",
      elements: [
        dataStateActionButton(
          820,
          "Merge Ticket Alpha",
          "merged",
          "ticket-alpha-merge",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Merge Ticket Alpha",
      pageContent: "Ticket Alpha Merge Ticket Alpha",
      elements: [
        dataStateActionButton(
          821,
          "Merge Ticket Alpha",
          "separate",
          "ticket-alpha-merge",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 820 },
      result: "Clicked element 820.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
