# OpenSidebar Implementation Plan v2 (Post-Remediation + 3-Level Routing)

Date: 2026-02-18  
Scope: Updated plan after issue remediation (Sprints 1-3) and new model-routing RFC.

## Current Baseline

- Issues `001-010` are implemented in code and documented as resolved.
- Orchestrator now has a configurable global token budget (default `1_000_000`).
- Smart-tier tenure/cooldown, repeat-action controls, ID validation, overlay/tagging, bridge reinject, and provider-disable logic are present.

## Objective

Add `L0/L1/L2` model routing (`fast -> qwen smart -> glm hard-recovery`) without degrading handoffs, while reducing cost per successful run.

## Execution Phases

### Phase A: Handoff Safety Gate (must pass before routing changes)

Deliverables:
- Standardized handoff payload at model switch boundaries:
  - `last_blocker`
  - `last_successful_action`
  - `next_intended_action`
  - `recent_failures`
  - `valid_ids_summary`
- Switch telemetry events with reason and outcome.

Estimate: 1.5d  
Exit criteria:
- Handoff payload present for >= 95% of tier switches in trace logs.
- No increase in immediate post-switch redundant actions.

### Phase B: 3-Tier Scaffold (feature flag off by default)

Deliverables:
- Tier state machine in code (`L0/L1/L2`) behind feature flag.
- No behavior change when disabled.

Estimate: 1.0d  
Exit criteria:
- Existing integration tests pass unchanged.
- New routing flag tests pass.

### Phase C: Controlled `L0 -> L1` Rollout (Qwen as smart default)

Deliverables:
- Enable `L1` promotion gates.
- Keep `L2` disabled.
- Add smart-token caps (`maxSmartTokensPerRun`, `maxTokensPerStep`).

Estimate: 1.5d  
Exit criteria:
- Completion rate regression <= 3 percentage points vs baseline.
- Cost/run reduced by >= 15%.

### Phase D: Selective `L2` Enablement (GLM for hard-stuck only)

Deliverables:
- `L1 -> L2` gate: minimum tenure + no-progress predicate after bounded pivots.
- `L2` budget cap (`maxL2TokensPerRun`) and tenure cap.

Estimate: 1.5d  
Exit criteria:
- `L2` is rare and bounded.
- Net cost/run reduced by >= 25% vs baseline.
- No new high-severity failure class appears.

### Phase E: Production Default + Kill Switch

Deliverables:
- Default enablement after eval pass.
- Runtime kill switch to return to current 2-tier policy.

Estimate: 0.5d  
Exit criteria:
- 3 consecutive benchmark batches pass all quality/cost gates.

## Metrics and Gates

Track per run:
- Completion rate
- Turns to completion
- Total tokens and cost
- Smart token share (`L1`, `L2`)
- Tier-switch count and oscillation rate
- Repeated tool+args incidents
- Invalid-ID error count
- Bridge reconnect failures

Ship gates:
1. Cost/run down >= 25%.
2. Completion rate not materially worse (<= 3pp regression).
3. Switch oscillation not worse than baseline.
4. No blocker regression from issues `001-010`.

## Risks and Mitigations

1. Premature de-escalation:
- Mitigation: progress-gated de-escalation + min tenure.

2. Handoff context loss:
- Mitigation: required handoff payload contract + trace validation.

3. L2 overuse:
- Mitigation: strict L2 budget and invocation caps.

4. Budget early-stop harming UX:
- Mitigation: structured blocked summary with next action suggestions.

## Suggested Owner Split

- Agent loop + routing gates: Core agent owner
- LLM client + tier/provider mapping: LLM infra owner
- Settings + telemetry UI: Sidepanel owner
- Eval harness + benchmarking: Evals owner

## References

- Routing RFC: `docs/rfc/rfc-three-level-model-routing.md`
- Issue summary: `docs/issues/README.md`
- Archived detailed postmortem: `docs/issues/archived/`
