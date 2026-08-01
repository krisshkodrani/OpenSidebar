import { useEffect, useRef, useState } from "react";
import {
  fetchTraceTrends,
  type TraceInsightsQuery,
  type TraceTrendPoint,
} from "../api";

/** Most recent days to chart — bounds the per-day request fan-out. */
export const TREND_MAX_DAYS = 30;

export type TrendPoint = TraceTrendPoint;

export interface UseTrendDataResult {
  points: TrendPoint[];
  loading: boolean;
  error: string | null;
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
 * Load the per-day time series from one grouped SQLite query.
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
        const results = await fetchTraceTrends(filters, TREND_MAX_DAYS);
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
