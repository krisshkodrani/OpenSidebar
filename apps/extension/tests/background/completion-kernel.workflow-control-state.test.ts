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

function selectedActionButton(
  tag: number,
  label: string,
  selected: boolean,
  id: string,
  attribute: "aria-selected" | "selected" = "aria-selected",
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      [attribute]: String(selected),
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

describe("completion kernel workflow control-state confirmation", () => {
  test("accepts enable confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(620, "Enable MFA", false, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Enable MFA",
      pageContent: "Security settings Enable MFA",
      elements: [statefulActionButton(621, "Enable MFA", true, "mfa-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 620 },
      result: "Clicked element 620.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:control-state:mfa-toggle",
        detail: expect.objectContaining({
          action: "enable",
          source: "control_state_change",
          text: "Control state changed to enabled: Enable MFA",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware control-state confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Feature Alpha disabled Feature Beta disabled",
      pageContent: "Feature Alpha disabled Feature Beta disabled",
      elements: [
        statefulActionButton(
          640,
          "Enable Feature Beta",
          false,
          "feature-beta-toggle",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Feature Alpha disabled Feature Beta enabled",
      pageContent: "Feature Alpha disabled Feature Beta enabled",
      elements: [
        statefulActionButton(
          641,
          "Enable Feature Beta",
          true,
          "feature-beta-toggle",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:enable:control-state:feature-beta-toggle",
        detail: expect.objectContaining({
          action: "enable",
          source: "control_state_change",
          targetText: "Feature Beta",
          text: "Control state changed to enabled: Enable Feature Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("keeps generic control-state confirmation valid for a named target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Feature Alpha disabled",
      pageContent: "Feature Alpha disabled",
      elements: [statefulActionButton(640, "Enable", false, "feature-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Feature Alpha enabled",
      pageContent: "Feature Alpha enabled",
      elements: [statefulActionButton(641, "Enable", true, "feature-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Enable Feature Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Enabled Feature Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "enable",
      targetLabel: "Feature Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:enable:control-state:feature-toggle",
        detail: expect.objectContaining({
          action: "enable",
          source: "control_state_change",
          text: "Control state changed to enabled: Enable",
        }),
      }),
    ]);
    expect((evidence[0]?.detail as { targetText?: string }).targetText).toBe(
      undefined,
    );
    expect(decision.status).toBe("accepted");
  });

  test("accepts disable confirmation from control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Disable MFA",
      pageContent: "Security settings Disable MFA",
      elements: [statefulActionButton(622, "Disable MFA", true, "mfa-toggle")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Disable MFA",
      pageContent: "Security settings Disable MFA",
      elements: [statefulActionButton(623, "Disable MFA", false, "mfa-toggle")],
    });
    const generated = generateCompletionContract({
      userRequest: "Disable MFA.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 622 },
      result: "Clicked element 622.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disabled MFA.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disable",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:disable:control-state:mfa-toggle",
        detail: expect.objectContaining({
          action: "disable",
          source: "control_state_change",
          text: "Control state changed to disabled: Disable MFA",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

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

  test("accepts cancel confirmation from semantic cancel data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          752,
          "Cancel Order Alpha",
          "active",
          "order-alpha-cancel",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          753,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel Order Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 752 },
      result: "Clicked element 752.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled Order Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "cancel",
      targetLabel: "Order Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:cancel:control-state:order-alpha-cancel",
        detail: expect.objectContaining({
          action: "cancel",
          source: "control_state_change",
          targetText: "Order Alpha",
          text: "Control state changed to canceled: Cancel Order Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer cancel confirmation when semantic data-state was already canceled", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          754,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          755,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 754 },
      result: "Clicked element 754.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer cancel confirmation when semantic data-state flips active", () => {
    const pre = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          756,
          "Cancel Order Alpha",
          "canceled",
          "order-alpha-cancel",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Order Alpha Cancel Order Alpha",
      pageContent: "Order Alpha Cancel Order Alpha",
      elements: [
        dataStateActionButton(
          757,
          "Cancel Order Alpha",
          "active",
          "order-alpha-cancel",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 756 },
      result: "Clicked element 756.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "archive",
      completion: "archived",
      label: "Archive Report Alpha",
      request: "Archive Report Alpha.",
      summary: "Archived Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-archive",
      beforeState: "active",
      afterState: "archived",
    },
    {
      action: "restore",
      completion: "restored",
      label: "Restore Version Alpha",
      request: "Restore Version Alpha.",
      summary: "Restored Version Alpha.",
      target: "Version Alpha",
      id: "version-alpha-archive",
      beforeState: "archived",
      afterState: "active",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic archive data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            758,
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
            759,
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
        args: { id: 758 },
        result: "Clicked element 758.",
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

  test("does not infer archive confirmation when semantic data-state was already archived", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Archive Report Alpha",
      pageContent: "Report Alpha Archive Report Alpha",
      elements: [
        dataStateActionButton(
          760,
          "Archive Report Alpha",
          "archived",
          "report-alpha-archive",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Archive Report Alpha",
      pageContent: "Report Alpha Archive Report Alpha",
      elements: [
        dataStateActionButton(
          761,
          "Archive Report Alpha",
          "archived",
          "report-alpha-archive",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 760 },
      result: "Clicked element 760.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer restore confirmation when semantic data-state flips archived", () => {
    const pre = workflowSnapshot({
      visibleContent: "Version Alpha Restore Version Alpha",
      pageContent: "Version Alpha Restore Version Alpha",
      elements: [
        dataStateActionButton(
          762,
          "Restore Version Alpha",
          "active",
          "version-alpha-archive",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Version Alpha Restore Version Alpha",
      pageContent: "Version Alpha Restore Version Alpha",
      elements: [
        dataStateActionButton(
          763,
          "Restore Version Alpha",
          "archived",
          "version-alpha-archive",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 762 },
      result: "Clicked element 762.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "deploy",
      completion: "deployed",
      label: "Deploy Release Alpha",
      request: "Deploy Release Alpha.",
      summary: "Deployed Release Alpha.",
      target: "Release Alpha",
      id: "release-alpha-deploy",
      beforeState: "staged",
      afterState: "deployed",
    },
    {
      action: "rollback",
      completion: "rolled back",
      label: "Rollback Release Alpha",
      request: "Rollback Release Alpha.",
      summary: "Rolled back Release Alpha.",
      target: "Release Alpha",
      id: "release-alpha-rollback",
      beforeState: "deployed",
      afterState: "rolled-back",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic deployment data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            770,
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
            771,
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
        args: { id: 770 },
        result: "Clicked element 770.",
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

  test("does not infer deploy confirmation when semantic data-state was already deployed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Release Alpha Deploy Release Alpha",
      pageContent: "Release Alpha Deploy Release Alpha",
      elements: [
        dataStateActionButton(
          772,
          "Deploy Release Alpha",
          "deployed",
          "release-alpha-deploy",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Release Alpha Deploy Release Alpha",
      pageContent: "Release Alpha Deploy Release Alpha",
      elements: [
        dataStateActionButton(
          773,
          "Deploy Release Alpha",
          "deployed",
          "release-alpha-deploy",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 772 },
      result: "Clicked element 772.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer rollback confirmation when semantic data-state flips deployed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Release Alpha Rollback Release Alpha",
      pageContent: "Release Alpha Rollback Release Alpha",
      elements: [
        dataStateActionButton(
          774,
          "Rollback Release Alpha",
          "rolled-back",
          "release-alpha-rollback",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Release Alpha Rollback Release Alpha",
      pageContent: "Release Alpha Rollback Release Alpha",
      elements: [
        dataStateActionButton(
          775,
          "Rollback Release Alpha",
          "deployed",
          "release-alpha-rollback",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 774 },
      result: "Clicked element 774.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "backup",
      completion: "backed up",
      label: "Back up Database Alpha",
      request: "Back up Database Alpha.",
      summary: "Backed up Database Alpha.",
      target: "Database Alpha",
      id: "database-alpha-backup",
      beforeState: "dirty",
      afterState: "backed-up",
    },
    {
      action: "reset",
      completion: "reset",
      label: "Reset Password Alpha",
      request: "Reset Password Alpha.",
      summary: "Reset Password Alpha.",
      target: "Password Alpha",
      id: "password-alpha-reset",
      beforeState: "modified",
      afterState: "reset",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic maintenance data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            776,
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
            777,
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
        args: { id: 776 },
        result: "Clicked element 776.",
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

  test("does not infer backup confirmation when semantic data-state was already backed up", () => {
    const pre = workflowSnapshot({
      visibleContent: "Database Alpha Back up Database Alpha",
      pageContent: "Database Alpha Back up Database Alpha",
      elements: [
        dataStateActionButton(
          778,
          "Back up Database Alpha",
          "backed-up",
          "database-alpha-backup",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Database Alpha Back up Database Alpha",
      pageContent: "Database Alpha Back up Database Alpha",
      elements: [
        dataStateActionButton(
          779,
          "Back up Database Alpha",
          "backed-up",
          "database-alpha-backup",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 778 },
      result: "Clicked element 778.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer reset confirmation when semantic data-state flips modified", () => {
    const pre = workflowSnapshot({
      visibleContent: "Password Alpha Reset Password Alpha",
      pageContent: "Password Alpha Reset Password Alpha",
      elements: [
        dataStateActionButton(
          780,
          "Reset Password Alpha",
          "reset",
          "password-alpha-reset",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Password Alpha Reset Password Alpha",
      pageContent: "Password Alpha Reset Password Alpha",
      elements: [
        dataStateActionButton(
          781,
          "Reset Password Alpha",
          "modified",
          "password-alpha-reset",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 780 },
      result: "Clicked element 780.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

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

  for (const scenario of [
    {
      action: "save",
      completion: "saved",
      label: "Save Settings Alpha",
      request: "Save Settings Alpha.",
      summary: "Saved Settings Alpha.",
      target: "Settings Alpha",
      id: "settings-alpha-save",
      beforeState: "unsaved",
      afterState: "saved",
    },
    {
      action: "update",
      completion: "updated",
      label: "Update Profile Alpha",
      request: "Update Profile Alpha.",
      summary: "Updated Profile Alpha.",
      target: "Profile Alpha",
      id: "profile-alpha-update",
      beforeState: "stale",
      afterState: "updated",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic persistence data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            790,
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
            791,
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
        args: { id: 790 },
        result: "Clicked element 790.",
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

  test("does not infer save confirmation when semantic data-state was already saved", () => {
    const pre = workflowSnapshot({
      visibleContent: "Settings Alpha Save Settings Alpha",
      pageContent: "Settings Alpha Save Settings Alpha",
      elements: [
        dataStateActionButton(
          792,
          "Save Settings Alpha",
          "saved",
          "settings-alpha-save",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Settings Alpha Save Settings Alpha",
      pageContent: "Settings Alpha Save Settings Alpha",
      elements: [
        dataStateActionButton(
          793,
          "Save Settings Alpha",
          "saved",
          "settings-alpha-save",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 792 },
      result: "Clicked element 792.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer update confirmation when semantic data-state flips stale", () => {
    const pre = workflowSnapshot({
      visibleContent: "Profile Alpha Update Profile Alpha",
      pageContent: "Profile Alpha Update Profile Alpha",
      elements: [
        dataStateActionButton(
          794,
          "Update Profile Alpha",
          "updated",
          "profile-alpha-update",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Profile Alpha Update Profile Alpha",
      pageContent: "Profile Alpha Update Profile Alpha",
      elements: [
        dataStateActionButton(
          795,
          "Update Profile Alpha",
          "stale",
          "profile-alpha-update",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 794 },
      result: "Clicked element 794.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      label: "Delete Ticket Alpha",
      request: "Delete Ticket Alpha.",
      summary: "Deleted Ticket Alpha.",
      target: "Ticket Alpha",
      id: "ticket-alpha-delete",
      beforeState: "active",
      afterState: "deleted",
    },
    {
      label: "Remove File Alpha",
      request: "Remove File Alpha.",
      summary: "Removed File Alpha.",
      target: "File Alpha",
      id: "file-alpha-remove",
      beforeState: "present",
      afterState: "removed",
    },
  ] as const) {
    test(`accepts delete confirmation from semantic deletion data-state control state change for ${scenario.label.toLowerCase()}`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            802,
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
            803,
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
        args: { id: 802 },
        result: "Clicked element 802.",
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
        action: "delete",
        targetLabel: scenario.target,
      });
      expect(evidence).toEqual([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: `workflow:confirmation:delete:control-state:${scenario.id}`,
          detail: expect.objectContaining({
            action: "delete",
            source: "control_state_change",
            targetText: scenario.target,
            text: `Control state changed to deleted: ${scenario.label}`,
          }),
        }),
      ]);
      expect(decision.status).toBe("accepted");
    });
  }

  test("does not infer delete confirmation when semantic data-state was already deleted", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Delete Ticket Alpha",
      pageContent: "Ticket Alpha Delete Ticket Alpha",
      elements: [
        dataStateActionButton(
          804,
          "Delete Ticket Alpha",
          "deleted",
          "ticket-alpha-delete",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Delete Ticket Alpha",
      pageContent: "Ticket Alpha Delete Ticket Alpha",
      elements: [
        dataStateActionButton(
          805,
          "Delete Ticket Alpha",
          "deleted",
          "ticket-alpha-delete",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 804 },
      result: "Clicked element 804.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer delete confirmation when semantic data-state flips active", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Delete Ticket Alpha",
      pageContent: "Ticket Alpha Delete Ticket Alpha",
      elements: [
        dataStateActionButton(
          806,
          "Delete Ticket Alpha",
          "deleted",
          "ticket-alpha-delete",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Delete Ticket Alpha",
      pageContent: "Ticket Alpha Delete Ticket Alpha",
      elements: [
        dataStateActionButton(
          807,
          "Delete Ticket Alpha",
          "active",
          "ticket-alpha-delete",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 806 },
      result: "Clicked element 806.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer delete confirmation from remove-assignment wording", () => {
    const pre = workflowSnapshot({
      visibleContent: "Ticket Alpha Remove assignment from Ticket Alpha",
      pageContent: "Ticket Alpha Remove assignment from Ticket Alpha",
      elements: [
        dataStateActionButton(
          808,
          "Remove assignment from Ticket Alpha",
          "active",
          "ticket-alpha-assignment",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Ticket Alpha Remove assignment from Ticket Alpha",
      pageContent: "Ticket Alpha Remove assignment from Ticket Alpha",
      elements: [
        dataStateActionButton(
          809,
          "Remove assignment from Ticket Alpha",
          "removed",
          "ticket-alpha-assignment",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 808 },
      result: "Clicked element 808.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

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

  test("accepts send confirmation from semantic send data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          828,
          "Send Message Alpha",
          "draft",
          "message-alpha-send",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          829,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Send Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 828 },
      result: "Clicked element 828.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Sent Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "send",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:send:control-state:message-alpha-send",
        detail: expect.objectContaining({
          action: "send",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to sent: Send Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer send confirmation when semantic data-state was already sent", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          830,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          831,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 830 },
      result: "Clicked element 830.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer send confirmation when semantic data-state flips draft", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          832,
          "Send Message Alpha",
          "sent",
          "message-alpha-send",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Send Message Alpha",
      pageContent: "Message Alpha Send Message Alpha",
      elements: [
        dataStateActionButton(
          833,
          "Send Message Alpha",
          "draft",
          "message-alpha-send",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 832 },
      result: "Clicked element 832.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "export",
      completion: "exported",
      label: "Export Report Alpha",
      request: "Export Report Alpha.",
      summary: "Exported Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-export",
      beforeState: "ready",
      afterState: "exported",
    },
    {
      action: "download",
      completion: "downloaded",
      label: "Download File Alpha",
      request: "Download File Alpha.",
      summary: "Downloaded File Alpha.",
      target: "File Alpha",
      id: "file-alpha-download",
      beforeState: "ready",
      afterState: "downloaded",
    },
    {
      action: "upload",
      completion: "uploaded",
      label: "Upload File Alpha",
      request: "Upload File Alpha.",
      summary: "Uploaded File Alpha.",
      target: "File Alpha",
      id: "file-alpha-upload",
      beforeState: "pending",
      afterState: "uploaded",
    },
    {
      action: "import",
      completion: "imported",
      label: "Import File Alpha",
      request: "Import File Alpha.",
      summary: "Imported File Alpha.",
      target: "File Alpha",
      id: "file-alpha-import",
      beforeState: "staged",
      afterState: "imported",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic file-transfer data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            834,
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
            835,
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
        args: { id: 834 },
        result: "Clicked element 834.",
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

  test("does not infer export confirmation when semantic data-state was already exported", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Export Report Alpha",
      pageContent: "Report Alpha Export Report Alpha",
      elements: [
        dataStateActionButton(
          836,
          "Export Report Alpha",
          "exported",
          "report-alpha-export",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Export Report Alpha",
      pageContent: "Report Alpha Export Report Alpha",
      elements: [
        dataStateActionButton(
          837,
          "Export Report Alpha",
          "exported",
          "report-alpha-export",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 836 },
      result: "Clicked element 836.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer import confirmation when semantic data-state flips staged", () => {
    const pre = workflowSnapshot({
      visibleContent: "File Alpha Import File Alpha",
      pageContent: "File Alpha Import File Alpha",
      elements: [
        dataStateActionButton(
          838,
          "Import File Alpha",
          "imported",
          "file-alpha-import",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "File Alpha Import File Alpha",
      pageContent: "File Alpha Import File Alpha",
      elements: [
        dataStateActionButton(
          839,
          "Import File Alpha",
          "staged",
          "file-alpha-import",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 838 },
      result: "Clicked element 838.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts create confirmation from semantic create data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Customer Alpha Create Customer Alpha",
      pageContent: "Customer Alpha Create Customer Alpha",
      elements: [
        dataStateActionButton(
          840,
          "Create Customer Alpha",
          "ready",
          "customer-alpha-create",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Customer Alpha Create Customer Alpha",
      pageContent: "Customer Alpha Create Customer Alpha",
      elements: [
        dataStateActionButton(
          841,
          "Create Customer Alpha",
          "created",
          "customer-alpha-create",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 840 },
      result: "Clicked element 840.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Customer Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:control-state:customer-alpha-create",
        detail: expect.objectContaining({
          action: "create",
          source: "control_state_change",
          targetText: "Customer Alpha",
          text: "Control state changed to created: Create Customer Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer create confirmation when semantic data-state was already created", () => {
    const pre = workflowSnapshot({
      visibleContent: "Customer Alpha Create Customer Alpha",
      pageContent: "Customer Alpha Create Customer Alpha",
      elements: [
        dataStateActionButton(
          842,
          "Create Customer Alpha",
          "created",
          "customer-alpha-create",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Customer Alpha Create Customer Alpha",
      pageContent: "Customer Alpha Create Customer Alpha",
      elements: [
        dataStateActionButton(
          843,
          "Create Customer Alpha",
          "created",
          "customer-alpha-create",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 842 },
      result: "Clicked element 842.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer create confirmation when semantic data-state flips ready", () => {
    const pre = workflowSnapshot({
      visibleContent: "Customer Alpha Create Customer Alpha",
      pageContent: "Customer Alpha Create Customer Alpha",
      elements: [
        dataStateActionButton(
          844,
          "Create Customer Alpha",
          "created",
          "customer-alpha-create",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Customer Alpha Create Customer Alpha",
      pageContent: "Customer Alpha Create Customer Alpha",
      elements: [
        dataStateActionButton(
          845,
          "Create Customer Alpha",
          "ready",
          "customer-alpha-create",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 844 },
      result: "Clicked element 844.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts dismiss confirmation from semantic dismiss data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Newsletter Popup Dismiss Newsletter Popup",
      pageContent: "Newsletter Popup Dismiss Newsletter Popup",
      elements: [
        dataStateActionButton(
          846,
          "Dismiss Newsletter Popup",
          "visible",
          "newsletter-popup-dismiss",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Newsletter Popup Dismiss Newsletter Popup",
      pageContent: "Newsletter Popup Dismiss Newsletter Popup",
      elements: [
        dataStateActionButton(
          847,
          "Dismiss Newsletter Popup",
          "dismissed",
          "newsletter-popup-dismiss",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Dismiss Newsletter Popup.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 846 },
      result: "Clicked element 846.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Dismissed Newsletter Popup.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
      targetLabel: "Newsletter Popup",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:dismiss:control-state:newsletter-popup-dismiss",
        detail: expect.objectContaining({
          action: "dismiss",
          source: "control_state_change",
          targetText: "Newsletter Popup",
          text: "Control state changed to dismissed: Dismiss Newsletter Popup",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer dismiss confirmation when semantic data-state was already dismissed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Newsletter Popup Dismiss Newsletter Popup",
      pageContent: "Newsletter Popup Dismiss Newsletter Popup",
      elements: [
        dataStateActionButton(
          848,
          "Dismiss Newsletter Popup",
          "dismissed",
          "newsletter-popup-dismiss",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Newsletter Popup Dismiss Newsletter Popup",
      pageContent: "Newsletter Popup Dismiss Newsletter Popup",
      elements: [
        dataStateActionButton(
          849,
          "Dismiss Newsletter Popup",
          "dismissed",
          "newsletter-popup-dismiss",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 848 },
      result: "Clicked element 848.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer dismiss confirmation when semantic data-state flips visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "Newsletter Popup Dismiss Newsletter Popup",
      pageContent: "Newsletter Popup Dismiss Newsletter Popup",
      elements: [
        dataStateActionButton(
          850,
          "Dismiss Newsletter Popup",
          "dismissed",
          "newsletter-popup-dismiss",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Newsletter Popup Dismiss Newsletter Popup",
      pageContent: "Newsletter Popup Dismiss Newsletter Popup",
      elements: [
        dataStateActionButton(
          851,
          "Dismiss Newsletter Popup",
          "visible",
          "newsletter-popup-dismiss",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 850 },
      result: "Clicked element 850.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

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

  test("accepts star confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(628, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(629, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 628 },
      result: "Clicked element 628.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:star:control-state:issue-alpha-star",
        detail: expect.objectContaining({
          action: "star",
          source: "control_state_change",
          targetText: "Issue Alpha",
          text: "Control state changed to starred: Star Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unstar confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Unstar Issue Alpha",
      pageContent: "Issue Alpha Unstar Issue Alpha",
      elements: [
        statefulActionButton(630, "Unstar Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Unstar Issue Alpha",
      pageContent: "Issue Alpha Unstar Issue Alpha",
      elements: [
        statefulActionButton(631, "Unstar Issue Alpha", false, "issue-alpha-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unstar Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 630 },
      result: "Clicked element 630.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unstarred Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unstar",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unstar:control-state:issue-alpha-star",
        detail: expect.objectContaining({
          action: "unstar",
          source: "control_state_change",
          targetText: "Issue Alpha",
          text: "Control state changed to unstarred: Unstar Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware pressed-toggle confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Issue Beta Star Issue Beta",
      pageContent: "Issue Alpha Issue Beta Star Issue Beta",
      elements: [
        statefulActionButton(632, "Star Issue Beta", false, "issue-beta-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Issue Beta Star Issue Beta",
      pageContent: "Issue Alpha Issue Beta Star Issue Beta",
      elements: [
        statefulActionButton(633, "Star Issue Beta", true, "issue-beta-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 632 },
      result: "Clicked element 632.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        logicalKey: "workflow:confirmation:star:control-state:issue-beta-star",
        detail: expect.objectContaining({
          action: "star",
          source: "control_state_change",
          targetText: "Issue Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer star confirmation when pressed state was already on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(628, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(629, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 628 },
      result: "Clicked element 628.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer star confirmation when pressed state flips off", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(628, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        statefulActionButton(629, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 628 },
      result: "Clicked element 628.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts like confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(644, "Like Comment Alpha", false, "comment-alpha-like"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(645, "Like Comment Alpha", true, "comment-alpha-like"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Like Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 644 },
      result: "Clicked element 644.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Liked Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "like",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:like:control-state:comment-alpha-like",
        detail: expect.objectContaining({
          action: "like",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to liked: Like Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlike confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Unlike Comment Alpha",
      pageContent: "Comment Alpha Unlike Comment Alpha",
      elements: [
        statefulActionButton(
          646,
          "Unlike Comment Alpha",
          true,
          "comment-alpha-like",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Unlike Comment Alpha",
      pageContent: "Comment Alpha Unlike Comment Alpha",
      elements: [
        statefulActionButton(
          647,
          "Unlike Comment Alpha",
          false,
          "comment-alpha-like",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlike Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 646 },
      result: "Clicked element 646.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unliked Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlike",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unlike:control-state:comment-alpha-like",
        detail: expect.objectContaining({
          action: "unlike",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to unliked: Unlike Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware like confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Like Comment Beta",
      pageContent: "Comment Alpha Comment Beta Like Comment Beta",
      elements: [
        statefulActionButton(648, "Like Comment Beta", false, "comment-beta-like"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Like Comment Beta",
      pageContent: "Comment Alpha Comment Beta Like Comment Beta",
      elements: [
        statefulActionButton(649, "Like Comment Beta", true, "comment-beta-like"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Like Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 648 },
      result: "Clicked element 648.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Liked Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "like",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        logicalKey: "workflow:confirmation:like:control-state:comment-beta-like",
        detail: expect.objectContaining({
          action: "like",
          source: "control_state_change",
          targetText: "Comment Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer like confirmation when pressed state was already on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(644, "Like Comment Alpha", true, "comment-alpha-like"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Like Comment Alpha",
      pageContent: "Comment Alpha Like Comment Alpha",
      elements: [
        statefulActionButton(645, "Like Comment Alpha", true, "comment-alpha-like"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 644 },
      result: "Clicked element 644.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts upvote confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          650,
          "Upvote Comment Alpha",
          false,
          "comment-alpha-upvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          651,
          "Upvote Comment Alpha",
          true,
          "comment-alpha-upvote",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Upvote Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Upvoted Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upvote",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:upvote:control-state:comment-alpha-upvote",
        detail: expect.objectContaining({
          action: "upvote",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to upvoted: Upvote Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts downvote confirmation from pressed control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Downvote Comment Alpha",
      pageContent: "Comment Alpha Downvote Comment Alpha",
      elements: [
        statefulActionButton(
          652,
          "Downvote Comment Alpha",
          false,
          "comment-alpha-downvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Downvote Comment Alpha",
      pageContent: "Comment Alpha Downvote Comment Alpha",
      elements: [
        statefulActionButton(
          653,
          "Downvote Comment Alpha",
          true,
          "comment-alpha-downvote",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Downvote Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 652 },
      result: "Clicked element 652.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Downvoted Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "downvote",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:downvote:control-state:comment-alpha-downvote",
        detail: expect.objectContaining({
          action: "downvote",
          source: "control_state_change",
          targetText: "Comment Alpha",
          text: "Control state changed to downvoted: Downvote Comment Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware upvote confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      pageContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      elements: [
        statefulActionButton(
          654,
          "Upvote Comment Beta",
          false,
          "comment-beta-upvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      pageContent: "Comment Alpha Comment Beta Upvote Comment Beta",
      elements: [
        statefulActionButton(
          655,
          "Upvote Comment Beta",
          true,
          "comment-beta-upvote",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Upvote Comment Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Upvoted Comment Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "upvote",
      targetLabel: "Comment Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        logicalKey:
          "workflow:confirmation:upvote:control-state:comment-beta-upvote",
        detail: expect.objectContaining({
          action: "upvote",
          source: "control_state_change",
          targetText: "Comment Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer upvote confirmation when pressed state was already on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          650,
          "Upvote Comment Alpha",
          true,
          "comment-alpha-upvote",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Comment Alpha Upvote Comment Alpha",
      pageContent: "Comment Alpha Upvote Comment Alpha",
      elements: [
        statefulActionButton(
          651,
          "Upvote Comment Alpha",
          true,
          "comment-alpha-upvote",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "bookmark",
      completion: "bookmarked",
      label: "Bookmark Article Alpha",
      request: "Bookmark Article Alpha.",
      summary: "Bookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
    },
    {
      action: "unbookmark",
      completion: "unbookmarked",
      label: "Unbookmark Article Alpha",
      request: "Unbookmark Article Alpha.",
      summary: "Unbookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "follow",
      completion: "followed",
      label: "Follow Project Alpha",
      request: "Follow Project Alpha.",
      summary: "Followed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
    },
    {
      action: "unfollow",
      completion: "unfollowed",
      label: "Unfollow Project Alpha",
      request: "Unfollow Project Alpha.",
      summary: "Unfollowed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "subscribe",
      completion: "subscribed",
      label: "Subscribe to Channel Alpha",
      request: "Subscribe to Channel Alpha.",
      summary: "Subscribed to Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
    },
    {
      action: "unsubscribe",
      completion: "unsubscribed",
      label: "Unsubscribe from Channel Alpha",
      request: "Unsubscribe from Channel Alpha.",
      summary: "Unsubscribed from Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "pin",
      completion: "pinned",
      label: "Pin Report Alpha",
      request: "Pin Report Alpha.",
      summary: "Pinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
    },
    {
      action: "unpin",
      completion: "unpinned",
      label: "Unpin Report Alpha",
      request: "Unpin Report Alpha.",
      summary: "Unpinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
      initiallyPressed: true,
      finallyPressed: false,
    },
    {
      action: "mute",
      completion: "muted",
      label: "Mute Thread Alpha",
      request: "Mute Thread Alpha.",
      summary: "Muted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
    },
    {
      action: "unmute",
      completion: "unmuted",
      label: "Unmute Thread Alpha",
      request: "Unmute Thread Alpha.",
      summary: "Unmuted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
      initiallyPressed: true,
      finallyPressed: false,
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from pressed control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          statefulActionButton(
            634,
            scenario.label,
            scenario.initiallyPressed ?? false,
            scenario.id,
          ),
        ],
      });
      const current = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          statefulActionButton(
            635,
            scenario.label,
            scenario.finallyPressed ?? true,
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
        args: { id: 634 },
        result: "Clicked element 634.",
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

  test("accepts star confirmation from aria-selected control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(636, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(637, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Star Issue Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 636 },
      result: "Clicked element 636.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Starred Issue Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "star",
      targetLabel: "Issue Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:star:control-state:issue-alpha-star",
        detail: expect.objectContaining({
          action: "star",
          source: "control_state_change",
          targetText: "Issue Alpha",
          text: "Control state changed to starred: Star Issue Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unbookmark confirmation from selected control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Alpha Unbookmark Article Alpha",
      pageContent: "Article Alpha Unbookmark Article Alpha",
      elements: [
        selectedActionButton(
          638,
          "Unbookmark Article Alpha",
          true,
          "article-alpha-bookmark",
          "selected",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Alpha Unbookmark Article Alpha",
      pageContent: "Article Alpha Unbookmark Article Alpha",
      elements: [
        selectedActionButton(
          639,
          "Unbookmark Article Alpha",
          false,
          "article-alpha-bookmark",
          "selected",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unbookmark Article Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 638 },
      result: "Clicked element 638.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unbookmarked Article Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unbookmark",
      targetLabel: "Article Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unbookmark:control-state:article-alpha-bookmark",
        detail: expect.objectContaining({
          action: "unbookmark",
          source: "control_state_change",
          targetText: "Article Alpha",
          text: "Control state changed to unbookmarked: Unbookmark Article Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer star confirmation when aria-selected was already true", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(636, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(637, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 636 },
      result: "Clicked element 636.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer star confirmation when aria-selected flips off", () => {
    const pre = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(636, "Star Issue Alpha", true, "issue-alpha-star"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Issue Alpha Star Issue Alpha",
      pageContent: "Issue Alpha Star Issue Alpha",
      elements: [
        selectedActionButton(637, "Star Issue Alpha", false, "issue-alpha-star"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 636 },
      result: "Clicked element 636.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts bookmark confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          640,
          "Bookmark Article Beta",
          "unchecked",
          "article-beta-bookmark",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          641,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Bookmark Article Beta.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Bookmarked Article Beta.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "bookmark",
      targetLabel: "Article Beta",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:bookmark:control-state:article-beta-bookmark",
        detail: expect.objectContaining({
          action: "bookmark",
          source: "control_state_change",
          targetText: "Article Beta",
          text: "Control state changed to bookmarked: Bookmark Article Beta",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unwatch confirmation from data-selected control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Repository Alpha Unwatch Repository Alpha",
      pageContent: "Repository Alpha Unwatch Repository Alpha",
      elements: [
        dataStateActionButton(
          642,
          "Unwatch Repository Alpha",
          "true",
          "repository-alpha-watch",
          "data-selected",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Repository Alpha Unwatch Repository Alpha",
      pageContent: "Repository Alpha Unwatch Repository Alpha",
      elements: [
        dataStateActionButton(
          643,
          "Unwatch Repository Alpha",
          "false",
          "repository-alpha-watch",
          "data-selected",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unwatch Repository Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 642 },
      result: "Clicked element 642.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unwatched Repository Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unwatch",
      targetLabel: "Repository Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unwatch:control-state:repository-alpha-watch",
        detail: expect.objectContaining({
          action: "unwatch",
          source: "control_state_change",
          targetText: "Repository Alpha",
          text: "Control state changed to unwatched: Unwatch Repository Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts connect confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          650,
          "Connect Integration Alpha",
          "disconnected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          651,
          "Connect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Connect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Connected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "connect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:connect:control-state:integration-alpha-connect",
        detail: expect.objectContaining({
          action: "connect",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to connected: Connect Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts disconnect confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          652,
          "Disconnect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          653,
          "Disconnect Integration Alpha",
          "disconnected",
          "integration-alpha-connect",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Disconnect Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 652 },
      result: "Clicked element 652.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Disconnected Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "disconnect",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:disconnect:control-state:integration-alpha-connect",
        detail: expect.objectContaining({
          action: "disconnect",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to disconnected: Disconnect Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer connect confirmation when data-state was already connected", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          650,
          "Connect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Connect Integration Alpha",
      pageContent: "Integration Alpha Connect Integration Alpha",
      elements: [
        dataStateActionButton(
          651,
          "Connect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 650 },
      result: "Clicked element 650.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer disconnect confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          652,
          "Disconnect Integration Alpha",
          "disconnected",
          "integration-alpha-connect",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Disconnect Integration Alpha",
      pageContent: "Integration Alpha Disconnect Integration Alpha",
      elements: [
        dataStateActionButton(
          653,
          "Disconnect Integration Alpha",
          "connected",
          "integration-alpha-connect",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 652 },
      result: "Clicked element 652.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts install confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          654,
          "Install Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          655,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Install Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Installed Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "install",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:install:control-state:package-alpha-install",
        detail: expect.objectContaining({
          action: "install",
          source: "control_state_change",
          targetText: "Package Alpha",
          text: "Control state changed to installed: Install Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts uninstall confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          656,
          "Uninstall Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          657,
          "Uninstall Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Uninstall Package Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 656 },
      result: "Clicked element 656.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Uninstalled Package Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "uninstall",
      targetLabel: "Package Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:uninstall:control-state:package-alpha-install",
        detail: expect.objectContaining({
          action: "uninstall",
          source: "control_state_change",
          targetText: "Package Alpha",
          text: "Control state changed to uninstalled: Uninstall Package Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer install confirmation when data-state was already installed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          654,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Install Package Alpha",
      pageContent: "Package Alpha Install Package Alpha",
      elements: [
        dataStateActionButton(
          655,
          "Install Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 654 },
      result: "Clicked element 654.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer uninstall confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          656,
          "Uninstall Package Alpha",
          "uninstalled",
          "package-alpha-install",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Package Alpha Uninstall Package Alpha",
      pageContent: "Package Alpha Uninstall Package Alpha",
      elements: [
        dataStateActionButton(
          657,
          "Uninstall Package Alpha",
          "installed",
          "package-alpha-install",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 656 },
      result: "Clicked element 656.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts sync confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "unsynced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Sync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Synced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:sync:control-state:integration-alpha-sync",
        detail: expect.objectContaining({
          action: "sync",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to synced: Sync Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resync confirmation from stale data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Resync Integration Alpha",
      pageContent: "Integration Alpha Resync Integration Alpha",
      elements: [
        dataStateActionButton(
          660,
          "Resync Integration Alpha",
          "stale",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Resync Integration Alpha",
      pageContent: "Integration Alpha Resync Integration Alpha",
      elements: [
        dataStateActionButton(
          661,
          "Resync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Resync Integration Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 660 },
      result: "Clicked element 660.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resynced Integration Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "sync",
      targetLabel: "Integration Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:sync:control-state:integration-alpha-sync",
        detail: expect.objectContaining({
          action: "sync",
          source: "control_state_change",
          targetText: "Integration Alpha",
          text: "Control state changed to synced: Resync Integration Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer sync confirmation when data-state was already synced", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer sync confirmation when data-state flips stale", () => {
    const pre = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          658,
          "Sync Integration Alpha",
          "synced",
          "integration-alpha-sync",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Integration Alpha Sync Integration Alpha",
      pageContent: "Integration Alpha Sync Integration Alpha",
      elements: [
        dataStateActionButton(
          659,
          "Sync Integration Alpha",
          "stale",
          "integration-alpha-sync",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 658 },
      result: "Clicked element 658.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts link confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          662,
          "Link Account Alpha",
          "unlinked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          663,
          "Link Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Link Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 662 },
      result: "Clicked element 662.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Linked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "link",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:link:control-state:account-alpha-link",
        detail: expect.objectContaining({
          action: "link",
          source: "control_state_change",
          targetText: "Account Alpha",
          text: "Control state changed to linked: Link Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlink confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          664,
          "Unlink Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          665,
          "Unlink Account Alpha",
          "unlinked",
          "account-alpha-link",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlink Account Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 664 },
      result: "Clicked element 664.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unlinked Account Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unlink",
      targetLabel: "Account Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unlink:control-state:account-alpha-link",
        detail: expect.objectContaining({
          action: "unlink",
          source: "control_state_change",
          targetText: "Account Alpha",
          text: "Control state changed to unlinked: Unlink Account Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer link confirmation when data-state was already linked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          662,
          "Link Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Link Account Alpha",
      pageContent: "Account Alpha Link Account Alpha",
      elements: [
        dataStateActionButton(
          663,
          "Link Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 662 },
      result: "Clicked element 662.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlink confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          664,
          "Unlink Account Alpha",
          "unlinked",
          "account-alpha-link",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Account Alpha Unlink Account Alpha",
      pageContent: "Account Alpha Unlink Account Alpha",
      elements: [
        dataStateActionButton(
          665,
          "Unlink Account Alpha",
          "linked",
          "account-alpha-link",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 664 },
      result: "Clicked element 664.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts tag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          666,
          "Tag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          667,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Tag Record Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 666 },
      result: "Clicked element 666.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Tagged Record Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "tag",
      targetLabel: "Record Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:tag:control-state:record-alpha-tag",
        detail: expect.objectContaining({
          action: "tag",
          source: "control_state_change",
          targetText: "Record Alpha",
          text: "Control state changed to tagged: Tag Record Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts untag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          668,
          "Untag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          669,
          "Untag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Untag Record Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 668 },
      result: "Clicked element 668.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Untagged Record Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "untag",
      targetLabel: "Record Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:untag:control-state:record-alpha-tag",
        detail: expect.objectContaining({
          action: "untag",
          source: "control_state_change",
          targetText: "Record Alpha",
          text: "Control state changed to untagged: Untag Record Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts flag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          670,
          "Flag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          671,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Flag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 670 },
      result: "Clicked element 670.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Flagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "flag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:flag:control-state:message-alpha-flag",
        detail: expect.objectContaining({
          action: "flag",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to flagged: Flag Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unflag confirmation from data-state control state change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          672,
          "Unflag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          673,
          "Unflag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Unflag Message Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 672 },
      result: "Clicked element 672.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Unflagged Message Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "unflag",
      targetLabel: "Message Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey:
          "workflow:confirmation:unflag:control-state:message-alpha-flag",
        detail: expect.objectContaining({
          action: "unflag",
          source: "control_state_change",
          targetText: "Message Alpha",
          text: "Control state changed to unflagged: Unflag Message Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer tag confirmation when data-state was already tagged", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          666,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Tag Record Alpha",
      pageContent: "Record Alpha Tag Record Alpha",
      elements: [
        dataStateActionButton(
          667,
          "Tag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 666 },
      result: "Clicked element 666.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer untag confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          668,
          "Untag Record Alpha",
          "untagged",
          "record-alpha-tag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Record Alpha Untag Record Alpha",
      pageContent: "Record Alpha Untag Record Alpha",
      elements: [
        dataStateActionButton(
          669,
          "Untag Record Alpha",
          "tagged",
          "record-alpha-tag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 668 },
      result: "Clicked element 668.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer flag confirmation when data-state was already flagged", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          670,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Flag Message Alpha",
      pageContent: "Message Alpha Flag Message Alpha",
      elements: [
        dataStateActionButton(
          671,
          "Flag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 670 },
      result: "Clicked element 670.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unflag confirmation when data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          672,
          "Unflag Message Alpha",
          "unflagged",
          "message-alpha-flag",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Message Alpha Unflag Message Alpha",
      pageContent: "Message Alpha Unflag Message Alpha",
      elements: [
        dataStateActionButton(
          673,
          "Unflag Message Alpha",
          "flagged",
          "message-alpha-flag",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 672 },
      result: "Clicked element 672.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  for (const scenario of [
    {
      action: "subscribe",
      completion: "subscribed",
      label: "Subscribe to Channel Alpha",
      request: "Subscribe to Channel Alpha.",
      summary: "Subscribed to Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
      beforeState: "unsubscribed",
      afterState: "subscribed",
    },
    {
      action: "unsubscribe",
      completion: "unsubscribed",
      label: "Unsubscribe from Channel Alpha",
      request: "Unsubscribe from Channel Alpha.",
      summary: "Unsubscribed from Channel Alpha.",
      target: "Channel Alpha",
      id: "channel-alpha-subscribe",
      beforeState: "subscribed",
      afterState: "unsubscribed",
    },
    {
      action: "follow",
      completion: "followed",
      label: "Follow Project Alpha",
      request: "Follow Project Alpha.",
      summary: "Followed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
      beforeState: "unfollowed",
      afterState: "followed",
    },
    {
      action: "unfollow",
      completion: "unfollowed",
      label: "Unfollow Project Alpha",
      request: "Unfollow Project Alpha.",
      summary: "Unfollowed Project Alpha.",
      target: "Project Alpha",
      id: "project-alpha-follow",
      beforeState: "followed",
      afterState: "unfollowed",
    },
    {
      action: "bookmark",
      completion: "bookmarked",
      label: "Bookmark Article Alpha",
      request: "Bookmark Article Alpha.",
      summary: "Bookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
      beforeState: "unbookmarked",
      afterState: "bookmarked",
    },
    {
      action: "unbookmark",
      completion: "unbookmarked",
      label: "Unbookmark Article Alpha",
      request: "Unbookmark Article Alpha.",
      summary: "Unbookmarked Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-bookmark",
      beforeState: "bookmarked",
      afterState: "unbookmarked",
    },
    {
      action: "favorite",
      completion: "favorited",
      label: "Favorite Article Alpha",
      request: "Favorite Article Alpha.",
      summary: "Favorited Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-favorite",
      beforeState: "unfavorited",
      afterState: "favorited",
    },
    {
      action: "unfavorite",
      completion: "unfavorited",
      label: "Unfavorite Article Alpha",
      request: "Unfavorite Article Alpha.",
      summary: "Unfavorited Article Alpha.",
      target: "Article Alpha",
      id: "article-alpha-favorite",
      beforeState: "favorited",
      afterState: "unfavorited",
    },
    {
      action: "watch",
      completion: "watched",
      label: "Watch Repository Alpha",
      request: "Watch Repository Alpha.",
      summary: "Watched Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-watch",
      beforeState: "unwatched",
      afterState: "watched",
    },
    {
      action: "unwatch",
      completion: "unwatched",
      label: "Unwatch Repository Alpha",
      request: "Unwatch Repository Alpha.",
      summary: "Unwatched Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-watch",
      beforeState: "watched",
      afterState: "unwatched",
    },
    {
      action: "star",
      completion: "starred",
      label: "Star Repository Alpha",
      request: "Star Repository Alpha.",
      summary: "Starred Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-star",
      beforeState: "unstarred",
      afterState: "starred",
    },
    {
      action: "unstar",
      completion: "unstarred",
      label: "Unstar Repository Alpha",
      request: "Unstar Repository Alpha.",
      summary: "Unstarred Repository Alpha.",
      target: "Repository Alpha",
      id: "repository-alpha-star",
      beforeState: "starred",
      afterState: "unstarred",
    },
    {
      action: "pin",
      completion: "pinned",
      label: "Pin Report Alpha",
      request: "Pin Report Alpha.",
      summary: "Pinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
      beforeState: "unpinned",
      afterState: "pinned",
    },
    {
      action: "unpin",
      completion: "unpinned",
      label: "Unpin Report Alpha",
      request: "Unpin Report Alpha.",
      summary: "Unpinned Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-pin",
      beforeState: "pinned",
      afterState: "unpinned",
    },
    {
      action: "mute",
      completion: "muted",
      label: "Mute Thread Alpha",
      request: "Mute Thread Alpha.",
      summary: "Muted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
      beforeState: "unmuted",
      afterState: "muted",
    },
    {
      action: "unmute",
      completion: "unmuted",
      label: "Unmute Thread Alpha",
      request: "Unmute Thread Alpha.",
      summary: "Unmuted Thread Alpha.",
      target: "Thread Alpha",
      id: "thread-alpha-mute",
      beforeState: "muted",
      afterState: "unmuted",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            674,
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
            675,
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
        args: { id: 674 },
        result: "Clicked element 674.",
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

  test("does not infer subscribe confirmation when semantic data-state was already subscribed", () => {
    const pre = workflowSnapshot({
      visibleContent: "Channel Alpha Subscribe to Channel Alpha",
      pageContent: "Channel Alpha Subscribe to Channel Alpha",
      elements: [
        dataStateActionButton(
          674,
          "Subscribe to Channel Alpha",
          "subscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Channel Alpha Subscribe to Channel Alpha",
      pageContent: "Channel Alpha Subscribe to Channel Alpha",
      elements: [
        dataStateActionButton(
          675,
          "Subscribe to Channel Alpha",
          "subscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 674 },
      result: "Clicked element 674.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unsubscribe confirmation when semantic data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Channel Alpha Unsubscribe from Channel Alpha",
      pageContent: "Channel Alpha Unsubscribe from Channel Alpha",
      elements: [
        dataStateActionButton(
          676,
          "Unsubscribe from Channel Alpha",
          "unsubscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Channel Alpha Unsubscribe from Channel Alpha",
      pageContent: "Channel Alpha Unsubscribe from Channel Alpha",
      elements: [
        dataStateActionButton(
          677,
          "Unsubscribe from Channel Alpha",
          "subscribed",
          "channel-alpha-subscribe",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 676 },
      result: "Clicked element 676.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer pin confirmation when semantic data-state was already pinned", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Pin Report Alpha",
      pageContent: "Report Alpha Pin Report Alpha",
      elements: [
        dataStateActionButton(
          678,
          "Pin Report Alpha",
          "pinned",
          "report-alpha-pin",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Pin Report Alpha",
      pageContent: "Report Alpha Pin Report Alpha",
      elements: [
        dataStateActionButton(
          679,
          "Pin Report Alpha",
          "pinned",
          "report-alpha-pin",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 678 },
      result: "Clicked element 678.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unmute confirmation when semantic data-state flips on", () => {
    const pre = workflowSnapshot({
      visibleContent: "Thread Alpha Unmute Thread Alpha",
      pageContent: "Thread Alpha Unmute Thread Alpha",
      elements: [
        dataStateActionButton(
          680,
          "Unmute Thread Alpha",
          "unmuted",
          "thread-alpha-mute",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Thread Alpha Unmute Thread Alpha",
      pageContent: "Thread Alpha Unmute Thread Alpha",
      elements: [
        dataStateActionButton(
          681,
          "Unmute Thread Alpha",
          "muted",
          "thread-alpha-mute",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 680 },
      result: "Clicked element 680.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

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

  test("does not infer bookmark confirmation when data-state was already checked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          640,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          641,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer bookmark confirmation when data-state flips off", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          640,
          "Bookmark Article Beta",
          "checked",
          "article-beta-bookmark",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Article Beta Bookmark Article Beta",
      pageContent: "Article Beta Bookmark Article Beta",
      elements: [
        dataStateActionButton(
          641,
          "Bookmark Article Beta",
          "unchecked",
          "article-beta-bookmark",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 640 },
      result: "Clicked element 640.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer lock confirmation when control state flips the wrong direction", () => {
    const pre = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(624, "Lock account", true, "account-lock")],
    });
    const current = workflowSnapshot({
      visibleContent: "Security settings Lock account",
      pageContent: "Security settings Lock account",
      elements: [statefulActionButton(625, "Lock account", false, "account-lock")],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 624 },
      result: "Clicked element 624.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
