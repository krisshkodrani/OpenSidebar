# RFC 0006 - Metric Semantics Definitions

Status: Implemented
Date: 2026-05-30
Scope: `analysis/types.ts` (`InvestigationSummaryMetrics`), `analysis/analyze.ts`, `analysis/repeat-actions.ts` (`sameSnapshot`, `compareToolSequence`, `findRepeatedActionPatterns`), docs

## Problem

Several headline metrics have no documented, stable definition:

- `productiveTurns`, `toolFailureTurns`, `perceptionTurns`,
  `degradedPerceptionTurns`, `contextHotTurns` in `InvestigationSummaryMetrics`.
- The repeat-action / "loop" notion built on snapshot-equality heuristics
  (`sameSnapshot`, `compareToolSequence`).

Definitions live only in code and can shift between versions without notice.

## Motivation (both lenses)

- **AI researcher:** Cross-study and longitudinal comparability require fixed
  definitions; "productive turn" or "loop" meaning silently changing invalidates
  trend lines and ablations.
- **AI engineer:** A triage signal you can trust across releases, and an
  unambiguous contract for anyone building on these metrics.

## Proposal

1. Write a short **metric dictionary** (doc) defining each metric precisely: what
   counts as productive, what marks a turn as degraded-perception, how
   context-hot is thresholded, and the exact loop/repeat criterion (window,
   equality basis, min repeats). Current dictionary:
   `docs/architecture/trace-viewer-metric-semantics.md`.
2. Centralize the definitions as named constants/predicates in `analyze.ts` /
   `repeat-actions.ts` (single source of truth) and reference the doc.
3. Lock each definition with a unit test so a change to the meaning is a
   deliberate, reviewed event (and a doc update).

## Alternatives

- Leave as code-only: status quo; the meanings keep drifting silently.
- Version the metric schema heavily: premature; a dictionary + locking tests is
  enough until we have formal experiment tracking.

## Testing

- Unit (Coverage Plan Tier 3): canonical fixtures pin each metric's value;
  loop detection pins window/threshold behavior. A semantics change must update
  both the test and the dictionary.

## Rollout

Low: mostly documentation + extracting constants + locking tests. No data-model
change.
