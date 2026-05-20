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

describe("completion kernel sentence-scoped operational relation read-answer", () => {
  test("accepts sentence-scoped managed-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is managed by Lina Park. Project Beacon is managed by Omar Diaz.",
      pageContent:
        "Project Apollo is managed by Lina Park. Project Beacon is managed by Omar Diaz. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who manages Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Lina Park",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Omar Diaz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "manager",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped managed-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is managed by Lina Park. Project Beacon is managed by Omar Diaz.",
      pageContent:
        "Project Apollo is managed by Lina Park. Project Beacon is managed by Omar Diaz. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo managed by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is managed by Lina Park. Project Beacon is managed by Omar Diaz. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Lina Park",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Omar Diaz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "manager",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped manages answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Lina Park manages Project Apollo. Omar Diaz manages Project Beacon.",
      pageContent:
        "Lina Park manages Project Apollo. Omar Diaz manages Project Beacon. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who manages Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Lina Park",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Omar Diaz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "manager",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped manages answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Lina Park manages Project Apollo. Omar Diaz manages Project Beacon.",
      pageContent:
        "Lina Park manages Project Apollo. Omar Diaz manages Project Beacon. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who manages Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nLina Park manages Project Apollo. Omar Diaz manages Project Beacon. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Lina Park",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Omar Diaz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "manager",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped leads answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Nina Patel leads Project Apollo. Theo Grant leads Project Beacon.",
      pageContent:
        "Nina Patel leads Project Apollo. Theo Grant leads Project Beacon. The page explains project leadership, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who leads Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Nina Patel",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Theo Grant",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "lead",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped leads answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Nina Patel leads Project Apollo. Theo Grant leads Project Beacon.",
      pageContent:
        "Nina Patel leads Project Apollo. Theo Grant leads Project Beacon. The page explains project leadership, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who leads Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nNina Patel leads Project Apollo. Theo Grant leads Project Beacon. The page explains project leadership, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Nina Patel",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Theo Grant",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "lead",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped led-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is led by Nina Patel. Project Beacon is led by Theo Grant.",
      pageContent:
        "Project Apollo is led by Nina Patel. Project Beacon is led by Theo Grant. The page explains project leadership, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who leads Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Nina Patel",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Theo Grant",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "lead",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped led-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is led by Nina Patel. Project Beacon is led by Theo Grant.",
      pageContent:
        "Project Apollo is led by Nina Patel. Project Beacon is led by Theo Grant. The page explains project leadership, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo led by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is led by Nina Patel. Project Beacon is led by Theo Grant. The page explains project leadership, ownership, review cadence, risk notes, launch timing, audit coverage, delivery routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Nina Patel",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Theo Grant",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "lead",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped maintains answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Ops maintains Service Atlas. Edge Ops maintains Service Beacon.",
      pageContent:
        "Core Ops maintains Service Atlas. Edge Ops maintains Service Beacon. The page explains service ownership, maintenance routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who maintains Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintainer",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped maintains answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Ops maintains Service Atlas. Edge Ops maintains Service Beacon.",
      pageContent:
        "Core Ops maintains Service Atlas. Edge Ops maintains Service Beacon. The page explains service ownership, maintenance routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who maintains Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Ops maintains Service Atlas. Edge Ops maintains Service Beacon. The page explains service ownership, maintenance routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintainer",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped maintained-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is maintained by Core Ops. Service Beacon is maintained by Edge Ops.",
      pageContent:
        "Service Atlas is maintained by Core Ops. Service Beacon is maintained by Edge Ops. The page explains service ownership, maintenance routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who maintains Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintainer",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped maintained-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is maintained by Core Ops. Service Beacon is maintained by Edge Ops.",
      pageContent:
        "Service Atlas is maintained by Core Ops. Service Beacon is maintained by Edge Ops. The page explains service ownership, maintenance routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas maintained by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is maintained by Core Ops. Service Beacon is maintained by Edge Ops. The page explains service ownership, maintenance routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintainer",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped handles answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Case Details",
      url: "https://example.test/cases",
      visibleContent:
        "Support Pod handles Case Alpha. Billing Pod handles Case Beta.",
      pageContent:
        "Support Pod handles Case Alpha. Billing Pod handles Case Beta. The page explains case ownership, routing policy, escalation notes, customer priority, audit coverage, response timing, and follow-up responsibilities so operators can answer case questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who handles Case Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Support Pod",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Billing Pod",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "handler",
      expectedAnswerTarget: "Case Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped handles answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Case Details",
      url: "https://example.test/cases",
      visibleContent:
        "Support Pod handles Case Alpha. Billing Pod handles Case Beta.",
      pageContent:
        "Support Pod handles Case Alpha. Billing Pod handles Case Beta. The page explains case ownership, routing policy, escalation notes, customer priority, audit coverage, response timing, and follow-up responsibilities so operators can answer case questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who handles Case Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nSupport Pod handles Case Alpha. Billing Pod handles Case Beta. The page explains case ownership, routing policy, escalation notes, customer priority, audit coverage, response timing, and follow-up responsibilities so operators can answer case questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Support Pod",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Billing Pod",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "handler",
      expectedAnswerTarget: "Case Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped handled-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Case Details",
      url: "https://example.test/cases",
      visibleContent:
        "Case Alpha is handled by Support Pod. Case Beta is handled by Billing Pod.",
      pageContent:
        "Case Alpha is handled by Support Pod. Case Beta is handled by Billing Pod. The page explains case ownership, routing policy, escalation notes, customer priority, audit coverage, response timing, and follow-up responsibilities so operators can answer case questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who handles Case Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Support Pod",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Billing Pod",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "handler",
      expectedAnswerTarget: "Case Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped handled-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Case Details",
      url: "https://example.test/cases",
      visibleContent:
        "Case Alpha is handled by Support Pod. Case Beta is handled by Billing Pod.",
      pageContent:
        "Case Alpha is handled by Support Pod. Case Beta is handled by Billing Pod. The page explains case ownership, routing policy, escalation notes, customer priority, audit coverage, response timing, and follow-up responsibilities so operators can answer case questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Case Alpha handled by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCase Alpha is handled by Support Pod. Case Beta is handled by Billing Pod. The page explains case ownership, routing policy, escalation notes, customer priority, audit coverage, response timing, and follow-up responsibilities so operators can answer case questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Support Pod",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Billing Pod",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "handler",
      expectedAnswerTarget: "Case Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped operates answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Ops operates Service Atlas. Edge Ops operates Service Beacon.",
      pageContent:
        "Core Ops operates Service Atlas. Edge Ops operates Service Beacon. The page explains service ownership, operational routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who operates Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "operator",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped operates answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Core Ops operates Service Atlas. Edge Ops operates Service Beacon.",
      pageContent:
        "Core Ops operates Service Atlas. Edge Ops operates Service Beacon. The page explains service ownership, operational routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who operates Service Atlas?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nCore Ops operates Service Atlas. Edge Ops operates Service Beacon. The page explains service ownership, operational routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "operator",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped operated-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is operated by Core Ops. Service Beacon is operated by Edge Ops.",
      pageContent:
        "Service Atlas is operated by Core Ops. Service Beacon is operated by Edge Ops. The page explains service ownership, operational routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who operates Service Atlas?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "operator",
      expectedAnswerTarget: "Service Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped operated-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Service Details",
      url: "https://example.test/services",
      visibleContent:
        "Service Atlas is operated by Core Ops. Service Beacon is operated by Edge Ops.",
      pageContent:
        "Service Atlas is operated by Core Ops. Service Beacon is operated by Edge Ops. The page explains service ownership, operational routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Service Atlas operated by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nService Atlas is operated by Core Ops. Service Beacon is operated by Edge Ops. The page explains service ownership, operational routing, escalation notes, reliability policy, deployment timing, audit coverage, and follow-up responsibilities so operators can answer service questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Core Ops",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Edge Ops",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "operator",
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
