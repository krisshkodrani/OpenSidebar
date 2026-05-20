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


});
