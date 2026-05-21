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

describe("completion kernel sentence-scoped service supervision relation read-answer", () => {
  test("accepts active-voice sentence-scoped supervises answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Reliability supervises Service Atlas. Edge Reliability supervises Service Beacon.",
      pageContent:
        "Core Reliability supervises Service Atlas. Edge Reliability supervises Service Beacon. The page explains service ownership, supervision routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who supervises Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Reliability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Reliability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supervisor",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped supervises answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Reliability supervises Service Atlas. Edge Reliability supervises Service Beacon.",
      pageContent:
        "Core Reliability supervises Service Atlas. Edge Reliability supervises Service Beacon. The page explains service ownership, supervision routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who supervises Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Reliability supervises Service Atlas. Edge Reliability supervises Service Beacon. The page explains service ownership, supervision routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Reliability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Reliability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supervisor",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped supervised-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is supervised by Core Reliability. Service Beacon is supervised by Edge Reliability.",
      pageContent:
        "Service Atlas is supervised by Core Reliability. Service Beacon is supervised by Edge Reliability. The page explains service ownership, supervision routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who supervises Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Reliability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Reliability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supervisor",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped supervised-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is supervised by Core Reliability. Service Beacon is supervised by Edge Reliability.",
      pageContent:
        "Service Atlas is supervised by Core Reliability. Service Beacon is supervised by Edge Reliability. The page explains service ownership, supervision routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas supervised by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is supervised by Core Reliability. Service Beacon is supervised by Edge Reliability. The page explains service ownership, supervision routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Reliability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Reliability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supervisor",
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
