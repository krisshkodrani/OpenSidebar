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

describe("completion kernel workflow status lock control-action confirmation", () => {
  test("accepts lock confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Active Lock account",
      pageContent: "Account ACCT001 Status: Active Lock account",
      elements: [actionButton(614, "Lock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked",
      pageContent: "Account ACCT001 Status: Locked",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Lock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 614 },
      result: "Clicked element 614.",
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
        logicalKey: "workflow:confirmation:lock:status:status-locked",
        detail: expect.objectContaining({
          action: "lock",
          source: "status_change",
          text: "Status: Locked",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("accepts unlock confirmation from same-page status change", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked Unlock account",
      pageContent: "Account ACCT001 Status: Locked Unlock account",
      elements: [actionButton(615, "Unlock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked",
      pageContent: "Account ACCT001 Status: Unlocked",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Unlock the account.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 615 },
      result: "Clicked element 615.",
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
        logicalKey: "workflow:confirmation:unlock:status:status-unlocked",
        detail: expect.objectContaining({
          action: "unlock",
          source: "status_change",
          text: "Status: Unlocked",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("does not infer lock confirmation when status was already locked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked Lock account",
      pageContent: "Account ACCT001 Status: Locked Lock account",
      elements: [actionButton(614, "Lock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Locked",
      pageContent: "Account ACCT001 Status: Locked",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 614 },
      result: "Clicked element 614.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer unlock confirmation when status was already unlocked", () => {
    const pre = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked Unlock account",
      pageContent: "Account ACCT001 Status: Unlocked Unlock account",
      elements: [actionButton(615, "Unlock account")],
    });
    const current = workflowSnapshot({
      visibleContent: "Account ACCT001 Status: Unlocked",
      pageContent: "Account ACCT001 Status: Unlocked",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 615 },
      result: "Clicked element 615.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("keeps locked status questions as read-answer contracts", () => {
    const snap = workflowSnapshot({
      title: "Account Matrix",
      url: "https://example.test/accounts",
      visibleContent: "Account Matrix Account locked: Yes Priority: High",
      pageContent:
        "Account Matrix Account locked: Yes. Priority: High. The page explains access coverage, account policy, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer account questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is the account locked?",
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
      expectedAnswerLabel: "account locked",
    });
    expect(decision.status).toBe("accepted");
  });
});
