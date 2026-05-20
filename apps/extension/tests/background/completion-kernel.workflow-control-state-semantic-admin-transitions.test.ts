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

  for (const scenario of [
    {
      action: "approve",
      completion: "approved",
      label: "Approve Request Alpha",
      request: "Approve Request Alpha.",
      summary: "Approved Request Alpha.",
      target: "Request Alpha",
      id: "request-alpha-approval",
      beforeState: "pending",
      afterState: "approved",
    },
    {
      action: "reject",
      completion: "rejected",
      label: "Reject Request Alpha",
      request: "Reject Request Alpha.",
      summary: "Rejected Request Alpha.",
      target: "Request Alpha",
      id: "request-alpha-approval",
      beforeState: "pending",
      afterState: "rejected",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic approval data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            734,
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
            735,
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
        args: { id: 734 },
        result: "Clicked element 734.",
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

  test("does not infer approve confirmation when semantic data-state was already approved", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Approve Request Alpha",
      pageContent: "Request Alpha Approve Request Alpha",
      elements: [
        dataStateActionButton(
          736,
          "Approve Request Alpha",
          "approved",
          "request-alpha-approval",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Approve Request Alpha",
      pageContent: "Request Alpha Approve Request Alpha",
      elements: [
        dataStateActionButton(
          737,
          "Approve Request Alpha",
          "approved",
          "request-alpha-approval",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 736 },
      result: "Clicked element 736.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reject confirmation when semantic data-state flips approved", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request Alpha Reject Request Alpha",
      pageContent: "Request Alpha Reject Request Alpha",
      elements: [
        dataStateActionButton(
          738,
          "Reject Request Alpha",
          "rejected",
          "request-alpha-approval",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Request Alpha Reject Request Alpha",
      pageContent: "Request Alpha Reject Request Alpha",
      elements: [
        dataStateActionButton(
          739,
          "Reject Request Alpha",
          "approved",
          "request-alpha-approval",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 738 },
      result: "Clicked element 738.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

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
