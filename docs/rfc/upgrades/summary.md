# RFC Upgrade Summary

Last updated: 2026-02-15

## Status Overview

| RFC | Title | Status |
|-----|-------|--------|
| RFC-020 | Advanced Interaction Primitives | Partially done (drag, hover done; click_coordinates remaining) |
| RFC-022 | DOM Snapshot Token Budgeting | Essentially complete (minor attribute dedup remaining) |
| RFC-024 | Optimistic Execution Pipeline | Deferred (valid, not prioritized) |
| RFC-025 | Intelligent History Pruning | Essentially complete (core idea fully implemented) |

## Deleted RFCs

- **RFC-021** (Prompt Caching): Targeted Anthropic `cache_control` headers; project uses Cerebras/Groq/OpenRouter. Not applicable.
- **RFC-023** (Event-Driven DOM Observation): MutationObserver replacement is high-risk. Current full-scan + stable IDs approach works well. Shadow DOM complexity and computed style blindness make incremental observation unreliable.
- **RFC-026** (Agent State Machine): FSM refactor has unclear ROI. The real issue is loop.ts size, not lack of a state machine. Boolean flags work for the current single-loop agent.

## Actionable Remaining Work

### RFC-020: `click_coordinates` tool
- Sound approach but needs: screenshot guard, `elementFromPoint()` resolution, viewport context
- Low-risk addition when visual interaction gaps are hit in practice

### RFC-022: Attribute hierarchy dedup
- Skip `title`/`alt` when `aria-label` exists; skip `placeholder` when input has text
- ~50-150 tokens/snapshot savings. Minor optimization.

### RFC-024: Adaptive network idle
- Replace hardcoded SPA waits with `PerformanceObserver`-based idle detection
- Revisit when latency becomes a bottleneck
