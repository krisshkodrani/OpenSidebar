import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildCompletionEnvelope,
  buildTrustedCompletionCandidate,
  buildTrustedReadAnswerCompletionCandidate,
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

function choice(
  tag: number,
  label: string,
  checked: boolean,
): TaggedElement {
  return {
    tag,
    tagName: "input",
    role: "checkbox",
    text: "on",
    attributes: {
      id: `choice-${tag}`,
      control: `choice-${tag}`,
      name: "answer",
      type: "checkbox",
      checked: String(checked),
      label,
    },
    rect: { x: 0, y: tag * 20, width: 16, height: 16 },
    isVisible: true,
    isDisabled: false,
  };
}

function quizSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Quiz",
    url: "https://example.test/quiz",
    visibleContent:
      "Question 32. Which approaches help adapt a foundation model? (Select two)",
    pageContent:
      "Question 32. Which approaches help adapt a foundation model? (Select two)",
    elements: [
      choice(158, "Domain Adaptation Fine-Tuning", true),
      choice(159, "Continued Pre-Training", true),
      choice(160, "Incremental Learning", false),
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

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

describe("completion kernel read-answer completion", () => {
  test("requires page evidence before read-answer completion", () => {
    const snap = workflowSnapshot({
      title: "Sparse",
      visibleContent: "Loading...",
      pageContent: "Loading...",
    });
    const generated = generateCompletionContract({
      userRequest: "Summarize this page.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: [],
      snapshot: snap,
      candidateSource: "model_done",
      summary: "The page has a useful overview.",
    });

    expect(generated?.contract).toMatchObject({ kind: "read_answer" });
    expect(decision.status).toBe("needs_verification");
    expect(decision.reason).toContain("no grounded page-read evidence");
  });

  test("rejects read-answer completion missing required multi-return coverage", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units.",
      pageContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units. The page compares current stock levels, receiving backlog, audit status, and replenishment timing for both warehouses so operators can report both requested inventory numbers from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Gamma inventory count is 6,412 units.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      taskContract: {
        multiReturnCount: 2,
        requiredEntities: expect.arrayContaining([
          "warehouse gamma",
          "warehouse alpha",
        ]),
      },
    });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("multi-return");
    expect(decision.reason).toContain("warehouse alpha");
  });

  test("accepts read-answer completion with required multi-return coverage", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units.",
      pageContent:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units. The page compares current stock levels, receiving backlog, audit status, and replenishment timing for both warehouses so operators can report both requested inventory numbers from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest:
        "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Warehouse Gamma inventory count is 6,412 units. Warehouse Alpha inventory count is 4,827 units.",
    });

    expect(generated?.source).toBe("task_contract");
    expect(decision.status).toBe("accepted");
  });

  test("derives read-answer evidence from read_page results", () => {
    const snap = workflowSnapshot({
      title: "Release Notes",
      url: "https://example.test/releases",
      visibleContent: "Release notes",
      pageContent: "Release notes",
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.READ_PAGE,
      args: {},
      result:
        "Page content: Release notes explain that version 2.4 adds audit exports, improves dashboard load time, updates permission checks, and fixes the account settings save flow for administrators.",
      preActionSnapshot: snap,
      currentSnapshot: snap,
      turn: 9,
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "answer_state",
          confidence: "high",
          logicalKey: expect.stringContaining("read_answer:page:"),
          observedAtTurn: 9,
          detail: expect.objectContaining({
            source: "page_read",
            url: "https://example.test/releases",
          }),
        }),
      ]),
    );
  });

  test("builds stable completion envelope metadata from accepted evidence", () => {
    const snap = quizSnapshot();
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 8);

    const envelope = buildCompletionEnvelope({
      source: "model_done",
      contractKind: "quiz_selection",
      decisionReason: "Quiz select-only contract is satisfied.",
      evidence,
      turn: 8,
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });
    const duplicate = buildCompletionEnvelope({
      source: "model_done",
      contractKind: "quiz_selection",
      decisionReason: "Quiz select-only contract is satisfied.",
      evidence,
      turn: 8,
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(envelope).toMatchObject({
      status: "completed",
      source: "model_done",
      contractKind: "quiz_selection",
      decisionReason: "Quiz select-only contract is satisfied.",
      evidenceKeys: expect.arrayContaining([
        expect.stringContaining("domain-adaptation-fine-tuning"),
      ]),
    });
    expect(envelope.resultId).toBe(duplicate.resultId);
    expect(envelope.evidenceEpoch).toBe(duplicate.evidenceEpoch);
  });

  test("builds typed trusted read-answer completion evidence", () => {
    const candidate = buildTrustedReadAnswerCompletionCandidate({
      workflow: "search-answer-extraction",
      answer: "100",
      source: "knowledge_base_search",
      turn: 9,
      question:
        "Each year, how many new hires does the company typically make?",
      evidenceText:
        "The average number of yearly hires is 100, reflecting sustained growth.",
      url: "https://example.service-now.test/kb",
    });

    expect(candidate).toMatchObject({
      contractKind: "read_answer",
      decisionReason: expect.stringContaining(
        "grounded knowledge base search evidence",
      ),
      evidence: [
        expect.objectContaining({
          type: "answer_state",
          confidence: "high",
          logicalKey: expect.stringContaining(
            "trusted:search-answer-extraction:answer",
          ),
          observedAtTurn: 9,
          detail: expect.objectContaining({
            answer: "100",
            source: "knowledge_base_search",
            url: "https://example.service-now.test/kb",
          }),
        }),
      ],
    });
  });

  test("preserves explicit trusted workflow target metadata", () => {
    const candidate = buildTrustedCompletionCandidate({
      workflow: "catalog_order",
      summary: "Catalog order submitted: REQ0025875. Item: Premium Monitor.",
      reason: "Trusted catalog order confirmation page matched the request.",
      turn: 12,
      evidenceText:
        "Order Status REQ0025875 Premium Monitor Quantity 10 Total $11,000.00",
      recordId: "REQ0025875",
      targetText: "Premium Monitor",
      url: "https://example.service-now.test/checkout",
    });

    expect(candidate).toMatchObject({
      contractKind: "workflow_confirmation",
      decisionReason: expect.stringContaining("catalog order"),
      evidence: [
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: expect.stringContaining(
            "trusted:catalog-order:confirmation:req0025875",
          ),
          observedAtTurn: 12,
          detail: expect.objectContaining({
            source: "trusted_workflow",
            recordId: "REQ0025875",
            targetText: "Premium Monitor",
            url: "https://example.service-now.test/checkout",
          }),
        }),
      ],
    });
  });

  test("accepts code extraction answer when page evidence uses answer phrasing", () => {
    const snap = workflowSnapshot({
      title: "Social Feed",
      url: "https://example.test/infinite-scroll",
      visibleContent:
        "Post #35 The Secret Formula for Productivity The answer to maximum productivity is: CODE-OMEGA-42.",
      pageContent:
        "Post #35 by Eve K. The Secret Formula for Productivity. The answer to maximum productivity is: CODE-OMEGA-42. Remember this code - it unlocks the productivity dashboard.",
    });
    const generated = generateCompletionContract({
      userRequest:
        "Find Post #35 'The Secret Formula for Productivity' in the feed and tell me the secret code mentioned in it.",
      snapshot: snap,
    });

    expect(generated?.contract).toMatchObject({ kind: "read_answer" });

    const decision = evaluateCompletionContract({
      contract: generated?.contract,

      evidence: deriveCompletionEvidenceFromSnapshot(snap, 7),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "The secret code mentioned in Post #35 'The Secret Formula for Productivity' is CODE-OMEGA-42.",
    });

    expect(decision.status).toBe("accepted");
  });
  test("classifies decomposed navigate-read requested result objectives as read-answer", () => {
    const snap = workflowSnapshot({
      title: "Social Feed",
      url: "https://example.test/infinite-scroll",
      visibleContent:
        "Post #35 The Secret Formula for Productivity The answer to maximum productivity is: CODE-OMEGA-42.",
      pageContent:
        "Post #35 by Eve K. The Secret Formula for Productivity. The answer to maximum productivity is: CODE-OMEGA-42. Remember this code - it unlocks the productivity dashboard.",
    });
    const generated = generateCompletionContract({
      userRequest:
        "Find Post #35 'The Secret Formula for Productivity' in the feed and tell me the secret code mentioned in it.",
      activeObjective:
        "Navigate to Post #35 and read the requested result there.",
      successCriteria:
        "The requested result is reported from the matching post.",
      snapshot: snap,
    });

    expect(generated?.contract).toMatchObject({ kind: "read_answer" });
  });

  test("classifies decomposed report requested results objectives as read-answer", () => {
    const snap = workflowSnapshot({
      title: "Social Feed",
      url: "https://example.test/infinite-scroll",
      visibleContent:
        "Post #35 The Secret Formula for Productivity The answer to maximum productivity is: CODE-OMEGA-42.",
      pageContent:
        "Post #35 by Eve K. The Secret Formula for Productivity. The answer to maximum productivity is: CODE-OMEGA-42. Remember this code - it unlocks the productivity dashboard.",
    });
    const generated = generateCompletionContract({
      userRequest:
        "Find Post #35 'The Secret Formula for Productivity' in the feed and tell me the secret code mentioned in it.",
      activeObjective:
        "Report the requested results for the secret formula for productivity.",
      successCriteria:
        "The requested result is reported from the matching post.",
      snapshot: snap,
    });

    expect(generated?.contract).toMatchObject({ kind: "read_answer" });
  });
});

