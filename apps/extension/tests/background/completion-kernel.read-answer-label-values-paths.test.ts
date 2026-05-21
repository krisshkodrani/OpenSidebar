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
describe("completion kernel path label-value read-answer", () => {
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

});
