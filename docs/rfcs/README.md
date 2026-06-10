# Trace Viewer RFCs

Design proposals for trace-viewer improvements. Each RFC targets a finding from
the 2026-05-30 dual-lens review (AI-researcher + AI-engineer): the prioritized
set are fixes that serve both lenses, because research rigor and engineering
trust are the same underlying problem.

These legacy RFCs are closed and retained as historical decision records. New
RFCs belong in Notion and must follow
[RFC Decision Process](../engineering/rfc-decision-process.md).

See also: [Viewer Coverage Plan](../testing/viewer-coverage-plan.md),
[Trace Viewer Observability](../architecture/trace-viewer-observability.md),
[Trace Viewer AI Concepts](../guides/trace-viewer-ai-concepts.md).

| #    | RFC                                                                                   | Theme           | Lifecycle | Decision | Closure                                                                                      |
| ---- | ------------------------------------------------------------------------------------- | --------------- | --------- | -------- | -------------------------------------------------------------------------------------------- |
| 0001 | [Evidence trust & expiry signaling](0001-evidence-trust-and-expiry.md)                | Trust           | Archived  | Approved | Verified implementation                                                                      |
| 0002 | [Honest aggregates: sample size & variance](0002-honest-aggregates.md)                | Stats           | Archived  | Approved | Verified implementation                                                                      |
| 0003 | [Label provenance for findings](0003-label-provenance.md)                             | Trust           | Archived  | Approved | Remaining viewer work moved to [#37](https://github.com/krisshkodrani/OpenSidebar/issues/37) |
| 0004 | [Canonical aggregate contract (JSONL<->SQLite)](0004-canonical-aggregate-contract.md) | Consistency     | Archived  | Rejected | Obsolete dual-engine premise                                                                 |
| 0005 | [Freeze/export a run as a permanent bundle](0005-run-freeze-export.md)                | Reproducibility | Archived  | Parked   | Import/load lacks a demonstrated workflow                                                    |
| 0006 | [Metric semantics definitions](0006-metric-semantics.md)                              | Comparability   | Archived  | Approved | Verified implementation                                                                      |

Recommended sequencing was 0001 -> 0002 -> 0003, then 0004 and 0006, then 0005.
The accepted implementations are reflected in the trace-viewer analysis, UI,
SQLite index, and focused regression tests. Rejected and parked work must not be
reinterpreted as implementation authorization.
