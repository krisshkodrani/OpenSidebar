# Trace Viewer RFCs

Design proposals for trace-viewer improvements. Each RFC targets a finding from
the 2026-05-30 dual-lens review (AI-researcher + AI-engineer): the prioritized
set are fixes that serve both lenses, because research rigor and engineering
trust are the same underlying problem.

See also: [Viewer Coverage Plan](../testing/viewer-coverage-plan.md),
[Trace Viewer Observability](../architecture/trace-viewer-observability.md),
[Trace Viewer AI Concepts](../guides/trace-viewer-ai-concepts.md).

| # | RFC | Theme | Both-lens win | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 0001 | [Evidence trust & expiry signaling](0001-evidence-trust-and-expiry.md) | Trust | grounding integrity + stale-evidence bug class | Low | Implemented |
| 0002 | [Honest aggregates: sample size & variance](0002-honest-aggregates.md) | Stats | no over-reading noise + honest ops numbers | Low-Med | Implemented |
| 0003 | [Label provenance for findings](0003-label-provenance.md) | Trust | calibratable labels + know the verdict's source | Low | Implemented |
| 0004 | [Canonical aggregate contract (JSONL<->SQLite)](0004-canonical-aggregate-contract.md) | Consistency | comparable numbers + no path drift | Med | Implemented |
| 0005 | [Freeze/export a run as a permanent bundle](0005-run-freeze-export.md) | Reproducibility | citable runs + regression repros | Med-High | Implemented, import deferred |
| 0006 | [Metric semantics definitions](0006-metric-semantics.md) | Comparability | stable cross-study metrics + consistent triage | Low | Implemented |

Recommended sequencing was 0001 -> 0002 -> 0003, then 0004 and 0006, then 0005.
That path is now reflected in the trace-viewer analysis, UI, SQLite index, and
focused regression tests.
