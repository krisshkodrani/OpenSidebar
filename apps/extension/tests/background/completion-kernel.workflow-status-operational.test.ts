import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
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
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      "aria-label": label,
    },
    rect: { x: 0, y: tag * 20, width: 120, height: 28 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel operational workflow status confirmation", () => {
  test("accepts pause confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Running Pause job",
      pageContent: "Sync job SYNC001 Status: Running Pause job",
      elements: [actionButton(624, "Pause job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused",
      pageContent: "Sync job SYNC001 Status: Paused",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Pause the job.",
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
      summary: "Paused the job.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "pause",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:pause:status:status-paused",
        detail: expect.objectContaining({
          action: "pause",
          source: "status_change",
          text: "Status: Paused",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts resume confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused Resume job",
      pageContent: "Sync job SYNC001 Status: Paused Resume job",
      elements: [actionButton(625, "Resume job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Running",
      pageContent: "Sync job SYNC001 Status: Running",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Resume the job.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 625 },
      result: "Clicked element 625.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Resumed the job.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "resume",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:resume:status:status-running",
        detail: expect.objectContaining({
          action: "resume",
          source: "status_change",
          text: "Status: Running",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer pause confirmation when status was already paused", () => {
    const pre = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused Pause job",
      pageContent: "Sync job SYNC001 Status: Paused Pause job",
      elements: [actionButton(624, "Pause job")],
    });
    const current = workflowSnapshot({
      visibleContent: "Sync job SYNC001 Status: Paused",
      pageContent: "Sync job SYNC001 Status: Paused",
      elements: [],
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

  test("keeps paused status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Sync Matrix",
      url: "https://example.test/sync",
      visibleContent: "Sync Matrix Sync paused: Yes Owner: platform operations",
      pageContent:
        "Sync Matrix Sync paused: Yes. Owner: platform operations. The page explains job coverage, sync policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer sync questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the sync paused?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sync paused",
    });
    expect(decision.status).toBe("accepted");
  });

});
