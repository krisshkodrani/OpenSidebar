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

describe("completion kernel workflow control-state semantic persistence action confirmation", () => {
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

});
