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

describe("completion kernel sentence-scoped relation read-answer", () => {
  test("accepts sentence-scoped contact answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo contact is Maya Chen. Project Borealis contact is Ravi Shah.",
      pageContent:
        "Project Apollo contact is Maya Chen. Project Borealis contact is Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
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
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped point-of-contact answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo's point of contact is Security Desk. Project Borealis's point of contact is Regional QA.",
      pageContent:
        "Project Apollo's point of contact is Security Desk. Project Borealis's point of contact is Regional QA. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo's point of contact?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo's point of contact is Security Desk. Project Borealis's point of contact is Regional QA. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Security Desk",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style sentence-scoped contact answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah.",
      pageContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
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
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style sentence-scoped contact answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah.",
      pageContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nContact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
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
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-contact sentence-scoped answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah.",
      pageContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
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
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-contact sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah.",
      pageContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
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
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped requested answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta.",
      pageContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who requested Ticket Alpha?",
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
      expectedAnswerLabel: "requester",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped requested answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta.",
      pageContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who requested Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "requester",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reported answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta.",
      pageContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reported Ticket Alpha?",
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
      expectedAnswerLabel: "reporter",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reported answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta.",
      pageContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reported Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "reporter",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped reported-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was reported by Maya Chen. Ticket Beta was reported by Ravi Shah.",
      pageContent:
        "Ticket Alpha was reported by Maya Chen. Ticket Beta was reported by Ravi Shah. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reported Ticket Alpha?",
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
      expectedAnswerLabel: "reporter",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped requested-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was requested by Maya Chen. Ticket Beta was requested by Ravi Shah.",
      pageContent:
        "Ticket Alpha was requested by Maya Chen. Ticket Beta was requested by Ravi Shah. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who requested Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha was requested by Maya Chen. Ticket Beta was requested by Ravi Shah. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "requester",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped created answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta.",
      pageContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who created Ticket Alpha?",
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
      expectedAnswerLabel: "creator",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped created answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta.",
      pageContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who created Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen created Ticket Alpha. Ravi Shah created Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "creator",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped created-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was created by Maya Chen. Ticket Beta was created by Ravi Shah.",
      pageContent:
        "Ticket Alpha was created by Maya Chen. Ticket Beta was created by Ravi Shah. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who created Ticket Alpha?",
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
      expectedAnswerLabel: "creator",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped opened answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta.",
      pageContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who opened Ticket Alpha?",
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
      expectedAnswerLabel: "opener",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped opened answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta.",
      pageContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who opened Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "opener",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped opened-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was opened by Maya Chen. Ticket Beta was opened by Ravi Shah.",
      pageContent:
        "Ticket Alpha was opened by Maya Chen. Ticket Beta was opened by Ravi Shah. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who opened Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha was opened by Maya Chen. Ticket Beta was opened by Ravi Shah. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "opener",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped approved answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta.",
      pageContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who approved Ticket Alpha?",
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
      expectedAnswerLabel: "approver",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped approved answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta.",
      pageContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who approved Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "approver",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped approved-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was approved by Maya Chen. Ticket Beta was approved by Ravi Shah.",
      pageContent:
        "Ticket Alpha was approved by Maya Chen. Ticket Beta was approved by Ravi Shah. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who approved Ticket Alpha?",
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
      expectedAnswerLabel: "approver",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reviewed answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta.",
      pageContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reviewed Ticket Alpha?",
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
      expectedAnswerLabel: "reviewer",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reviewed answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta.",
      pageContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reviewed Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "reviewer",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped reviewed-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was reviewed by Maya Chen. Ticket Beta was reviewed by Ravi Shah.",
      pageContent:
        "Ticket Alpha was reviewed by Maya Chen. Ticket Beta was reviewed by Ravi Shah. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reviewed Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha was reviewed by Maya Chen. Ticket Beta was reviewed by Ravi Shah. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
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
      expectedAnswerLabel: "reviewer",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use target-contact sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Queue",
      url: "https://example.test/projects",
      visibleContent:
        "Project Queue Project Apollo contact: Maya Chen Project Borealis contact: Ravi Shah",
      pageContent:
        "Project Queue Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
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

  test("does not use contact-for sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Queue",
      url: "https://example.test/projects",
      visibleContent:
        "Project Queue Contact for Project Apollo: Maya Chen Contact for Project Borealis: Ravi Shah",
      pageContent:
        "Project Queue Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
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


});
