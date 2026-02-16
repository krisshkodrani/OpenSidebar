# Evaluation: Batch Execution (B) vs Concurrent Executors (C)

## Head-to-Head Comparison

| Dimension | B: Batch Execution | C: Concurrent Executors |
|-----------|-------------------|------------------------|
| **Core idea** | Smart model pre-plans tool sequence, loop executes without LLM calls | Smart model spawns parallel fast-model instances with independent agency |
| **LLM calls saved** | N-1 per batch (entire sequence = 0 LLM calls) | 0 saved — more calls total (each executor has its own LLM loop) |
| **Wall time reduction** | Eliminates LLM latency between steps | Parallelizes sub-goals (wall time = max instead of sum) |
| **HANDS agency** | Low during batch (bail-out only), full between batches | Full — each executor reasons independently |
| **Architectural change** | Minimal — new tool + intercept in existing loop | Significant — new Executor, Pool, DomLock, Semaphore |
| **New files** | 0 | 2 (executor.ts, executor-pool.ts) |
| **Implementation effort** | ~1 session | ~3-4 sessions |
| **Risk of DOM conflicts** | None (serial execution, one tool at a time) | Real (concurrent DOM mutations, element locking needed) |
| **Risk of stale IDs** | Low (executes quickly, IDs don't drift) | Medium (parallel mutations may invalidate IDs) |
| **Provider rate impact** | Reduces calls → less rate limit pressure | Increases concurrent calls → more rate limit pressure |
| **Token cost** | Lower (zero LLM calls during batch) | Higher (N executors × M turns each) |
| **Debugging** | Simple (linear execution log) | Complex (interleaved executor logs) |
| **Max parallelism** | 1 (serial, just faster) | 2-3 executors |

## Detailed Pros & Cons

### Option B: Batch Execution

**Pros:**
1. **Massive latency win for deterministic sequences.** A 5-step form fill goes from ~4s (5 LLM roundtrips × 800ms) to ~250ms (5 tool calls × 50ms). That's a **16x speedup** for the batch.
2. **Zero architectural risk.** No new concurrency primitives, no DOM locking, no context forking. The loop just runs tools in sequence — it already does this.
3. **Cheaper.** Eliminates LLM calls entirely for batched steps. Each batch saves $0.001-0.005 in API costs.
4. **Trivial to implement.** One new tool definition, one intercept block in loop.ts (similar pattern to `escalate` and `update_plan`). No new files.
5. **Composable with BRAINS→HANDS.** Smart model batches during orientation, fast model can also batch later. No special coordination needed.
6. **Predictable behavior.** Serial execution means no race conditions, no element conflicts, no interleaved logs.
7. **Bail-out gives enough agency.** The executor can stop on any error, element not found, or unexpected result. This covers the common failure modes.

**Cons:**
1. **No true parallelism.** Still serial — just eliminates LLM overhead between steps. Wall time is still sum(tool_times).
2. **Requires accurate element IDs upfront.** The smart model must know ALL element IDs before emitting the batch. If the page is dynamic, IDs may be wrong by step 3.
3. **LLM may emit bad batches.** Wrong tool order, wrong IDs, missing steps. The bail-out mechanism catches errors but wastes the already-executed steps.
4. **Limited to deterministic sequences.** Can't batch "search for X, then click the first result" — the result depends on what the search returns.
5. **Batch granularity is coarse.** If step 3 of 10 fails, steps 1-2 are wasted context (their results are added but the batch didn't complete its goal).

### Option C: Concurrent Executors

**Pros:**
1. **True parallelism.** Multiple sub-goals progress simultaneously. A task with 3 independent sections runs in 1/3 the time.
2. **Full HANDS agency.** Each executor is a real agent — it can read the page, adapt to errors, try alternatives. Not limited to pre-planned tool sequences.
3. **Handles dynamic content.** Executors can reason about what they see and adjust. No need to predict element IDs upfront.
4. **Scales to complex tasks.** Multi-section forms, data extraction across multiple areas, parallel verification checks.
5. **Natural fit for the BRAINS/HANDS metaphor.** One brain, many hands — each hand has full dexterity.

**Cons:**
1. **DOM conflict risk is real.** Two executors clicking in the same area, or one executor's action causing a re-render that invalidates another's elements. Element locking helps but doesn't solve layout shifts.
2. **3-4x implementation effort.** Two new files, new concurrency primitives (DomLock, Semaphore), context forking, result merging. More surface area for bugs.
3. **Higher token cost.** Each executor runs its own LLM loop. 3 executors × 2 turns = 6 LLM calls instead of 1 batch call. At current rates, roughly 3-6x more expensive per dispatched step.
4. **Rate limit pressure.** 2-3 concurrent LLM calls hit provider burst limits faster. More failovers, more latency variance. The Cerebras 3000 TPS advantage is diluted when 2 requests compete.
5. **Debugging nightmare.** Interleaved executor logs from 3 parallel agents touching the same page. Reproducing issues requires replaying the exact interleaving.
6. **Diminishing returns for most tasks.** In practice, most web tasks have 1-2 truly independent sub-goals, not 5. The parallelism window is narrow.
7. **Snapshot coherence.** Executors share an initial snapshot but the DOM changes under them. No way to refresh without pausing all executors (defeats the purpose).
8. **Executor coordination overhead.** The orchestrator must wait for all executors, merge results, handle partial failures. This adds complexity to every dispatched step.

## Quantitative Analysis

### Scenario: 5-field login form (email, password, remember me, submit)

| Metric | Current | B: Batch | C: Concurrent (2 executors) |
|--------|---------|----------|---------------------------|
| LLM calls | 5 | 1 (batch) + 1 (verify) = 2 | 2 executors × 2 turns = 4 |
| Tool calls | 5 | 5 | 5 (same work, split across executors) |
| Wall time (LLM) | 4000ms | 800ms | 1600ms (2 turns, parallelized) |
| Wall time (tools) | 250ms | 250ms | 150ms (parallel tools) |
| Total wall time | ~4250ms | ~1050ms | ~1750ms |
| Token cost | 5x base | 2x base | 4x base |

**B wins for form fills** — fewer LLM calls, lower cost, faster.

### Scenario: Extract 3 data points from different page sections

| Metric | Current | B: Batch | C: Concurrent (3 executors) |
|--------|---------|----------|---------------------------|
| LLM calls | 3 | 1 + 1 = 2 | 3 executors × 1 turn = 3 |
| Wall time (LLM) | 2400ms | 800ms | 800ms (parallel) |
| Wall time (tools) | 150ms | 150ms | 50ms (parallel) |
| Total wall time | ~2550ms | ~950ms | ~850ms |
| Token cost | 3x base | 2x base | 3x base |

**C slightly faster, B slightly cheaper.** Close call.

### Scenario: Complex multi-section form (shipping + billing + payment, 15 fields total)

| Metric | Current | B: Batch | C: Concurrent (3 executors) |
|--------|---------|----------|---------------------------|
| LLM calls | 15 | 1 + 1 = 2 | 3 × 3 = 9 |
| Wall time (LLM) | 12000ms | 800ms | 2400ms (3 turns, parallelized) |
| Wall time (tools) | 750ms | 750ms | 250ms (parallel) |
| Total wall time | ~12750ms | ~1550ms | ~2650ms |
| Token cost | 15x base | 2x base | 9x base |

**B dominates** — 8x faster than current, 5x cheaper than C, and 1.7x faster than C.

## Decision Matrix

| Factor | Weight | B Score (1-5) | C Score (1-5) |
|--------|--------|---------------|---------------|
| **Latency reduction** | 25% | 5 (eliminates LLM roundtrips) | 4 (parallel but more LLM calls) |
| **Implementation cost** | 20% | 5 (1 session, no new files) | 2 (3-4 sessions, 2 new files) |
| **Risk** | 20% | 5 (no concurrency, no DOM conflicts) | 2 (DOM races, rate limits, debugging) |
| **HANDS agency** | 15% | 3 (bail-out only during batch) | 5 (full independent reasoning) |
| **Token cost** | 10% | 5 (fewer LLM calls) | 2 (more LLM calls) |
| **Scalability** | 10% | 3 (serial, one task at a time) | 4 (true parallelism) |
| **Weighted total** | 100% | **4.50** | **2.95** |

## Recommendation: Start with B, Layer C Later

**Implement Option B first.** It captures 80% of the performance win with 20% of the effort and risk.

**Reasoning:**
1. The biggest latency bottleneck is LLM roundtrips between deterministic tool sequences. B eliminates this entirely.
2. Most web tasks (forms, clicks, navigation) are inherently serial on a single DOM. True parallelism helps in fewer cases than expected.
3. B requires zero new concurrency primitives. The existing loop already handles tool execution serially — batch is just "more of the same without asking the LLM each time."
4. B composes cleanly with BRAINS→HANDS. The smart model batches, the fast model executes batches or individual tools — no special coordination.
5. Token cost matters for a free/low-cost extension. B is the cheapest option.

**When to add C:** After B is proven, IF profiling shows that specific task categories (multi-section forms, parallel data extraction) would significantly benefit from true parallelism. C can be layered on top of B — the `dispatch` tool can internally use `batch_execute` for each executor's sub-goal.

**Hybrid future:**
```
BRAINS: dispatch([
  { sub_goal: "shipping", script: batch_execute([type, type, type]) },
  { sub_goal: "payment",  script: batch_execute([type, type, type]) },
])
→ Two executors run in parallel
→ Each executor runs a batch (zero LLM calls)
→ Best of both worlds
```

This hybrid combines B's zero-LLM-call efficiency with C's parallelism, but it's unnecessary until B proves insufficient.
