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

describe("completion kernel workflow control-state semantic object action confirmation", () => {
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
});
