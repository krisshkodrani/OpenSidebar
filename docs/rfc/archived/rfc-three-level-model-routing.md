# RFC: Three-Level Model Routing Policy (Fast -> Smart-Qwen -> Smart-GLM)

## Status

Proposed

## Problem

Challenge runs can consume very high token volume before converging. Recent runs reported approximately 13.6M tokens across about two attempts, with substantial smart-tier spend. Current two-tier behavior (fast/smart) is not enough to control cost under long-loop failure modes.

We need a routing policy that:

1. Preserves high completion quality on hard web tasks.
2. Reduces average token cost per attempt.
3. Prevents runaway smart-tier usage during non-converging loops.

## Motivation

The project has mixed task types:

- High-volume mechanical execution (cheap model is sufficient).
- Medium-hard recovery/planning turns (better model needed intermittently).
- Rare hard-stuck turns where strongest reasoning may be required.

A single smart tier is a coarse control. A three-level cascade enables selective spending: use the cheapest capable model first, then escalate only when evidence indicates it is necessary.

## Goals

- Add a 3-level inference policy:
  - `L0`: fast executor (`gpt-oss-120b`)
  - `L1`: smart default (`qwen3-235b-a22b-2507`)
  - `L2`: hard-recovery tier (`glm-4.7`)
- Enforce explicit escalation/de-escalation gates based on observed progress.
- Enforce run-level and step-level token budgets.
- Improve cost-per-success while maintaining or improving completion rate.

## Non-Goals

- Replacing all models at once.
- Rewriting the full agent loop architecture.
- Optimizing vision model policy in this RFC.

## Proposed Solution

### 1. Tier Definitions

- `L0` Fast: current high-throughput default for most turns.
- `L1` Smart-Qwen: default escalation tier for stuck/recovery and planning-heavy turns.
- `L2` Smart-GLM: reserved for persistent hard-stuck states after `L1` fails.

### 2. Routing Policy

#### Escalation to L1

Promote `L0 -> L1` when any is true:

- Progress tracker stale threshold reached.
- Repeated tool+args failures exceed threshold.
- Repeated invalid element IDs exceed threshold.
- Step watchdog threshold reached.

#### Escalation to L2

Promote `L1 -> L2` only when both are true:

- `L1` received minimum tenure (for example 3-5 turns), and
- No meaningful progress after bounded pivots (state fingerprint/URL/actionability unchanged).

#### De-escalation

- `L2 -> L1` after successful recovery signal or max `L2` tenure.
- `L1/L2 -> L0` only after progress-gated condition (not just one DOM change).
- Apply cooldown to prevent immediate oscillation.

### 3. Budget Guardrails

Add hard limits:

- `maxTotalTokensPerRun`
- `maxSmartTokensPerRun` (combined L1+L2)
- `maxL2TokensPerRun`
- `maxTokensPerStep`

When any budget is exhausted:

- Stop autonomous looping.
- Emit structured summary with last blockers, attempted pivots, and recommended user action.

### 4. Failure-Type-Aware Model Promotion

- Mechanical failures (stale IDs, missing tags): prefer corrective tools + `L1`.
- Reasoning deadlock (contradictory page state, possible trap step): allow `L2`.
- Provider/billing failures: do not promote model tier; trigger provider failover logic.

## Implementation Plan

### Files

- `src/background/llm/client.ts`
  - Add third tier model constants and switching helpers.
  - Preserve provider-pool behavior per tier.
- `src/background/agent/loop.ts`
  - Add tier state machine (`L0/L1/L2`).
  - Add progress-gated promotion/de-escalation rules.
  - Enforce token budget guardrails.
- `src/background/agent/constants.ts`
  - Add routing thresholds and budget defaults.
- `src/background/agent/progress.ts`
  - Expose stronger progress signals used by routing gates.

### Suggested Constants (initial)

- `MAX_TOTAL_TOKENS_PER_RUN = 1_500_000`
- `MAX_SMART_TOKENS_PER_RUN = 300_000`
- `MAX_L2_TOKENS_PER_RUN = 120_000`
- `MAX_TOKENS_PER_STEP = 150_000`
- `L1_MIN_TENURE = 3`
- `L2_MIN_TENURE = 3`
- `MODEL_SWITCH_COOLDOWN_TURNS = 5`

These are starting points and should be tuned via evals.

## Evaluation Plan

Run A/B/C on identical challenge settings:

- `A`: Baseline (current 2-tier policy)
- `B`: 3-tier without budgets
- `C`: 3-tier with budgets and progress-gated de-escalation

Track:

- Completion rate
- Median turns to completion
- Tokens per successful run
- Smart-tier token share
- L2 invocation rate
- Time spent in escalation transitions
- Stuck-loop incidence (same tool+args repetition, stale step turns)

Success criteria:

1. Cost per successful run reduced materially (target >= 30%).
2. Completion rate does not regress more than 3 percentage points.
3. L2 usage remains bounded and rare.
4. No increase in high-severity failure classes from current issue set.

## Risks and Mitigations

- Risk: Qwen underperforms GLM on hardest recovery turns.
  - Mitigation: keep L2 GLM fallback; route only after bounded L1 failure.
- Risk: Tier oscillation adds latency.
  - Mitigation: minimum tenure + cooldown + progress-gated switching.
- Risk: Budget limits can end runs early.
  - Mitigation: return actionable blocked summary and preserve session diagnostics.

## Alternatives Considered

1. Keep current two-tier policy and just swap GLM -> Qwen.
   - Simpler, but weaker control for rare hard-stuck cases.
2. Use GLM only as smart tier.
   - Strong quality, but higher cost and unnecessary spend on medium-hard turns.
3. Use Qwen only as smart tier.
   - Cheapest, but risk of quality drop on hardest deadlocks.

## Decision

Adopt staged rollout of 3-level routing:

1. Implement tier state machine and budget guardrails behind a feature flag.
2. Default to `L0 -> L1` in production path.
3. Enable `L2` only after eval validation.

## References

Research and systems guidance supporting cascaded routing and bounded recovery:

1. ReAct: Synergizing Reasoning and Acting in Language Models  
   https://arxiv.org/abs/2210.03629
2. Reflexion: Language Agents with Verbal Reinforcement Learning  
   https://arxiv.org/abs/2303.11366
3. FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance  
   https://arxiv.org/abs/2305.05176
4. RouteLLM: Learning to Route LLMs with Preference Data  
   https://arxiv.org/abs/2406.18665
5. Mixture-of-Agents Enhances Large Language Model Capabilities  
   https://arxiv.org/abs/2406.04692
6. Lost in the Middle: How Language Models Use Long Contexts  
   https://arxiv.org/abs/2307.03172

Operational references for current model endpoints:

7. OpenRouter GLM-4.7  
   https://openrouter.ai/z-ai/glm-4.7
8. OpenRouter Qwen3-235B-A22B-2507  
   https://openrouter.ai/qwen/qwen3-235b-a22b-2507

