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

describe("completion kernel sentence-scoped service relation read-answer", () => {
  test("accepts sentence-scoped supported-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is supported by Core Support. Service Beacon is supported by Edge Support.",
      pageContent:
        "Service Atlas is supported by Core Support. Service Beacon is supported by Edge Support. The page explains service ownership, support routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who supports Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Support",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Support",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supporter",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped supported-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is supported by Core Support. Service Beacon is supported by Edge Support.",
      pageContent:
        "Service Atlas is supported by Core Support. Service Beacon is supported by Edge Support. The page explains service ownership, support routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas supported by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is supported by Core Support. Service Beacon is supported by Edge Support. The page explains service ownership, support routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Support",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Support",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supporter",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped supports answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Support supports Service Atlas. Edge Support supports Service Beacon.",
      pageContent:
        "Core Support supports Service Atlas. Edge Support supports Service Beacon. The page explains service ownership, support routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who supports Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Support",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Support",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supporter",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped supports answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Support supports Service Atlas. Edge Support supports Service Beacon.",
      pageContent:
        "Core Support supports Service Atlas. Edge Support supports Service Beacon. The page explains service ownership, support routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who supports Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Support supports Service Atlas. Edge Support supports Service Beacon. The page explains service ownership, support routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Support",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Support",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "supporter",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped hosts answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Hosting hosts Service Atlas. Edge Hosting hosts Service Beacon.",
      pageContent:
        "Core Hosting hosts Service Atlas. Edge Hosting hosts Service Beacon. The page explains service ownership, hosting routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who hosts Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Hosting",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Hosting",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "host",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped hosts answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Hosting hosts Service Atlas. Edge Hosting hosts Service Beacon.",
      pageContent:
        "Core Hosting hosts Service Atlas. Edge Hosting hosts Service Beacon. The page explains service ownership, hosting routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who hosts Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Hosting hosts Service Atlas. Edge Hosting hosts Service Beacon. The page explains service ownership, hosting routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Hosting",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Hosting",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "host",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped hosted-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is hosted by Core Hosting. Service Beacon is hosted by Edge Hosting.",
      pageContent:
        "Service Atlas is hosted by Core Hosting. Service Beacon is hosted by Edge Hosting. The page explains service ownership, hosting routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who hosts Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Hosting",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Hosting",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "host",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped hosted-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is hosted by Core Hosting. Service Beacon is hosted by Edge Hosting.",
      pageContent:
        "Service Atlas is hosted by Core Hosting. Service Beacon is hosted by Edge Hosting. The page explains service ownership, hosting routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas hosted by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is hosted by Core Hosting. Service Beacon is hosted by Edge Hosting. The page explains service ownership, hosting routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Hosting",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Hosting",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "host",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped administers answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Admin administers Service Atlas. Edge Admin administers Service Beacon.",
      pageContent:
        "Core Admin administers Service Atlas. Edge Admin administers Service Beacon. The page explains service ownership, administration routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who administers Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Admin",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Admin",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "administrator",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped administers answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Admin administers Service Atlas. Edge Admin administers Service Beacon.",
      pageContent:
        "Core Admin administers Service Atlas. Edge Admin administers Service Beacon. The page explains service ownership, administration routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who administers Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Admin administers Service Atlas. Edge Admin administers Service Beacon. The page explains service ownership, administration routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Admin",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Admin",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "administrator",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped administered-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is administered by Core Admin. Service Beacon is administered by Edge Admin.",
      pageContent:
        "Service Atlas is administered by Core Admin. Service Beacon is administered by Edge Admin. The page explains service ownership, administration routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who administers Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Admin",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Admin",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "administrator",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped administered-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is administered by Core Admin. Service Beacon is administered by Edge Admin.",
      pageContent:
        "Service Atlas is administered by Core Admin. Service Beacon is administered by Edge Admin. The page explains service ownership, administration routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas administered by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is administered by Core Admin. Service Beacon is administered by Edge Admin. The page explains service ownership, administration routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Admin",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Admin",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "administrator",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped monitors answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Observability monitors Service Atlas. Edge Observability monitors Service Beacon.",
      pageContent:
        "Core Observability monitors Service Atlas. Edge Observability monitors Service Beacon. The page explains service ownership, monitoring routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who monitors Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Observability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Observability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monitor",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped monitors answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Observability monitors Service Atlas. Edge Observability monitors Service Beacon.",
      pageContent:
        "Core Observability monitors Service Atlas. Edge Observability monitors Service Beacon. The page explains service ownership, monitoring routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who monitors Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Observability monitors Service Atlas. Edge Observability monitors Service Beacon. The page explains service ownership, monitoring routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Observability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Observability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monitor",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped monitored-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is monitored by Core Observability. Service Beacon is monitored by Edge Observability.",
      pageContent:
        "Service Atlas is monitored by Core Observability. Service Beacon is monitored by Edge Observability. The page explains service ownership, monitoring routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who monitors Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Observability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Observability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monitor",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped monitored-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is monitored by Core Observability. Service Beacon is monitored by Edge Observability.",
      pageContent:
        "Service Atlas is monitored by Core Observability. Service Beacon is monitored by Edge Observability. The page explains service ownership, monitoring routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas monitored by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is monitored by Core Observability. Service Beacon is monitored by Edge Observability. The page explains service ownership, monitoring routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Observability",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Observability",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monitor",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

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
