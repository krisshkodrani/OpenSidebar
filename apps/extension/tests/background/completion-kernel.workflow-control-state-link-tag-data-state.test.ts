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

describe("completion kernel workflow link data-state confirmation", () => {
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
});
