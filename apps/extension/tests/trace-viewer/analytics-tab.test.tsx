import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import AnalyticsTab from "../../src/trace-viewer/components/traces/AnalyticsTab";

const mockInsights = {
  summary: {
    totalSessions: 12,
    totalRuns: 4,
    completedSessions: 9,
    failedSessions: 3,
    successRate: 0.75,
    failureRate: 0.25,
    totalTurns: 96,
    averageTurns: 8,
    totalCost: 1.25,
    averageDurationMs: 60_000,
    toolCalls: 200,
    toolFailures: 10,
    toolFailureRate: 0.05,
    llmRequests: 150,
    promptTokens: 1_000_000,
    completionTokens: 50_000,
    cachedTokens: 400_000,
    nonCachedInputTokens: 600_000,
    totalTokens: 1_050_000,
    requestCost: 1.25,
    estimatedInputCost: 0.8,
    estimatedCachedInputCost: 0.1,
    estimatedOutputCost: 0.35,
    estimatedRequestCost: 1.25,
    outputTokenShare: 0.05,
    outputCostShare: 0.28,
    unpricedRequests: 0,
    averagePromptTokens: 6_667,
    averageCompletionTokens: 333,
    averageTotalTokens: 7_000,
    totalLlmDurationMs: 300_000,
    averageLlmDurationMs: 2_000,
    partialHandoffCount: 0,
    maxTurnsWithHandoffCount: 0,
    maxTurnsWithoutUsefulProgressCount: 0,
    escalatedSessions: 3,
    escalations: 4,
    escalationRescued: 2,
    escalationFailedFast: 1,
    escalationBudgetExhausted: 1,
    escalationFireRate: 0.25,
    escalationRescueRate: 0.5,
  },
  facets: {
    runs: [],
    sessions: [],
    domains: [],
    models: [],
    skills: ["order-lookup"],
    tools: ["click"],
    failures: [],
    eventTypes: [],
  },
  tools: [],
  skills: [],
  models: [],
  failures: [],
  events: [],
  runs: [],
};

vi.mock("../../src/trace-viewer/hooks/useInsightsData", () => ({
  useInsightsData: () => ({
    insights: mockInsights,
    loading: false,
    error: null,
  }),
}));
vi.mock("../../src/trace-viewer/hooks/useTrendData", () => ({
  useTrendData: () => ({ points: [], loading: false }),
}));
vi.mock("../../src/trace-viewer/api", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    fetchHarnessRatchet: vi.fn().mockResolvedValue([]),
    fetchTraceIndexStatus: vi.fn().mockResolvedValue(null),
  };
});

describe("AnalyticsTab", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("renders the KPI row from insights and keeps drill-downs collapsed", async () => {
    await act(async () => {
      root.render(
        <AnalyticsTab onSelectSession={() => {}} onFocusRun={() => {}} />,
      );
    });

    const text = container.textContent ?? "";
    // KPI row values from the mocked summary.
    expect(text).toContain("Traces");
    expect(text).toContain("12");
    expect(text).toContain("Runs");
    expect(text).toContain("75%");
    expect(text).toContain("Est. cost");
    // Escalation aggregate preview (fire · rescue) from the mocked summary.
    expect(text).toContain("Escalations");
    expect(text).toContain("25% fire · 50% rescue");
    // Drill-down sections exist but are collapsed by default.
    expect(text).toContain("Failures");
    expect(text).toContain("Tools");
    expect(text).toContain("Models");
    expect(text).toContain("Ratchet");
    const openSections = container.querySelectorAll(
      ".collapsible.open",
    );
    expect(openSections.length).toBe(0);
  });

  test("expands a drill-down section on click", async () => {
    await act(async () => {
      root.render(
        <AnalyticsTab onSelectSession={() => {}} onFocusRun={() => {}} />,
      );
    });

    const failuresTrigger = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Failures"));
    expect(failuresTrigger).toBeTruthy();

    await act(async () => {
      failuresTrigger!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.querySelectorAll(".collapsible.open").length).toBe(1);
    expect(container.textContent).toContain(
      "No failures found for the current filters.",
    );
  });
});
