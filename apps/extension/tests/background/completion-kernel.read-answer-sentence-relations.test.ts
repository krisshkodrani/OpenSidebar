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

describe("completion kernel sentence-scoped relation read-answer", () => {
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

  test("accepts active-voice sentence-scoped sponsors answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Product Council sponsors Project Apollo. Regional Council sponsors Project Borealis.",
      pageContent:
        "Product Council sponsors Project Apollo. Regional Council sponsors Project Borealis. The page explains project ownership, sponsorship routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who sponsors Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Product Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sponsor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped sponsors answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Product Council sponsors Project Apollo. Regional Council sponsors Project Borealis.",
      pageContent:
        "Product Council sponsors Project Apollo. Regional Council sponsors Project Borealis. The page explains project ownership, sponsorship routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who sponsors Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProduct Council sponsors Project Apollo. Regional Council sponsors Project Borealis. The page explains project ownership, sponsorship routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Product Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sponsor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped sponsored-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is sponsored by Product Council. Project Borealis is sponsored by Regional Council.",
      pageContent:
        "Project Apollo is sponsored by Product Council. Project Borealis is sponsored by Regional Council. The page explains project ownership, sponsorship routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who sponsors Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Product Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sponsor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped sponsored-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is sponsored by Product Council. Project Borealis is sponsored by Regional Council.",
      pageContent:
        "Project Apollo is sponsored by Product Council. Project Borealis is sponsored by Regional Council. The page explains project ownership, sponsorship routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo sponsored by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is sponsored by Product Council. Project Borealis is sponsored by Regional Council. The page explains project ownership, sponsorship routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Product Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "sponsor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped funds answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Growth Fund funds Project Apollo. Regional Fund funds Project Borealis.",
      pageContent:
        "Growth Fund funds Project Apollo. Regional Fund funds Project Borealis. The page explains project ownership, funding routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who funds Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Growth Fund",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Fund",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "funder",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped funds answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Growth Fund funds Project Apollo. Regional Fund funds Project Borealis.",
      pageContent:
        "Growth Fund funds Project Apollo. Regional Fund funds Project Borealis. The page explains project ownership, funding routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who funds Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nGrowth Fund funds Project Apollo. Regional Fund funds Project Borealis. The page explains project ownership, funding routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Growth Fund",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Fund",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "funder",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped funded-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is funded by Growth Fund. Project Borealis is funded by Regional Fund.",
      pageContent:
        "Project Apollo is funded by Growth Fund. Project Borealis is funded by Regional Fund. The page explains project ownership, funding routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who funds Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Growth Fund",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Fund",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "funder",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped funded-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is funded by Growth Fund. Project Borealis is funded by Regional Fund.",
      pageContent:
        "Project Apollo is funded by Growth Fund. Project Borealis is funded by Regional Fund. The page explains project ownership, funding routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo funded by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is funded by Growth Fund. Project Borealis is funded by Regional Fund. The page explains project ownership, funding routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Growth Fund",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Fund",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "funder",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped oversees answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Governance Board oversees Project Apollo. Regional Board oversees Project Borealis.",
      pageContent:
        "Governance Board oversees Project Apollo. Regional Board oversees Project Borealis. The page explains project ownership, oversight routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who oversees Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Governance Board",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Board",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "overseer",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped oversees answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Governance Board oversees Project Apollo. Regional Board oversees Project Borealis.",
      pageContent:
        "Governance Board oversees Project Apollo. Regional Board oversees Project Borealis. The page explains project ownership, oversight routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who oversees Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nGovernance Board oversees Project Apollo. Regional Board oversees Project Borealis. The page explains project ownership, oversight routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Governance Board",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Board",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "overseer",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped overseen-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is overseen by Governance Board. Project Borealis is overseen by Regional Board.",
      pageContent:
        "Project Apollo is overseen by Governance Board. Project Borealis is overseen by Regional Board. The page explains project ownership, oversight routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who oversees Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Governance Board",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Board",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "overseer",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped overseen-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is overseen by Governance Board. Project Borealis is overseen by Regional Board.",
      pageContent:
        "Project Apollo is overseen by Governance Board. Project Borealis is overseen by Regional Board. The page explains project ownership, oversight routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo overseen by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is overseen by Governance Board. Project Borealis is overseen by Regional Board. The page explains project ownership, oversight routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Governance Board",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Board",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "overseer",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped governs answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Architecture Council governs Project Apollo. Regional Council governs Project Borealis.",
      pageContent:
        "Architecture Council governs Project Apollo. Regional Council governs Project Borealis. The page explains project ownership, governance routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who governs Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Architecture Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "governor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped governs answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Architecture Council governs Project Apollo. Regional Council governs Project Borealis.",
      pageContent:
        "Architecture Council governs Project Apollo. Regional Council governs Project Borealis. The page explains project ownership, governance routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who governs Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nArchitecture Council governs Project Apollo. Regional Council governs Project Borealis. The page explains project ownership, governance routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Architecture Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "governor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped governed-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is governed by Architecture Council. Project Borealis is governed by Regional Council.",
      pageContent:
        "Project Apollo is governed by Architecture Council. Project Borealis is governed by Regional Council. The page explains project ownership, governance routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who governs Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Architecture Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "governor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped governed-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is governed by Architecture Council. Project Borealis is governed by Regional Council.",
      pageContent:
        "Project Apollo is governed by Architecture Council. Project Borealis is governed by Regional Council. The page explains project ownership, governance routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo governed by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is governed by Architecture Council. Project Borealis is governed by Regional Council. The page explains project ownership, governance routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Architecture Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "governor",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped controls answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Risk Council controls Project Apollo. Regional Council controls Project Borealis.",
      pageContent:
        "Risk Council controls Project Apollo. Regional Council controls Project Borealis. The page explains project ownership, control routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who controls Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Risk Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "controller",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped controls answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Risk Council controls Project Apollo. Regional Council controls Project Borealis.",
      pageContent:
        "Risk Council controls Project Apollo. Regional Council controls Project Borealis. The page explains project ownership, control routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who controls Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nRisk Council controls Project Apollo. Regional Council controls Project Borealis. The page explains project ownership, control routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Risk Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "controller",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped controlled-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is controlled by Risk Council. Project Borealis is controlled by Regional Council.",
      pageContent:
        "Project Apollo is controlled by Risk Council. Project Borealis is controlled by Regional Council. The page explains project ownership, control routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who controls Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Risk Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "controller",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped controlled-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo is controlled by Risk Council. Project Borealis is controlled by Regional Council.",
      pageContent:
        "Project Apollo is controlled by Risk Council. Project Borealis is controlled by Regional Council. The page explains project ownership, control routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo controlled by?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo is controlled by Risk Council. Project Borealis is controlled by Regional Council. The page explains project ownership, control routing, dependency notes, release timing, audit coverage, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Risk Council",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional Council",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "controller",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

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

  test("accepts sentence-scoped contact answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo contact is Maya Chen. Project Borealis contact is Ravi Shah.",
      pageContent:
        "Project Apollo contact is Maya Chen. Project Borealis contact is Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped point-of-contact answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo's point of contact is Security Desk. Project Borealis's point of contact is Regional QA.",
      pageContent:
        "Project Apollo's point of contact is Security Desk. Project Borealis's point of contact is Regional QA. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is Project Apollo's point of contact?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo's point of contact is Security Desk. Project Borealis's point of contact is Regional QA. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Security Desk",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Regional QA",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style sentence-scoped contact answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah.",
      pageContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style sentence-scoped contact answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah.",
      pageContent:
        "Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nContact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-contact sentence-scoped answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah.",
      pageContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-contact sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Details",
      url: "https://example.test/projects",
      visibleContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah.",
      pageContent:
        "Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "contact",
      expectedAnswerTarget: "Project Apollo",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped requested answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta.",
      pageContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who requested Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "requester",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped requested answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta.",
      pageContent:
        "Maya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who requested Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen requested Ticket Alpha. Ravi Shah requested Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "requester",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reported answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta.",
      pageContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reported Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "reporter",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reported answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta.",
      pageContent:
        "Maya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reported Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen reported Ticket Alpha. Ravi Shah reported Ticket Beta. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "reporter",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped reported-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was reported by Maya Chen. Ticket Beta was reported by Ravi Shah.",
      pageContent:
        "Ticket Alpha was reported by Maya Chen. Ticket Beta was reported by Ravi Shah. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reported Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "reporter",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped requested-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was requested by Maya Chen. Ticket Beta was requested by Ravi Shah.",
      pageContent:
        "Ticket Alpha was requested by Maya Chen. Ticket Beta was requested by Ravi Shah. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who requested Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha was requested by Maya Chen. Ticket Beta was requested by Ravi Shah. The page explains ticket reporting, request intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "requester",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped created answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta.",
      pageContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who created Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "creator",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped created answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta.",
      pageContent:
        "Maya Chen created Ticket Alpha. Ravi Shah created Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who created Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen created Ticket Alpha. Ravi Shah created Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "creator",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped created-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was created by Maya Chen. Ticket Beta was created by Ravi Shah.",
      pageContent:
        "Ticket Alpha was created by Maya Chen. Ticket Beta was created by Ravi Shah. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who created Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "creator",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped opened answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta.",
      pageContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who opened Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "opener",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped opened answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta.",
      pageContent:
        "Maya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who opened Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen opened Ticket Alpha. Ravi Shah opened Ticket Beta. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "opener",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped opened-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was opened by Maya Chen. Ticket Beta was opened by Ravi Shah.",
      pageContent:
        "Ticket Alpha was opened by Maya Chen. Ticket Beta was opened by Ravi Shah. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who opened Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha was opened by Maya Chen. Ticket Beta was opened by Ravi Shah. The page explains ticket creation, case intake, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "opener",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped approved answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta.",
      pageContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who approved Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "approver",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped approved answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta.",
      pageContent:
        "Maya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who approved Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen approved Ticket Alpha. Ravi Shah approved Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "approver",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped approved-by answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was approved by Maya Chen. Ticket Beta was approved by Ravi Shah.",
      pageContent:
        "Ticket Alpha was approved by Maya Chen. Ticket Beta was approved by Ravi Shah. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who approved Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "approver",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reviewed answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta.",
      pageContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reviewed Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "reviewer",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts active-voice sentence-scoped reviewed answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta.",
      pageContent:
        "Maya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reviewed Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nMaya Chen reviewed Ticket Alpha. Ravi Shah reviewed Ticket Beta. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "reviewer",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped reviewed-by answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha was reviewed by Maya Chen. Ticket Beta was reviewed by Ravi Shah.",
      pageContent:
        "Ticket Alpha was reviewed by Maya Chen. Ticket Beta was reviewed by Ravi Shah. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who reviewed Ticket Alpha?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha was reviewed by Maya Chen. Ticket Beta was reviewed by Ravi Shah. The page explains ticket approval, case review, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Ravi Shah",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "reviewer",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped due-date answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is due on 2026-05-20. Ticket Beta is due on 2026-05-21.",
      pageContent:
        "Ticket Alpha is due on 2026-05-20. Ticket Beta is due on 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha due?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-21",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use due-on sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha is due on 2026-05-20 Ticket Beta is due on 2026-05-21",
      pageContent:
        "Ticket Queue Ticket Alpha is due on 2026-05-20. Ticket Beta is due on 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha due?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped possessive due-date answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha's due date is 2026-05-20. Ticket Beta's due date is 2026-05-21.",
      pageContent:
        "Ticket Alpha's due date is 2026-05-20. Ticket Beta's due date is 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha's due date?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha's due date is 2026-05-20. Ticket Beta's due date is 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, follow-up ownership, and support queue review so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "2026-05-21",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use target-contact sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Queue",
      url: "https://example.test/projects",
      visibleContent:
        "Project Queue Project Apollo contact: Maya Chen Project Borealis contact: Ravi Shah",
      pageContent:
        "Project Queue Project Apollo contact: Maya Chen. Project Borealis contact: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use contact-for sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Queue",
      url: "https://example.test/projects",
      visibleContent:
        "Project Queue Contact for Project Apollo: Maya Chen Contact for Project Borealis: Ravi Shah",
      pageContent:
        "Project Queue Contact for Project Apollo: Maya Chen. Contact for Project Borealis: Ravi Shah. The page explains project staffing, ownership, review cadence, risk notes, launch timing, audit coverage, support routing, and follow-up responsibilities so operators can answer project questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the contact for Project Apollo?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Maya Chen",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts separator-style target-due-date sentence-scoped answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha due date: 2026-05-20. Ticket Beta due date: 2026-05-21.",
      pageContent:
        "Ticket Alpha due date: 2026-05-20. Ticket Beta due date: 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha's due date?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-21",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-due-date sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha due date: 2026-05-20. Ticket Beta due date: 2026-05-21.",
      pageContent:
        "Ticket Alpha due date: 2026-05-20. Ticket Beta due date: 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha's due date?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha due date: 2026-05-20. Ticket Beta due date: 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, follow-up ownership, and support queue review so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "2026-05-21",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use target-due-date sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha due date: 2026-05-20 Ticket Beta due date: 2026-05-21",
      pageContent:
        "Ticket Queue Ticket Alpha due date: 2026-05-20. Ticket Beta due date: 2026-05-21. The page explains ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "When is Ticket Alpha's due date?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-20",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped status answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is open. Ticket Beta is closed.",
      pageContent:
        "Ticket Alpha is open. Ticket Beta is closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the status for Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use status sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha is open Ticket Beta is closed",
      pageContent:
        "Ticket Queue Ticket Alpha is open. Ticket Beta is closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the status for Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped status answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha status is Open. Ticket Beta status is Closed.",
      pageContent:
        "Ticket Alpha status is Open. Ticket Beta status is Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's status?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha status is Open. Ticket Beta status is Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-status sentence-scoped answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed.",
      pageContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's status?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-status sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed.",
      pageContent:
        "Ticket Alpha status: Open. Ticket Beta status: Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's status?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha status: Open. Ticket Beta status: Closed. The page explains ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Open",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Closed",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "status",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped priority answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha is high priority. Ticket Beta is low priority.",
      pageContent:
        "Ticket Alpha is high priority. Ticket Beta is low priority. The page explains ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the priority for Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "High",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Low",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "priority",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use priority sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha is high priority Ticket Beta is low priority",
      pageContent:
        "Ticket Queue Ticket Alpha is high priority. Ticket Beta is low priority. The page explains ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the priority for Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "High",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped priority answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha priority is High. Ticket Beta priority is Low.",
      pageContent:
        "Ticket Alpha priority is High. Ticket Beta priority is Low. The page explains ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's priority?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha priority is High. Ticket Beta priority is Low. The page explains ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "High",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Low",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "priority",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-priority sentence-scoped answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha priority: High. Ticket Beta priority: Low.",
      pageContent:
        "Ticket Alpha priority: High. Ticket Beta priority: Low. The page explains ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's priority?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "High",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Low",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "priority",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-priority sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha priority: High. Ticket Beta priority: Low.",
      pageContent:
        "Ticket Alpha priority: High. Ticket Beta priority: Low. The page explains ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's priority?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha priority: High. Ticket Beta priority: Low. The page explains ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "High",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Low",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "priority",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts sentence-scoped severity answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha severity is Critical. Ticket Beta severity is Minor.",
      pageContent:
        "Ticket Alpha severity is Critical. Ticket Beta severity is Minor. The page explains ticket severity, ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the severity for Ticket Alpha?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Critical",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Minor",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "severity",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use severity sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Ticket Queue",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Queue Ticket Alpha is critical severity Ticket Beta is minor severity",
      pageContent:
        "Ticket Queue Ticket Alpha is critical severity. Ticket Beta is minor severity. The page explains ticket severity, ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What is the severity for Ticket Alpha?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Critical",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts sentence-scoped severity answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha severity is Critical. Ticket Beta severity is Minor.",
      pageContent:
        "Ticket Alpha severity is Critical. Ticket Beta severity is Minor. The page explains ticket severity, ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's severity?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha severity is Critical. Ticket Beta severity is Minor. The page explains ticket severity, ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Critical",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Minor",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "severity",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-severity sentence-scoped answer for the requested target", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha severity: Critical. Ticket Beta severity: Minor.",
      pageContent:
        "Ticket Alpha severity: Critical. Ticket Beta severity: Minor. The page explains ticket severity, ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's severity?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Critical",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Minor",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "severity",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts separator-style target-severity sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Ticket Details",
      url: "https://example.test/tickets",
      visibleContent:
        "Ticket Alpha severity: Critical. Ticket Beta severity: Minor.",
      pageContent:
        "Ticket Alpha severity: Critical. Ticket Beta severity: Minor. The page explains ticket severity, ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Ticket Alpha's severity?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nTicket Alpha severity: Critical. Ticket Beta severity: Minor. The page explains ticket severity, ticket priority, ticket status, ticket assignment, ticket ownership, customer impact, support routing, escalation notes, audit timing, queue priority, and follow-up responsibilities so operators can answer ticket questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Critical",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "Minor",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "severity",
      expectedAnswerTarget: "Ticket Alpha",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });
});
