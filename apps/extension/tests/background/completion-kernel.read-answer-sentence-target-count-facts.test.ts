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

describe("completion kernel sentence-scoped target-count factual read-answer", () => {
  test("accepts target-count sentence-scoped answer for a how-many question", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 17 open incidents.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 4 open incidents.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target-count sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas has 17 open incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "17",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts target-count answer with current-count adverbs", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas currently has 17 open incidents. Project Borealis currently has 4 open incidents.",
      pageContent:
        "Project Atlas currently has 17 open incidents. Project Borealis currently has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas currently have?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "17",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts existential target-count answer with currently read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are currently 17 open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis.",
      pageContent:
        "There are currently 17 open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents are there currently for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are currently 17 open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "17",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "4",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open incidents count",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not accept a target-count sentence with the wrong requested metric", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 17 closed incidents. Project Borealis has 4 open incidents.",
      pageContent:
        "Project Atlas has 17 closed incidents. Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 4 open incidents.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use target-count sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Metrics Project Atlas has 17 open incidents Project Borealis has 4 open incidents",
      pageContent:
        "Project Metrics Project Atlas has 17 open incidents Project Borealis has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents does Project Atlas have?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas has 17 open incidents.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });
});
