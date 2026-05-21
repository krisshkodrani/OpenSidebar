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

describe("completion kernel page factual read-answer", () => {
  test("accepts read-answer completion from grounded snapshot evidence", () => {
    const snap = workflowSnapshot({
      title: "Onboarding Guide",
      url: "https://example.test/onboarding",
      visibleContent:
        "The onboarding guide says new employees must set up accounts, enroll in security training, review access policies, and meet their manager before requesting production access.",
      pageContent:
        "The onboarding guide says new employees must set up accounts, enroll in security training, review access policies, and meet their manager before requesting production access. The guide also explains that access requests are audited every quarter and that support tickets should include the employee department and manager approval.",
    });
    const generated = generateCompletionContract({
      userRequest: "Summarize this page and mention the key onboarding steps.",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "The page says employees set up accounts, enroll in security training, review access policies, and meet their manager before production access.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
    });
    expect(decision.status).toBe("accepted");
    expect(decision.evidence[0]).toMatchObject({
      type: "answer_state",
      detail: {
        source: "page_read",
        url: "https://example.test/onboarding",
      },
    });
  });

  test("accepts page-scoped factual question as grounded read-answer completion", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units.",
      pageContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer factual warehouse questions from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the Warehouse Beta inventory count on this page?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Beta inventory count is 7,318 units.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
    });
    expect(decision.status).toBe("accepted");
  });

  test("accepts grounded direct factual question without explicit page wording", () => {
    const snap = workflowSnapshot({
      title: "Warehouse Counts",
      url: "https://example.test/warehouses",
      visibleContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units.",
      pageContent:
        "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer factual warehouse questions from the page evidence.",
    });
    const generated = generateCompletionContract({
      userRequest: "What is the Warehouse Beta inventory count?",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Warehouse Beta inventory count is 7,318 units.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
    });
    expect(decision.status).toBe("accepted");
  });

  test("does not use read-answer for ungrounded direct factual question", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the refund policy?",
      snapshot: workflowSnapshot({
        title: "Warehouse Counts",
        url: "https://example.test/warehouses",
        visibleContent:
          "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units.",
        pageContent:
          "Warehouse Beta inventory count is 7,318 units. Warehouse Delta inventory count is 2,184 units. The page compares inventory counts, receiving backlog, audit timing, and replenishment notes so operators can answer factual warehouse questions from the page evidence.",
      }),
    });

    expect(generated).toBeNull();
  });

  test("does not use read-answer for dashboard chart value extraction", () => {
    const generated = generateCompletionContract({
      userRequest: "What is the highest value on this dashboard chart?",
      snapshot: workflowSnapshot({
        title: "Revenue Dashboard",
        visibleContent: "Revenue dashboard with a line chart",
        pageContent: "Revenue dashboard with a line chart",
      }),
    });

    expect(generated).toBeNull();
  });
});
