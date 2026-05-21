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
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "data-state": state,
    },
  };
}

describe("completion kernel workflow control-state semantic create/dismiss action confirmation", () => {
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
        logicalKey:
          "workflow:confirmation:create:control-state:customer-alpha-create",
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
});
