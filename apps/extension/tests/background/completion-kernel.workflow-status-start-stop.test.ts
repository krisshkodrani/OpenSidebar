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

describe("completion kernel start/stop workflow status confirmation", () => {
  test("accepts start confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped Start service",
      pageContent: "Worker service SVC001 Status: Stopped Start service",
      elements: [actionButton(626, "Start service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Running",
      pageContent: "Worker service SVC001 Status: Running",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Start the service.",
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
      summary: "Started the service.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "start",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:start:status:status-running",
        detail: expect.objectContaining({
          action: "start",
          source: "status_change",
          text: "Status: Running",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts stop confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Running Stop service",
      pageContent: "Worker service SVC001 Status: Running Stop service",
      elements: [actionButton(627, "Stop service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped",
      pageContent: "Worker service SVC001 Status: Stopped",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Stop the service.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 627 },
      result: "Clicked element 627.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Stopped the service.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "stop",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:stop:status:status-stopped",
        detail: expect.objectContaining({
          action: "stop",
          source: "status_change",
          text: "Status: Stopped",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer stop confirmation when status was already stopped", () => {
    const pre = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped Stop service",
      pageContent: "Worker service SVC001 Status: Stopped Stop service",
      elements: [actionButton(627, "Stop service")],
    });
    const current = workflowSnapshot({
      visibleContent: "Worker service SVC001 Status: Stopped",
      pageContent: "Worker service SVC001 Status: Stopped",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 627 },
      result: "Clicked element 627.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps stopped status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Service Matrix",
      url: "https://example.test/service",
      visibleContent: "Service Matrix Service stopped: Yes Owner: platform operations",
      pageContent:
        "Service Matrix Service stopped: Yes. Owner: platform operations. The page explains service coverage, service policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer service questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the service stopped?",
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
      expectedAnswerLabel: "service stopped",
    });
    expect(decision.status).toBe("accepted");
  });

  test("keeps restart requirement questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Service Matrix",
      url: "https://example.test/service",
      visibleContent:
        "Service Matrix Restart required: No Owner: platform operations",
      pageContent:
        "Service Matrix Restart required: No. Owner: platform operations. The page explains service coverage, restart policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer service questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is restart required?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "restart required",
    });
    expect(decision.status).toBe("accepted");
  });

  test("keeps refresh rate questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Monitor Matrix",
      url: "https://example.test/monitor",
      visibleContent:
        "Monitor Matrix Refresh rate: 60Hz Owner: platform operations",
      pageContent:
        "Monitor Matrix Refresh rate: 60Hz. Owner: platform operations. The page explains monitor coverage, refresh policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer monitor questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the refresh rate?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "refresh rate",
    });
    expect(decision.status).toBe("accepted");
  });
});
