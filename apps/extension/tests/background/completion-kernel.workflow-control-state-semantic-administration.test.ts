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
});
