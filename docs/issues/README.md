# Issue Reports (Browser Challenge Postmortem)

**Status**: All issues resolved across Sprints 1-3 (2026-02-17 to 2026-02-18).

Original postmortem: 2026-02-17. All 10 issues identified from trace analysis of 5 sessions.

## Resolution Summary

| Issue | Title | Sprint | Commit |
|-------|-------|--------|--------|
| ISSUE-001 | Context bloat / no compression | Sprint 2 | `e4ab45d` |
| ISSUE-002 | Non-converging tool loops | Sprint 2 | `e4ab45d` |
| ISSUE-003 | Overlay/modal dismissal gaps | Sprint 1 + 3 | `5722620`, `880bcde` |
| ISSUE-004 | Drag-drop stale ID fragility | Sprint 3 | `880bcde` |
| ISSUE-005 | Bridge/content-script disconnects | Sprint 1 | `5722620` |
| ISSUE-006 | Provider failover / credit resilience | Sprint 1 | `5722620` |
| ISSUE-007 | Tab management attempt churn | Sprint 2 | `e4ab45d` |
| ISSUE-008 | Element ID hallucination | Sprint 2 | `e4ab45d` |
| ISSUE-009 | Escalation thrashing / short window | Sprint 2 | `e4ab45d` |
| ISSUE-010 | Snapshot element cap starvation | Sprint 3 | `880bcde` |

## Key Fixes by Sprint

**Sprint 1** — See, click, stay connected
- Snapshot deduplication (`collapseNearIdentical`)
- Overlay dismissal (broader selectors, ancestor walk)
- Bridge auto-reconnect (pre-dispatch ping, reinject)
- Provider failover (permanent disable on credit exhaustion)
- SPA typing (InputEvent + native value setter)

**Sprint 2** — Smart loops, no grinding
- Turn-count compression triggers (LIGHT/MEDIUM/HEAVY)
- Failed-action memory (exact-repeat circuit breaker)
- Escalation gating (min tenure, cooldown, progress gate)
- Element ID validation (pre-dispatch check, id=0 block)
- Tab tool taboo (blocked-tool memory)

**Sprint 3** — Modal escape, smart caps, dead-end sensing
- Broadened overlay detection (15+ new selectors, 15% threshold, `<dialog>`)
- Dynamic tag pinning (3-cycle TTL, 5 overflow slots)
- Task-relevance element scoring (`scoreElement()`)
- Adaptive element cap (50 default, 75 for DnD pages)
- Outcome-based dead-end detection (nudge at 3, pivot at 5)

## Archived Files

Original issue reports, literature review, and implementation plan are in [archived/](./archived/).
