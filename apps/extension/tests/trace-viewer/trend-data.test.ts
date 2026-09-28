import { describe, expect, it } from "vitest";
import type { TraceInsightsResponse } from "../../src/trace-viewer/api";
import {
  fetchDailyTrendPoints,
  TREND_MAX_CONCURRENT_REQUESTS,
} from "../../src/trace-viewer/hooks/useTrendData";

describe("daily trend reads", () => {
  it("bounds simultaneous requests and preserves day order", async () => {
    const days = Array.from({ length: 8 }, (_, index) =>
      `2026-09-${String(index + 1).padStart(2, "0")}`);
    let active = 0;
    let peak = 0;
    const requested: string[] = [];
    const points = await fetchDailyTrendPoints(days, {}, new AbortController().signal,
      async (filters) => {
        requested.push(filters.day ?? "");
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { summary: {
          totalSessions: 1,
          completedSessions: 1,
          successRate: 1,
          estimatedRequestCost: 1,
          averageTurns: 1,
        } } as TraceInsightsResponse;
      });
    expect(peak).toBe(TREND_MAX_CONCURRENT_REQUESTS);
    expect(requested).toHaveLength(days.length);
    expect(points.map((point) => point.day)).toEqual(days);
  });
});
