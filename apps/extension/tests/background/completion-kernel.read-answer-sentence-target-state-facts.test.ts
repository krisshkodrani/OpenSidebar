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

describe("completion kernel sentence-scoped target-state factual read-answer", () => {
  test("accepts target-state sentence-scoped yes answer for a state question", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is blocked. Project Borealis is active.",
      pageContent:
        "Project Atlas is blocked. Project Borealis is active. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-state sentence-scoped no answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is not blocked. Project Borealis is blocked.",
      pageContent:
        "Project Atlas is not blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas is not blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, Project Atlas is not blocked.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("does not accept a target-state sentence from a sibling target", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is active. Project Borealis is blocked.",
      pageContent:
        "Project Atlas is active. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas is blocked.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use target-state sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Status Project Atlas is blocked Project Borealis is active",
      pageContent:
        "Project Status Project Atlas is blocked Project Borealis is active. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas blocked?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas is blocked.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts target-state sentence-scoped answer with current-state adverbs", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is currently blocked. Project Borealis is active.",
      pageContent:
        "Project Atlas is currently blocked. Project Borealis is active. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas still blocked?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Yes, Project Atlas is still blocked.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "No.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(wrongAnswer.status).toBe("inconclusive");
  });

  test("accepts target-state no answer with no-longer evidence from read_page", () => {
    const snap = workflowSnapshot({
      title: "Project Status",
      url: "https://example.test/projects/status",
      visibleContent:
        "Project Atlas is no longer blocked. Project Borealis is blocked.",
      pageContent:
        "Project Atlas is no longer blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Is Project Atlas currently blocked?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas is no longer blocked. Project Borealis is blocked. The page explains project status, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project state questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "No, Project Atlas is no longer blocked.",
    });
    const wrongAnswer = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Yes.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked state",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(wrongAnswer.status).toBe("inconclusive");
  });
});
