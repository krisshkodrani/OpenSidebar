# RFCs (Request for Comments)

This directory contains feature proposals, technical decisions, and implementation plans for OpenSidebar.

## Active RFCs

| RFC | Status | Summary |
|-----|--------|---------|
| [Three-Level Model Routing (Reopened)](./rfc-three-level-model-routing.md) | **Proposed** | Reintroduces `L0/L1/L2` routing with explicit handoff-safety gates and budget guardrails |

## Archived RFCs

Completed, superseded, and historical documents are stored in [archived/](./archived/).

### Recently Archived (2026-02-18)

| RFC | Status | Summary |
|-----|--------|---------|
| [Three-Level Model Routing](./archived/rfc-three-level-model-routing.md) | **Superseded** | Replaced by two-tier system (fast/smart) with BRAINS→HANDS orientation + escalation gating |

### Archived (2026-02-14)

| RFC | Status | Summary |
|-----|--------|---------|
| [DOM Context Optimization](./archived/rfc-dom-optimization-plan.md) | **Done** | Viewport filtering, attribute whitelisting, progressive compression |
| [Content Script API Guard](./archived/rfc-content-script-api-guard.md) | **Done** | Runtime context detection in `src/utils/context.ts` |
| [Shadow DOM Support](./archived/shadow-dom-report.md) | **Done** | `querySelectorAllDeep()` recursive shadow DOM traversal |
| [Agent UX Feedback](./archived/rfc-agent-ux-feedback.md) | **Done** | StuckBanner, TaskProgressPanel, ControlBar, hints, CompletionSummary |
| [Progress Tracker](./archived/rfc-progress-tracker.md) | **Done** | Snapshot fingerprinting, graduated nudge/escalate intervention |
| [Stable Element Identity](./archived/rfc-stable-element-identity.md) | **Done** | FNV-1a hash-based stable IDs + inline clickable detection |
| [Token Usage & Cost Tracking](./archived/rfc-token-usage-cost-tracking.md) | **Done** | SessionMetrics, MetricsBar, CompletionSummary, vision tracking |
| [Plan Guardian](./archived/rfc-premature-done-guard.md) | **Done** | PlanGuardian: decompose() + validateDone() in `agent/guardian.ts` |
| [Locked Workspace](./archived/rfc-locked-workspace.md) | **Done** | Tab re-grouping, auto-delete, panel persistence |
| [Task Decomposition](./archived/rfc-task-decomposition.md) | **Done** | Guardian-based decomposition with loop-managed step progress (simplified from SubtaskRunner) |
| [LLM Provider Fallback](./archived/rfc-llm-provider-fallback.md) | **Superseded** | Replaced by priority-based failover (`ProviderPool`) |
| [LLM Round-Robin](./archived/rfc-llm-round-robin.md) | **Superseded** | Replaced by priority-based failover (Cerebras→Groq→OpenRouter) |

### Historical

- **Phase 0-8** - Initial implementation phases (all complete)
- **Technical Master Plan** - Original technical standards
- **Design Decisions** - Resolved product and UX decisions
- **Implementation Audits** - Historical gap analyses

## RFC Process

### Submitting an RFC

1. **Create RFC document** in this directory using the template below
2. **Technical review** - Evaluate technical feasibility
3. **Design review** - Consider UX implications
4. **Approval** - RFC moves to "Ready to implement" status
5. **Implementation** - Assigned to development milestone
6. **Archival** - Moved to `archived/` with status annotation when complete

### RFC Template

```markdown
# RFC: [Feature Name]

## Status

[Proposed | Ready to implement | In progress | Complete | Superseded]

## Problem

[Clear description of the issue or opportunity]

## Solution

[Proposed implementation approach]

## Implementation

[Technical details and code changes]

## Testing

[Test plan and success criteria]

## Impact

[Effects on users, performance, security]
```
