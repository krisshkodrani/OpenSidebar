# RFC: Orchestrator Call Reduction (Eliminate Coordination Overhead)

## Status
Proposed

## References
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems* (2025). Ch 11 §11.3.11 "You Probably Don't Need a Multi-Agent System"; Ch 1 §1.7 "Choosing the Right AI Agent Architecture" — decision framework; Ch 2 §2.3.3 "Conversation-Driven Pattern" — coordination overhead; Ch 2 §2.4.2 "Selection Criteria" — handoff has lowest overhead; Ch 1 §1.7.1 — 24x token efficiency for simple tasks with direct calls; Ch 2 §2.3.1 "Plan-Based Orchestration Pattern" — orchestrator as bottleneck; Ch 7 §7.5 "Plan-Based Orchestration" — plan once, re-plan on failure only.
- **Book 2**: Antonio Gulli, *Agentic Design Patterns* (2025). Ch 7 "Multi-Agent Collaboration" (lines 1245-1247) — supervisor as bottleneck; Ch 4 "Reflection" (lines 756-757) — single reflection cycle over iterative; Ch 17 "MASS" (lines 2888-2904) — optimize individual agents before composing; Ch 2 "Routing" (lines 310-325) — LLM-based routing to avoid expensive calls; Ch 16 "Resource-Aware Optimization" (lines 2607-2636) — dynamic model switching.
- **Book 3**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (Packt, 2025). Ch 4 "Planner" (lines 2450-2509) — plan once, execute many; Ch 4 "Agent Registry" (lines 2416-2441) — capabilities-aware planning; Ch 6 "Micro-context engineering" — minimum viable context per step; Ch 8 "Two-stage content moderation protocol" — fast programmatic gate before LLM gate.
- **Internal**: `src/background/orchestrator/planner.ts` (deliberation loop), `src/background/orchestrator/verifier.ts` (reviewer + advise + debate), `src/background/orchestrator/index.ts` (orchestrator main loop).

## Context

### The Problem: Orchestrator Overhead Exceeds Executor Cost

The orchestrator was designed to provide reliable multi-step task execution. But its coordination machinery has accumulated LLM calls that often cost more than the actual task execution:

| Phase | Method | Calls | Tier | When |
|-------|--------|-------|------|------|
| **Planning** | `guardian.decompose()` | 1 | Smart | Always — initial decomposition |
| | `runPlanDeliberation()` | 0–2 | Smart | When plan has ≥3 steps or dependencies |
| | `reviewPlan()` | 1 | Smart | Always — preflight review |
| **Per-Node** | `advise()` | 1 | Smart | Always — per-node advisory |
| | `verifyNode()` | 1 | Smart | Always — per-node verification |
| | `runDialogue()` | 0–2 | Smart | When verification ≠ accept |
| | `reflectDecision()` | 0–1 | Smart | When drift/staleness detected |
| | `advocateChallenge()` | 0–1 | Smart | When verifier rejects |
| **Post-Run** | `retrospective()` | 1 | Smart | Always — post-mortem |
| | Summarization | 1 | Smart | Always — final summary |

**For a simple 3-node task:**
- Minimum: 1 (decompose) + 1 (review) + 3×2 (advise+verify) + 1 (retrospective) + 1 (summary) = **10 smart calls**
- Typical: Add deliberation + some debate rounds = **14-18 smart calls**
- Of these, only the 3 executor loops do actual work. The rest is coordination.

The orchestrator's overhead is **3-6x the executor cost** in LLM calls.

### What the Literature Says

**Dibia (Ch 11 §11.3.11)** states it directly: "You probably don't need a multi-agent system. The overhead of coordination, token growth from shared conversations, and error compounding often outweigh the theoretical benefits." The orchestrator's planner-verifier-critic-advocate pipeline is effectively a 4-agent system for what is often a straightforward sequence of browser actions.

**Dibia (Ch 1 §1.7.1)** provides the data: "Evaluation data shows direct model calls achieve 9.7/10 quality with 24x better token efficiency than multi-agent systems on simple reasoning tasks. Multi-agent systems only justify overhead when tasks require tool coordination or specialized expertise."

**Dibia (Ch 2 §2.3.3)** on conversation-driven coordination: "AI-driven conversation patterns require an additional LLM call per turn just for speaker selection. Combined with the growing conversation context that all agents share, this makes conversation-driven coordination the most expensive pattern." The verifier dialogue is exactly this pattern — multiple LLM "speakers" debating each node.

**Dibia (Ch 2 §2.4.2)** recommends handoff patterns for resource-constrained systems: "Among autonomous patterns, handoff patterns have the lowest coordination overhead. Agents make local decisions about delegation without requiring a centralized orchestrator." The existing fast→smart escalation is already a handoff pattern — the orchestrator adds an expensive layer on top.

**Gulli (Ch 7, lines 1245-1247)** warns about supervisors: "Managing communication overhead and ensuring coherent decision-making can be challenging. The Supervisor model introduces a single point of failure and can become a bottleneck if overwhelmed." The orchestrator is exactly this bottleneck.

**Gulli (Ch 17, lines 2888-2904)** on the MASS framework: "Optimize individual agents with high-quality prompts before composing them." The implication is clear: invest in making the executor (fast model with good prompts) work well on its own before adding orchestration layers.

**Rothman (Ch 4, lines 2450-2509)** on planning: "The Planner makes ONE call to the LLM. The Executor then follows this plan mechanically without consulting the LLM again for planning decisions." The deliberation loop (up to 2 additional planning calls) contradicts this principle.

**Rothman (Ch 8)** on two-stage gates: "Implement a two-stage moderation gate: first a fast programmatic check, then an LLM-based check only if needed." Applied to the orchestrator: the programmatic verification gate (see RFC: Programmatic Verification) should replace most LLM verification calls, making the debate/reflection machinery unnecessary.

## Problem

Five specific sources of wasted calls:

**P1: Plan deliberation (0–2 calls).** `runPlanDeliberation()` re-runs `guardian.decompose()` up to 2 additional times to "refine" the plan. In practice, the first decomposition is usually good enough — the deliberation often just shuffles step ordering or adds minor wording changes. The convergence check (`planSignature`) shows plans often converge after 0-1 rounds.

**P2: Plan review (1 call).** `reviewPlan()` makes a smart-tier call to validate the plan structure. But the plan was just generated by the same smart model — reviewing the model's own output with the same model is circular. Structural issues (missing dependencies, invalid tool names) are already caught by `validatePlannerAssignments()` programmatically.

**P3: Per-node advisory (1 call each).** `advise()` generates hints before each node execution. For simple nodes ("navigate to URL", "click the submit button"), the hint adds no information beyond what's already in the node description and executor instruction. The advisory is most useful for complex or previously-failed nodes — the minority case.

**P4: Per-node verification debate (1–4 calls each).** `runDialogue()` + `criticChallenge()` + `reflectDecision()` + `advocateChallenge()` create a multi-round debate for each node. As argued in RFC: Programmatic Verification, browser actions have observable outcomes that can be checked programmatically. The debate is designed for subjective quality assessment, not binary state verification.

**P5: Retrospective (1 call).** `retrospective()` extracts "lessons learned" from the session's failure log. These lessons are stored in `reflexionLog` entries but have no downstream consumer — they're logged but not acted upon in future sessions. The memory system (`memory_add`) is the correct place for cross-session learning, but the retrospective doesn't write to memory.

## Solution

### S1: Remove Plan Deliberation

Delete `runPlanDeliberation()` and `shouldRunDeliberation()`. The initial `guardian.decompose()` call produces the plan in one pass.

**Rationale from Rothman (Ch 4):** "The Planner makes ONE call." Plan refinement is warranted when plan quality is poor, but the guardian prompt already produces well-structured plans. If plan quality needs improvement, the correct fix is improving the guardian prompt (Gulli Ch 17 MASS: "optimize individual agents"), not adding iterative refinement calls.

**Fallback:** If the initial plan is structurally invalid (caught by `validatePlannerAssignments()`), the executor still adapts at runtime — replanning happens only when a node actually fails, not as a scheduled pre-check.

**Savings: 0–2 smart calls per session.**

### S2: Remove Plan Review

Delete `reviewPlan()`. Structural validation is already handled by `validatePlannerAssignments()` (programmatic). Semantic review by the same model that generated the plan adds little value.

**Rationale from Rothman (Ch 8):** Two-stage gate — the programmatic validation (stage 1) catches structural issues. If the plan passes structural validation, it's good enough to execute. Failures are caught at node execution time, where they can be addressed with concrete evidence (not hypothetical concerns from a preflight check).

**Savings: 1 smart call per session.**

### S3: Gate Advisory (Covered by RFC: Programmatic Verification S3)

Already specified in the Programmatic Verification RFC. Only call `advise()` for complex/retried nodes.

**Savings: 2–4 smart calls per 5-node task.**

### S4: Replace Verification Debate with Programmatic Gate + Single LLM Fallback (Covered by RFC: Programmatic Verification S1+S2)

Already specified in the Programmatic Verification RFC. Programmatic gate first, single `verifyNode()` for ambiguous cases, no debate.

**Savings: 5–15 smart calls per 5-node task.**

### S5: Replace Retrospective with Memory Write

Instead of a dedicated LLM call for retrospective analysis, have the orchestrator write failure lessons directly to the memory system using `memory_add` with structured entries.

When a node fails and is rerouted or the task completes with failures:

```typescript
// Instead of: await this.planner.retrospective(task, nodes, reflexionLog, signal);
// Do:
for (const entry of reflexionLog) {
  if (entry.failureType && entry.executorSummary) {
    await memoryBridge.add({
      content: `[${domain}] ${entry.executorSummary}. ` +
        `Failure: ${entry.failureType}. ` +
        `Verifier: ${entry.verifierDecision}.`,
      category: "procedure",
      tags: [domain, "failure", entry.failureType],
    });
  }
}
```

This is zero LLM calls (memory_add uses the embedding model, not the LLM), makes the lessons available cross-session (via `memory_search`), and stores them with proper categorization. The current retrospective's output (lessons array) is never retrieved — memory_add fixes that.

**Rationale from Rothman (Ch 3):** "Procedural RAG — Store *how-to-act* instructions in a vector store." Failure lessons are procedural knowledge ("don't try approach X on this site") and belong in the procedural memory, not in a transient reflexion log.

**Savings: 1 smart call per session.**

### S6: Remove End-of-Run LLM Summarization

The orchestrator makes a final `llm.complete()` call to summarize the execution log. The executor's own `done` tool output already contains a summary. The orchestrator can compose a programmatic summary from node statuses + the executor's done message:

```typescript
function buildProgrammaticSummary(
  task: OrchestratorTask,
  nodes: TaskNode[],
): string {
  const completed = nodes.filter(n => n.status === "completed").length;
  const failed = nodes.filter(n => n.status === "failed").length;
  const total = nodes.length;
  const lastCompletedNode = nodes.findLast(n => n.status === "completed");

  return [
    `Task: ${task.query}`,
    `Result: ${completed}/${total} subtasks completed${failed > 0 ? `, ${failed} failed` : ""}.`,
    lastCompletedNode?.result ? `Final output: ${lastCompletedNode.result.slice(0, 200)}` : null,
    failed > 0
      ? `Failures: ${nodes.filter(n => n.status === "failed").map(n => n.description).join("; ")}`
      : null,
  ].filter(Boolean).join("\n");
}
```

**Savings: 1 smart call per session.**

## Implementation

### S1: Remove Plan Deliberation

**File**: `src/background/orchestrator/planner.ts`

Remove:
- `runPlanDeliberation()` method (lines 161-225)
- `shouldRunDeliberation()` function (lines 73-82)
- `planSignature()` function (lines 59-71)
- `DELIBERATION_MAX_TURNS` constant (line 57)

Simplify `buildNodes()` to use the initial decomposition directly:

```typescript
async buildNodes(
  query: string,
  pageTitle: string,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<TaskNode[]> {
  const decomposition = await this.guardian.decompose(
    query, pageTitle, pageUrl, signal,
  );
  // ... rest of node building (unchanged)
}
```

### S2: Remove Plan Review

**File**: `src/background/orchestrator/verifier.ts`

Remove:
- `reviewPlan()` method (lines 457-499)
- `PREFLIGHT_SYSTEM` constant (line 60)

**File**: `src/background/orchestrator/index.ts`

Remove all calls to `this.verifier.reviewPlan()`. The orchestrator proceeds directly from plan generation to execution.

### S5: Replace Retrospective with Memory Write

**File**: `src/background/orchestrator/planner.ts`

Remove `retrospective()` method (lines 390-463) and `RETROSPECTIVE_SYSTEM` constant (line 14).

**File**: `src/background/orchestrator/index.ts`

Replace the `retrospective()` call with direct memory writes. The memory bridge is already available in the orchestrator context.

### S6: Programmatic Summarization

**File**: `src/background/orchestrator/index.ts`

Replace the `llm.complete()` summarization call with `buildProgrammaticSummary()`. Add the function as a module-level utility.

Remove the `LlmLike` type dependency if it was only used for summarization.

## Testing

### Unit Tests

**S1 — No deliberation:**
- Test that `buildNodes()` calls `guardian.decompose()` exactly once
- Test that plans with ≥3 steps proceed without deliberation
- Test that plans with dependencies proceed without deliberation

**S2 — No plan review:**
- Test that the orchestrator does not call `reviewPlan()` on any plan
- Test that structurally invalid plans are still caught by `validatePlannerAssignments()`

**S5 — Memory-based retrospective:**
- Test that failed nodes produce `memory_add` calls with correct category and tags
- Test that successful sessions (no failures) produce no memory writes
- Test that the failure description includes the domain, executor summary, and failure type

**S6 — Programmatic summary:**
- Test `buildProgrammaticSummary()` with all-completed nodes
- Test with mixed completed/failed nodes
- Test with empty result on completed nodes (graceful fallback)

### Eval Pipeline

Run existing eval suite before/after, compare:
- **Total smart-tier LLM calls per session** (primary metric)
- **Task completion rate** (must not regress)
- **Time to completion** (should improve from fewer round trips)
- **Cost per session** (should drop 50-70%)

## Impact

### Performance

**Combined savings for a 5-node orchestrated task:**

| Component | Before | After | Saved |
|-----------|--------|-------|-------|
| Plan decomposition | 1 | 1 | 0 (kept) |
| Plan deliberation | 0–2 | 0 | 0–2 |
| Plan review | 1 | 0 | 1 |
| Advisory (5 nodes) | 5 | 1–2 | 3–4 |
| Verification (5 nodes) | 5–20 | 1–3 | 4–17 |
| Retrospective | 1 | 0 | 1 |
| Summarization | 1 | 0 | 1 |
| **Total smart-tier calls** | **14–30** | **3–6** | **10–24 (70-80%)** |

### Reliability

- **Simpler is more reliable.** Removing deliberation, debate, and review eliminates classes of parsing errors, timeout failures, and stochastic disagreements between LLM "roles." Each removed call is one fewer failure point.
- **Programmatic verification is deterministic.** Same input → same output. No stochastic variance from temperature, model state, or prompt sensitivity.
- **Memory-based retrospective is durable.** Lessons survive across sessions (memory_add → memory_search). The current retrospective's output dies with the session.

### Risks

- **Plan quality without deliberation.** If the initial `guardian.decompose()` produces poor plans, there's no refinement step. Mitigated by: (a) the guardian prompt is already well-optimized, (b) node-level replanning via `expandNode()` still handles runtime failures, (c) if plan quality regresses measurably in evals, we can add back a single deliberation round (1 call, not 2).
- **Missing subtle failures without debate.** The critic/advocate pattern could theoretically catch a failure that the programmatic gate and single verifyNode miss. In practice, browser actions have observable outcomes. If a pattern of missed failures emerges in traces, the programmatic gate can be tuned with new signals.
- **No summarization quality.** The programmatic summary is less polished than an LLM-generated one. But the summary is primarily for the user-facing completion message — and a factual "3/3 subtasks completed" is more trustworthy than a hallucinatable LLM narrative.

## Rollout Plan

| Phase | Changes | Risk | Validation |
|-------|---------|------|------------|
| **1** | S2 (remove plan review) + S6 (programmatic summary) | Very low — review rarely changes plans, summary is cosmetic | Eval suite pass rate |
| **2** | S1 (remove deliberation) + S5 (memory retrospective) | Low — deliberation often converges on first plan | Eval suite + trace comparison |
| **3** | S3 + S4 (from Programmatic Verification RFC) | Medium — changes verification behavior | Eval suite + manual testing on complex tasks |

## Decision Log

| Decision | Chosen | Rejected Alternative | Rationale |
|----------|--------|---------------------|-----------|
| Deliberation | Remove entirely | Keep 1 round | Even 1 round is an expensive smart call that rarely improves the plan. Rothman: "Planner makes ONE call." |
| Plan review | Remove | Replace with programmatic structural check | `validatePlannerAssignments()` already does the structural check. Semantic review by the same model is circular. |
| Retrospective | Replace with memory writes | Keep but reduce scope | The retrospective's output has no consumer. Memory writes have a consumer (`memory_search`). Zero LLM cost. |
| Summarization | Programmatic | Keep LLM but use fast tier | Fast-tier call is cheaper but still unnecessary. Node statuses + executor done message already contain all the information. |
| Advisory | Gate behind heuristic | Remove entirely | Advisory helps for complex/retried nodes. Full removal is too aggressive — keeps the escape hatch for hard cases. |

## Cross-References

- **RFC: Programmatic Verification** — S3 (conditional advisory) and S1+S2 (programmatic gate + debate removal) are specified there in detail. This RFC references them for completeness.
- **RFC: Multi-Turn Resilience** — Fresh-start recovery (S3 in that RFC) benefits from reduced orchestrator calls because a fresh start resets the orchestrator state, and fewer coordination calls means faster recovery.
- **RFC: Batched Actions** — Batched execution reduces the number of executor turns, which in turn reduces the number of per-node verification calls (fewer nodes when batch actions complete a subtask in one turn).
