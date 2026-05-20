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
describe("completion kernel typed label-value read-answer", () => {
  test("accepts concise grounded email label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Owner email: support@example.com Backup email: help@example.com",
      pageContent:
        "Support Matrix Owner email: support@example.com. Backup email: help@example.com. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the owner email?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "support@example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner email",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling email label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Owner email: support@example.com Backup email: help@example.com",
      pageContent:
        "Support Matrix Owner email: support@example.com. Backup email: help@example.com. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the owner email?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "help@example.com",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "owner email",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded url label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Portal URL: https://portal.example.com/login Backup URL: https://backup.example.com/login",
      pageContent:
        "Support Matrix Portal URL: https://portal.example.com/login. Backup URL: https://backup.example.com/login. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the portal URL?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "https://portal.example.com/login",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "portal url",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling url label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Portal URL: https://portal.example.com/login Backup URL: https://backup.example.com/login",
      pageContent:
        "Support Matrix Portal URL: https://portal.example.com/login. Backup URL: https://backup.example.com/login. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the portal URL?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "https://backup.example.com/login",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "portal url",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded path label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml Backup path: /etc/open-sidebar/config.bak",
      pageContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml. Backup path: /etc/open-sidebar/config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config path?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "/etc/open-sidebar/config.yaml",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config path",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling path label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml Backup path: /etc/open-sidebar/config.bak",
      pageContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml. Backup path: /etc/open-sidebar/config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config path?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "/etc/open-sidebar/config.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config path",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept path prefix inside a longer path", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml Archive path: /etc/open-sidebar/config.yaml.bak",
      pageContent:
        "Runtime Matrix Config path: /etc/open-sidebar/config.yaml. Archive path: /etc/open-sidebar/config.yaml.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config path?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "/etc/open-sidebar/config.yaml.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config path",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded Windows path label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml Backup file: C:\\OpenSidebar\\config.bak",
      pageContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml. Backup file: C:\\OpenSidebar\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "C:\\OpenSidebar\\config.yaml",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config file",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling Windows path label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml Backup file: C:\\OpenSidebar\\config.bak",
      pageContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml. Backup file: C:\\OpenSidebar\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "C:\\OpenSidebar\\config.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept Windows path prefix inside a longer path", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml Archive file: C:\\OpenSidebar\\config.yaml.bak",
      pageContent:
        "Runtime Matrix Config file: C:\\OpenSidebar\\config.yaml. Archive file: C:\\OpenSidebar\\config.yaml.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "C:\\OpenSidebar\\config.yaml.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded UNC path label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml Backup file: \\\\fileserver\\share\\config.bak",
      pageContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml. Backup file: \\\\fileserver\\share\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the shared config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "\\\\fileserver\\share\\config.yaml",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "shared config file",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling UNC path label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml Backup file: \\\\fileserver\\share\\config.bak",
      pageContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml. Backup file: \\\\fileserver\\share\\config.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the shared config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "\\\\fileserver\\share\\config.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "shared config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept UNC path prefix inside a longer path", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml Archive file: \\\\fileserver\\share\\config.yaml.bak",
      pageContent:
        "Runtime Matrix Shared config file: \\\\fileserver\\share\\config.yaml. Archive file: \\\\fileserver\\share\\config.yaml.bak. The page explains runtime ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the shared config file?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "\\\\fileserver\\share\\config.yaml.bak",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "shared config file",
    });
    expect(decision.status).toBe("inconclusive");
  });

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

  test("accepts concise grounded numeric label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 14 Closed tickets: 9",
      pageContent:
        "Support Matrix Open tickets: 14. Closed tickets: 9. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise numeric label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 9 Closed tickets: 14",
      pageContent:
        "Support Matrix Open tickets: 9. Closed tickets: 14. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded decimal percent label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Reliability Matrix",
      url: "https://example.test/reliability",
      visibleContent:
        "Reliability Matrix Uptime percentage: 99.9% Target uptime: 99%",
      pageContent:
        "Reliability Matrix Uptime percentage: 99.9%. Target uptime: 99%. The page explains reliability ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer reliability questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the uptime percentage?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "99.9%",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "uptime percentage",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept truncated decimal percent label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Reliability Matrix",
      url: "https://example.test/reliability",
      visibleContent:
        "Reliability Matrix Uptime percentage: 99.9% Target uptime: 99%",
      pageContent:
        "Reliability Matrix Uptime percentage: 99.9%. Target uptime: 99%. The page explains reliability ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer reliability questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the uptime percentage?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "99%",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "uptime percentage",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept truncated decimal currency label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Budget Matrix",
      url: "https://example.test/budget",
      visibleContent:
        "Budget Matrix Monthly budget: $1,250.50 Monthly spend: $1,250.00",
      pageContent:
        "Budget Matrix Monthly budget: $1,250.50. Monthly spend: $1,250.00. The page explains budget ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer budget questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the monthly budget?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "$1,250",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monthly budget",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded decimal currency label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Budget Matrix",
      url: "https://example.test/budget",
      visibleContent:
        "Budget Matrix Monthly budget: $1,250.50 Monthly spend: $1,250.00",
      pageContent:
        "Budget Matrix Monthly budget: $1,250.50. Monthly spend: $1,250.00. The page explains budget ownership, service priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer budget questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the monthly budget?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "$1,250.50",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "monthly budget",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts concise numeric label-value answer with existential count wording", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 14 Closed tickets: 9",
      pageContent:
        "Support Matrix Open tickets: 14. Closed tickets: 9. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets are there?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong existential count label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 9 Closed tickets: 14",
      pageContent:
        "Support Matrix Open tickets: 9. Closed tickets: 14. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "How many open tickets are there?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise numeric label-value answer with number-of count wording", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 14 Closed tickets: 9",
      pageContent:
        "Support Matrix Open tickets: 14. Closed tickets: 9. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the number of open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong number-of count label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Open tickets: 9 Closed tickets: 14",
      pageContent:
        "Support Matrix Open tickets: 9. Closed tickets: 14. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the number of open tickets?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "open tickets",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded identifier label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident number: INC0012345 Change number: CHG0099",
      pageContent:
        "Incident Matrix Incident number: INC0012345. Change number: CHG0099. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "INC0012345",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident number",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise identifier label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Incident number: INC0012345 Change number: CHG0099",
      pageContent:
        "Incident Matrix Incident number: INC0012345. Change number: CHG0099. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the incident number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CHG0099",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "incident number",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded hyphenated identifier label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Case number: CASE-1234 Related case: CASE-1234-B",
      pageContent:
        "Incident Matrix Case number: CASE-1234. Related case: CASE-1234-B. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the case number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CASE-1234",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "case number",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept identifier prefix inside a longer identifier", () => {
    const snap = workflowSnapshot({
      title: "Incident Matrix",
      url: "https://example.test/incidents",
      visibleContent:
        "Incident Matrix Case number: CASE-1234 Related case: CASE-1234-B",
      pageContent:
        "Incident Matrix Case number: CASE-1234. Related case: CASE-1234-B. The page explains service coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer incident questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the case number?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "CASE-1234-B",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "case number",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded uuid label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Session Matrix",
      url: "https://example.test/sessions",
      visibleContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366 Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
      pageContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366. Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a. The page explains session ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer session questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the session ID?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "4a0402d6-ad57-435e-8db0-6bf179f30366",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "session id",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling uuid label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Session Matrix",
      url: "https://example.test/sessions",
      visibleContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366 Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
      pageContent:
        "Session Matrix Session ID: 4a0402d6-ad57-435e-8db0-6bf179f30366. Request ID: 7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a. The page explains session ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer session questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the session ID?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "7d9dcf6e-b399-4d33-a8f2-9a60f0217a2a",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "session id",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded hash label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling hash label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept hash prefix inside a longer value", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      pageContent:
        "Release Matrix Release SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08. Backup hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the release SHA256 hash?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08-backup",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "release sha256 hash",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded version label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.0",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.0. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.1",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept sibling version label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.0",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.0. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.0",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept same-prefix longer version label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix App version: v2.4.1 API version: v2.4.10",
      pageContent:
        "Release Matrix App version: v2.4.1. API version: v2.4.10. The page explains release ownership, support coverage, rollout timing, incident routing, customer impact, compatibility guidance, audit notes, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the app version?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "v2.4.10",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "app version",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("does not accept arbitrary single-word label-value answer summaries", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent: "Support Matrix Escalation owner: Alice Team: Bob",
      pageContent:
        "Support Matrix Escalation owner: Alice. Team: Bob. The page explains support coverage, ticket priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer support policy questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Who is the escalation owner?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Alice",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "escalation owner",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded date label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Due date: 2026-05-18 Review date: 2026-06-01",
      pageContent:
        "Schedule Matrix Due date: 2026-05-18. Review date: 2026-06-01. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the due date?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not accept the wrong concise date label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Due date: 2026-05-18 Review date: 2026-06-01",
      pageContent:
        "Schedule Matrix Due date: 2026-05-18. Review date: 2026-06-01. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the due date?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-06-01",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "due date",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise date-range label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Deployment window: 2026-05-18 - 2026-05-20 Backup window: 2026-06-01 - 2026-06-03",
      pageContent:
        "Release Matrix Deployment window: 2026-05-18 - 2026-05-20. Backup window: 2026-06-01 - 2026-06-03. The page explains release ownership, deployment policy, schedule windows, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the deployment window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18-2026-05-20",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-06-01-2026-06-03",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "deployment window",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts date-range label-value answer with to separator", () => {
    const snap = workflowSnapshot({
      title: "Freeze Matrix",
      url: "https://example.test/freezes",
      visibleContent:
        "Freeze Matrix Freeze period: 2026-11-01 to 2026-11-15 Backup period: 2026-12-01 to 2026-12-15",
      pageContent:
        "Freeze Matrix Freeze period: 2026-11-01 to 2026-11-15. Backup period: 2026-12-01 to 2026-12-15. The page explains freeze ownership, release policy, schedule windows, audit notes, incident routing, maintenance coordination, environment ownership, escalation routing, and manager review so operators can answer freeze questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the freeze period?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-11-01 to 2026-11-15",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "freeze period",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept date-range concise answers without a date-range label", () => {
    const snap = workflowSnapshot({
      title: "Release Matrix",
      url: "https://example.test/releases",
      visibleContent:
        "Release Matrix Team code: 2026-05-18 - 2026-05-20 Backup code: 2026-06-01 - 2026-06-03",
      pageContent:
        "Release Matrix Team code: 2026-05-18 - 2026-05-20. Backup code: 2026-06-01 - 2026-06-03. The page explains release ownership, deployment policy, schedule windows, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer release questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "2026-05-18 - 2026-05-20",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts concise grounded time label-value answer summary", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Maintenance time: 14:30 Review time: 15:30",
      pageContent:
        "Schedule Matrix Maintenance time: 14:30. Review time: 15:30. The page explains schedule ownership, release priority, customer impact, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "When is the maintenance time?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "14:30",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintenance time",
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts only the expected concise duration label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent:
        "Runtime Matrix Request timeout: 30s Retry timeout: 60s",
      pageContent:
        "Runtime Matrix Request timeout: 30s. Retry timeout: 60s. The page explains runtime ownership, service coverage, queue behavior, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the request timeout?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "30s",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60s",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "request timeout",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept unit-like concise answers without a duration label", () => {
    const snap = workflowSnapshot({
      title: "Runtime Matrix",
      url: "https://example.test/runtime",
      visibleContent: "Runtime Matrix Team code: 30s Backup code: 60s",
      pageContent:
        "Runtime Matrix Team code: 30s. Backup code: 60s. The page explains runtime ownership, service coverage, queue behavior, response timing, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer runtime questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "30s",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise data-size label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Storage Matrix",
      url: "https://example.test/storage",
      visibleContent:
        "Storage Matrix Artifact size: 512 MB Backup size: 1 GB",
      pageContent:
        "Storage Matrix Artifact size: 512 MB. Backup size: 1 GB. The page explains storage ownership, capacity planning, quota behavior, upload limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer storage questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the artifact size?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "512MB",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "1GB",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "artifact size",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept data-size concise answers without a size label", () => {
    const snap = workflowSnapshot({
      title: "Storage Matrix",
      url: "https://example.test/storage",
      visibleContent: "Storage Matrix Team code: 512MB Backup code: 1GB",
      pageContent:
        "Storage Matrix Team code: 512MB. Backup code: 1GB. The page explains storage ownership, capacity planning, quota behavior, upload limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer storage questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "512MB",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise data-rate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent:
        "Network Matrix Download speed: 50 Mbps Upload speed: 10 Mbps",
      pageContent:
        "Network Matrix Download speed: 50 Mbps. Upload speed: 10 Mbps. The page explains network ownership, bandwidth planning, throughput behavior, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the download speed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "50Mbps",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "10Mbps",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "download speed",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept data-rate concise answers without a rate label", () => {
    const snap = workflowSnapshot({
      title: "Network Matrix",
      url: "https://example.test/network",
      visibleContent: "Network Matrix Team code: 50Mbps Backup code: 10Mbps",
      pageContent:
        "Network Matrix Team code: 50Mbps. Backup code: 10Mbps. The page explains network ownership, bandwidth planning, throughput behavior, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer network questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "50Mbps",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise temperature label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Environment Matrix",
      url: "https://example.test/environment",
      visibleContent:
        "Environment Matrix Server temperature: 72 F Backup temperature: 68 F",
      pageContent:
        "Environment Matrix Server temperature: 72 F. Backup temperature: 68 F. The page explains environment monitoring, thermal policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer environment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the server temperature?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "72F",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "68F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "server temperature",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept temperature concise answers without a temperature label", () => {
    const snap = workflowSnapshot({
      title: "Environment Matrix",
      url: "https://example.test/environment",
      visibleContent: "Environment Matrix Team code: 72F Backup code: 68F",
      pageContent:
        "Environment Matrix Team code: 72F. Backup code: 68F. The page explains environment monitoring, thermal policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer environment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "72F",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise electrical label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Power Matrix",
      url: "https://example.test/power",
      visibleContent:
        "Power Matrix Output voltage: 12 V Backup voltage: 24 V",
      pageContent:
        "Power Matrix Output voltage: 12 V. Backup voltage: 24 V. The page explains power monitoring, electrical policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer power questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the output voltage?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12V",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "24V",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "output voltage",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept electrical concise answers without an electrical label", () => {
    const snap = workflowSnapshot({
      title: "Power Matrix",
      url: "https://example.test/power",
      visibleContent: "Power Matrix Team code: 12V Backup code: 24V",
      pageContent:
        "Power Matrix Team code: 12V. Backup code: 24V. The page explains power monitoring, electrical policy, service limits, audit notes, incident routing, maintenance coordination, data center ownership, escalation routing, and manager review so operators can answer power questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12V",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise mass label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Shipping Matrix",
      url: "https://example.test/shipping",
      visibleContent:
        "Shipping Matrix Package weight: 12 kg Backup weight: 15 kg",
      pageContent:
        "Shipping Matrix Package weight: 12 kg. Backup weight: 15 kg. The page explains shipping policy, payload handling, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer shipping questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the package weight?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12kg",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15kg",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "package weight",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept mass concise answers without a mass label", () => {
    const snap = workflowSnapshot({
      title: "Shipping Matrix",
      url: "https://example.test/shipping",
      visibleContent: "Shipping Matrix Team code: 12kg Backup code: 15kg",
      pageContent:
        "Shipping Matrix Team code: 12kg. Backup code: 15kg. The page explains shipping policy, payload handling, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer shipping questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12kg",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise length label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Dimension Matrix",
      url: "https://example.test/dimensions",
      visibleContent:
        "Dimension Matrix Package width: 12 cm Backup width: 15 cm",
      pageContent:
        "Dimension Matrix Package width: 12 cm. Backup width: 15 cm. The page explains package dimensions, clearance policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer dimension questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the package width?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12cm",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15cm",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "package width",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept length concise answers without a length label", () => {
    const snap = workflowSnapshot({
      title: "Dimension Matrix",
      url: "https://example.test/dimensions",
      visibleContent: "Dimension Matrix Team code: 12cm Backup code: 15cm",
      pageContent:
        "Dimension Matrix Team code: 12cm. Backup code: 15cm. The page explains package dimensions, clearance policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer dimension questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12cm",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise volume label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Fluid Matrix",
      url: "https://example.test/fluids",
      visibleContent: "Fluid Matrix Tank volume: 12 L Backup volume: 15 L",
      pageContent:
        "Fluid Matrix Tank volume: 12 L. Backup volume: 15 L. The page explains fluid handling, reservoir policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer fluid questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the tank volume?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12L",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "15L",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tank volume",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept volume concise answers without a volume label", () => {
    const snap = workflowSnapshot({
      title: "Fluid Matrix",
      url: "https://example.test/fluids",
      visibleContent: "Fluid Matrix Team code: 12L Backup code: 15L",
      pageContent:
        "Fluid Matrix Team code: 12L. Backup code: 15L. The page explains fluid handling, reservoir policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer fluid questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "12L",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise pressure label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Pressure Matrix",
      url: "https://example.test/pressure",
      visibleContent:
        "Pressure Matrix Tank pressure: 35 psi Backup pressure: 40 psi",
      pageContent:
        "Pressure Matrix Tank pressure: 35 psi. Backup pressure: 40 psi. The page explains hydraulic monitoring, pneumatic policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer pressure questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the tank pressure?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "35psi",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "40psi",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "tank pressure",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept pressure concise answers without a pressure label", () => {
    const snap = workflowSnapshot({
      title: "Pressure Matrix",
      url: "https://example.test/pressure",
      visibleContent: "Pressure Matrix Team code: 35psi Backup code: 40psi",
      pageContent:
        "Pressure Matrix Team code: 35psi. Backup code: 40psi. The page explains hydraulic monitoring, pneumatic policy, service limits, audit notes, incident routing, maintenance coordination, warehouse ownership, escalation routing, and manager review so operators can answer pressure questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "35psi",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise frequency label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Display Matrix",
      url: "https://example.test/display",
      visibleContent:
        "Display Matrix Refresh frequency: 60 Hz Backup frequency: 75 Hz",
      pageContent:
        "Display Matrix Refresh frequency: 60 Hz. Backup frequency: 75 Hz. The page explains display timing, refresh policy, service limits, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer display questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the refresh frequency?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "75Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "refresh frequency",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept frequency concise answers without a frequency label", () => {
    const snap = workflowSnapshot({
      title: "Display Matrix",
      url: "https://example.test/display",
      visibleContent: "Display Matrix Team code: 60Hz Backup code: 75Hz",
      pageContent:
        "Display Matrix Team code: 60Hz. Backup code: 75Hz. The page explains display timing, refresh policy, service limits, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer display questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60Hz",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise UTC timezone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Time zone: UTC+02:00 Backup time zone: UTC-05:00",
      pageContent:
        "Schedule Matrix Time zone: UTC+02:00. Backup time zone: UTC-05:00. The page explains schedule ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the time zone?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC+02:00",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC-05:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "time zone",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise IANA timezone label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Deployment Matrix",
      url: "https://example.test/deployments",
      visibleContent:
        "Deployment Matrix Deployment timezone: Europe/Berlin Backup timezone: America/New_York",
      pageContent:
        "Deployment Matrix Deployment timezone: Europe/Berlin. Backup timezone: America/New_York. The page explains deployment ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer deployment questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the deployment timezone?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Europe/Berlin",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "America/New_York",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "deployment timezone",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept timezone concise answers without a timezone label", () => {
    const snap = workflowSnapshot({
      title: "Schedule Matrix",
      url: "https://example.test/schedule",
      visibleContent:
        "Schedule Matrix Team code: UTC+02:00 Backup code: UTC-05:00",
      pageContent:
        "Schedule Matrix Team code: UTC+02:00. Backup code: UTC-05:00. The page explains schedule ownership, time zone policy, service windows, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer schedule questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "UTC+02:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise locale label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Language locale: en-US Backup locale: fr-FR",
      pageContent:
        "Localization Matrix Language locale: en-US. Backup locale: fr-FR. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the language locale?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "fr-FR",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "language locale",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise extended locale label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Preferred locale: zh-Hans-CN Backup locale: en-US",
      pageContent:
        "Localization Matrix Preferred locale: zh-Hans-CN. Backup locale: en-US. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the preferred locale?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "zh-Hans-CN",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "preferred locale",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept locale concise answers without a locale label", () => {
    const snap = workflowSnapshot({
      title: "Localization Matrix",
      url: "https://example.test/localization",
      visibleContent:
        "Localization Matrix Team code: en-US Backup code: fr-FR",
      pageContent:
        "Localization Matrix Team code: en-US. Backup code: fr-FR. The page explains localization ownership, language policy, regional formatting, audit notes, incident routing, maintenance coordination, device ownership, escalation routing, and manager review so operators can answer localization questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "en-US",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise coordinate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix GPS coordinates: 37.7749, -122.4194 Backup coordinates: 40.7128, -74.0060",
      pageContent:
        "Location Matrix GPS coordinates: 37.7749, -122.4194. Backup coordinates: 40.7128, -74.0060. The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What are the GPS coordinates?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "37.7749,-122.4194",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "40.7128,-74.0060",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "gps coordinates",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts parenthesized coordinate label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix Location coordinates: (51.5074, -0.1278) Backup coordinates: (48.8566, 2.3522)",
      pageContent:
        "Location Matrix Location coordinates: (51.5074, -0.1278). Backup coordinates: (48.8566, 2.3522). The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What are the location coordinates?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "51.5074,-0.1278",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "location coordinates",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept coordinate concise answers without a coordinate label", () => {
    const snap = workflowSnapshot({
      title: "Location Matrix",
      url: "https://example.test/locations",
      visibleContent:
        "Location Matrix Team code: 37.7749, -122.4194 Backup code: 40.7128, -74.0060",
      pageContent:
        "Location Matrix Team code: 37.7749, -122.4194. Backup code: 40.7128, -74.0060. The page explains location ownership, geolocation policy, routing notes, audit timing, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer location questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "37.7749, -122.4194",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise time-window label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Maintenance Matrix",
      url: "https://example.test/maintenance",
      visibleContent:
        "Maintenance Matrix Maintenance window: 02:00-04:00 Backup window: 05:00-07:00",
      pageContent:
        "Maintenance Matrix Maintenance window: 02:00-04:00. Backup window: 05:00-07:00. The page explains maintenance ownership, schedule policy, service windows, audit notes, incident routing, coordination plans, device ownership, escalation routing, and manager review so operators can answer maintenance questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the maintenance window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "02:00-04:00",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "05:00-07:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "maintenance window",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts spaced time-window label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Support Matrix",
      url: "https://example.test/support",
      visibleContent:
        "Support Matrix Service window: 09:00 - 17:30 Backup window: 18:00 - 20:00",
      pageContent:
        "Support Matrix Service window: 09:00 - 17:30. Backup window: 18:00 - 20:00. The page explains support ownership, service hours, schedule policy, audit notes, incident routing, coordination plans, queue ownership, escalation routing, and manager review so operators can answer support questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the service window?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "09:00-17:30",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "service window",
    });
    expect(accepted.status).toBe("accepted");
  });

  test("does not accept time-window concise answers without a time-window label", () => {
    const snap = workflowSnapshot({
      title: "Maintenance Matrix",
      url: "https://example.test/maintenance",
      visibleContent:
        "Maintenance Matrix Team code: 02:00-04:00 Backup code: 05:00-07:00",
      pageContent:
        "Maintenance Matrix Team code: 02:00-04:00. Backup code: 05:00-07:00. The page explains maintenance ownership, schedule policy, service windows, audit notes, incident routing, coordination plans, device ownership, escalation routing, and manager review so operators can answer maintenance questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "02:00-04:00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise physical speed label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Route Matrix",
      url: "https://example.test/routes",
      visibleContent: "Route Matrix Cruise speed: 55 mph Backup speed: 60 mph",
      pageContent:
        "Route Matrix Cruise speed: 55 mph. Backup speed: 60 mph. The page explains route timing, travel policy, service limits, audit notes, incident routing, maintenance coordination, fleet ownership, escalation routing, and manager review so operators can answer route questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the cruise speed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "55mph",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "60mph",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "cruise speed",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept physical speed concise answers without a speed label", () => {
    const snap = workflowSnapshot({
      title: "Route Matrix",
      url: "https://example.test/routes",
      visibleContent: "Route Matrix Team code: 55mph Backup code: 60mph",
      pageContent:
        "Route Matrix Team code: 55mph. Backup code: 60mph. The page explains route timing, travel policy, service limits, audit notes, incident routing, maintenance coordination, fleet ownership, escalation routing, and manager review so operators can answer route questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "55mph",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise area label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Facility Matrix",
      url: "https://example.test/facility",
      visibleContent:
        "Facility Matrix Room area: 250 sq ft Backup area: 300 sq ft",
      pageContent:
        "Facility Matrix Room area: 250 sq ft. Backup area: 300 sq ft. The page explains facility planning, floor space policy, service limits, audit notes, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer facility questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the room area?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "250sqft",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "300sqft",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "room area",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept area concise answers without an area label", () => {
    const snap = workflowSnapshot({
      title: "Facility Matrix",
      url: "https://example.test/facility",
      visibleContent: "Facility Matrix Team code: 250sqft Backup code: 300sqft",
      pageContent:
        "Facility Matrix Team code: 250sqft. Backup code: 300sqft. The page explains facility planning, floor space policy, service limits, audit notes, incident routing, maintenance coordination, site ownership, escalation routing, and manager review so operators can answer facility questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "250sqft",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise hex color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: #1A2B3C Backup color: #00FF00",
      pageContent:
        "Theme Matrix Primary color: #1A2B3C. Backup color: #00FF00. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#1A2B3C",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#00FF00",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept hex color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: #1A2B3C Backup code: #00FF00",
      pageContent:
        "Theme Matrix Team code: #1A2B3C. Backup code: #00FF00. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "#1A2B3C",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise rgb color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rgb(12, 34, 56) Backup color: rgb(90, 80, 70)",
      pageContent:
        "Theme Matrix Primary color: rgb(12, 34, 56). Backup color: rgb(90, 80, 70). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12,34,56)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(90,80,70)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept rgb color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rgb(12, 34, 56) Backup code: rgb(90, 80, 70)",
      pageContent:
        "Theme Matrix Team code: rgb(12, 34, 56). Backup code: rgb(90, 80, 70). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12,34,56)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise hsl color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: hsl(210, 50%, 40%) Backup color: hsl(120, 60%, 50%)",
      pageContent:
        "Theme Matrix Primary color: hsl(210, 50%, 40%). Backup color: hsl(120, 60%, 50%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210,50%,40%)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(120,60%,50%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept hsl color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: hsl(210, 50%, 40%) Backup code: hsl(120, 60%, 50%)",
      pageContent:
        "Theme Matrix Team code: hsl(210, 50%, 40%). Backup code: hsl(120, 60%, 50%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210,50%,40%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise modern rgb color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rgb(12 34 56 / 0.5) Backup color: rgb(90 80 70 / 75%)",
      pageContent:
        "Theme Matrix Primary color: rgb(12 34 56 / 0.5). Backup color: rgb(90 80 70 / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12 34 56/0.5)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(90 80 70/75%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("accepts only the expected concise modern hsl color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: hsl(210 50% 40% / 0.75) Backup color: hsl(120 60% 50% / 75%)",
      pageContent:
        "Theme Matrix Primary color: hsl(210 50% 40% / 0.75). Backup color: hsl(120 60% 50% / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(210 50% 40%/0.75)",
    });
    const rejected = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "hsl(120 60% 50%/75%)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejected.status).toBe("inconclusive");
  });

  test("does not accept modern slash color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rgb(12 34 56 / 0.5) Backup code: hsl(120 60% 50% / 75%)",
      pageContent:
        "Theme Matrix Team code: rgb(12 34 56 / 0.5). Backup code: hsl(120 60% 50% / 75%). The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rgb(12 34 56/0.5)",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });

  test("accepts only the expected concise named color label-value answer", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Primary color: rebeccapurple Backup color: steelblue",
      pageContent:
        "Theme Matrix Primary color: rebeccapurple. Backup color: steelblue. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the primary color?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple",
    });
    const rejectedSibling = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "steelblue",
    });
    const rejectedCompound = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple-blue",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "primary color",
    });
    expect(accepted.status).toBe("accepted");
    expect(rejectedSibling.status).toBe("inconclusive");
    expect(rejectedCompound.status).toBe("inconclusive");
  });

  test("does not accept named color concise answers without a color label", () => {
    const snap = workflowSnapshot({
      title: "Theme Matrix",
      url: "https://example.test/theme",
      visibleContent:
        "Theme Matrix Team code: rebeccapurple Backup code: steelblue",
      pageContent:
        "Theme Matrix Team code: rebeccapurple. Backup code: steelblue. The page explains theme ownership, palette policy, service limits, audit notes, incident routing, maintenance coordination, design ownership, escalation routing, and manager review so operators can answer theme questions from visible page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the team code?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "rebeccapurple",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "team code",
    });
    expect(decision.status).toBe("inconclusive");
  });
});
