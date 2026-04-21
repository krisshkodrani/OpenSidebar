import { describe, expect, test } from "vitest";
import "../setup";
import {
  computeFleetAnalytics,
  computeRegressionSummary,
  computeSkillPolicyRegressionSummary,
  FLEET_LENSES,
  isLensActive,
} from "../../src/trace-viewer/analytics";

describe("trace-viewer analytics", () => {
  test("computes fleet rollups for sessions and domains", () => {
    const analytics = computeFleetAnalytics(
      [
        {
          sessionId: "s1",
          startTime: 100,
          endTime: 300,
          query: "Objective: one",
          startUrl: "https://app.example.com/a",
          outcome: "completed",
          turnCount: 2,
          summary: "done",
          metrics: { totalCost: 0.1, modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 2 } } },
          skillToolMetrics: {
            skillId: "structured-form-fill",
            rankingApplications: 2,
            totalSelections: 2,
            preferredSelections: 2,
            neutralSelections: 0,
            discouragedSelections: 0,
            preferredSelectionRate: 1,
            discouragedSelectionRate: 0,
          },
        },
        {
          sessionId: "s2",
          startTime: 200,
          endTime: 700,
          query: "Objective: two",
          startUrl: "https://app.example.com/b",
          outcome: "error",
          turnCount: 4,
          summary: "failed",
          metrics: { totalCost: 0.3, modelBreakdown: { "openai/gpt-5.4": { calls: 4 } } },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 2,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 1,
            preferredSelectionRate: 0.5,
            discouragedSelectionRate: 0.5,
          },
        },
        {
          sessionId: "s3",
          startTime: 300,
          endTime: 1300,
          query: "Objective: three",
          startUrl: "https://docs.example.org/c",
          outcome: "max_turns",
          turnCount: 6,
          summary: "stalled",
          metrics: { totalCost: 0.6, modelBreakdown: { "openai/gpt-5.4": { calls: 6 } } },
        },
        {
          sessionId: "s4",
          startTime: 400,
          endTime: 800,
          query: "Objective: four",
          startUrl: "https://app.example.com/d",
          outcome: "completed",
          turnCount: 3,
          summary: "done",
          metrics: { totalCost: 0.2, modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 3 } } },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 3,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 2,
            preferredSelectionRate: 1 / 3,
            discouragedSelectionRate: 2 / 3,
          },
        },
      ] as any,
      [] as any,
    );

    expect(Math.round(analytics.successRate * 100)).toBe(50);
    expect(analytics.averageTurns).toBe(3.75);
    expect(analytics.errorSessions).toBe(1);
    expect(analytics.maxTurnsSessions).toBe(1);
    expect(analytics.skillGuidedSessions).toBe(3);
    expect(Math.round(analytics.preferredToolSelectionRate * 100)).toBe(57);
    expect(Math.round(analytics.discouragedToolSelectionRate * 100)).toBe(43);
    expect(analytics.topSkillPolicies[0]).toEqual({
      skillId: "modal-overlay-recovery",
      sessions: 2,
      preferredRate: 0.4,
    });
    expect(analytics.topSkillPolicies[1]).toEqual({
      skillId: "structured-form-fill",
      sessions: 1,
      preferredRate: 1,
    });
    expect(analytics.skillPolicyAlerts[0]).toEqual({
      skillId: "modal-overlay-recovery",
      sessions: 2,
      preferredRate: 0.4,
      discouragedRate: 0.6,
      severity: "critical",
      reason: "High discouraged-tool selection rate",
    });
    expect(analytics.topFailingDomains[0]).toEqual({
      domain: "app.example.com",
      count: 1,
    });
    expect(analytics.topModels[0]).toEqual({ model: "gpt-5.4-mini:nitro", count: 2 });
  });

  test("matches active lenses by filter subset", () => {
    const plannerLens = FLEET_LENSES.find((lens) => lens.key === "planner");
    expect(plannerLens).toBeTruthy();
    expect(
      isLensActive(
        {
          outcome: "all",
          day: "all",
          from: "2026-04-09",
          to: "2026-04-15",
          domain: "",
          mode: "all",
          model: "all",
          tier: "planner",
          runId: "",
        },
        plannerLens!,
      ),
    ).toBe(true);
  });

  test("computes regression summary across the last and previous 7-day windows", () => {
    const summary = computeRegressionSummary(
      [
        {
          sessionId: "older",
          startTime: Date.UTC(2026, 3, 2),
          endTime: Date.UTC(2026, 3, 2, 0, 5),
          query: "Objective: older",
          startUrl: "https://example.com",
          outcome: "error",
          turnCount: 6,
          summary: "older",
          metrics: { totalCost: 0.6 },
        },
        {
          sessionId: "recent-1",
          startTime: Date.UTC(2026, 3, 13),
          endTime: Date.UTC(2026, 3, 13, 0, 5),
          query: "Objective: recent 1",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "recent",
          metrics: { totalCost: 0.2 },
        },
        {
          sessionId: "recent-2",
          startTime: Date.UTC(2026, 3, 15),
          endTime: Date.UTC(2026, 3, 15, 0, 10),
          query: "Objective: recent 2",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 3,
          summary: "recent",
          metrics: { totalCost: 0.3 },
        },
      ] as any,
    );

    expect(summary).not.toBeNull();
    expect(summary!.currentLabel).toBe("Last 7d");
    expect(summary!.current.sessionCount).toBe(2);
    expect(Math.round(summary!.current.successRate * 100)).toBe(100);
    expect(summary!.previous.sessionCount).toBe(1);
    expect(Math.round(summary!.previous.successRate * 100)).toBe(0);
  });

  test("computes skill policy regression against the previous 7-day window", () => {
    const summary = computeSkillPolicyRegressionSummary(
      [
        {
          sessionId: "older-1",
          startTime: Date.UTC(2026, 3, 2),
          endTime: Date.UTC(2026, 3, 2, 0, 5),
          query: "older",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "older",
          metrics: { totalCost: 0.2 },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 4,
            neutralSelections: 0,
            discouragedSelections: 1,
            preferredSelectionRate: 0.8,
            discouragedSelectionRate: 0.2,
          },
        },
        {
          sessionId: "older-2",
          startTime: Date.UTC(2026, 3, 3),
          endTime: Date.UTC(2026, 3, 3, 0, 5),
          query: "older 2",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "older",
          metrics: { totalCost: 0.2 },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 4,
            neutralSelections: 0,
            discouragedSelections: 1,
            preferredSelectionRate: 0.8,
            discouragedSelectionRate: 0.2,
          },
        },
        {
          sessionId: "recent-1",
          startTime: Date.UTC(2026, 3, 13),
          endTime: Date.UTC(2026, 3, 13, 0, 5),
          query: "recent 1",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "recent",
          metrics: { totalCost: 0.2 },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 4,
            preferredSelectionRate: 0.2,
            discouragedSelectionRate: 0.8,
          },
        },
        {
          sessionId: "recent-1b",
          startTime: Date.UTC(2026, 3, 14),
          endTime: Date.UTC(2026, 3, 14, 0, 5),
          query: "recent 1b",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "recent",
          metrics: { totalCost: 0.2 },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 4,
            preferredSelectionRate: 0.2,
            discouragedSelectionRate: 0.8,
          },
        },
        {
          sessionId: "recent-2",
          startTime: Date.UTC(2026, 3, 15),
          endTime: Date.UTC(2026, 3, 15, 0, 10),
          query: "recent 2",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 3,
          summary: "recent",
          metrics: { totalCost: 0.3 },
          skillToolMetrics: {
            skillId: "structured-form-fill",
            rankingApplications: 1,
            totalSelections: 3,
            preferredSelections: 3,
            neutralSelections: 0,
            discouragedSelections: 0,
            preferredSelectionRate: 1,
            discouragedSelectionRate: 0,
          },
        },
        {
          sessionId: "older-structured",
          startTime: Date.UTC(2026, 3, 4),
          endTime: Date.UTC(2026, 3, 4, 0, 10),
          query: "older structured",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 2,
          summary: "older",
          metrics: { totalCost: 0.2 },
          skillToolMetrics: {
            skillId: "continuation-edit",
            rankingApplications: 1,
            totalSelections: 3,
            preferredSelections: 2,
            neutralSelections: 1,
            discouragedSelections: 0,
            preferredSelectionRate: 2 / 3,
            discouragedSelectionRate: 0,
          },
        },
        {
          sessionId: "recent-low-signal",
          startTime: Date.UTC(2026, 3, 16),
          endTime: Date.UTC(2026, 3, 16, 0, 10),
          query: "recent low signal",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 1,
          summary: "recent",
          metrics: { totalCost: 0.1 },
          skillToolMetrics: {
            skillId: "hover-reveal-navigation",
            rankingApplications: 1,
            totalSelections: 2,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 1,
            preferredSelectionRate: 0.5,
            discouragedSelectionRate: 0.5,
          },
        },
        {
          sessionId: "older-low-signal",
          startTime: Date.UTC(2026, 3, 5),
          endTime: Date.UTC(2026, 3, 5, 0, 10),
          query: "older low signal",
          startUrl: "https://example.com",
          outcome: "completed",
          turnCount: 1,
          summary: "older",
          metrics: { totalCost: 0.1 },
          skillToolMetrics: {
            skillId: "hover-reveal-navigation",
            rankingApplications: 1,
            totalSelections: 2,
            preferredSelections: 2,
            neutralSelections: 0,
            discouragedSelections: 0,
            preferredSelectionRate: 1,
            discouragedSelectionRate: 0,
          },
        },
      ] as any,
    );

    expect(summary).not.toBeNull();
    expect(summary!.currentLabel).toBe("Last 7d");
    expect(summary!.changes[0]).toEqual({
      skillId: "modal-overlay-recovery",
      currentSessions: 2,
      previousSessions: 1,
      currentSelections: 10,
      previousSelections: 5,
      currentPreferredRate: 0.2,
      previousPreferredRate: 0.8,
      currentDiscouragedRate: 0.8,
      previousDiscouragedRate: 0.2,
      trend: "worse",
    });
    expect(summary!.changes.some((item) => item.skillId === "structured-form-fill" && item.trend === "new")).toBe(true);
    expect(summary!.changes.some((item) => item.skillId === "continuation-edit" && item.trend === "inactive")).toBe(true);
    expect(summary!.changes.some((item) => item.skillId === "hover-reveal-navigation" && item.trend === "low-signal")).toBe(true);
  });
});
