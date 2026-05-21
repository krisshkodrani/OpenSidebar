import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
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

describe("completion kernel sentence-scoped field relation read-answer", () => {
  test("accepts sentence-scoped status answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is open. Ticket Beta is closed.",
      pageContent:
        "Ticket Alpha is open. Ticket Beta is closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the status for Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use status sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha is open Ticket Beta is closed",
      pageContent:
        "Ticket Queue Ticket Alpha is open. Ticket Beta is closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the status for Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped status answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha status is Open. Ticket Beta status is Closed.",
      pageContent:
        "Ticket Alpha status is Open. Ticket Beta status is Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's status?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha status is Open. Ticket Beta status is Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-status sentence-scoped answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed.",
      pageContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's status?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-status sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed.",
      pageContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's status?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha status: Open. Ticket Beta status: Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });
});
