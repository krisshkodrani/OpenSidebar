import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

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

describe("completion kernel CIDR/prefix label-value read-answer", () => {
  test("accepts concise grounded CIDR label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0/24",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept truncated base address for CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept truncated CIDR base address for generic address label", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary address: 10.42.0.0/24 Backup address: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary address: 10.42.0.0/24. Backup address: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept sibling CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.43.0.0/24",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept CIDR prefix inside a longer value", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary subnet: 10.42.0.0/24 Backup subnet: 10.43.0.0/24",
      pageContent:
        "Network Matrix Primary subnet: 10.42.0.0/24. Backup subnet: 10.43.0.0/24. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary subnet?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.0/24-backup",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary subnet",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded IPv6 CIDR label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::/64",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept truncated base address for IPv6 CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts IPv6 CIDR value for generic prefix label", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary prefix: 2001:db8::/64 Backup prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary prefix: 2001:db8::/64. Backup prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::/64",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary prefix",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling IPv6 CIDR label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8:1::/64",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept IPv6 CIDR prefix inside a longer value", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64 Backup IPv6 prefix: 2001:db8:1::/64",
      pageContent:
        "Network Matrix Primary IPv6 prefix: 2001:db8::/64. Backup IPv6 prefix: 2001:db8:1::/64. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 prefix?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::/64-backup",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 prefix",
    });
    expect(decision.status).toBe("inconclusive");
  });

});
