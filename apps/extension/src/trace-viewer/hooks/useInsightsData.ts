import { useEffect, useRef, useState } from "react";
import { getInsights, insightsCacheKey } from "../insights-cache";
import type { TraceInsightsQuery, TraceInsightsResponse } from "../api";

const TIMEOUT_MS = 30_000;

function emptyInsights(): TraceInsightsResponse {
  return {
    summary: {
      totalSessions: 0,
      totalRuns: 0,
      completedSessions: 0,
      failedSessions: 0,
      successRate: 0,
      failureRate: 0,
      totalTurns: 0,
      averageTurns: 0,
      totalCost: 0,
      averageDurationMs: 0,
      toolCalls: 0,
      toolFailures: 0,
      toolFailureRate: 0,
      llmRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      nonCachedInputTokens: 0,
      totalTokens: 0,
      requestCost: 0,
      estimatedInputCost: 0,
      estimatedCachedInputCost: 0,
      estimatedOutputCost: 0,
      estimatedRequestCost: 0,
      outputTokenShare: 0,
      outputCostShare: 0,
      unpricedRequests: 0,
      averagePromptTokens: 0,
      averageCompletionTokens: 0,
      averageTotalTokens: 0,
      totalLlmDurationMs: 0,
      averageLlmDurationMs: 0,
      partialHandoffCount: 0,
      maxTurnsWithHandoffCount: 0,
      maxTurnsWithoutUsefulProgressCount: 0,
    },
    facets: {
      runs: [],
      sessions: [],
      domains: [],
      models: [],
      skills: [],
      tools: [],
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
}

export interface UseInsightsDataResult {
  /** Best available data — cached stale data on first render, fresh after fetch. */
  insights: TraceInsightsResponse;
  /** True only while no data exists yet (very first load). Stale hits show data immediately. */
  loading: boolean;
  error: string | null;
}

/**
 * Shared hook for fetching /api/trace-insights.
 *
 * Uses the module-level insights-cache so:
 *  - A second consumer with the same filters gets the in-flight promise
 *    instead of starting a duplicate request.
 *  - Switching tabs is instant when data is already cached.
 *  - Stale data is shown immediately while a background refresh runs.
 */
export function useInsightsData(
  filters: TraceInsightsQuery,
): UseInsightsDataResult {
  const [insights, setInsights] = useState<TraceInsightsResponse>(emptyInsights);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track the key from the previous render to detect filter changes.
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = insightsCacheKey(filters);
    let cancelled = false;

    const { data, fresh } = getInsights(filters);

    // If we have cached data, render it immediately — no spinner.
    if (data !== null) {
      setInsights(data);
      setLoading(false);
      setError(null);
    } else {
      // No cached data at all: show spinner only on brand-new keys.
      if (prevKeyRef.current !== key) {
        setLoading(true);
        setError(null);
      }
    }

    prevKeyRef.current = key;

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setError(
          "Timed out loading insights. Try narrowing the filters or rebuilding the trace index.",
        );
      }
    }, TIMEOUT_MS);

    fresh
      .then((result) => {
        if (!cancelled) {
          setInsights(result);
          setLoading(false);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoading(false);
          // Don't overwrite data we already rendered with an error from a stale refresh.
          if (data === null) {
            setError(String(err));
          }
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightsCacheKey(filters)]);

  return { insights, loading, error };
}
