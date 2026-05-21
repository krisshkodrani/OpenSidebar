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


describe("completion kernel workflow control-state semantic collaboration action confirmation", () => {
  for (const scenario of [
    {
      action: "share",
      completion: "shared",
      label: "Share Report Alpha",
      request: "Share Report Alpha.",
      summary: "Shared Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-share",
      beforeState: "private",
      afterState: "shared",
    },
    {
      action: "invite",
      completion: "invited",
      label: "Invite Member Alpha",
      request: "Invite Member Alpha.",
      summary: "Invited Member Alpha.",
      target: "Member Alpha",
      id: "member-alpha-invite",
      beforeState: "uninvited",
      afterState: "invited",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic collaboration data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            796,
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
            797,
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
        args: { id: 796 },
        result: "Clicked element 796.",
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

  test("does not infer share confirmation when semantic data-state was already shared", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Share Report Alpha",
      pageContent: "Report Alpha Share Report Alpha",
      elements: [
        dataStateActionButton(
          798,
          "Share Report Alpha",
          "shared",
          "report-alpha-share",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Share Report Alpha",
      pageContent: "Report Alpha Share Report Alpha",
      elements: [
        dataStateActionButton(
          799,
          "Share Report Alpha",
          "shared",
          "report-alpha-share",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 798 },
      result: "Clicked element 798.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer invite confirmation when semantic data-state flips uninvited", () => {
    const pre = workflowSnapshot({
      visibleContent: "Member Alpha Invite Member Alpha",
      pageContent: "Member Alpha Invite Member Alpha",
      elements: [
        dataStateActionButton(
          800,
          "Invite Member Alpha",
          "invited",
          "member-alpha-invite",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Member Alpha Invite Member Alpha",
      pageContent: "Member Alpha Invite Member Alpha",
      elements: [
        dataStateActionButton(
          801,
          "Invite Member Alpha",
          "uninvited",
          "member-alpha-invite",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 800 },
      result: "Clicked element 800.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
