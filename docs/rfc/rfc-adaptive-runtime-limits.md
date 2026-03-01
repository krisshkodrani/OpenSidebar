# RFC: Difficulty-Adaptive Runtime Limits

## Status
Proposed

## References
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems: Principles, Patterns, and Implementation for AI Agents* (2025). ISBN: 979-8-9931012-2-4.
- **Book 2**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (Packt, 2025).
- **Book 3**: Agentic Tracing Gap Analysis (`docs/research/agentic-tracing-gap-analysis-2026-02-19.md`).
- **Internal**: DMAS evaluation (`docs/research/evaluation-against-DMAS-book.md`), Context Engineering gap analysis (`docs/research/context-engineering-book-gap-analysis-2026-02-19.md`), Multi-Turn Resilience RFC (`docs/rfc/rfc-multi-turn-resilience.md`), Escalation Stability RFC (`docs/rfc/rfc-escalation-stability.md`).
- **Constants file**: `src/background/agent/constants.ts` (current single source of truth for all static limits).

## Context

### The Problem with Static Constants

OpenSidebar's agent loop is governed by ~40 hard-coded numeric constants in `src/background/agent/constants.ts`. These control retry counts, escalation thresholds, circuit breakers, stuck detection, and termination — the core "reflexes" that determine how the agent responds to difficulty.

Every constant was chosen to work *on average* across all tasks. But tasks vary enormously in difficulty:

| Task class | Example | Natural turns | Failure tolerance needed |
|---|---|---|---|
| Simple click | "Click the login button" | 1–3 | Very low — fail fast |
| Form fill | "Fill out this registration form" | 5–12 | Moderate |
| Multi-step workflow | "Book a flight from A to B" | 15–30 | High — sites are flaky, modals appear |
| Research + synthesis | "Compare prices across 3 sites" | 20–40+ | Very high — needs persistence |

A `TOOL_FAILURE_THRESHOLDS.EXIT = 6` is too generous for a simple click (wastes 6 turns on a fundamentally wrong approach) and too tight for a multi-step workflow on a flaky site (gives up just as the agent is learning the site's quirks).

### What the Literature Says

**Dibia (2025)** on termination strategies:

> "Robust termination strategies prevent runaway agents while ensuring legitimate long-running tasks can complete. Budget-based limits provide hard safety guarantees" (§2.5.1, p.46)

Dibia recommends **multiple termination dimensions** (turns, tokens, time, cost) and argues that a single constant is a blunt instrument. The book's plan-based orchestration pattern (§2.3.1, p.36) explicitly separates planning from execution — implying the planner should configure execution parameters, not inherit static defaults:

> "Plan-based orchestration involves a dedicated planner agent that generates a sequence of actions before execution begins. This pattern works well when the task structure is clear and predictable" (§2.3.1, p.36)

The book's middleware pattern (§4.4, p.96) further argues that retry logic, rate limiting, and circuit-breaking should be **composable and configurable**, not embedded:

> "Agent middleware enables clean separation of cross-cutting concerns from core agent logic. This improves testability, reusability, and maintainability" (§4.4, p.96)

**Rothman (2025)** is the most direct. The Context Engineering gap analysis identified this as a P2 finding:

> "Many constants embedded in orchestrator/runtime... Risk: slower tuning and harder governance across releases. **Target: externalize guardrail/retry/isolation thresholds into versioned policy config.**"

Rothman's core lesson #4 — "Enforce context reduction as a first-class capability" — implies that compression thresholds should be driven by **measured token budgets and task characteristics**, not static numbers. Lesson #7 — "Engineer for production reality early" — frames constants as **production levers** that should be observable and adjustable.

**The Tracing Gap Analysis** (Book 3) connects the feedback loop:

> "Failure semantics are distributed and not normalized into a compact failure ontology... harder to compute reliable failure trends and auto-remediation triggers."

Translation: you cannot intelligently adjust retry/escalation limits if you cannot systematically measure failure patterns. Static constants prevent the system from learning; adaptive ones create a feedback surface.

### Cross-Source Convergence

All three sources arrive at the same conclusion from different angles:

| Principle | Dibia (2025) | Rothman (2025) | Tracing Analysis |
|---|---|---|---|
| Limits should be task-aware | Multi-dimensional termination (§2.5.1) | Policy-as-config, not code-bound | Failure ontology enables tuning |
| Planning should configure execution | Plan-based orchestration (§2.3.1) | Planner sets execution parameters | Run traces should capture limit overrides |
| Constants are production levers | Middleware pattern (§4.4) | Externalize thresholds to versioned config | Observable limits enable feedback loops |
| One-size-fits-all hurts both ways | Too tight = premature termination; too loose = runaway | Opaque compression = uneven behavior | Unnormalized failures = no auto-remediation |

## Problem

**P1: Over-persistence on simple tasks.** Static limits like `STUCK_THRESHOLDS.ESCALATE = 5` mean the agent spends 5 turns stuck on what should be a 1-turn task before even considering escalation. For "click the login button", 5 stale turns is 5 wasted turns. The planner model gets called in to diagnose what was fundamentally a wrong-element-ID problem that should have been caught immediately.

**P2: Under-persistence on complex tasks.** `TOOL_FAILURE_THRESHOLDS.EXIT = 6` and `STUCK_THRESHOLDS.GIVE_UP = 10` terminate the agent on complex multi-step workflows where failure-then-recovery is the *expected* pattern. A flight booking site that shows loading spinners, modal overlays, and dynamic content will naturally produce tool failures — but the circuit breaker doesn't distinguish "site is flaky" from "approach is fundamentally wrong."

**P3: Escalation thrashing on medium tasks.** `ESCALATION_LIMITS.MAX_CYCLES = 5` and `COOLDOWN_TURNS = 3` are calibrated for an "average" task. But a simple task should never escalate more than once (and ideally zero times), while a hard task might legitimately need 3–4 escalation cycles as it explores different strategies.

**P4: Wasted planner rejections.** `MAX_DONE_REJECTIONS = 3` means the planner can reject `done()` three times regardless of task complexity. For a simple task, the agent was probably right the first time — the planner is second-guessing a correct completion. For a complex task, 3 rejections may not be enough to prevent premature termination on a partially-completed workflow.

**P5: No feedback loop.** All constants are compile-time values. The system cannot learn from its own execution history. A task that took 25 turns last time gets the same limits as a task the agent has never seen. This contradicts Rothman's "engineer for production reality" principle and the tracing analysis's call for "auto-remediation triggers."

## Non-Goals

- Replacing the existing constants file (it remains the source of static defaults)
- Making *all* constants adaptive (safety rails stay fixed — see Classification below)
- Requiring the planner model for every task (executor-tier tasks use defaults)
- Adding LLM calls solely to assess difficulty (piggyback on existing planner decomposition)
- Runtime learning across sessions (future work — this RFC covers per-session adaptation only)

## Solution

### S0: Constant Classification

**Insight:** Not all constants should be adaptive. Safety rails, infrastructure limits, and user-facing timeouts must remain static.

**Book basis:** Dibia (2025) distinguishes between "hard safety guarantees" (budget limits) and "execution strategy" (retry, escalation): "Budget-based limits provide hard safety guarantees" (§2.5.1, p.46). Rothman (2025) separates "guardrails" from "policy" — guardrails are non-negotiable, policy is tunable.

**Classification:**

| Category | Constants | Adaptive? | Rationale |
|---|---|---|---|
| **Safety rails** | `MAX_SESSION_MS`, `APPROVAL_TIMEOUT_MS`, `sanitizeUserInput`, `sanitizeForPrompt` | No | Protect user and system. Model must not extend these. |
| **Infrastructure** | `COOLDOWN_MS`, backoff formulas, `ALARM_PERIOD_MINUTES`, `FLUSH_*` | No | Provider/platform constraints, not task-dependent. |
| **Cost/budget caps** | `DEFAULT_MAX_TOTAL_COST_USD`, `DEFAULT_MAX_TOTAL_TOKENS`, user `maxTurns` | No | User's wallet. Never let the model spend more. |
| **Execution strategy** | `STUCK_THRESHOLDS.*`, `TOOL_FAILURE_THRESHOLDS.*`, `ESCALATION_LIMITS.*`, `STAGNATION_DETECTION.*` | Yes | Task-dependent reflexes. The core of this RFC. |
| **Planner calibration** | `MAX_DONE_REJECTIONS`, `LLM_CONFIG.MAX_SUBTASKS` | Yes | Directly tied to task complexity. |
| **Compression** | `COMPRESSION_TRIGGERS.*`, `ROLLING_DISTILL.*` | Partially | Thresholds are turn-count proxies for token pressure — could be informed by estimated task length. |
| **Logging/display** | `STRING_LIMITS.*`, `BROADCAST_INTERVALS.*` | No | UX and debugging, not execution. |

### S1: Difficulty Assessment at Plan Time

**Insight:** Piggyback on the planner's existing decomposition call to emit a difficulty rating.

**Book basis:** Dibia (2025): "Plan-based orchestration involves a dedicated planner agent that generates a sequence of actions before execution begins" (§2.3.1, p.36). The planner already analyzes the task — asking it to also rate difficulty adds near-zero marginal cost.

**Behavior:** The planner's `decompose()` call already sends the user query + DOM snapshot to the planner model and gets back a structured plan. We extend the response schema to include a `difficulty` field and an optional `runtimeLimits` override object.

The planner model assesses difficulty based on:
- Number of steps in its own plan (more steps = harder)
- Whether the task involves multiple pages/navigations
- Whether the DOM is complex (many interactive elements, dynamic content)
- Whether the task involves ambiguous or subjective goals
- Prior memory hits suggesting this task/site is known to be difficult

**Difficulty levels:**

| Level | Heuristic | Example |
|---|---|---|
| `simple` | 1–2 steps, single page, clear target | "Click the search button" |
| `moderate` | 3–5 steps, may navigate, clear goal | "Log in with these credentials" |
| `complex` | 6–10 steps, multi-page, some ambiguity | "Fill out this application form" |
| `extreme` | 10+ steps, multi-site, subjective success criteria | "Find the cheapest flight and book it" |

### S2: RuntimeLimits Override Type

**Insight:** A typed partial-override object that merges with static defaults.

**Book basis:** Rothman (2025): "externalize guardrail/retry/isolation thresholds into versioned policy config." This is the in-session version of that principle — the planner produces a policy override for the current task.

**Behavior:** Define a `RuntimeLimits` interface covering all adaptive constants. The planner can return a `Partial<RuntimeLimits>` — only the fields it wants to override. The loop merges these with static defaults at session start.

```typescript
/** Adaptive limits that the planner can override per-task */
export interface RuntimeLimits {
  // Stuck detection
  stuckEscalate: number;        // default: STUCK_THRESHOLDS.ESCALATE (5)
  stuckGiveUp: number;          // default: STUCK_THRESHOLDS.GIVE_UP (10)
  stuckGiveUpPlanner: number;     // default: STUCK_THRESHOLDS.GIVE_UP_PLANNER (8)

  // Escalation cycles
  maxEscalationCycles: number;  // default: ESCALATION_LIMITS.MAX_CYCLES (5)
  escalationCooldown: number;   // default: ESCALATION_LIMITS.COOLDOWN_TURNS (3)

  // Tool failure circuit breaker
  toolFailureWarn: number;      // default: TOOL_FAILURE_THRESHOLDS.WARN (4)
  toolFailureExit: number;      // default: TOOL_FAILURE_THRESHOLDS.EXIT (6)

  // Planner calibration
  maxDoneRejections: number;    // default: AGENT_LIMITS.MAX_DONE_REJECTIONS (3)
  maxConsecutiveAllFail: number; // default: AGENT_LIMITS.MAX_CONSECUTIVE_ALL_FAIL (5)

  // Stagnation detection
  stagnationReflection: number;         // default: STAGNATION_DETECTION.REFLECTION_THRESHOLD (3)
  stagnationPivot: number;         // default: STAGNATION_DETECTION.PIVOT_THRESHOLD (5)

  // Step watchdog
  stepWarnTurns: number;        // default: STEP_WATCHDOG.WARN_TURNS (5)
  stepEscalateTurns: number;    // default: STEP_WATCHDOG.ESCALATE_TURNS (10)

  // Fresh start
  maxFreshStarts: number;       // default: FRESH_START.MAX_PER_SESSION (2)
}
```

### S3: Difficulty-to-Limits Mapping

**Insight:** Each difficulty level maps to a preset limits profile. The planner can further fine-tune individual values.

**Book basis:** Dibia (2025) on agent specialization: "Different agents can have different expertise" (§1.3.2, p.7). By analogy, different tasks should have different tolerance profiles. Rothman (2025) on policy-driven architecture: policy should be versioned and explicit, not implicit in code.

**Preset profiles:**

```typescript
const DIFFICULTY_PROFILES: Record<Difficulty, Partial<RuntimeLimits>> = {
  simple: {
    stuckEscalate: 3,          // escalate fast — shouldn't be stuck
    stuckGiveUp: 6,            // give up early — not worth persisting
    stuckGiveUpPlanner: 5,
    maxEscalationCycles: 2,    // one retry at most
    toolFailureWarn: 2,        // warn early
    toolFailureExit: 4,        // exit early
    maxDoneRejections: 1,      // trust the agent's judgment
    maxConsecutiveAllFail: 3,  // fail fast
    stagnationReflection: 2,
    stagnationPivot: 3,
    stepWarnTurns: 3,
    stepEscalateTurns: 6,
    maxFreshStarts: 1,
  },
  moderate: {
    // Mostly defaults — the constants were tuned for this tier
    stuckEscalate: 4,
    maxDoneRejections: 2,
  },
  complex: {
    stuckEscalate: 6,
    stuckGiveUp: 14,
    stuckGiveUpPlanner: 10,
    maxEscalationCycles: 4,
    toolFailureWarn: 5,
    toolFailureExit: 8,
    maxDoneRejections: 4,
    maxConsecutiveAllFail: 6,
    stagnationReflection: 4,
    stagnationPivot: 6,
    stepWarnTurns: 7,
    stepEscalateTurns: 14,
    maxFreshStarts: 2,
  },
  extreme: {
    stuckEscalate: 8,
    stuckGiveUp: 18,
    stuckGiveUpPlanner: 14,
    maxEscalationCycles: 5,
    escalationCooldown: 2,     // shorter cooldown — let it re-escalate faster
    toolFailureWarn: 6,
    toolFailureExit: 10,
    maxDoneRejections: 5,
    maxConsecutiveAllFail: 7,
    stagnationReflection: 4,
    stagnationPivot: 7,
    stepWarnTurns: 8,
    stepEscalateTurns: 16,
    maxFreshStarts: 3,
  },
};
```

**Merge order:** `staticDefaults → difficultyProfile → plannerOverrides`

The planner can override individual values beyond the profile. For example, a `complex` task on a site the agent has memory of being flaky could set `toolFailureExit: 12` while inheriting everything else from the `complex` profile.

### S4: Planner Schema Extension

**Insight:** Extend the existing decomposition response schema to include difficulty and optional limit overrides, at zero additional LLM cost.

**Book basis:** Dibia (2025) on structured output: "Use structured output for reliability" (§4.5, p.74). The planner already returns structured JSON — adding fields is trivial.

**Behavior:** The planner prompt gains a `difficulty` field (required, enum) and `limit_overrides` field (optional, object). The system prompt explains:

```
You must also assess the task difficulty:
- "simple": 1-2 steps, single page, obvious target element
- "moderate": 3-5 steps, may navigate, clear success criteria
- "complex": 6-10 steps, multi-page, needs verification
- "extreme": 10+ steps, multi-site, ambiguous success criteria

Your assessment determines how patient or aggressive the execution
engine will be with retries, escalation, and failure detection.
Be honest — overrating difficulty wastes resources on easy tasks,
underrating causes premature termination on hard ones.

Optionally, override specific runtime limits if you have strong
reason (e.g., known flaky site from memory, unusually deep form).
```

**Fallback:** If the planner doesn't return difficulty (model failure, simple task that skips decomposition), default to `moderate` — the current behavior.

### S5: Mid-Session Reassessment

**Insight:** The initial difficulty assessment may be wrong. Allow the planner model to revise limits when it's escalated into the conversation.

**Book basis:** Dibia (2025) on the handoff pattern: "The handoff pattern allows agents to transfer control when another agent is better suited to handle the next step. This creates flexible, adaptive workflows" (§2.3.2, p.38). Escalation is a handoff — the planner model arrives with fresh perspective and can reassess.

Rothman (2025) lesson #1: "Treat context as an engineered system, not a long prompt." The difficulty assessment is part of the context — it should evolve with the conversation.

**Behavior:** When the planner model is escalated (either via stuck detection or voluntary `escalate` tool), it receives the current `RuntimeLimits` in the escalation context alongside the distilled history. It may return a `limit_overrides` adjustment in its first response.

This covers two important cases:
1. **Underrated difficulty:** Agent assessed `simple`, but the page turned out to have dynamic content, overlays, and multi-step auth. Planner model bumps to `complex` limits.
2. **Overrated difficulty:** Agent assessed `complex`, but the task is actually straightforward — the agent was just using the wrong approach. Planner model can tighten limits to prevent further waste.

**Guard:** Mid-session reassessment can only **widen** limits (increase thresholds), never tighten below the `simple` profile minimums. This prevents the planner model from inadvertently creating a death spiral where it tightens limits, gets terminated, escalates, tightens again.

**Exception:** `maxDoneRejections` can be tightened (reduced) — if the planner model believes the task is simpler than initially assessed, it should be allowed to let `done()` through more easily.

### S6: Trace Integration

**Insight:** Record the difficulty assessment and active limits in traces for offline analysis and future learning.

**Book basis:** The Tracing Gap Analysis: "Failure semantics are distributed and not normalized into a compact failure ontology... harder to compute reliable failure trends and auto-remediation triggers." Recording which limits were active when a failure occurred is essential for tuning the profiles.

Rothman (2025) lesson #8: "Keep the system glass-box. Traceability of decisions, evidence, and failure reasons is a hard requirement."

**Behavior:** Extend `TraceSession` and `TraceEntry` to capture:

```typescript
// In TraceSession
difficultyAssessment: Difficulty;
runtimeLimits: RuntimeLimits;        // resolved limits (after merge)
limitOverrides: Partial<RuntimeLimits> | null;  // what the planner changed

// In TraceEntry (on reassessment turns only)
limitReassessment?: {
  previousDifficulty: Difficulty;
  newDifficulty: Difficulty;
  changedLimits: Partial<RuntimeLimits>;
  reason: string;
};
```

This enables:
- **Profile tuning:** Analyze outcomes grouped by difficulty level to refine the presets
- **Override analysis:** Identify which planner overrides correlate with better/worse outcomes
- **Reassessment tracking:** Measure how often initial assessments are wrong and in which direction
- **Eval integration:** Eval cases can assert expected difficulty levels for known tasks

## Implementation

### File: `src/background/agent/constants.ts`

Add the `RuntimeLimits` interface, `Difficulty` type, `DIFFICULTY_PROFILES` map, and a `resolveRuntimeLimits()` merge function.

```typescript
export type Difficulty = 'simple' | 'moderate' | 'complex' | 'extreme';

export interface RuntimeLimits {
  stuckEscalate: number;
  stuckGiveUp: number;
  stuckGiveUpPlanner: number;
  maxEscalationCycles: number;
  escalationCooldown: number;
  toolFailureWarn: number;
  toolFailureExit: number;
  maxDoneRejections: number;
  maxConsecutiveAllFail: number;
  stagnationReflection: number;
  stagnationPivot: number;
  stepWarnTurns: number;
  stepEscalateTurns: number;
  maxFreshStarts: number;
}

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  stuckEscalate: STUCK_THRESHOLDS.ESCALATE,
  stuckGiveUp: STUCK_THRESHOLDS.GIVE_UP,
  stuckGiveUpPlanner: STUCK_THRESHOLDS.GIVE_UP_PLANNER,
  maxEscalationCycles: ESCALATION_LIMITS.MAX_CYCLES,
  escalationCooldown: ESCALATION_LIMITS.COOLDOWN_TURNS,
  toolFailureWarn: TOOL_FAILURE_THRESHOLDS.WARN,
  toolFailureExit: TOOL_FAILURE_THRESHOLDS.EXIT,
  maxDoneRejections: AGENT_LIMITS.MAX_DONE_REJECTIONS,
  maxConsecutiveAllFail: AGENT_LIMITS.MAX_CONSECUTIVE_ALL_FAIL,
  stagnationReflection: STAGNATION_DETECTION.NUDGE_THRESHOLD,
  stagnationPivot: STAGNATION_DETECTION.PIVOT_THRESHOLD,
  stepWarnTurns: STEP_WATCHDOG.WARN_TURNS,
  stepEscalateTurns: STEP_WATCHDOG.ESCALATE_TURNS,
  maxFreshStarts: FRESH_START.MAX_PER_SESSION,
};

/** Hard floor values — no profile or override can go below these */
const MINIMUM_LIMITS: RuntimeLimits = {
  stuckEscalate: 2,
  stuckGiveUp: 4,
  stuckGiveUpPlanner: 3,
  maxEscalationCycles: 1,
  escalationCooldown: 1,
  toolFailureWarn: 2,
  toolFailureExit: 3,
  maxDoneRejections: 1,
  maxConsecutiveAllFail: 2,
  stagnationReflection: 2,
  stagnationPivot: 3,
  stepWarnTurns: 2,
  stepEscalateTurns: 4,
  maxFreshStarts: 1,
};

/** Hard ceiling values — no profile or override can exceed these */
const MAXIMUM_LIMITS: RuntimeLimits = {
  stuckEscalate: 12,
  stuckGiveUp: 25,
  stuckGiveUpPlanner: 20,
  maxEscalationCycles: 8,
  escalationCooldown: 6,
  toolFailureWarn: 10,
  toolFailureExit: 15,
  maxDoneRejections: 7,
  maxConsecutiveAllFail: 10,
  stagnationReflection: 6,
  stagnationPivot: 10,
  stepWarnTurns: 12,
  stepEscalateTurns: 20,
  maxFreshStarts: 4,
};

export function resolveRuntimeLimits(
  difficulty: Difficulty,
  plannerOverrides?: Partial<RuntimeLimits> | null,
): RuntimeLimits {
  const profile = DIFFICULTY_PROFILES[difficulty] ?? {};
  const merged = { ...DEFAULT_RUNTIME_LIMITS, ...profile, ...plannerOverrides };
  // Clamp every value to [MINIMUM, MAXIMUM]
  const result = { ...merged };
  for (const key of Object.keys(result) as (keyof RuntimeLimits)[]) {
    result[key] = Math.max(MINIMUM_LIMITS[key], Math.min(MAXIMUM_LIMITS[key], result[key]));
  }
  return result;
}
```

### File: `src/background/agent/loop.ts`

Replace direct references to static constants with `this.limits.*`:

```typescript
class AgentLoop {
  private limits: RuntimeLimits;
  private difficulty: Difficulty = 'moderate';

  constructor(/* ... */) {
    this.limits = { ...DEFAULT_RUNTIME_LIMITS };
  }

  /** Called after planner decomposition returns */
  applyDifficultyAssessment(difficulty: Difficulty, overrides?: Partial<RuntimeLimits> | null): void {
    this.difficulty = difficulty;
    this.limits = resolveRuntimeLimits(difficulty, overrides);
    this.logger.info('runtime-limits', { difficulty, limits: this.limits });
  }

  /** Called on escalation reassessment — can only widen (except maxDoneRejections) */
  reassessLimits(overrides: Partial<RuntimeLimits>): void {
    const previous = { ...this.limits };
    for (const [key, value] of Object.entries(overrides) as [keyof RuntimeLimits, number][]) {
      if (key === 'maxDoneRejections') {
        // Can tighten — planner model may judge task is simpler
        this.limits[key] = Math.max(MINIMUM_LIMITS[key], Math.min(MAXIMUM_LIMITS[key], value));
      } else {
        // Can only widen (increase)
        this.limits[key] = Math.max(this.limits[key], Math.min(MAXIMUM_LIMITS[key], value));
      }
    }
    this.logger.info('limits-reassessed', { previous, updated: this.limits });
  }
}
```

Every site in `loop.ts` that currently reads e.g. `STUCK_THRESHOLDS.ESCALATE` would instead read `this.limits.stuckEscalate`.

### File: `src/background/agent/planner.ts`

Extend the decomposition prompt and response parsing:

```typescript
// Add to decomposition system prompt:
const DIFFICULTY_INSTRUCTION = `
Assess task difficulty as one of: simple, moderate, complex, extreme.
- simple: 1-2 steps, single page, obvious target
- moderate: 3-5 steps, may navigate, clear goal
- complex: 6-10 steps, multi-page, needs verification
- extreme: 10+ steps, multi-site, or ambiguous success criteria

Return in your JSON: { "steps": [...], "difficulty": "<level>" }
Optionally include "limit_overrides": { ... } if you have strong reason
to deviate from the difficulty preset (e.g. known flaky site from memory).
`;

// In response parsing:
interface PlannerDecompositionResult {
  steps: SubtaskStep[];
  difficulty?: Difficulty;
  limit_overrides?: Partial<RuntimeLimits>;
}
```

### File: `src/background/agent/trace.ts`

Extend trace types:

```typescript
// TraceSession additions
difficultyAssessment?: Difficulty;
resolvedLimits?: RuntimeLimits;
plannerLimitOverrides?: Partial<RuntimeLimits> | null;

// TraceEntry addition (only on reassessment turns)
limitReassessment?: {
  trigger: 'escalation' | 'manual';
  previousDifficulty: Difficulty;
  newDifficulty: Difficulty;
  changedLimits: Partial<RuntimeLimits>;
  reason: string;
};
```

### File: `src/types/index.ts`

Export `Difficulty` and `RuntimeLimits` from the central types.

## Testing

### Unit Tests

**S1/S2 — `resolveRuntimeLimits()`:**
- Returns defaults for `moderate` with no overrides
- Applies `simple` profile correctly (all values tighter)
- Applies `extreme` profile correctly (all values wider)
- Planner overrides take precedence over profile
- Clamps to `MINIMUM_LIMITS` floor (model can't set `stuckEscalate: 0`)
- Clamps to `MAXIMUM_LIMITS` ceiling (model can't set `stuckGiveUp: 999`)

**S5 — `reassessLimits()`:**
- Can only widen non-`maxDoneRejections` values
- Can tighten `maxDoneRejections`
- Respects floor/ceiling after reassessment
- Logs previous and updated values

**S4 — Planner parsing:**
- Parses `difficulty` field from decomposition response
- Falls back to `moderate` when field missing
- Parses `limit_overrides` when present
- Ignores malformed overrides gracefully

### Eval Pipeline

**New eval cases:**
- `simple_task_fast_termination.json` — simple task should complete in <5 turns with `simple` limits
- `complex_task_persistence.json` — complex task on flaky site should survive tool failures that would trip `simple` limits
- `difficulty_reassessment.json` — task initially assessed as `simple` that requires escalation and limit widening

**Regression cases:**
- Existing golden files should pass unchanged (defaults = `moderate` = current behavior)

### Manual Testing

1. Simple task ("click the login button"): verify agent fails fast (< 6 turns) on wrong approach instead of persisting to turn 10
2. Complex form fill: verify agent persists through intermittent failures that would have tripped the old static `EXIT = 6`
3. Check trace output includes `difficultyAssessment` and `resolvedLimits`

## Impact

### Performance
- **Zero additional LLM calls.** Difficulty assessment piggybacks on existing planner decomposition (S1).
- **Potential token savings on simple tasks.** Fewer wasted turns = fewer LLM calls = lower cost. A `simple` task that currently runs 10 turns before giving up would terminate at 6.
- **Potential throughput improvement on complex tasks.** Wider limits mean the agent completes tasks it previously abandoned, avoiding user re-runs.

### Reliability
- **Reduced false terminations.** Complex tasks get the patience they need, per Dibia's multi-dimensional termination principle (§2.5.1).
- **Reduced wasted computation.** Simple tasks fail fast, per Rothman's "engineer for production reality" principle.
- **Better escalation calibration.** The planner model is called less often for simple tasks (tighter escalation threshold), more strategically for complex ones.

### Observability
- **Difficulty labels in traces** enable segmented analysis: "what's our success rate on `complex` vs `simple` tasks?"
- **Limit override tracking** enables profile tuning over time: "are the `extreme` presets too generous?"
- **Reassessment events** measure planner accuracy: "how often is the initial assessment wrong?"

### Risks

| Risk | Mitigation |
|---|---|
| Planner produces wrong difficulty | Fallback to `moderate` (current behavior). Floor/ceiling clamps prevent extreme values. |
| Planner model games limits to extend its own tenure | Mid-session can only widen, not tighten (except `maxDoneRejections`). Safety rails (`MAX_SESSION_MS`, cost caps) are never adaptive. |
| Profile presets are miscalibrated | Trace data enables empirical tuning. Initial profiles are conservative (close to current defaults for `moderate`). |
| Added complexity in loop.ts | `this.limits.X` is a direct replacement for `CONSTANT.X` — same read pattern, different source. |

## Decision Log

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Difficulty granularity | 4 levels (simple/moderate/complex/extreme) | Numeric 1–10 scale | 4 levels are interpretable by the model and map to distinct profiles. A numeric scale invites hallucinated precision. |
| Assessment timing | Planner decomposition (existing call) | Separate difficulty-assessment LLM call | Zero marginal cost. Dibia (2025, §4.5): piggyback on structured output. |
| Override mechanism | `Partial<RuntimeLimits>` merge | Full `RuntimeLimits` required from model | Partial overrides minimize model burden and schema complexity. Most tasks need 0–2 overrides. |
| Mid-session direction | Can only widen (except `maxDoneRejections`) | Bidirectional | Prevents death spiral where model tightens limits → gets terminated → escalates → tightens again. |
| Floor/ceiling clamps | `MINIMUM_LIMITS` / `MAXIMUM_LIMITS` | Trust the model | Defense in depth. Model can hallucinate `stuckGiveUp: 0` or `toolFailureExit: 1000`. Clamps bound the damage. |
| Safety constants | Never adaptive | All adaptive with high floor | Dibia (2025, §2.5.1): "Budget-based limits provide hard safety guarantees." Mixing safety and strategy is an anti-pattern. |
| Compression thresholds | Not adaptive (this RFC) | Adaptive | Compression is turn-count-based and already has 5 tiers. Adaptive compression is future work (interacts with rolling distillation). |

## Future Work

- **Cross-session learning:** Use trace data to build per-site or per-task-type difficulty priors. A site that consistently requires `complex` limits could be pre-classified via memory.
- **Adaptive compression:** Extend the same pattern to `COMPRESSION_TRIGGERS` — a `simple` task that unexpectedly runs long could trigger compression earlier.
- **Orchestrator integration:** The orchestrator's lane policies (`maxConcurrent`, `maxCallMs`, `isolationCooldownMs`) are also candidates for difficulty-adaptive tuning.
- **User-facing difficulty display:** Show the assessed difficulty in the side panel so users understand why the agent is being patient or aggressive.
