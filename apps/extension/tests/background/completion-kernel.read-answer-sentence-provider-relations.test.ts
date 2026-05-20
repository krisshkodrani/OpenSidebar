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

describe("completion kernel sentence-scoped provider relation read-answer", () => {
  test("accepts active-voice sentence-scoped provides answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Platform provides Service Atlas. Edge Platform provides Service Beacon.",
      pageContent:
        "Core Platform provides Service Atlas. Edge Platform provides Service Beacon. The page explains service ownership, provider routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who provides Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Platform",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Platform",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "provider",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped provides answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Platform provides Service Atlas. Edge Platform provides Service Beacon.",
      pageContent:
        "Core Platform provides Service Atlas. Edge Platform provides Service Beacon. The page explains service ownership, provider routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who provides Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Platform provides Service Atlas. Edge Platform provides Service Beacon. The page explains service ownership, provider routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Platform",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Platform",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "provider",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped provided-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is provided by Core Platform. Service Beacon is provided by Edge Platform.",
      pageContent:
        "Service Atlas is provided by Core Platform. Service Beacon is provided by Edge Platform. The page explains service ownership, provider routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who provides Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Platform",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Platform",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "provider",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped provided-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is provided by Core Platform. Service Beacon is provided by Edge Platform.",
      pageContent:
        "Service Atlas is provided by Core Platform. Service Beacon is provided by Edge Platform. The page explains service ownership, provider routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas provided by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is provided by Core Platform. Service Beacon is provided by Edge Platform. The page explains service ownership, provider routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Platform",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Platform",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "provider",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });
});
