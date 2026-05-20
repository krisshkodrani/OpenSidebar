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

describe("completion kernel sentence-scoped coordinator relation read-answer", () => {
  test("accepts active-voice sentence-scoped coordinates answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Program Office coordinates Project Apollo. Regional Office coordinates Project Borealis.",
      pageContent:
        "Program Office coordinates Project Apollo. Regional Office coordinates Project Borealis. The page explains project ownership, coordination routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who coordinates Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Program Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Office",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "coordinator",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped coordinates answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Program Office coordinates Project Apollo. Regional Office coordinates Project Borealis.",
      pageContent:
        "Program Office coordinates Project Apollo. Regional Office coordinates Project Borealis. The page explains project ownership, coordination routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who coordinates Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProgram Office coordinates Project Apollo. Regional Office coordinates Project Borealis. The page explains project ownership, coordination routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Program Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Office",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "coordinator",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped coordinated-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is coordinated by Program Office. Project Borealis is coordinated by Regional Office.",
      pageContent:
        "Project Apollo is coordinated by Program Office. Project Borealis is coordinated by Regional Office. The page explains project ownership, coordination routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who coordinates Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Program Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Office",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "coordinator",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped coordinated-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is coordinated by Program Office. Project Borealis is coordinated by Regional Office.",
      pageContent:
        "Project Apollo is coordinated by Program Office. Project Borealis is coordinated by Regional Office. The page explains project ownership, coordination routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo coordinated by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is coordinated by Program Office. Project Borealis is coordinated by Regional Office. The page explains project ownership, coordination routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Program Office",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Office",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "coordinator",
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
