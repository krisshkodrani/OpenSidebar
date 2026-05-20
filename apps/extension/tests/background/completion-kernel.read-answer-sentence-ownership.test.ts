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

describe("completion kernel sentence-scoped ownership read-answer", () => {
  test("accepts sentence-scoped assigned-to answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is assigned to Maya Chen. Ticket Beta is assigned to Ravi Shah.",
      pageContent:
        "Ticket Alpha is assigned to Maya Chen. Ticket Beta is assigned to Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha assigned to?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use passive relation sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha is assigned to Maya Chen Ticket Beta is assigned to Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha is assigned to Maya Chen. Ticket Beta is assigned to Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha assigned to?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped assigned-to answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is assigned to Maya Chen. Ticket Beta is assigned to Ravi Shah.",
      pageContent:
        "Ticket Alpha is assigned to Maya Chen. Ticket Beta is assigned to Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha assigned to?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha is assigned to Maya Chen. Ticket Beta is assigned to Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped assigned-to answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is assigned to Ticket Alpha. Ravi Shah is assigned to Ticket Beta.",
      pageContent:
        "Maya Chen is assigned to Ticket Alpha. Ravi Shah is assigned to Ticket Beta. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use active-voice sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Maya Chen is assigned to Ticket Alpha Ravi Shah is assigned to Ticket Beta",
      pageContent:
        "Ticket Queue Maya Chen is assigned to Ticket Alpha. Ravi Shah is assigned to Ticket Beta. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
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

  test("accepts active-voice sentence-scoped assigned-to answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is assigned to Ticket Alpha. Ravi Shah is assigned to Ticket Beta.",
      pageContent:
        "Maya Chen is assigned to Ticket Alpha. Ravi Shah is assigned to Ticket Beta. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen is assigned to Ticket Alpha. Ravi Shah is assigned to Ticket Beta. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped responsible-for answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is responsible for Ticket Alpha. Ravi Shah is responsible for Ticket Beta.",
      pageContent:
        "Maya Chen is responsible for Ticket Alpha. Ravi Shah is responsible for Ticket Beta. The page explains ticket responsibility, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is responsible for Ticket Alpha?",
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
      expectedAnswerLabel: "responsible party",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use active-voice responsible-for sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Maya Chen is responsible for Ticket Alpha Ravi Shah is responsible for Ticket Beta",
      pageContent:
        "Ticket Queue Maya Chen is responsible for Ticket Alpha. Ravi Shah is responsible for Ticket Beta. The page explains ticket responsibility, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is responsible for Ticket Alpha?",
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

  test("accepts active-voice sentence-scoped responsible-for answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is responsible for Ticket Alpha. Ravi Shah is responsible for Ticket Beta.",
      pageContent:
        "Maya Chen is responsible for Ticket Alpha. Ravi Shah is responsible for Ticket Beta. The page explains ticket responsibility, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is responsible for Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen is responsible for Ticket Alpha. Ravi Shah is responsible for Ticket Beta. The page explains ticket responsibility, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "responsible party",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped accountable-for answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is accountable for Ticket Alpha. Ravi Shah is accountable for Ticket Beta.",
      pageContent:
        "Maya Chen is accountable for Ticket Alpha. Ravi Shah is accountable for Ticket Beta. The page explains ticket accountability, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is accountable for Ticket Alpha?",
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
      expectedAnswerLabel: "accountable party",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use active-voice accountable-for sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Maya Chen is accountable for Ticket Alpha Ravi Shah is accountable for Ticket Beta",
      pageContent:
        "Ticket Queue Maya Chen is accountable for Ticket Alpha. Ravi Shah is accountable for Ticket Beta. The page explains ticket accountability, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is accountable for Ticket Alpha?",
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

  test("accepts active-voice sentence-scoped accountable-for answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen is accountable for Ticket Alpha. Ravi Shah is accountable for Ticket Beta.",
      pageContent:
        "Maya Chen is accountable for Ticket Alpha. Ravi Shah is accountable for Ticket Beta. The page explains ticket accountability, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is accountable for Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen is accountable for Ticket Alpha. Ravi Shah is accountable for Ticket Beta. The page explains ticket accountability, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "accountable party",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not treat bare assigned action as active assignee evidence", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen assigned Ticket Alpha. Ravi Shah assigned Ticket Beta.",
      pageContent:
        "Maya Chen assigned Ticket Alpha. Ravi Shah assigned Ticket Beta. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
      snapshot: snap,
    });

    expect(generated?.contract).not.toMatchObject({
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
  });

  test("accepts possessive sentence-scoped assignee answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha's assignee is Maya Chen. Ticket Beta's assignee is Ravi Shah.",
      pageContent:
        "Ticket Alpha's assignee is Maya Chen. Ticket Beta's assignee is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use possessive sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha's assignee is Maya Chen Ticket Beta's assignee is Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha's assignee is Maya Chen. Ticket Beta's assignee is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts possessive sentence-scoped assignee answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha's assignee is Maya Chen. Ticket Beta's assignee is Ravi Shah.",
      pageContent:
        "Ticket Alpha's assignee is Maya Chen. Ticket Beta's assignee is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha's assignee is Maya Chen. Ticket Beta's assignee is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style possessive sentence-scoped assignee answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha's assignee: Maya Chen. Ticket Beta's assignee: Ravi Shah.",
      pageContent:
        "Ticket Alpha's assignee: Maya Chen. Ticket Beta's assignee: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style possessive sentence-scoped assignee answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha's assignee: Maya Chen. Ticket Beta's assignee: Ravi Shah.",
      pageContent:
        "Ticket Alpha's assignee: Maya Chen. Ticket Beta's assignee: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha's assignee: Maya Chen. Ticket Beta's assignee: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts relation-noun sentence-scoped assignee answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Assignee for Ticket Alpha is Maya Chen. Assignee for Ticket Beta is Ravi Shah.",
      pageContent:
        "Assignee for Ticket Alpha is Maya Chen. Assignee for Ticket Beta is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts relation-noun sentence-scoped assignee answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Assignee for Ticket Alpha is Maya Chen. Assignee for Ticket Beta is Ravi Shah.",
      pageContent:
        "Assignee for Ticket Alpha is Maya Chen. Assignee for Ticket Beta is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nAssignee for Ticket Alpha is Maya Chen. Assignee for Ticket Beta is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style relation-noun sentence-scoped assignee answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Assignee for Ticket Alpha: Maya Chen. Assignee for Ticket Beta: Ravi Shah.",
      pageContent:
        "Assignee for Ticket Alpha: Maya Chen. Assignee for Ticket Beta: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style relation-noun sentence-scoped assignee answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Assignee for Ticket Alpha: Maya Chen. Assignee for Ticket Beta: Ravi Shah.",
      pageContent:
        "Assignee for Ticket Alpha: Maya Chen. Assignee for Ticket Beta: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nAssignee for Ticket Alpha: Maya Chen. Assignee for Ticket Beta: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use relation-noun sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Assignee for Ticket Alpha: Maya Chen Assignee for Ticket Beta: Ravi Shah",
      pageContent:
        "Ticket Queue Assignee for Ticket Alpha: Maya Chen. Assignee for Ticket Beta: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is assigned to Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts target-relation sentence-scoped assignee answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha assignee is Maya Chen. Ticket Beta assignee is Ravi Shah.",
      pageContent:
        "Ticket Alpha assignee is Maya Chen. Ticket Beta assignee is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target-relation sentence-scoped assignee answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha assignee is Maya Chen. Ticket Beta assignee is Ravi Shah.",
      pageContent:
        "Ticket Alpha assignee is Maya Chen. Ticket Beta assignee is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha assignee is Maya Chen. Ticket Beta assignee is Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-relation sentence-scoped assignee answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha assignee: Maya Chen. Ticket Beta assignee: Ravi Shah.",
      pageContent:
        "Ticket Alpha assignee: Maya Chen. Ticket Beta assignee: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-relation sentence-scoped assignee answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha assignee: Maya Chen. Ticket Beta assignee: Ravi Shah.",
      pageContent:
        "Ticket Alpha assignee: Maya Chen. Ticket Beta assignee: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha assignee: Maya Chen. Ticket Beta assignee: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "assignee",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use target-relation sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha assignee: Maya Chen Ticket Beta assignee: Ravi Shah",
      pageContent:
        "Ticket Queue Ticket Alpha assignee: Maya Chen. Ticket Beta assignee: Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Ticket Alpha's assignee?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped owned-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is owned by Maya Chen. Ticket Beta is owned by Ravi Shah.",
      pageContent:
        "Ticket Alpha is owned by Maya Chen. Ticket Beta is owned by Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who owns Ticket Alpha?",
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

  test("accepts sentence-scoped owned-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is owned by Maya Chen. Ticket Beta is owned by Ravi Shah.",
      pageContent:
        "Ticket Alpha is owned by Maya Chen. Ticket Beta is owned by Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who owns Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha is owned by Maya Chen. Ticket Beta is owned by Ravi Shah. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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

  test("accepts active-voice sentence-scoped owns answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen owns Ticket Alpha. Ravi Shah owns Ticket Beta.",
      pageContent:
        "Maya Chen owns Ticket Alpha. Ravi Shah owns Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who owns Ticket Alpha?",
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

  test("accepts active-voice sentence-scoped owns answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen owns Ticket Alpha. Ravi Shah owns Ticket Beta.",
      pageContent:
        "Maya Chen owns Ticket Alpha. Ravi Shah owns Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who owns Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen owns Ticket Alpha. Ravi Shah owns Ticket Beta. The page explains ticket ownership, ticket assignment, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
