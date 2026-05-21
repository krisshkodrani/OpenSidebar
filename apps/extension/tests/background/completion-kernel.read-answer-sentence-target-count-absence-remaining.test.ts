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

describe("completion kernel sentence-scoped target-count absence and remaining read-answer", () => {
  test("accepts target-count zero answer with no-longer evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas no longer has any open incidents. Project Borealis currently has 4 open incidents.",
      pageContent:
        "Project Atlas no longer has any open incidents. Project Borealis currently has 4 open incidents. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
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
      summary: "0",
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

  test("accepts existential target-count zero answer with no-longer read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis.",
      pageContent:
        "There are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents are there for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are no longer any open incidents for Project Atlas. There are currently 4 open incidents for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "zero",
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

  test("accepts target-count answer with remaining phrasing", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas has 3 open incidents remaining. Project Borealis has 4 open incidents remaining.",
      pageContent:
        "Project Atlas has 3 open incidents remaining. Project Borealis has 4 open incidents remaining. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents remain for Project Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "3",
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

  test("accepts existential target-count answer with left read_page evidence", () => {
    const snap = workflowSnapshot({
      title: "Project Metrics",
      url: "https://example.test/projects",
      visibleContent:
        "There are 3 open incidents left for Project Atlas. There are 4 open incidents left for Project Borealis.",
      pageContent:
        "There are 3 open incidents left for Project Atlas. There are 4 open incidents left for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open incidents are left for Project Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nThere are 3 open incidents left for Project Atlas. There are 4 open incidents left for Project Borealis. The page explains project metrics, incident ownership, support process, release timing, budget review, customer communications, dependency status, and audit notes so readers can answer project metric questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "3",
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
});
