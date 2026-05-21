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

describe("completion kernel display predicate-variant owner-role read-answer", () => {
  test("accepts identified-as predicate-noun sentence-scoped owner answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is identified as the owner of Ticket Alpha. Ravi Shah is identified as the owner of Ticket Beta.",
      pageContent:
        "Maya Chen is identified as the owner of Ticket Alpha. Ravi Shah is identified as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the owner of Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use identified-as owner sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Maya Chen is identified as the owner of Ticket Alpha Ravi Shah is identified as the owner of Ticket Beta",
      pageContent:
        "Ticket Queue Maya Chen is identified as the owner of Ticket Alpha. Ravi Shah is identified as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the owner of Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ticket Queue Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts identified-as predicate-noun owner answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is identified as the owner of Ticket Alpha. Ravi Shah is identified as the owner of Ticket Beta.",
      pageContent:
        "Maya Chen is identified as the owner of Ticket Alpha. Ravi Shah is identified as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the owner of Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen is identified as the owner of Ticket Alpha. Ravi Shah is identified as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts shown-as predicate-noun sentence-scoped owner answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is shown as the owner of Ticket Alpha. Ravi Shah is shown as the owner of Ticket Beta.",
      pageContent:
        "Maya Chen is shown as the owner of Ticket Alpha. Ravi Shah is shown as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the owner of Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use shown-as owner sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Maya Chen is shown as the owner of Ticket Alpha Ravi Shah is shown as the owner of Ticket Beta",
      pageContent:
        "Ticket Queue Maya Chen is shown as the owner of Ticket Alpha. Ravi Shah is shown as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the owner of Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ticket Queue Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts shown-as predicate-noun owner answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is shown as the owner of Ticket Alpha. Ravi Shah is shown as the owner of Ticket Beta.",
      pageContent:
        "Maya Chen is shown as the owner of Ticket Alpha. Ravi Shah is shown as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the owner of Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen is shown as the owner of Ticket Alpha. Ravi Shah is shown as the owner of Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner",
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
