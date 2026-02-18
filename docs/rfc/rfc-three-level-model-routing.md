# RFC: Three-Level Model Routing Policy (Fast -> Smart-Qwen -> Smart-GLM)

## Status

Proposed

## Context

The postmortem issue set (001-010) has been addressed in the current codebase baseline (compression triggers, loop breakers, escalation tenure/cooldown, ID validation, overlay and tagging fixes, bridge reinject, provider-disable logic). Orchestrator global token budget now defaults to `1_000_000` and is user-configurable.

This RFC defines the next step: add a 3-level model cascade without regressing handoff quality.

## Problem

Even with issue fixes, long browser challenges can still consume large token budgets. A single smart tier is too coarse for cost control:

- Some turns need only fast execution.
- Some need medium-hard recovery.
- Rare deadlocks need strongest reasoning.

Without tier specialization, either quality drops (too cheap) or cost spikes (too strong everywhere).

## Goals

1. Add model cascade:
   - `L0`: fast executor (`gpt-oss-120b`)
   - `L1`: default smart escalation (`qwen3-235b-a22b-2507`)
   - `L2`: hard-recovery fallback (`glm-4.7`)
2. Protect handoffs and avoid model-switch thrash.
3. Reduce token cost per successful run.
4. Keep completion quality stable or better.

## Non-Goals

- Replacing vision model policy.
- Rewriting orchestrator lane architecture.
- Removing existing fast/smart path before validation.

## Key Risks

1. **Handoff degradation**: diagnosis from `L1/L2` not preserved when returning to `L0`.
2. **Oscillation**: frequent tier switches add latency and confuse execution state.
3. **Premature de-escalation**: downgrade before the recovery action chain is complete.
4. **Over-promotion**: too many `L2` calls erase cost savings.

## Handoff Safety Contract (Required Before Rollout)

Every tier switch must carry forward:

- `last_blocker`
- `last_successful_action`
- `next_intended_action`
- `recent_failures` (compact)
- `current_valid_element_ids_summary`

De-escalation is allowed only when a progress predicate is met (not a single noisy DOM delta).

## Proposed Policy

### Promotion

- `L0 -> L1` on stuck threshold, repeated-action breaker, or invalid-ID streak.
- `L1 -> L2` only after:
  - minimum `L1` tenure, and
  - no meaningful progress after bounded pivots.

### De-escalation

- `L2 -> L1` after recovery signal or `L2` tenure cap.
- `L1/L2 -> L0` only via progress-gated condition.
- apply switch cooldown to avoid immediate bounce-back.

### Budget Guardrails

- `maxTotalTokensPerRun`
- `maxSmartTokensPerRun` (`L1+L2`)
- `maxL2TokensPerRun`
- `maxTokensPerStep`

On budget exhaustion: stop looping and emit structured blocked summary.

## Current Baseline Checks (already present)

- Escalation tenure/cooldown (`MIN_SMART_TENURE`, `COOLDOWN_TURNS`) in `src/background/agent/constants.ts`.
- Repeat-action protection and stuck handling in `src/background/agent/loop.ts`.
- Pre-dispatch element-ID validation path in background tools.
- Bridge reconnect with reinjection in `src/background/tools/index.ts`.
- Orchestrator token budget setting in `src/background/orchestrator/index.ts` and sidepanel settings.

## Rollout Plan

### Phase 0 (done): Baseline hardening

Issue fixes and guardrails from Sprints 1-3.

### Phase 1: Instrument-only tier scaffold

- Implement `L0/L1/L2` state machine behind feature flag (`disabled` by default).
- Emit switch telemetry and handoff payload snapshots.
- No behavioral change when flag is off.

### Phase 2: `L0 -> L1` only (Qwen smart), no `L2`

- Enable `L1` in controlled evals.
- Keep `L2` disabled.
- Compare against current baseline.

### Phase 3: selective `L2` enablement

- Enable `L2` only on hard-stuck gate.
- Enforce strict `L2` token cap and tenure cap.
- Validate net benefit.

### Phase 4: production enablement

- Enable policy by default if success criteria hold.
- Keep runtime kill-switch and rollback path.

## Success Criteria

1. Token cost per successful run down by >= 25%.
2. Completion rate regression <= 3 percentage points.
3. Switch oscillation rate decreases or stays neutral versus baseline.
4. No increase in high-severity failure classes (issues 001-010).

## Evaluation Plan

Compare three configs on identical challenge settings:

- `A`: current 2-tier baseline
- `B`: 3-tier with `L1` only
- `C`: full 3-tier (`L1+L2`) with all caps/gates

Track:

- completion rate
- turns to completion
- total tokens and cost per run
- smart-tier share and `L2` invocation rate
- repeated-action and stuck-signal frequency
- bridge/reconnect and invalid-ID error rates

## References

1. ReAct (reasoning + acting): https://arxiv.org/abs/2210.03629
2. Reflexion (failure memory): https://arxiv.org/abs/2303.11366
3. FrugalGPT (cost-aware cascades): https://arxiv.org/abs/2305.05176
4. RouteLLM (routing policies): https://arxiv.org/abs/2406.18665
5. Mixture-of-Agents (specialized model roles): https://arxiv.org/abs/2406.04692
6. Lost in the Middle (long-context quality limits): https://arxiv.org/abs/2307.03172
7. OpenRouter GLM-4.7: https://openrouter.ai/z-ai/glm-4.7
8. OpenRouter Qwen3-235B-A22B-2507: https://openrouter.ai/qwen/qwen3-235b-a22b-2507

