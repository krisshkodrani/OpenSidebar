import { useEffect, useRef, useState } from "react";
import {
  fetchTraceDays,
  fetchTraceInsights,
  type TraceInsightsQuery,
} from "../api";

/** Most recent days to chart — bounds the per-day request fan-out. */
export const TREND_MAX_DAYS = 30;

export interface TrendPoint {
  day: string;
  totalSessions: number;
  completedSessions: number;
  successRate: number;
  estimatedRequestCost: number;
  averageTurns: number;
}

export interface UseTrendDataResult {
  points: TrendPoint[];
  loading: boolean;
  error: string | null;
}

function withinWindow(
  day: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** Stable key over every filter except the single-day selector. */
function trendKey(filters: TraceInsightsQuery): string {
  const { day: _day, ...rest } = filters;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(rest)
        .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

/**
 * Build a per-day time series by fanning the existing /api/trace-insights
 * endpoint across each day in the active window. No backend change required:
 * the insights endpoint already accepts a `day` filter, so one call per day
 * yields that day's success rate and cost. Capped at {@link TREND_MAX_DAYS}.
 */
export function useTrendData(filters: TraceInsightsQuery): UseTrendDataResult {
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevKeyRef = useRef<string | null>(null);

  const key = trendKey(filters);

  useEffect(() => {
    let cancelled = false;
    if (prevKeyRef.current !== key) {
      setLoading(true);
      setError(null);
    }
    prevKeyRef.current = key;

    (async () => {
      try {
        const dayBuckets = await fetchTraceDays();
        if (cancelled) return;
        const days = dayBuckets
          .map((bucket) => bucket.day)
          .filter((day) => withinWindow(day, filters.from, filters.to))
          .sort()
          .slice(-TREND_MAX_DAYS);

        const results = await Promise.all(
          days.map(async (day) => {
            const insights = await fetchTraceInsights({
              ...filters,
              day,
              from: undefined,
              to: undefined,
            });
            const { summary } = insights;
            const point: TrendPoint = {
              day,
              totalSessions: summary.totalSessions,
              completedSessions: summary.completedSessions,
              successRate: summary.successRate,
              estimatedRequestCost:
                summary.estimatedRequestCost ||
                summary.requestCost ||
                summary.totalCost,
              averageTurns: summary.averageTurns,
            };
            return point;
          }),
        );
        if (cancelled) return;
        setPoints(results.filter((point) => point.totalSessions > 0));
        setLoading(false);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setLoading(false);
        setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { points, loading, error };
}
