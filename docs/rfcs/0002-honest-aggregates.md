# RFC 0002 - Honest Aggregates: Sample Size & Variance

Status: Implemented
Date: 2026-05-30
Scope: `analysis/fleet.ts`, `analysis/types.ts` (`TraceFleetCluster`, `TraceFleetAnalysis`), `components/traces/FleetInsights.tsx`, `components/traces/FleetOverview.tsx`, `components/traces/MetricsTab.tsx`

## Problem

Fleet and metrics aggregates are presented as bare point estimates, e.g.
`failureRate`, `averageTurns`, with no sample size shown and no dispersion.
`TraceFleetCluster` already carries `count` and `sessionIds`, so the raw `n` is
*available* but not surfaced, and there is no variance/interval at all.

## Motivation (both lenses)

- **AI researcher:** The executor is nondeterministic (prior A/B note: executor
  nondeterminism is the dominant source of variance). A "12% failure rate" over
  n=8 is noise; presenting it without n or spread invites false conclusions and
  bogus model/perception comparisons.
- **AI engineer:** Ops dashboards that quote rates without n are misleading;
  on-call will chase a "regression" that is sampling noise.

## Proposal

1. In `analyzeTraceFleet` (`fleet.ts`), compute and attach, per cluster and for
   the overall analysis: sample size `n` (already `count` / `totalSessions`), and a simple
   dispersion measure: std-dev of `turns`, and a Wilson (or normal-approx)
   confidence interval for `failureRate`/`successRate`.
2. **Always display `n`** next to every rate/average in `FleetInsights`,
   `FleetOverview`, and `MetricsTab`; show the interval as `+/- x` or a small
   range. De-emphasize (or annotate "low n") clusters below a threshold (e.g.
   n < 5).
3. Extend `/api/trace-insights` rows separately from `TraceFleetAnalysis`:
   `MetricsTab` consumes `TraceInsightsSummary` / `TraceInsightsMetricRow`, so
   denominators must be explicit there too (`sessions`, `runs`, `calls`, or
   `requests` depending on the metric).

## Data-model change

Extend `TraceFleetCluster` / `TraceFleetAnalysis` with optional
`turnsStdDev?: number`, `failureRateCI?: { low: number; high: number }`,
`successRateCI?: { low: number; high: number }`, and surface existing `count`
as `n` in the view layer. Add equivalent optional interval fields to trace
insights API rows where rates are rendered. Non-breaking (additive).

## Alternatives

- Full Bayesian/posterior treatment: overkill for a triage UI; revisit if we add
  formal experiment tracking.
- Leave stats out and document the caveat in prose: rejected; the number is what
  people act on, so the honesty must live next to the number.

## Testing

- Unit (`fleet.ts`): known fixtures produce expected `n`, std-dev, and CI bounds;
  degenerate cases (n=1, all-success, all-fail) don't divide-by-zero or NaN.
- Component: each rate renders with its `n`; low-n clusters get the annotation.

## Rollout

Low-medium. Pure-function + display change; additive types.
