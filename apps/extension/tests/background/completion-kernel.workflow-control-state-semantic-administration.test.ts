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

function statefulActionButton(
  tag: number,
  label: string,
  pressed: boolean,
  id: string,
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "aria-pressed": String(pressed),
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

describe("completion kernel workflow control-state semantic administration confirmation", () => {
  for (const scenario of [
    {
      action: "enable",
      completion: "enabled",
      label: "Enable Feature Alpha",
      request: "Enable Feature Alpha.",
      summary: "Enabled Feature Alpha.",
      target: "Feature Alpha",
      id: "feature-alpha-enable",
      beforeState: "disabled",
      afterState: "enabled",
    },
    {
      action: "disable",
      completion: "disabled",
      label: "Disable Feature Alpha",
      request: "Disable Feature Alpha.",
      summary: "Disabled Feature Alpha.",
      target: "Feature Alpha",
      id: "feature-alpha-disable",
      beforeState: "enabled",
      afterState: "disabled",
    },
    {
      action: "enable",
      completion: "enabled",
      label: "Activate Feature Alpha",
      request: "Activate Feature Alpha.",
      summary: "Activated Feature Alpha.",
      target: "Feature Alpha",
      id: "feature-alpha-activate",
      beforeState: "inactive",
      afterState: "active",
    },
    {
      action: "disable",
      completion: "disabled",
      label: "Deactivate Feature Alpha",
      request: "Deactivate Feature Alpha.",
      summary: "Deactivated Feature Alpha.",
      target: "Feature Alpha",
      id: "feature-alpha-deactivate",
      beforeState: "active",
      afterState: "inactive",
    },
  ] as const) {
    test(`accepts ${scenario.label.toLowerCase()} confirmation from semantic data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            692,
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
            693,
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
        args: { id: 692 },
        result: "Clicked element 692.",
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

  test("does not infer enable confirmation when semantic data-state was already enabled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Feature Alpha Enable Feature Alpha",
      pageContent: "Feature Alpha Enable Feature Alpha",
      elements: [
        dataStateActionButton(
          694,
          "Enable Feature Alpha",
          "enabled",
          "feature-alpha-enable",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Feature Alpha Enable Feature Alpha",
      pageContent: "Feature Alpha Enable Feature Alpha",
      elements: [
        dataStateActionButton(
          695,
          "Enable Feature Alpha",
          "enabled",
          "feature-alpha-enable",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 694 },
      result: "Clicked element 694.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disable confirmation when semantic data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Feature Alpha Disable Feature Alpha",
      pageContent: "Feature Alpha Disable Feature Alpha",
      elements: [
        dataStateActionButton(
          696,
          "Disable Feature Alpha",
          "disabled",
          "feature-alpha-disable",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Feature Alpha Disable Feature Alpha",
      pageContent: "Feature Alpha Disable Feature Alpha",
      elements: [
        dataStateActionButton(
          697,
          "Disable Feature Alpha",
          "enabled",
          "feature-alpha-disable",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 696 },
      result: "Clicked element 696.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer enable confirmation when control state was already enabled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(620, "Enable MFA", true, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(621, "Enable MFA", true, "mfa-toggle")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer enable confirmation when control state flips the wrong direction", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(620, "Enable MFA", true, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(621, "Enable MFA", false, "mfa-toggle")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer enable confirmation from generic toggled control text", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings MFA",
      pageContent: "Security settings MFA",
      elements: [statefulActionButton(620, "MFA", false, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings MFA",
      pageContent: "Security settings MFA",
      elements: [statefulActionButton(621, "MFA", true, "mfa-toggle")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts lock confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(624, "Lock account", false, "account-lock")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(625, "Lock account", true, "account-lock")],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Locked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "lock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:lock:control-state:account-lock",
        detail: expect.objectContaining({
          action: "lock",
          source: "control_state_change",
          text: "Control state changed to locked: Lock account",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlock confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Unlock account",
      pageContent: "Security settings Unlock account",
      elements: [statefulActionButton(626, "Unlock account", true, "account-lock")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Unlock account",
      pageContent: "Security settings Unlock account",
      elements: [statefulActionButton(627, "Unlock account", false, "account-lock")],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 626 },
      result: "Clicked element 626.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlocked the account.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlock",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:unlock:control-state:account-lock",
        detail: expect.objectContaining({
          action: "unlock",
          source: "control_state_change",
          text: "Control state changed to unlocked: Unlock account",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  for (const scenario of [
    {
      action: "lock",
      completion: "locked",
      label: "Lock Account Alpha",
      request: "Lock Account Alpha.",
      summary: "Locked Account Alpha.",
      target: "Account Alpha",
      id: "account-alpha-lock",
      beforeState: "unlocked",
      afterState: "locked",
    },
    {
      action: "unlock",
      completion: "unlocked",
      label: "Unlock Account Alpha",
      request: "Unlock Account Alpha.",
      summary: "Unlocked Account Alpha.",
      target: "Account Alpha",
      id: "account-alpha-lock",
      beforeState: "locked",
      afterState: "unlocked",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic lock data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            698,
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
            699,
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
        args: { id: 698 },
        result: "Clicked element 698.",
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

  test("does not infer lock confirmation when semantic data-state was already locked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Lock Account Alpha",
      pageContent: "Account Alpha Lock Account Alpha",
      elements: [
        dataStateActionButton(
          700,
          "Lock Account Alpha",
          "locked",
          "account-alpha-lock",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Lock Account Alpha",
      pageContent: "Account Alpha Lock Account Alpha",
      elements: [
        dataStateActionButton(
          701,
          "Lock Account Alpha",
          "locked",
          "account-alpha-lock",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 700 },
      result: "Clicked element 700.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlock confirmation when semantic data-state flips locked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Unlock Account Alpha",
      pageContent: "Account Alpha Unlock Account Alpha",
      elements: [
        dataStateActionButton(
          702,
          "Unlock Account Alpha",
          "unlocked",
          "account-alpha-lock",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Unlock Account Alpha",
      pageContent: "Account Alpha Unlock Account Alpha",
      elements: [
        dataStateActionButton(
          703,
          "Unlock Account Alpha",
          "locked",
          "account-alpha-lock",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 702 },
      result: "Clicked element 702.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "block",
      completion: "blocked",
      label: "Block User Alpha",
      request: "Block User Alpha.",
      summary: "Blocked User Alpha.",
      target: "User Alpha",
      id: "user-alpha-block",
      beforeState: "unblocked",
      afterState: "blocked",
    },
    {
      action: "unblock",
      completion: "unblocked",
      label: "Unblock User Alpha",
      request: "Unblock User Alpha.",
      summary: "Unblocked User Alpha.",
      target: "User Alpha",
      id: "user-alpha-block",
      beforeState: "blocked",
      afterState: "unblocked",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic block data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            704,
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
            705,
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
        args: { id: 704 },
        result: "Clicked element 704.",
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

  test("does not infer block confirmation when semantic data-state was already blocked", () => {
    const pre = workflowSnapshot({
      visibleContent: "User Alpha Block User Alpha",
      pageContent: "User Alpha Block User Alpha",
      elements: [
        dataStateActionButton(
          706,
          "Block User Alpha",
          "blocked",
          "user-alpha-block",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "User Alpha Block User Alpha",
      pageContent: "User Alpha Block User Alpha",
      elements: [
        dataStateActionButton(
          707,
          "Block User Alpha",
          "blocked",
          "user-alpha-block",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 706 },
      result: "Clicked element 706.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unblock confirmation when semantic data-state flips blocked", () => {
    const pre = workflowSnapshot({
      visibleContent: "User Alpha Unblock User Alpha",
      pageContent: "User Alpha Unblock User Alpha",
      elements: [
        dataStateActionButton(
          708,
          "Unblock User Alpha",
          "unblocked",
          "user-alpha-block",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "User Alpha Unblock User Alpha",
      pageContent: "User Alpha Unblock User Alpha",
      elements: [
        dataStateActionButton(
          709,
          "Unblock User Alpha",
          "blocked",
          "user-alpha-block",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 708 },
      result: "Clicked element 708.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "assign",
      completion: "assigned",
      label: "Assign Ticket Alpha",
      request: "Assign Ticket Alpha.",
      summary: "Assigned Ticket Alpha.",
      target: "Ticket Alpha",
      id: "ticket-alpha-assign",
      beforeState: "unassigned",
      afterState: "assigned",
    },
    {
      action: "unassign",
      completion: "unassigned",
      label: "Unassign Ticket Alpha",
      request: "Unassign Ticket Alpha.",
      summary: "Unassigned Ticket Alpha.",
      target: "Ticket Alpha",
      id: "ticket-alpha-assign",
      beforeState: "assigned",
      afterState: "unassigned",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic assignment data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            710,
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
            711,
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
        args: { id: 710 },
        result: "Clicked element 710.",
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

  test("does not infer assign confirmation when semantic data-state was already assigned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Assign Ticket Alpha",
      pageContent: "Ticket Alpha Assign Ticket Alpha",
      elements: [
        dataStateActionButton(
          712,
          "Assign Ticket Alpha",
          "assigned",
          "ticket-alpha-assign",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Assign Ticket Alpha",
      pageContent: "Ticket Alpha Assign Ticket Alpha",
      elements: [
        dataStateActionButton(
          713,
          "Assign Ticket Alpha",
          "assigned",
          "ticket-alpha-assign",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 712 },
      result: "Clicked element 712.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unassign confirmation when semantic data-state flips assigned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Ticket Alpha Unassign Ticket Alpha",
      elements: [
        dataStateActionButton(
          714,
          "Unassign Ticket Alpha",
          "unassigned",
          "ticket-alpha-assign",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Unassign Ticket Alpha",
      pageContent: "Ticket Alpha Unassign Ticket Alpha",
      elements: [
        dataStateActionButton(
          715,
          "Unassign Ticket Alpha",
          "assigned",
          "ticket-alpha-assign",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 714 },
      result: "Clicked element 714.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });


});
