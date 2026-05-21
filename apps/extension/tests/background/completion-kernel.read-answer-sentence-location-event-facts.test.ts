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

describe("completion kernel sentence-scoped location and event-date read-answer", () => {
  test("accepts location sentence-scoped answer for a where question", () => {
    const snap = workflowSnapshot({
      title: "Project Locations",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas is located in Building C. Project Borealis is located in Building D.",
      pageContent:
        "Project Atlas is located in Building C. Project Borealis is located in Building D. The page explains project locations, office routing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project location questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is Project Atlas located?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas is located in Building C.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas is located in Building D.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "location",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts location sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Locations",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas is located in Building C. Project Borealis is located in Building D.",
      pageContent:
        "Project Atlas is located in Building C. Project Borealis is located in Building D. The page explains project locations, office routing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project location questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is Project Atlas located?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas is located in Building C. Project Borealis is located in Building D. The page explains project locations, office routing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project location questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Building C",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Building D",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "location",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not accept a location sentence with the wrong requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Locations",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas is owned by Maya Chen. Project Borealis is located in Building D.",
      pageContent:
        "Project Atlas is owned by Maya Chen. Project Borealis is located in Building D. The page explains project locations, office routing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project location questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Where is Project Atlas located?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas is located in Building D.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use location sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Locations",
      url: "https://example.test/projects",
      visibleContent:
        "Project Locations Project Atlas is located in Building C Project Borealis is located in Building D",
      pageContent:
        "Project Locations Project Atlas is located in Building C Project Borealis is located in Building D. The page explains project locations, office routing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project location questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Where is Project Atlas located?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas is located in Building C.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts event-date sentence-scoped answer for a when question", () => {
    const snap = workflowSnapshot({
      title: "Project Timeline",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas launched on March 12, 2026. Project Borealis launched on April 9, 2026.",
      pageContent:
        "Project Atlas launched on March 12, 2026. Project Borealis launched on April 9, 2026. The page explains project launch timing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project timeline questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When was Project Atlas launched?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas launched on March 12, 2026.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas launched on April 9, 2026.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "launched date",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts event-date sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Timeline",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas launched on March 12, 2026. Project Borealis launched on April 9, 2026.",
      pageContent:
        "Project Atlas launched on March 12, 2026. Project Borealis launched on April 9, 2026. The page explains project launch timing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project timeline questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When was Project Atlas launched?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas launched on March 12, 2026. Project Borealis launched on April 9, 2026. The page explains project launch timing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project timeline questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "March 12, 2026",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "April 9, 2026",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "launched date",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not accept an event-date sentence with the wrong requested predicate", () => {
    const snap = workflowSnapshot({
      title: "Project Timeline",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas closed on March 12, 2026. Project Borealis launched on April 9, 2026.",
      pageContent:
        "Project Atlas closed on March 12, 2026. Project Borealis launched on April 9, 2026. The page explains project launch timing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project timeline questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When was Project Atlas launched?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas launched on March 12, 2026.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use event-date sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Timeline",
      url: "https://example.test/projects",
      visibleContent:
        "Project Timeline Project Atlas launched on March 12, 2026 Project Borealis launched on April 9, 2026",
      pageContent:
        "Project Timeline Project Atlas launched on March 12, 2026 Project Borealis launched on April 9, 2026. The page explains project launch timing, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project timeline questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "When was Project Atlas launched?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Project Atlas launched on March 12, 2026.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });
});
