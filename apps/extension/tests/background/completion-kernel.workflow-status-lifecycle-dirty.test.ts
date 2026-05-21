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

describe("completion kernel workflow lifecycle confirmation", () => {
  test("accepts publish confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article ART001 Status: Draft Publish article",
      pageContent: "Article ART001 Status: Draft Publish article",
      elements: [actionButton(616, "Publish article")],
    });
    const current = workflowSnapshot({
      visibleContent: "Article ART001 Status: Published",
      pageContent: "Article ART001 Status: Published",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Publish the article.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 616 },
      result: "Clicked element 616.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Published the article.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "post",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:post:status:status-published",
        detail: expect.objectContaining({
          action: "post",
          source: "status_change",
          text: "Status: Published",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer publish confirmation when status was already published", () => {
    const pre = workflowSnapshot({
      visibleContent: "Article ART001 Status: Published Publish article",
      pageContent: "Article ART001 Status: Published Publish article",
      elements: [actionButton(616, "Publish article")],
    });
    const current = workflowSnapshot({
      visibleContent: "Article ART001 Status: Published",
      pageContent: "Article ART001 Status: Published",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 616 },
      result: "Clicked element 616.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps published status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Article Matrix",
      url: "https://example.test/articles",
      visibleContent: "Article Matrix Article published: Yes Priority: High",
      pageContent:
        "Article Matrix Article published: Yes. Priority: High. The page explains article status, review policy, customer impact, response timing, audit notes, routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer article questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the article published?",
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
      expectedAnswerLabel: "article published",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts submit confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Draft Submit request",
      pageContent: "Request REQ004 Status: Draft Submit request",
      elements: [actionButton(605, "Submit request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Submitted",
      pageContent: "Request REQ004 Status: Submitted",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Submit the request.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 605 },
      result: "Clicked element 605.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Submitted the request.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "submit",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:submit:status:status-submitted",
        detail: expect.objectContaining({
          action: "submit",
          source: "status_change",
          text: "Status: Submitted",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer submit status-change confirmation when status was already submitted", () => {
    const pre = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Submitted Submit request",
      pageContent: "Request REQ004 Status: Submitted Submit request",
      elements: [actionButton(605, "Submit request")],
    });
    const current = workflowSnapshot({
      visibleContent: "Request REQ004 Status: Submitted",
      pageContent: "Request REQ004 Status: Submitted",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 605 },
      result: "Clicked element 605.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("accepts mark-complete confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Task TASK001 Status: In Progress Mark task complete",
      pageContent: "Task TASK001 Status: In Progress Mark task complete",
      elements: [actionButton(606, "Mark task complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Task TASK001 Status: Completed",
      pageContent: "Task TASK001 Status: Completed",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 606 },
      result: "Clicked element 606.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:status:status-completed",
        detail: expect.objectContaining({
          action: "complete",
          source: "status_change",
          text: "Status: Completed",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects target-aware mark-complete status-change confirmation for a different target", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Task TASK001 Status: In Progress\nTask TASK002 Status: In Progress\nMark task complete",
      pageContent:
        "Task TASK001 Status: In Progress\nTask TASK002 Status: In Progress\nMark task complete",
      elements: [actionButton(606, "Mark task complete")],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Task TASK001 Status: In Progress\nTask TASK002 Status: Completed",
      pageContent:
        "Task TASK001 Status: In Progress\nTask TASK002 Status: Completed",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Mark TASK001 complete.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 606 },
      result: "Clicked element 606.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Marked TASK001 complete.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "complete",
      targetLabel: "TASK001",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:complete:status:status-completed",
        detail: expect.objectContaining({
          action: "complete",
          source: "status_change",
          targetText: "Task TASK002",
          text: "Status: Completed",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer mark-complete confirmation when status was already complete", () => {
    const pre = workflowSnapshot({
      visibleContent: "Task TASK001 Status: Completed Mark task complete",
      pageContent: "Task TASK001 Status: Completed Mark task complete",
      elements: [actionButton(606, "Mark task complete")],
    });
    const current = workflowSnapshot({
      visibleContent: "Task TASK001 Status: Completed",
      pageContent: "Task TASK001 Status: Completed",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 606 },
      result: "Clicked element 606.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not generate complete workflow contract for generic form-completion wording", () => {
    const generated = generateCompletionContract({
      userRequest: "Complete the profile form.",
      snapshot: workflowSnapshot(),
    });

    expect(generated).toBeNull();
  });

  test("does not generate complete workflow contract for reporting a complete state", () => {
    const generated = generateCompletionContract({
      userRequest: "Report that the task is complete.",
      snapshot: workflowSnapshot(),
    });

    expect(generated).toBeNull();
  });
});
