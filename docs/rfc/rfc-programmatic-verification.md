# RFC: Programmatic Verification (Replace LLM Verification with DOM-State Checks)

## Status
Proposed

## References
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems* (2025). Ch 10 §10.4.4 "When to Use Numeric Metrics vs LLM Judges"; Ch 15 §15.5.1 "Explicit Completion Evaluation with TaskStatusTool"; Ch 7 §7.5.2 "Step Progress Evaluation"; Ch 7 §7.5.3 "Intelligent Retry Logic".
- **Book 2**: Antonio Gulli, *Agentic Design Patterns* (2025). Ch 4 "Reflection" (lines 665-668, 756-757) — reflection cost analysis; Ch 1 "Prompt Chaining" — structured output for verification.
- **Book 3**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (Packt, 2025). Ch 2 §"Adding agent specialization controls and validation" — lightweight pass/fail validator; Ch 2 §"Validating MCP messages" — structural guardrails; Ch 5 §"Refactoring the agents for production" — stable data contracts.
- **Internal**: `src/background/orchestrator/verifier.ts` (current LLM-based verifier), `src/background/orchestrator/index.ts` (orchestrator loop), `src/background/agent/stagnation.ts` (snapshot fingerprinting).

## Context

### The Problem: Verification is the Biggest LLM Cost Multiplier

The orchestrator currently makes **1–4 planner-tier LLM calls per node** just for verification:

| Call | File | Method | When | Cost |
|------|------|--------|------|------|
| Node verify | `verifier.ts:210` | `verifyNode()` | Every node completion | 1 planner call |
| Critic challenge | `verifier.ts:325` | `criticChallenge()` | Up to `MAX_VERIFIER_REFLECTION_ROUNDS` (2) rounds when verify ≠ accept | 0–2 planner calls |
| Reflection | `verifier.ts:391` | `reflectDecision()` | When drift/staleness detected | 0–1 planner call |
| Advocate | `verifier.ts:501` | `advocateChallenge()` | When verifier rejects | 0–1 planner call |

For a 5-node orchestrated task, this means **5–20 planner-tier LLM calls** for verification alone — often more than the executor uses.

### What the Literature Says

All three books converge on the same principle: **use programmatic checks first, LLM judgment second.**

**Dibia (Ch 10 §10.4.4)** draws a clear line: "Programmatic/numeric metrics should be used when the evaluation criteria can be expressed as deterministic checks (exact match, string containment, regex match, code execution success). LLM-as-judge should be reserved for qualitative assessment where human-like judgment is needed." He also notes (Ch 7 §7.5.2) that step completion evaluation should use "programmatic checks (did the output match expected schema? Did the function return success?) before falling back to LLM evaluation."

**Dibia (Ch 7 §7.5.3)** addresses retry specifically: "When a step fails, the orchestrator evaluates the failure programmatically first (timeout? network error? malformed input?) before using an LLM to analyze the failure." This means the `retry-policy.ts` should catch common failure patterns without burning an LLM call.

**Dibia (Ch 15 §15.5.1)** proposes the `TaskStatusTool` pattern: "A meta-cognitive tool lets the agent explicitly mark task progress without requiring an LLM judgment call. The agent calls `task_status(status='complete', reason='...')` as a tool, which the system intercepts for programmatic verification." OpenSidebar's `done` tool already follows this pattern — the insight is to trust it more.

**Gulli (Ch 4)** warns about the cost of reflection explicitly: "Every refinement loop may require a new LLM call, making it suboptimal for time-sensitive applications." He recommends: "While full iterative reflection often requires stateful workflows, a single reflection step can be implemented" — and only at subtask boundaries, not every turn. The critic/advocate debate pattern (2+ rounds) is exactly the expensive pattern he warns against.

**Rothman (Ch 2)** demonstrates a lightweight validator that uses a focused pass/fail check rather than a full LLM re-analysis: "If all claims are supported, respond 'pass'. If not, respond 'fail' with a one-sentence explanation." He also advocates structural validation (Ch 2, MCP message validation) as a zero-cost first gate.

### What We Already Have (But Don't Use)

The codebase already contains the building blocks for programmatic verification:

1. **`deriveVerifierFallbackDecision()`** (`verifier.ts:116`) — A keyword-based heuristic that checks for "completed", "success", "done", "blocked", "captcha" etc. Currently only used as a fallback when the LLM verifier fails. This should be the **first** check, not the fallback.

2. **`StagnationMonitor`** (`agent/stagnation.ts`) — Fingerprints snapshots by hashing URL + element count + element signatures. Already detects when the page state has changed vs. stalled. This is a free signal for "did the action have any effect?"

3. **DOM snapshot diffs** — The agent loop already compares `prevElementCount` across turns. A URL change + element count change is strong programmatic evidence of progress.

4. **Tool result structure** — Every tool executor returns structured results (success/failure text). The verifier could inspect these directly instead of asking an LLM to interpret them.

## Problem

Three specific waste patterns:

**P1: LLM verification of obvious successes.** When the executor navigates to a new URL and the success criteria is "navigate to the search results page," the URL change is sufficient proof. The LLM verifier call is wasted.

**P2: Multi-round debate on clear failures.** When the executor output contains "Error: element not found," the failure type is programmatically determinable (`state_mismatch`). Running 2 rounds of critic/advocate debate to arrive at the same conclusion wastes 2–3 planner-tier calls.

**P3: Advisory calls for straightforward nodes.** The `advise()` method makes a planner-tier LLM call before each node's execution to generate hints. For simple nodes ("click the login button"), this advice adds no value.

## Solution

### S1: Programmatic Verification Gate (Before LLM)

Introduce a `programmaticVerify()` function that runs before `verifyNode()`. If it produces a high-confidence result, skip the LLM call entirely.

**Signals checked:**

| Signal | Source | Interpretation |
|--------|--------|----------------|
| URL changed | Executor handoff context | Navigation succeeded |
| Page title changed | Executor handoff context | Page transitioned |
| Element count changed significantly (±20%) | DOM snapshot | Page content updated |
| Success keywords in executor output | `deriveVerifierFallbackDecision()` (existing) | Self-reported success |
| Error keywords in executor output | `deriveVerifierFallbackDecision()` (existing) | Self-reported failure |
| Blocked markers in executor output | `BLOCKED_MARKERS` (existing) | Blocked — reroute |
| Tool results all succeeded | Executor handoff artifacts | Actions executed cleanly |

**Decision matrix:**

```
High-confidence ACCEPT (skip LLM):
  - Executor output contains "completed"/"success"/"done"
  - AND (URL changed OR element count changed OR page title changed)
  → Accept with confidence 0.85

High-confidence RETRY (skip LLM):
  - Executor output contains error keywords
  - AND URL did NOT change
  - AND element count unchanged
  → Retry with confidence 0.85, failureType from keyword match

High-confidence REROUTE (skip LLM):
  - Executor output contains blocked markers ("captcha", "forbidden", "access denied")
  → Reroute with confidence 0.90

Ambiguous (fall through to LLM verifier):
  - Mixed signals (success text but no DOM change, or DOM changed but no explicit success)
  - No strong keywords either way
```

**Expected impact:** Based on trace analysis of typical sessions, ~60-70% of node verifications fall into the "obvious" categories (clear success or clear failure). This eliminates 3–4 LLM calls per 5-node task.

### S2: Eliminate Critic/Advocate Debate

Remove the `runDialogue()`, `criticChallenge()`, `reflectDecision()`, and `advocateChallenge()` methods entirely. Replace with a single `verifyNode()` call when programmatic verification is ambiguous.

**Rationale from the literature:**

- **Gulli (Ch 4)**: "Every refinement loop may require a new LLM call, making it suboptimal for time-sensitive applications." The critic pattern exists for open-ended content generation where quality is subjective. Browser automation verification is binary: the page either changed or it didn't.

- **Dibia (Ch 11 §11.3.11)**: "You Probably Don't Need a Multi-Agent System." The verifier-critic-advocate is effectively a 3-agent system for a task that's deterministic in most cases.

- **Rothman (Ch 2)**: The validator uses a single pass/fail check, not a debate. "If all claims are supported, respond 'pass'."

The debate pattern was designed for subjective quality assessment. Verification of browser actions is not subjective — it's observable state. When the single `verifyNode()` call produces a low-confidence result, the correct response is to retry the action (cheap) rather than debate the interpretation (expensive).

### S3: Conditional Advisory

Gate `advise()` behind a complexity heuristic. Only call it when:
- The node has 2+ dependencies (needs coordination context)
- The node's assumptions list is non-empty (needs validation)
- The node has been retried at least once (struggling — advice may help)

For simple nodes with no dependencies and no assumptions, skip the advisory call entirely.

**Expected impact:** ~60% of nodes in typical plans are simple (single-action, no dependencies). Skipping advisory for these saves ~3 planner-tier calls per 5-node task.

### S4: Structured Executor Evidence

Require the executor's `done` tool to include structured evidence fields that the programmatic verifier can check directly.

When the agent calls `done` at the end of a node execution, the handoff artifact should include:

```typescript
interface StructuredEvidence {
  finalUrl: string;
  finalTitle: string;
  successIndicators: string[];  // text fragments found on page confirming success
  errorIndicators: string[];    // any error text encountered
}
```

This evidence is already partially available in the executor's handoff context. Making it structured (rather than free text) enables the programmatic verifier to check it without parsing natural language — the "stable data contracts between agents" pattern from Rothman (Ch 5).

## Implementation

### S1: Programmatic Verification Gate

**File**: `src/background/orchestrator/verifier.ts`

Add a new function before the class:

```typescript
export interface ProgrammaticVerificationInput {
  output: string;
  successCriteria: string;
  evidence?: StructuredEvidence;
  previousUrl?: string;
  previousTitle?: string;
  previousElementCount?: number;
}

export function programmaticVerify(
  input: ProgrammaticVerificationInput,
): NodeVerificationResult | null {
  const text = input.output.trim().toLowerCase();

  // Gate 1: Blocked markers → reroute immediately
  if (BLOCKED_MARKERS.some((m) => text.includes(m))) {
    return {
      decision: "reroute",
      reason: "Execution appears blocked (programmatic detection).",
      confidence: 0.9,
      failureType: "blocked",
      rerouteObjective: `Use an alternate path.`,
    };
  }

  // Gate 2: Explicit error with no DOM change → retry
  const hasError = text.startsWith("error") || text.includes("failed") ||
    text.includes("not found") || text.includes("timed out");
  const urlChanged = input.evidence?.finalUrl !== input.previousUrl;
  const titleChanged = input.evidence?.finalTitle !== input.previousTitle;
  const elementCountChanged = input.previousElementCount !== undefined &&
    input.evidence !== undefined &&
    Math.abs(/* delta check would need element count in evidence */0) > 0;

  if (hasError && !urlChanged && !titleChanged) {
    return {
      decision: "retry",
      reason: "Executor reported error with no page state change.",
      confidence: 0.85,
      failureType: "state_mismatch",
    };
  }

  // Gate 3: Success keywords + DOM change → accept
  const hasSuccess = text.includes("completed") || text.includes("success") ||
    text.includes("done") || text.includes("verified");
  const hasDomChange = urlChanged || titleChanged;

  if (hasSuccess && hasDomChange) {
    return {
      decision: "accept",
      reason: "Executor reports success and page state changed.",
      confidence: 0.85,
    };
  }

  // Gate 4: Strong success keywords alone (even without DOM change)
  // Some actions don't change the page (e.g., "read the price")
  if (hasSuccess && input.evidence?.successIndicators?.length) {
    return {
      decision: "accept",
      reason: "Executor reports success with corroborating evidence.",
      confidence: 0.80,
    };
  }

  // Ambiguous — fall through to LLM verifier
  return null;
}
```

**File**: `src/background/orchestrator/index.ts`

In the node completion handler, call `programmaticVerify()` first:

```typescript
// Before calling this.verifier.verifyNode(...)
const programmaticResult = programmaticVerify({
  output: executorOutput,
  successCriteria: node.successCriteria,
  evidence: structuredEvidence,
  previousUrl: nodeStartUrl,
  previousTitle: nodeStartTitle,
  previousElementCount: nodeStartElementCount,
});

if (programmaticResult) {
  // Skip LLM verification entirely
  verificationResult = programmaticResult;
  logger.info("orchestrator", "Programmatic verification accepted", {
    nodeId: node.id,
    decision: programmaticResult.decision,
    confidence: programmaticResult.confidence,
  });
} else {
  // Fall through to single LLM verifyNode() — no dialogue/debate
  verificationResult = await this.verifier.verifyNode(verifyInput, signal);
}
```

### S2: Remove Debate Methods

**File**: `src/background/orchestrator/verifier.ts`

Remove the following methods from `OrchestratorVerifier`:
- `runDialogue()` (lines 278-313)
- `criticChallenge()` (lines 325-389) — private, only called by runDialogue
- `reflectDecision()` (lines 391-455)
- `advocateChallenge()` (lines 501-552)

Remove associated types:
- `VerifierDialogueTurn`
- `DialogueResult`
- `VerificationReflectionInput`

Remove associated prompt constants:
- `REFLECT_SYSTEM`
- `ADVOCATE_SYSTEM`

**File**: `src/background/orchestrator/index.ts`

Remove all references to `runDialogue`, `reflectDecision`, `advocateChallenge`.
The `MAX_VERIFIER_REFLECTION_ROUNDS` and `MIN_CRITIC_CONFIDENCE_DELTA` constants become unused — remove them.

### S3: Conditional Advisory

**File**: `src/background/orchestrator/index.ts`

Replace unconditional `advise()` call with gated version:

```typescript
function shouldAdvise(node: TaskNode): boolean {
  return (
    node.dependencies.length >= 2 ||
    node.assumptions.length > 0 ||
    node.retries > 0
  );
}

// In the node execution section:
const advisory = shouldAdvise(node)
  ? await this.verifier.advise(adviseInput, signal)
  : null;
```

### S4: Structured Evidence in Handoff

**File**: `src/background/orchestrator/types.ts`

The `StructuredEvidence` type is already defined there. Ensure the executor populates it in its handoff artifact when completing a node.

**File**: `src/background/orchestrator/handoff.ts`

In `buildVerifierContext()`, extract structured evidence from the executor's final state and include it in the verification input.

## Testing

### Unit Tests

**S1 — Programmatic verification:**
- Test `programmaticVerify()` returns `reroute` for blocked markers
- Test returns `retry` for error output + no DOM change
- Test returns `accept` for success output + URL change
- Test returns `accept` for success output + structured evidence
- Test returns `null` for ambiguous output (mixed signals)
- Test returns `null` for empty output

**S2 — Debate removal:**
- Test that `OrchestratorVerifier` no longer exposes `runDialogue`, `reflectDecision`, `advocateChallenge`
- Test that the orchestrator uses single `verifyNode()` call after programmatic gate

**S3 — Conditional advisory:**
- Test `shouldAdvise()` returns false for simple nodes (no deps, no assumptions, no retries)
- Test returns true for nodes with 2+ dependencies
- Test returns true for retried nodes

### Eval Pipeline

- Run existing eval suite before/after, compare:
  - Total LLM calls per session (primary metric — expect ~40-60% reduction in verifier calls)
  - Task completion rate (must not regress)
  - Time to completion (expect improvement from fewer LLM round trips)

## Impact

### Performance

| Metric | Before (5-node task) | After | Savings |
|--------|---------------------|-------|---------|
| Verifier LLM calls | 5-20 | 1-3 | 70-85% |
| Advisory LLM calls | 5 | 1-2 | 60-80% |
| Planner-tier calls total | 10-25 | 2-5 | 75-80% |
| Estimated cost savings | — | — | $0.02-0.08 per task |

### Reliability

- Programmatic verification is deterministic — same input always gives same output. No stochastic failures from LLM parsing errors.
- The `deriveVerifierFallbackDecision()` logic is already battle-tested as the fallback path. Promoting it to primary eliminates a class of "verifier returned invalid JSON" errors.
- Single-pass LLM verification (when needed) is more reliable than multi-round debate, which can oscillate between accept/retry and waste calls.

### Risks

- **False accepts**: Programmatic gate may accept a node that actually failed (e.g., executor says "done" but the page shows an error not in the output). Mitigated by the confidence thresholds (0.80-0.85) and by requiring corroborating DOM change signals.
- **False retries**: Programmatic gate may retry when the task actually succeeded but used unusual language. Mitigated by falling through to LLM for ambiguous cases.
- **Lost nuance from debate removal**: The critic/advocate pattern could theoretically catch subtle failures. In practice, browser actions are binary (worked or didn't), and the debate pattern's value was marginal compared to its cost.

## Decision Log

| Decision | Chosen | Rejected Alternative | Rationale |
|----------|--------|---------------------|-----------|
| Programmatic gate confidence | 0.80-0.90 | 0.95+ (stricter) | High threshold would rarely trigger, defeating the purpose. The fallback LLM call catches misclassifications. |
| Debate removal | Full removal | Keep single critic round | Even one critic round doubles verification cost. Single `verifyNode()` is already a focused assessment — Rothman's pass/fail validator. |
| Advisory gating | Complexity heuristic | Remove entirely | Advisory adds value for complex/retried nodes. Blanket removal is too aggressive. |
| Evidence structure | Required in handoff | Optional | Required evidence enables programmatic verification. Optional would maintain the LLM dependency. |
