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

describe("completion kernel workflow control-state semantic administrative transition confirmation", () => {
  for (const scenario of [
    {
      action: "grant",
      completion: "granted",
      label: "Grant Role Alpha",
      request: "Grant Role Alpha.",
      summary: "Granted Role Alpha.",
      target: "Role Alpha",
      id: "role-alpha-grant",
      beforeState: "revoked",
      afterState: "granted",
    },
    {
      action: "revoke",
      completion: "revoked",
      label: "Revoke Role Alpha",
      request: "Revoke Role Alpha.",
      summary: "Revoked Role Alpha.",
      target: "Role Alpha",
      id: "role-alpha-grant",
      beforeState: "granted",
      afterState: "revoked",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic grant data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            716,
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
            717,
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
        args: { id: 716 },
        result: "Clicked element 716.",
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

  test("does not infer grant confirmation when semantic data-state was already granted", () => {
    const pre = workflowSnapshot({
      visibleContent: "Role Alpha Grant Role Alpha",
      pageContent: "Role Alpha Grant Role Alpha",
      elements: [
        dataStateActionButton(
          718,
          "Grant Role Alpha",
          "granted",
          "role-alpha-grant",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Role Alpha Grant Role Alpha",
      pageContent: "Role Alpha Grant Role Alpha",
      elements: [
        dataStateActionButton(
          719,
          "Grant Role Alpha",
          "granted",
          "role-alpha-grant",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 718 },
      result: "Clicked element 718.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer revoke confirmation when semantic data-state flips granted", () => {
    const pre = workflowSnapshot({
      visibleContent: "Role Alpha Revoke Role Alpha",
      pageContent: "Role Alpha Revoke Role Alpha",
      elements: [
        dataStateActionButton(
          720,
          "Revoke Role Alpha",
          "revoked",
          "role-alpha-grant",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Role Alpha Revoke Role Alpha",
      pageContent: "Role Alpha Revoke Role Alpha",
      elements: [
        dataStateActionButton(
          721,
          "Revoke Role Alpha",
          "granted",
          "role-alpha-grant",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 720 },
      result: "Clicked element 720.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "suspend",
      completion: "suspended",
      label: "Suspend Account Alpha",
      request: "Suspend Account Alpha.",
      summary: "Suspended Account Alpha.",
      target: "Account Alpha",
      id: "account-alpha-suspend",
      beforeState: "unsuspended",
      afterState: "suspended",
    },
    {
      action: "unsuspend",
      completion: "unsuspended",
      label: "Unsuspend Account Alpha",
      request: "Unsuspend Account Alpha.",
      summary: "Unsuspended Account Alpha.",
      target: "Account Alpha",
      id: "account-alpha-suspend",
      beforeState: "suspended",
      afterState: "unsuspended",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic suspend data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            722,
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
            723,
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
        args: { id: 722 },
        result: "Clicked element 722.",
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

  test("does not infer suspend confirmation when semantic data-state was already suspended", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Suspend Account Alpha",
      pageContent: "Account Alpha Suspend Account Alpha",
      elements: [
        dataStateActionButton(
          724,
          "Suspend Account Alpha",
          "suspended",
          "account-alpha-suspend",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Suspend Account Alpha",
      pageContent: "Account Alpha Suspend Account Alpha",
      elements: [
        dataStateActionButton(
          725,
          "Suspend Account Alpha",
          "suspended",
          "account-alpha-suspend",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 724 },
      result: "Clicked element 724.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsuspend confirmation when semantic data-state flips suspended", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Unsuspend Account Alpha",
      pageContent: "Account Alpha Unsuspend Account Alpha",
      elements: [
        dataStateActionButton(
          726,
          "Unsuspend Account Alpha",
          "unsuspended",
          "account-alpha-suspend",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Unsuspend Account Alpha",
      pageContent: "Account Alpha Unsuspend Account Alpha",
      elements: [
        dataStateActionButton(
          727,
          "Unsuspend Account Alpha",
          "suspended",
          "account-alpha-suspend",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 726 },
      result: "Clicked element 726.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "schedule",
      completion: "scheduled",
      label: "Schedule Report Alpha",
      request: "Schedule Report Alpha.",
      summary: "Scheduled Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-schedule",
      beforeState: "unscheduled",
      afterState: "scheduled",
    },
    {
      action: "unschedule",
      completion: "unscheduled",
      label: "Unschedule Report Alpha",
      request: "Unschedule Report Alpha.",
      summary: "Unscheduled Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-schedule",
      beforeState: "scheduled",
      afterState: "unscheduled",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic schedule data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            728,
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
            729,
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
        args: { id: 728 },
        result: "Clicked element 728.",
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

  test("does not infer schedule confirmation when semantic data-state was already scheduled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Schedule Report Alpha",
      pageContent: "Report Alpha Schedule Report Alpha",
      elements: [
        dataStateActionButton(
          730,
          "Schedule Report Alpha",
          "scheduled",
          "report-alpha-schedule",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Schedule Report Alpha",
      pageContent: "Report Alpha Schedule Report Alpha",
      elements: [
        dataStateActionButton(
          731,
          "Schedule Report Alpha",
          "scheduled",
          "report-alpha-schedule",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 730 },
      result: "Clicked element 730.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unschedule confirmation when semantic data-state flips scheduled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Unschedule Report Alpha",
      pageContent: "Report Alpha Unschedule Report Alpha",
      elements: [
        dataStateActionButton(
          732,
          "Unschedule Report Alpha",
          "unscheduled",
          "report-alpha-schedule",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Unschedule Report Alpha",
      pageContent: "Report Alpha Unschedule Report Alpha",
      elements: [
        dataStateActionButton(
          733,
          "Unschedule Report Alpha",
          "scheduled",
          "report-alpha-schedule",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 732 },
      result: "Clicked element 732.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

});
