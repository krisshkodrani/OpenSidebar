import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  assessResultPageProgress,
  createResultPageProgressState,
  extractResultPageCandidates,
} from "../../src/background/agent/result-page-progress-policy";

const query =
  'Answer the following question using the knowledge base: "Which company is charged with ensuring the integrity of our financial audits? State the full name of the company as an answer."';

function toolMessage(content: string) {
  return [{ role: "tool", content }];
}

function pageObservation(lines: string[]) {
  return ["Page: Search Results", "URL: https://example.com/search?q=audit", ...lines].join(
    "\n",
  );
}

describe("result page progress policy", () => {
  test("ranks generic result candidates by question context", () => {
    const candidates = extractResultPageCandidates({
      originalQuery: query,
      text: [
        "Page: Search Results",
        "URL: https://example.com/search?q=audit",
        "### [Article 2](https://example.com/conference)",
        "Enhancing Your Conference Room Experience.",
        "### [Article 25](https://example.com/audit)",
        "Ensuring Integrity and Transparency in Financial Reporting.",
      ].join("\n"),
    });

    expect(candidates[0]?.url).toBe("https://example.com/audit");
  });

  test("does not rank candidates only matching low-value relation words", () => {
    const candidates = extractResultPageCandidates({
      originalQuery: query,
      text: [
        "Page: Search Results",
        "URL: https://example.com/search?q=audit",
        "### [Article 2](https://example.com/conference)",
        "Conference rooms are charged and ensuring each meeting works.",
      ].join("\n"),
    });

    expect(candidates[0]?.score ?? 0).toBeLessThanOrEqual(0);
  });

  test("does not treat result-page image assets as result candidates", () => {
    const candidates = extractResultPageCandidates({
      originalQuery: query,
      text: [
        "Page: integrity financial audits Search Results",
        "URL: https://example.com/search?q=audit",
        "![Knowledge base icon](https://example.com/default_knowledge_base.svg)",
        "### [Audit article](https://example.com/audit)",
        "Financial audit integrity details.",
      ].join("\n"),
    });

    expect(candidates.map((candidate) => candidate.url)).toEqual([
      "https://example.com/audit",
    ]);
  });

  test("grounds a result page once before taking another search action", () => {
    const decision = assessResultPageProgress({
      state: createResultPageProgressState(),
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.SEARCH_KNOWLEDGE_BASE,
      currentUrl: "https://example.com/search?q=audit",
      messages: [],
    });

    expect(decision).toEqual({
      action: "read_page",
      reason: "initial_result_grounding",
    });
  });

  test("ignores stale page observations from a different current URL", () => {
    const state = createResultPageProgressState();
    const messages = toolMessage(
      pageObservation([
        "10 results for audit",
        "### [Article 25](https://example.com/audit)",
        "Ensuring Integrity and Transparency in Financial Reporting.",
      ]),
    );

    const decision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.CLICK_ELEMENT,
      currentUrl: "https://example.com/search?q=other",
      messages,
    });

    expect(decision).toEqual({
      action: "read_page",
      reason: "initial_result_grounding",
    });
  });

  test("navigates to the highest ranked unvisited candidate after grounding", () => {
    const state = createResultPageProgressState();
    const messages = toolMessage(
      pageObservation([
        "10 results for audit",
        "### [Article 2](https://example.com/conference)",
        "Enhancing Your Conference Room Experience.",
        "### [Article 25](https://example.com/audit)",
        "Ensuring Integrity and Transparency in Financial Reporting.",
      ]),
    );

    const decision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.CLICK_ELEMENT,
      currentUrl: "https://example.com/search?q=audit",
      messages,
    });

    expect(decision).toEqual({
      action: "navigate",
      url: "https://example.com/audit",
      reason: "ranked_candidate",
    });
  });

  test("allows a requested navigate to an already ranked candidate", () => {
    const state = createResultPageProgressState();
    const messages = toolMessage(
      pageObservation([
        "10 results for audit",
        "### [Article 25](https://example.com/audit)",
        "Ensuring Integrity and Transparency in Financial Reporting.",
        "### [Article 42](https://example.com/security)",
        "Security audit controls.",
      ]),
    );

    const decision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.NAVIGATE,
      currentUrl: "https://example.com/search?q=audit",
      requestedUrl: "https://example.com/audit",
      messages,
    });

    expect(decision).toEqual({
      action: "none",
      reason: "allow_requested_candidate",
    });
  });

  test("suppresses visited candidates and chooses the next ranked result", () => {
    const state = createResultPageProgressState();
    state.visitedCandidateUrls.add("https://example.com/audit");
    const messages = toolMessage(
      pageObservation([
        "10 results for audit",
        "### [Article 25](https://example.com/audit)",
        "Ensuring Integrity and Transparency in Financial Reporting.",
        "### [Article 26](https://example.com/financial)",
        "Financial audit partner responsibilities.",
      ]),
    );

    const decision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.FIND_ELEMENT,
      currentUrl: "https://example.com/search?q=audit",
      messages,
    });

    expect(decision).toEqual({
      action: "navigate",
      url: "https://example.com/financial",
      reason: "ranked_candidate",
    });
  });

  test("exhausts after repeated equivalent result reads with no candidates", () => {
    const state = createResultPageProgressState();
    const content = pageObservation([
      "0 results for audit",
      "No results found.",
    ]);
    const firstMessages = toolMessage(content);
    const secondMessages = [
      ...firstMessages,
      {
        role: "assistant",
        content: "I should check this once more.",
      },
      ...toolMessage(content),
    ];

    const firstDecision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.CLICK_ELEMENT,
      currentUrl: "https://example.com/search?q=audit",
      messages: firstMessages,
    });
    const secondDecision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.CLICK_ELEMENT,
      currentUrl: "https://example.com/search?q=audit",
      messages: secondMessages,
    });
    const thirdDecision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.CLICK_ELEMENT,
      currentUrl: "https://example.com/search?q=audit",
      messages: secondMessages,
    });

    expect(firstDecision).toEqual({
      action: "read_page",
      reason: "bounded_result_grounding",
    });
    expect(secondDecision).toEqual({
      action: "exhausted",
      reason: "no_unvisited_candidates",
    });
    expect(thirdDecision).toEqual({
      action: "exhausted",
      reason: "no_unvisited_candidates",
    });
  });

  test("exhausts immediately when the configured read cap is already reached", () => {
    const state = createResultPageProgressState();
    const messages = toolMessage(
      pageObservation([
        "0 results for audit",
        "No results found.",
      ]),
    );

    assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.CLICK_ELEMENT,
      currentUrl: "https://example.com/search?q=audit",
      messages,
      maxResultReads: 1,
    });
    const decision = assessResultPageProgress({
      state,
      selectedSkillId: "search-answer-extraction",
      originalQuery: query,
      toolName: ToolName.CLICK_ELEMENT,
      currentUrl: "https://example.com/search?q=audit",
      messages,
      maxResultReads: 1,
    });

    expect(decision).toEqual({
      action: "exhausted",
      reason: "no_unvisited_candidates",
    });
  });
});
