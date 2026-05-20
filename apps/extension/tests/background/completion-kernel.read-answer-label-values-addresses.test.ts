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
describe("completion kernel address label-value read-answer", () => {
  test("accepts concise grounded domain label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix API host: api.example.com Backup host: backup.example.com",
      pageContent:
        "Network Matrix API host: api.example.com. Backup host: backup.example.com. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the API host?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "api.example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "api host",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling domain label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix API host: api.example.com Backup host: backup.example.com",
      pageContent:
        "Network Matrix API host: api.example.com. Backup host: backup.example.com. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the API host?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "backup.example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "api host",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept domain suffix inside a longer hostname", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Base domain: example.com Full host: api.example.com",
      pageContent:
        "Network Matrix Base domain: example.com. Full host: api.example.com. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the base domain?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "api.example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "base domain",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded MAC address label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E Backup MAC address: 00:1A:2B:3C:4D:5F",
      pageContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E. Backup MAC address: 00:1A:2B:3C:4D:5F. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the device MAC address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "00:1A:2B:3C:4D:5E",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "device mac address",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling MAC address label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E Backup MAC address: 00:1A:2B:3C:4D:5F",
      pageContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E. Backup MAC address: 00:1A:2B:3C:4D:5F. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the device MAC address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "00:1A:2B:3C:4D:5F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "device mac address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept MAC address prefix inside a longer address", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E Backup MAC address: 00:1A:2B:3C:4D:5F",
      pageContent:
        "Network Matrix Device MAC address: 00:1A:2B:3C:4D:5E. Backup MAC address: 00:1A:2B:3C:4D:5F. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the device MAC address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "00:1A:2B:3C:4D:5E:FF",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "device mac address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded IPv6 label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42 Backup IPv6 address: 2001:db8::43",
      pageContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42. Backup IPv6 address: 2001:db8::43. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::42",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 address",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling IPv6 label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42 Backup IPv6 address: 2001:db8::43",
      pageContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42. Backup IPv6 address: 2001:db8::43. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::43",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 address",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept IPv6 prefix inside a longer address", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42 Backup IPv6 address: 2001:db8::43",
      pageContent:
        "Network Matrix Primary IPv6 address: 2001:db8::42. Backup IPv6 address: 2001:db8::43. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary IPv6 address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2001:db8::42:99",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary ipv6 address",
    });
    expect(decision.status).toBe("inconclusive");
  });

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

  test("accepts concise grounded phone label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Support phone: +1 (415) 555-0134 Backup phone: +1 (650) 555-0199",
      pageContent:
        "Support Matrix Support phone: +1 (415) 555-0134. Backup phone: +1 (650) 555-0199. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the support phone?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "+1 (415) 555-0134",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "support phone",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling phone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Support phone: +1 (415) 555-0134 Backup phone: +1 (650) 555-0199",
      pageContent:
        "Support Matrix Support phone: +1 (415) 555-0134. Backup phone: +1 (650) 555-0199. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the support phone?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "+1 (650) 555-0199",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "support phone",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded ip address label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Server address: 10.42.0.8 Backup address: 10.42.0.9",
      pageContent:
        "Network Matrix Server address: 10.42.0.8. Backup address: 10.42.0.9. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the server address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.8",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "server address",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling ip address with same prefix", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Server address: 10.42.0.8 Backup address: 10.42.0.9",
      pageContent:
        "Network Matrix Server address: 10.42.0.8. Backup address: 10.42.0.9. The page explains network ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the server address?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10.42.0.9",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "server address",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
