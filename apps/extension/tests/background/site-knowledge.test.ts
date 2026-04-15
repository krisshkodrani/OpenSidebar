import { describe, test, expect } from "vitest";
import {
  extractDomain,
  buildExtractionContext,
  extractSiteKnowledgeFallback,
  deduplicateSiteKnowledge,
  rankSiteKnowledgeForTask,
  formatSiteKnowledgeForPrompt,
} from "../../src/background/orchestrator/site-knowledge";
import type { OrchestratorTask } from "../../src/background/orchestrator/types";
import type { TaskCompletionMessage } from "../../src/types/messages";
import type { MemoryResult } from "../../src/background/infrastructure/backend-client";

// ── Helpers ──

function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    rootTabId: 1,
    query: "Search for flights on kayak.com",
    status: "completed",
    createdAt: Date.now(),
    nodes: [],
    plannerReflexionLog: [],
    maxWorkers: 1,
    maxReplans: 2,
    replansUsed: 0,
    horizonExpansions: 0,
    currentIndex: 0,
    sessionMetrics: { totalTokens: 0, totalCost: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, turns: 0 } as any,
    budget: { maxSessionTimeMs: 300000, maxTotalTokens: 100000, maxTotalCostUsd: 1 },
    ...overrides,
  } as OrchestratorTask;
}

function makePayload(overrides: Partial<TaskCompletionMessage["payload"]> = {}): TaskCompletionMessage["payload"] {
  return {
    taskId: "task-1",
    status: "completed",
    summary: "Searched for flights successfully",
    subtaskResults: [],
    totalTurnsUsed: 5,
    totalTimeMs: 30000,
    urlHistory: [],
    metrics: {} as any,
    ...overrides,
  } as TaskCompletionMessage["payload"];
}

// ── extractDomain ──

describe("extractDomain", () => {
  test("extracts hostname from HTTP URL", () => {
    expect(extractDomain("https://www.kayak.com/flights")).toBe("kayak.com");
  });

  test("strips www prefix", () => {
    expect(extractDomain("https://www.example.com")).toBe("example.com");
  });

  test("preserves subdomains other than www", () => {
    expect(extractDomain("https://app.example.com/page")).toBe("app.example.com");
  });

  test("returns null for chrome:// URLs", () => {
    expect(extractDomain("chrome://extensions")).toBeNull();
  });

  test("returns null for about: URLs", () => {
    expect(extractDomain("about:blank")).toBeNull();
  });

  test("returns null for chrome-extension:// URLs", () => {
    expect(extractDomain("chrome-extension://abc123/popup.html")).toBeNull();
  });

  test("returns null for invalid URLs", () => {
    expect(extractDomain("not-a-url")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractDomain("")).toBeNull();
  });
});

// ── buildExtractionContext ──

describe("buildExtractionContext", () => {
  test("includes domain, task query, and outcome", () => {
    const task = makeTask({ nodes: [] });
    const payload = makePayload();
    const context = buildExtractionContext(task, payload, "https://kayak.com/flights");

    expect(context).toContain("Domain: kayak.com");
    expect(context).toContain("Task: Search for flights");
    expect(context).toContain("Outcome: completed");
  });

  test("includes node details and reflexion log", () => {
    const task = makeTask({
      nodes: [
        {
          id: "n1",
          role: "executor",
          description: "Fill flight search form",
          successCriteria: "Form submitted",
          allowedTools: [],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [
            {
              attempt: 1,
              executorSummary: "Clicked search but cookie banner blocked it",
              verifierDecision: "retry",
              verifierReason: "Cookie consent overlay blocked the search button",
              failureType: "blocked",
              confidence: 0.9,
              suggestedApproach: "Dismiss cookie banner first",
              timestamp: Date.now(),
            },
          ],
          handoffDepth: 0,
          status: "completed",
          retries: 1,
          result: "Form submitted after dismissing banner",
        },
      ] as any,
    });
    const payload = makePayload();
    const context = buildExtractionContext(task, payload, "https://kayak.com");

    expect(context).toContain("Fill flight search form");
    expect(context).toContain("Retries: 1");
    expect(context).toContain("Cookie consent overlay blocked");
    expect(context).toContain("Dismiss cookie banner first");
  });

  test("truncates to ~6000 chars", () => {
    const longNodes = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      role: "executor",
      description: "A".repeat(200),
      successCriteria: "Done",
      allowedTools: [],
      dependencies: [],
      assumptions: [],
      handoffArtifacts: [],
      reflexionLog: [],
      handoffDepth: 0,
      status: "completed",
      retries: 0,
      result: "B".repeat(200),
    }));
    const task = makeTask({ nodes: longNodes as any });
    const context = buildExtractionContext(task, makePayload(), "https://example.com");

    expect(context.length).toBeLessThanOrEqual(6020); // 6000 + "[truncated]"
  });
});

// ── extractSiteKnowledgeFallback ──

describe("extractSiteKnowledgeFallback", () => {
  test("extracts cookie banner pattern from reflexion log", () => {
    const task = makeTask({
      nodes: [
        {
          id: "n1",
          role: "executor",
          description: "Click buy button",
          successCriteria: "Button clicked",
          allowedTools: [],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [
            {
              attempt: 1,
              executorSummary: "Cookie consent dialog blocked the button",
              verifierDecision: "retry",
              verifierReason: "Cookie overlay prevented interaction",
              failureType: "blocked",
              confidence: 0.85,
              timestamp: Date.now(),
            },
          ],
          handoffDepth: 0,
          status: "completed",
          retries: 1,
        },
      ] as any,
    });

    const entries = extractSiteKnowledgeFallback(task, makePayload(), "example.com");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].tip.toLowerCase()).toContain("cookie");
    expect(entries[0].domain).toBe("example.com");
    expect(entries[0].tipType).toBe("recovery");
  });

  test("extracts reroute lesson", () => {
    const task = makeTask({
      nodes: [
        {
          id: "n1",
          role: "executor",
          description: "Navigate to search",
          successCriteria: "Search page loaded",
          allowedTools: [],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [
            {
              attempt: 1,
              executorSummary: "Tried main nav link but page 404d",
              verifierDecision: "reroute",
              verifierReason: "Navigation failed",
              failureType: "state_mismatch",
              confidence: 0.8,
              suggestedApproach: "Use the site search box in the header instead",
              timestamp: Date.now(),
            },
          ],
          handoffDepth: 0,
          status: "completed",
          retries: 1,
        },
      ] as any,
    });

    const entries = extractSiteKnowledgeFallback(task, makePayload(), "example.com");
    const reroute = entries.find((e) => e.tipType === "strategy");
    expect(reroute).toBeDefined();
    expect(reroute!.tip).toContain("site search box");
  });

  test("extracts rate limiting pattern from node error", () => {
    const task = makeTask({
      nodes: [
        {
          id: "n1",
          role: "executor",
          description: "Scrape product list",
          successCriteria: "Products scraped",
          allowedTools: [],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [],
          handoffDepth: 0,
          status: "failed",
          retries: 0,
          error: "HTTP 429 Too Many Requests — rate limit exceeded",
        },
      ] as any,
    });

    const entries = extractSiteKnowledgeFallback(task, makePayload({ status: "failed" }), "example.com");
    expect(entries.some((e) => e.tip.toLowerCase().includes("rate limit"))).toBe(true);
  });

  test("extracts success-after-retry pattern", () => {
    const task = makeTask({
      nodes: [
        {
          id: "n1",
          role: "executor",
          description: "Submit form",
          successCriteria: "Form submitted",
          allowedTools: [],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [
            {
              attempt: 1,
              executorSummary: "Form failed",
              verifierDecision: "retry",
              verifierReason: "Form not submitted",
              failureType: "transient",
              confidence: 0.7,
              suggestedApproach: "Wait for page to fully load before interacting",
              timestamp: Date.now(),
            },
          ],
          handoffDepth: 0,
          status: "completed",
          retries: 1,
        },
      ] as any,
    });

    const entries = extractSiteKnowledgeFallback(task, makePayload(), "example.com");
    expect(entries.some((e) => e.tip.includes("Wait for page to fully load"))).toBe(true);
  });

  test("returns max 4 entries", () => {
    const task = makeTask({
      nodes: Array.from({ length: 10 }, (_, i) => ({
        id: `n${i}`,
        role: "executor",
        description: `Step ${i}`,
        successCriteria: "Done",
        allowedTools: [],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [
          {
            attempt: 1,
            executorSummary: `Cookie banner blocked step ${i}`,
            verifierDecision: "retry",
            verifierReason: `Cookie overlay blocked step ${i}`,
            failureType: "blocked",
            confidence: 0.8,
            suggestedApproach: `Workaround ${i}: use different approach`,
            timestamp: Date.now(),
          },
        ],
        handoffDepth: 0,
        status: "completed",
        retries: 1,
      })) as any,
    });

    const entries = extractSiteKnowledgeFallback(task, makePayload(), "example.com");
    expect(entries.length).toBeLessThanOrEqual(4);
  });

  test("returns empty array when no patterns found", () => {
    const task = makeTask({
      nodes: [
        {
          id: "n1",
          role: "executor",
          description: "Simple click",
          successCriteria: "Clicked",
          allowedTools: [],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [],
          handoffDepth: 0,
          status: "completed",
          retries: 0,
        },
      ] as any,
    });

    const entries = extractSiteKnowledgeFallback(task, makePayload(), "example.com");
    expect(entries).toHaveLength(0);
  });
});

// ── deduplicateSiteKnowledge ──

describe("deduplicateSiteKnowledge", () => {
  test("removes duplicate memories by content", () => {
    const memories: MemoryResult[] = [
      { slug: "a", title: "T1", category: "site-knowledge", content: "Dismiss cookie banner", score: 1 },
      { slug: "b", title: "T2", category: "site-knowledge", content: "Dismiss cookie banner", score: 0.9 },
      { slug: "c", title: "T3", category: "site-knowledge", content: "Use hamburger menu for search", score: 0.8 },
    ];

    const deduped = deduplicateSiteKnowledge(memories);
    expect(deduped).toHaveLength(2);
  });

  test("handles case/whitespace differences", () => {
    const memories: MemoryResult[] = [
      { slug: "a", title: "T1", category: "site-knowledge", content: "Dismiss cookie banner", score: 1 },
      { slug: "b", title: "T2", category: "site-knowledge", content: "dismiss  cookie  banner", score: 0.9 },
    ];

    const deduped = deduplicateSiteKnowledge(memories);
    expect(deduped).toHaveLength(1);
  });

  test("preserves confidence from metadata", () => {
    const memories: MemoryResult[] = [
      {
        slug: "a",
        title: "T1",
        category: "site-knowledge",
        content: "Some tip",
        score: 1,
        metadata: { confidence: 0.95, tipType: "strategy" },
      },
    ];

    const deduped = deduplicateSiteKnowledge(memories);
    expect(deduped[0].confidence).toBe(0.95);
    expect(deduped[0].tipType).toBe("strategy");
  });
});

// ── formatSiteKnowledgeForPrompt ──

describe("formatSiteKnowledgeForPrompt", () => {
  test("formats entries with header and tip type prefix", () => {
    const result = formatSiteKnowledgeForPrompt([
      { tip: "Dismiss cookie banner before interaction", tipType: "recovery", confidence: 0.9 },
      { tip: "Search form is in the hamburger menu", tipType: "optimization", confidence: 0.7 },
    ]);

    expect(result).toContain("SITE KNOWLEDGE");
    expect(result).toContain("[recovery]");
    expect(result).toContain("[optimization]");
    expect(result).toContain("Dismiss cookie banner");
  });

  test("returns empty string for no entries", () => {
    expect(formatSiteKnowledgeForPrompt([])).toBe("");
  });

  test("sorts by confidence descending", () => {
    const result = formatSiteKnowledgeForPrompt([
      { tip: "Low confidence tip", confidence: 0.3 },
      { tip: "High confidence tip", confidence: 0.95 },
    ]);

    const highIdx = result.indexOf("High confidence");
    const lowIdx = result.indexOf("Low confidence");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  test("limits to 4 entries", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      tip: `Tip number ${i}`,
      confidence: 0.5 + i * 0.05,
    }));

    const result = formatSiteKnowledgeForPrompt(entries);
    const bulletCount = (result.match(/^- /gm) || []).length;
    expect(bulletCount).toBeLessThanOrEqual(4);
  });

  test("caps total length to ~800 chars", () => {
    const entries = Array.from({ length: 4 }, () => ({
      tip: "A".repeat(300),
      confidence: 0.9,
    }));

    const result = formatSiteKnowledgeForPrompt(entries);
    expect(result.length).toBeLessThanOrEqual(850);
  });
});

describe("rankSiteKnowledgeForTask", () => {
  test("prefers query-relevant tips over higher-confidence noise", () => {
    const ranked = rankSiteKnowledgeForTask(
      [
        { tip: "probe tip final", tipType: "strategy", confidence: 0.99 },
        {
          tip: "The dashboard's report list is behind the Reports tab. Open Reports before answering questions about available reports.",
          tipType: "strategy",
          confidence: 0.98,
        },
        { tip: "probe tip five", tipType: "strategy", confidence: 0.99 },
      ],
      "What reports are available on this dashboard? Give me the report names.",
    );

    expect(ranked[0]?.tip).toContain("dashboard's report list");
  });

  test("limits ranked results to top 3 entries", () => {
    const ranked = rankSiteKnowledgeForTask(
      Array.from({ length: 6 }, (_, i) => ({
        tip: `Tip ${i} for dashboard reports`,
        confidence: 0.5 + i * 0.01,
      })),
      "dashboard reports",
    );

    expect(ranked).toHaveLength(3);
  });
});
