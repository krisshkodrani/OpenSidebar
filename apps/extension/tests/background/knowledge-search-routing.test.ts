import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  buildKnowledgeBaseSearchArgs,
  extractKnowledgeBaseAnswerCandidate,
  extractKnowledgeBaseAnswerFromText,
  extractKnowledgeBaseRenderedSearchUrl,
  shouldRouteKnowledgeBaseSearchFirst,
  shouldRouteKnowledgeBaseSearchToRenderedResults,
} from "../../src/background/agent/knowledge-search-routing";

describe("knowledge search routing", () => {
  test("routes the first manual search action for knowledge answer workflows", () => {
    expect(
      shouldRouteKnowledgeBaseSearchFirst({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.CLICK_ELEMENT,
        originalQuery:
          'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
        messages: [
          {
            role: "system",
            content:
              "Tool discipline: Use search_knowledge_base before manual search field clicks.",
          },
        ],
      }),
    ).toBe(true);
  });

  test("does not route after the extractor has produced evidence", () => {
    expect(
      shouldRouteKnowledgeBaseSearchFirst({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.TYPE_TEXT,
        originalQuery: "Search the knowledge base and answer the question.",
        messages: [{ role: "tool", content: "Knowledge base search result." }],
      }),
    ).toBe(false);
  });

  test("extracts rendered search URL after shell-only knowledge search", () => {
    expect(
      extractKnowledgeBaseRenderedSearchUrl([
        {
          role: "tool",
          content: [
            "Knowledge base search result.",
            "No answer candidate found in the ranked knowledge results.",
            "Ranked results:",
            "- Service Portal knowledge search: new hires (https://example.service-now.com/kb?id=kb_search&query=new%20hires)",
          ].join("\n"),
        },
      ]),
    ).toBe("https://example.service-now.com/kb?id=kb_search&query=new%20hires");
  });

  test("routes manual recovery to rendered results after shell-only knowledge search", () => {
    expect(
      shouldRouteKnowledgeBaseSearchToRenderedResults({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.CLICK_ELEMENT,
        originalQuery:
          'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
        messages: [
          {
            role: "tool",
            content: [
              "Knowledge base search result.",
              "No answer candidate found in the ranked knowledge results.",
              "Ranked results:",
              "- Service Portal knowledge search: new hires (https://example.service-now.com/kb?id=kb_search&query=new%20hires)",
            ].join("\n"),
          },
        ],
      }),
    ).toBe("https://example.service-now.com/kb?id=kb_search&query=new%20hires");
  });

  test("reroutes over-specific rendered search navigation to extractor fallback", () => {
    expect(
      shouldRouteKnowledgeBaseSearchToRenderedResults({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.NAVIGATE,
        requestedUrl:
          "https://example.service-now.com/kb?id=kb_search&query=new%20hires%20annual%20hiring%20number%20employees%20per%20year",
        originalQuery:
          'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
        messages: [
          {
            role: "tool",
            content: [
              "Knowledge base search result.",
              "No answer candidate found in the ranked knowledge results.",
              "Rendered search URL: https://example.service-now.com/kb?id=kb_search&query=new%20hires",
            ].join("\n"),
          },
        ],
      }),
    ).toBe("https://example.service-now.com/kb?id=kb_search&query=new%20hires");
  });

  test("does not reroute direct article navigation to rendered search", () => {
    expect(
      shouldRouteKnowledgeBaseSearchToRenderedResults({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.NAVIGATE,
        requestedUrl:
          "https://example.service-now.com/kb?id=kb_article_view&sys_kb_id=article8",
        originalQuery:
          'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
        messages: [
          {
            role: "tool",
            content: [
              "Knowledge base search result.",
              "No answer candidate found in the ranked knowledge results.",
              "Rendered search URL: https://example.service-now.com/kb?id=kb_search&query=new%20hires",
            ].join("\n"),
          },
        ],
      }),
    ).toBeNull();
  });

  test("routes repeated shell-only extractor attempts to rendered results", () => {
    expect(
      shouldRouteKnowledgeBaseSearchToRenderedResults({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.SEARCH_KNOWLEDGE_BASE,
        originalQuery:
          'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
        messages: [
          {
            role: "tool",
            content: [
              "Knowledge base search result.",
              "No answer candidate found in the ranked knowledge results.",
              "Ranked results:",
              "- Service Portal knowledge search: new hires (https://example.service-now.com/kb?id=kb_search&query=new%20hires)",
            ].join("\n"),
          },
        ],
      }),
    ).toBe("https://example.service-now.com/kb?id=kb_search&query=new%20hires");
  });

  test("does not reroute to rendered results when already on that URL", () => {
    expect(
      shouldRouteKnowledgeBaseSearchToRenderedResults({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.SEARCH_KNOWLEDGE_BASE,
        originalQuery:
          'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
        currentUrl:
          "https://example.service-now.com/kb?id=kb_search&query=new%20hires#top",
        messages: [
          {
            role: "tool",
            content: [
              "Knowledge base search result.",
              "No answer candidate found in the ranked knowledge results.",
              "Ranked results:",
              "- Service Portal knowledge search: new hires (https://example.service-now.com/kb?id=kb_search&query=new%20hires)",
            ].join("\n"),
          },
        ],
      }),
    ).toBeNull();
  });

  test("does not route rendered results when a candidate was extracted", () => {
    expect(
      shouldRouteKnowledgeBaseSearchToRenderedResults({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.CLICK_ELEMENT,
        originalQuery: "Search the knowledge base and answer the question.",
        messages: [
          {
            role: "tool",
            content: [
              "Knowledge base search result.",
              "Answer candidate: 100",
              "Ranked results:",
              "- Service Portal knowledge search: new hires (https://example.service-now.com/kb?id=kb_search&query=new%20hires)",
            ].join("\n"),
          },
        ],
      }),
    ).toBeNull();
  });

  test("does not reroute manual recovery after a recent extractor attempt", () => {
    expect(
      shouldRouteKnowledgeBaseSearchFirst({
        selectedSkillId: "search-answer-extraction",
        toolName: ToolName.CLICK_ELEMENT,
        originalQuery: "Search the knowledge base and answer the question.",
        messages: [],
        recentToolCalls: [
          {
            tool: ToolName.SEARCH_KNOWLEDGE_BASE,
            argsKey: '{"question":"Search the knowledge base"}',
          },
        ],
      }),
    ).toBe(false);
  });

  test("extracts the quoted question and numeric answer type", () => {
    expect(
      buildKnowledgeBaseSearchArgs(
        'Objective: Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toEqual({
      question:
        "Each year, how many new hires does the company typically make? Your answer should be a number.",
      answerType: "number",
    });
  });

  test("extracts answer candidates from knowledge tool results", () => {
    expect(
      extractKnowledgeBaseAnswerCandidate(
        [
          "Knowledge base search result.",
          "Answer candidate: 123",
          "Evidence sentence: The company typically makes 123 new hires each year.",
        ].join("\n"),
      ),
    ).toBe("123");
  });

  test("extracts numeric answers from visible knowledge result snippets", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Page: Knowledge Search - Knowledge Portal | ServiceNow",
          '4 results for "new hires"',
          "Article 8 General Knowledge Relevancy : 9.9089 Onboarding for new hires.",
          "Article 47 General Knowledge Relevancy : 6.5775 yearly hires is 100, reflecting our sustained growth.",
          "Article Metadata System Administrator Authored by System Administrator 130 Views",
        ].join(" "),
        'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBe("100");
  });

  test("extracts numeric answers from ranked knowledge tool snippets", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Knowledge base search result.",
          "No answer candidate found in the ranked knowledge results.",
          "Ranked results:",
          "- Article 47: Article Article 47 General Knowledge Relevancy : 12.6052 a robust hiring program that attracts and retains the best talent in the industry.",
          "The average number of yearly hires is 100, reflecting our sustained growth and the scaling up of our dynamic teams.",
          "(https://example.service-now.com/kb?sys_kb_id=abc&id=kb_article_view)",
          "- Article 50: Employee wellness and annual budget details.",
        ].join(" "),
        'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBe("100");
  });

  test("does not treat article ids as numeric answers", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Page: Knowledge Search - Knowledge Portal | ServiceNow",
          "Article 8 General Knowledge Relevancy : 9.9089 Onboarding for new hires.",
          "Article Metadata System Administrator Authored by System Administrator 18 Views",
        ].join(" "),
        'Answer using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBeNull();
  });

  test("does not complete hiring questions from search result counts", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Page: Knowledge Search - Knowledge Portal | ServiceNow",
          '3 results for "new hires annually"',
          "Article 8 Onboarding: Ensuring a smooth and welcoming onboarding process for new hires.",
          "Article 40 Orientation process for new hires.",
          "Article 50 Annual employee programs.",
        ].join(" "),
        'Answer using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBeNull();
  });

  test("does not complete hiring questions from unrelated onboarding steps", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Page: Company Protocols - Onboarding a new user - Knowledge Portal",
          "This article has 1 view.",
          "Steps for Onboarding a New User 1. Create a User Account 2. Order a Laptop 3. Create a Hardware Asset",
        ].join(" "),
        'Answer using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBeNull();
  });

  test("does not complete hiring questions from employee budget numbers", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Page: Employee Training - Knowledge Portal",
          "Empowering Our Workforce through Comprehensive Training.",
          "The annual spending on employee training programs is $250,000.",
        ].join(" "),
        'Answer using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBeNull();
  });

  test("does not complete hiring questions from annual budget result snippets", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Page: Knowledge Search - Knowledge Portal | ServiceNow",
          '5 results for "new hires hiring annual"',
          "Article 22 General Knowledge a substantial portion of our budget for these activities.",
          "The annual CSR budget is $500,000 and extends beyond our hiring practices.",
          "Article Metadata System Administrator Authored by System Administrator",
        ].join(" "),
        'Answer using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBeNull();
  });

  test("does not complete hiring questions from knowledge home counters", () => {
    expect(
      extractKnowledgeBaseAnswerFromText(
        [
          "Page: Knowledge Home - Knowledge Portal",
          'Search value="new hires"',
          "Knowledge Home 7 Knowledge Bases 143 Articles Company Protocols 11 General Knowledge 100 IT 32",
          "Article 47 Article Metadata System Administrator updated 4mo ago",
        ].join(" "),
        'Answer using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."',
      ),
    ).toBeNull();
  });
});
