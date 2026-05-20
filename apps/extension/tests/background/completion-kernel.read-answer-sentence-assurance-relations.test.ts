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

describe("completion kernel sentence-scoped assurance relation read-answer", () => {
  test("accepts active-voice sentence-scoped audits answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Compliance Office audits Project Apollo. Regional Audit audits Project Borealis.",
      pageContent:
        "Compliance Office audits Project Apollo. Regional Audit audits Project Borealis. The page explains project ownership, audit routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who audits Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Compliance Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Audit",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "auditor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped audits answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Compliance Office audits Project Apollo. Regional Audit audits Project Borealis.",
      pageContent:
        "Compliance Office audits Project Apollo. Regional Audit audits Project Borealis. The page explains project ownership, audit routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who audits Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCompliance Office audits Project Apollo. Regional Audit audits Project Borealis. The page explains project ownership, audit routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Compliance Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Audit",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "auditor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped audited-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is audited by Compliance Office. Project Borealis is audited by Regional Audit.",
      pageContent:
        "Project Apollo is audited by Compliance Office. Project Borealis is audited by Regional Audit. The page explains project ownership, audit routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who audits Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Compliance Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Audit",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "auditor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped audited-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is audited by Compliance Office. Project Borealis is audited by Regional Audit.",
      pageContent:
        "Project Apollo is audited by Compliance Office. Project Borealis is audited by Regional Audit. The page explains project ownership, audit routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo audited by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is audited by Compliance Office. Project Borealis is audited by Regional Audit. The page explains project ownership, audit routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Compliance Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Audit",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "auditor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped validates answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "QA Council validates Project Apollo. Regional QA validates Project Borealis.",
      pageContent:
        "QA Council validates Project Apollo. Regional QA validates Project Borealis. The page explains project ownership, validation routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who validates Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "QA Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "validator",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped validates answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "QA Council validates Project Apollo. Regional QA validates Project Borealis.",
      pageContent:
        "QA Council validates Project Apollo. Regional QA validates Project Borealis. The page explains project ownership, validation routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who validates Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nQA Council validates Project Apollo. Regional QA validates Project Borealis. The page explains project ownership, validation routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "QA Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "validator",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped validated-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is validated by QA Council. Project Borealis is validated by Regional QA.",
      pageContent:
        "Project Apollo is validated by QA Council. Project Borealis is validated by Regional QA. The page explains project ownership, validation routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who validates Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "QA Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "validator",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped validated-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is validated by QA Council. Project Borealis is validated by Regional QA.",
      pageContent:
        "Project Apollo is validated by QA Council. Project Borealis is validated by Regional QA. The page explains project ownership, validation routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo validated by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is validated by QA Council. Project Borealis is validated by Regional QA. The page explains project ownership, validation routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "QA Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "validator",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped verifies answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Release Assurance verifies Project Apollo. Regional QA verifies Project Borealis.",
      pageContent:
        "Release Assurance verifies Project Apollo. Regional QA verifies Project Borealis. The page explains project ownership, verification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who verifies Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Release Assurance",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "verifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped verifies answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Release Assurance verifies Project Apollo. Regional QA verifies Project Borealis.",
      pageContent:
        "Release Assurance verifies Project Apollo. Regional QA verifies Project Borealis. The page explains project ownership, verification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who verifies Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nRelease Assurance verifies Project Apollo. Regional QA verifies Project Borealis. The page explains project ownership, verification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Release Assurance",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "verifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped verified-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is verified by Release Assurance. Project Borealis is verified by Regional QA.",
      pageContent:
        "Project Apollo is verified by Release Assurance. Project Borealis is verified by Regional QA. The page explains project ownership, verification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who verifies Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Release Assurance",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "verifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped verified-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is verified by Release Assurance. Project Borealis is verified by Regional QA.",
      pageContent:
        "Project Apollo is verified by Release Assurance. Project Borealis is verified by Regional QA. The page explains project ownership, verification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo verified by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is verified by Release Assurance. Project Borealis is verified by Regional QA. The page explains project ownership, verification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Release Assurance",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "verifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped certifies answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Security Council certifies Project Apollo. Regional QA certifies Project Borealis.",
      pageContent:
        "Security Council certifies Project Apollo. Regional QA certifies Project Borealis. The page explains project ownership, certification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who certifies Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Security Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "certifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped certifies answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Security Council certifies Project Apollo. Regional QA certifies Project Borealis.",
      pageContent:
        "Security Council certifies Project Apollo. Regional QA certifies Project Borealis. The page explains project ownership, certification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who certifies Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nSecurity Council certifies Project Apollo. Regional QA certifies Project Borealis. The page explains project ownership, certification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Security Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "certifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped certified-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is certified by Security Council. Project Borealis is certified by Regional QA.",
      pageContent:
        "Project Apollo is certified by Security Council. Project Borealis is certified by Regional QA. The page explains project ownership, certification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who certifies Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Security Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "certifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped certified-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is certified by Security Council. Project Borealis is certified by Regional QA.",
      pageContent:
        "Project Apollo is certified by Security Council. Project Borealis is certified by Regional QA. The page explains project ownership, certification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo certified by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is certified by Security Council. Project Borealis is certified by Regional QA. The page explains project ownership, certification routing, dependency notes, release timing, control coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Security Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "certifier",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });
});
