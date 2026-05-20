import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot } from "../../src/types";

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

function modalSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return workflowSnapshot({
    title: "Newsletter",
    visibleContent: "Newsletter popup Stay updated Close",
    pageContent: "Newsletter popup Stay updated Close",
    elements: [
      {
        tag: 401,
        tagName: "div",
        role: "dialog",
        text: "Newsletter popup Stay updated",
        attributes: {
          id: "newsletter-modal",
          "aria-modal": "true",
          "aria-label": "Newsletter popup",
        },
        rect: { x: 120, y: 80, width: 420, height: 260 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 402,
        tagName: "button",
        role: "button",
        text: "Close",
        attributes: {
          id: "close-newsletter",
          "aria-label": "Close newsletter popup",
        },
        rect: { x: 500, y: 90, width: 32, height: 32 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    ...overrides,
  });
}

describe("completion kernel modal workflow confirmation", () => {
  test("accepts modal dismissal from pre/post dialog disappearance evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Close the newsletter popup.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed the newsletter popup.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: expect.stringContaining("workflow:confirmation:dismiss"),
        detail: expect.objectContaining({
          action: "dismiss",
          source: "modal_disappearance",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("treats cancel-dialog requests as modal dismissal, not workflow cancellation", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Cancel the newsletter dialog.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Canceled the newsletter dialog.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        detail: expect.objectContaining({
          action: "dismiss",
          source: "modal_disappearance",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts modal dismissal from hide_element overlay disappearance evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Hide the newsletter popup.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.HIDE_ELEMENT,
      args: { id: 401 },
      result: 'Hidden element [401] <div> "Newsletter popup Stay updated"',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Hid the newsletter popup.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: expect.stringContaining("workflow:confirmation:dismiss"),
        detail: expect.objectContaining({
          action: "dismiss",
          source: "modal_disappearance",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts modal dismissal from dismiss_overlays disappearance evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Dismiss the newsletter overlay.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.DISMISS_OVERLAYS,
      args: {},
      result: "Dismissed 1 overlay(s).",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Dismissed the newsletter overlay.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "dismiss",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        detail: expect.objectContaining({
          action: "dismiss",
          source: "modal_disappearance",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer modal dismissal from rejected hide_element result", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Newsletter",
      visibleContent: "Account settings",
      pageContent: "Account settings",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.HIDE_ELEMENT,
      args: { id: 401 },
      result:
        'Element [401] <div> is not an overlay and has no overlay ancestor. Try press_key("Escape") or click a close button.',
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    expect(evidence).toEqual([]);
  });

  test("does not treat modal disappearance during navigation as dismissal evidence", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      url: "https://example.test/next",
      visibleContent: "Next page",
      pageContent: "Next page",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer modal dismissal from a standalone close button", () => {
    const pre = workflowSnapshot({
      visibleContent: "Newsletter controls Close popup",
      pageContent: "Newsletter controls Close popup",
      elements: [
        {
          tag: 402,
          tagName: "button",
          role: "button",
          text: "Close",
          attributes: {
            id: "close-newsletter-popup",
            "aria-label": "Close newsletter popup",
          },
          rect: { x: 500, y: 90, width: 32, height: 32 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Newsletter controls",
      pageContent: "Newsletter controls",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    expect(evidence).toEqual([]);
  });

  test("does not generate modal dismissal contracts for compound follow-up work", () => {
    const generated = generateCompletionContract({
      userRequest:
        "Dismiss the newsletter popup, then fill in the email field.",
      snapshot: modalSnapshot(),
    });

    expect(generated).toBeNull();
  });

  test("does not accept close-record workflows from modal disappearance", () => {
    const pre = modalSnapshot();
    const current = workflowSnapshot({
      title: "Incident",
      visibleContent: "Incident form",
      pageContent: "Incident form",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Close the incident record.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 402 },
      result: "Clicked element 402.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 8,
    });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Closed the incident record.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "close",
    });
    expect(decision.status).toBe("needs_verification");
  });
});
