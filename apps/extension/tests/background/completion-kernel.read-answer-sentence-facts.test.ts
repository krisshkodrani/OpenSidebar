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

describe("completion kernel sentence-scoped factual read-answer", () => {
  test("accepts definition sentence-scoped answer for a meaning question", () => {
    const snap = workflowSnapshot({
      title: "Model Glossary",
      url: "https://example.test/glossary",
      visibleContent:
        "Domain Adaptation Fine-Tuning means adapting a pretrained model to a target domain with representative examples. Generic Fine-Tuning means updating model weights for a broader task.",
      pageContent:
        "Domain Adaptation Fine-Tuning means adapting a pretrained model to a target domain with representative examples. Generic Fine-Tuning means updating model weights for a broader task. The page explains model training vocabulary, deployment notes, evaluation criteria, dataset preparation, audit requirements, release timing, and support ownership so readers can answer glossary questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What does Domain Adaptation Fine-Tuning mean?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "It means adapting a pretrained model to a target domain with representative examples.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It means updating model weights for a broader task.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "definition",
      expectedAnswerTarget: "Domain Adaptation Fine-Tuning",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts definition sentence-scoped answer for a what-is question", () => {
    const snap = workflowSnapshot({
      title: "Security Glossary",
      url: "https://example.test/security",
      visibleContent:
        "Zero Trust is a security model that verifies every request before granting access. Password Rotation is a scheduled credential reset policy.",
      pageContent:
        "Zero Trust is a security model that verifies every request before granting access. Password Rotation is a scheduled credential reset policy. The page explains identity controls, authorization checks, session review, monitoring, device posture, access logs, operational ownership, and rollout timing so readers can answer security glossary questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is Zero Trust?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Zero Trust is a security model that verifies every request.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It is a scheduled credential reset policy.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "definition",
      expectedAnswerTarget: "Zero Trust",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts definition sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Model Glossary",
      url: "https://example.test/glossary",
      visibleContent:
        "Domain Adaptation Fine-Tuning means adapting a pretrained model to a target domain with representative examples. Generic Fine-Tuning means updating model weights for a broader task.",
      pageContent:
        "Domain Adaptation Fine-Tuning means adapting a pretrained model to a target domain with representative examples. Generic Fine-Tuning means updating model weights for a broader task. The page explains model training vocabulary, deployment notes, evaluation criteria, dataset preparation, audit requirements, release timing, and support ownership so readers can answer glossary questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What does Domain Adaptation Fine-Tuning mean?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nDomain Adaptation Fine-Tuning means adapting a pretrained model to a target domain with representative examples. Generic Fine-Tuning means updating model weights for a broader task. The page explains model training vocabulary, deployment notes, evaluation criteria, dataset preparation, audit requirements, release timing, and support ownership so readers can answer glossary questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary:
        "It means adapting a pretrained model to a target domain with representative examples.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "It means updating model weights for a broader task.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "definition",
      expectedAnswerTarget: "Domain Adaptation Fine-Tuning",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not use definition sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Model Glossary",
      url: "https://example.test/glossary",
      visibleContent:
        "Model Glossary Domain Adaptation Fine-Tuning means adapting a pretrained model to a target domain Generic Fine-Tuning means updating model weights for a broader task",
      pageContent:
        "Model Glossary Domain Adaptation Fine-Tuning means adapting a pretrained model to a target domain Generic Fine-Tuning means updating model weights for a broader task. The page explains model training vocabulary, deployment notes, evaluation criteria, dataset preparation, audit requirements, release timing, and support ownership so readers can answer glossary questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "What does Domain Adaptation Fine-Tuning mean?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "It means adapting a pretrained model to a target domain with representative examples.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("accepts reason sentence-scoped answer for a why question", () => {
    const snap = workflowSnapshot({
      title: "Project Updates",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas was delayed because vendor approval arrived late. Project Borealis was delayed because budget approval changed.",
      pageContent:
        "Project Atlas was delayed because vendor approval arrived late. Project Borealis was delayed because budget approval changed. The page explains project timeline risk, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Why was Project Atlas delayed?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It was delayed because vendor approval arrived late.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It was delayed because budget approval changed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "delayed reason",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts due-to reason sentence-scoped answer for a why question", () => {
    const snap = workflowSnapshot({
      title: "Project Updates",
      url: "https://example.test/projects",
      visibleContent:
        "Database Migration is blocked due to pending firewall approval. Report Export is blocked due to missing credentials.",
      pageContent:
        "Database Migration is blocked due to pending firewall approval. Report Export is blocked due to missing credentials. The page explains project timeline risk, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Why is Database Migration blocked?",
      snapshot: snap,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It is blocked due to pending firewall approval.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It is blocked due to missing credentials.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "blocked reason",
      expectedAnswerTarget: "Database Migration",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("accepts reason sentence-scoped answer from read_page evidence without live snapshot", () => {
    const snap = workflowSnapshot({
      title: "Project Updates",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas was delayed because vendor approval arrived late. Project Borealis was delayed because budget approval changed.",
      pageContent:
        "Project Atlas was delayed because vendor approval arrived late. Project Borealis was delayed because budget approval changed. The page explains project timeline risk, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Why was Project Atlas delayed?",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content:\nProject Atlas was delayed because vendor approval arrived late. Project Borealis was delayed because budget approval changed. The page explains project timeline risk, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project questions from visible prose evidence.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });
    const accepted = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "It was delayed because vendor approval arrived late.",
    });
    const siblingValue = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      candidateSource: "model_done",
      summary: "It was delayed because budget approval changed.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      expectedAnswerLabel: "delayed reason",
      expectedAnswerTarget: "Project Atlas",
      expectedAnswerScope: "sentence",
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.evidence[0]?.logicalKey).toContain(
      "read_answer:sentence-text:",
    );
    expect(siblingValue.status).toBe("inconclusive");
  });

  test("does not accept a reason sentence with the wrong requested predicate", () => {
    const snap = workflowSnapshot({
      title: "Project Updates",
      url: "https://example.test/projects",
      visibleContent:
        "Project Atlas was canceled because the sponsor withdrew. Project Borealis was delayed because vendor approval arrived late.",
      pageContent:
        "Project Atlas was canceled because the sponsor withdrew. Project Borealis was delayed because vendor approval arrived late. The page explains project timeline risk, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project questions from visible prose evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "Why was Project Atlas delayed?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It was delayed because the sponsor withdrew.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });

  test("does not use reason sentence-scoped acceptance from flattened page text", () => {
    const snap = workflowSnapshot({
      title: "Project Updates",
      url: "https://example.test/projects",
      visibleContent:
        "Project Updates Project Atlas was delayed because vendor approval arrived late Project Borealis was delayed because budget approval changed",
      pageContent:
        "Project Updates Project Atlas was delayed because vendor approval arrived late Project Borealis was delayed because budget approval changed. The page explains project timeline risk, release ownership, support process, deployment requirements, budget review, customer communications, dependency status, and audit notes so readers can answer project questions from visible prose evidence.",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Why was Project Atlas delayed?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "It was delayed because vendor approval arrived late.",
    });

    expect(
      generated?.contract.kind === "read_answer"
        ? generated.contract.expectedAnswerScope
        : undefined,
    ).toBeUndefined();
    expect(decision.status).not.toBe("accepted");
  });
});
