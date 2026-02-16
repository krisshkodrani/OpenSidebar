# Batch Execution × Multi-Provider Analysis

## Current Flow: BRAINS→HANDS with Provider Pool

```
Turn 1-2 (BRAINS):  MODEL_SMART on OpenRouter (always, no pool)
Turn 3+  (HANDS):   MODEL_FAST via pool: Cerebras → Groq → OpenRouter
                     ↳ 429 → cooldown(60s) → immediate failover to next
```

The smart model (BRAINS) always routes through OpenRouter — it's the only provider that serves `x-ai/grok-4.1-fast:nitro`. The fast model (HANDS) goes through the `ProviderPool` which tries Cerebras first (3000 TPS), falls back to Groq, then OpenRouter.

## How Batch Execution Changes the Provider Picture

### Without batch (current)

```
BRAINS: 1 LLM call (OpenRouter)  → emits plan
HANDS:  5 LLM calls (pool)       → click, type, type, type, click
                                     ↳ 5 opportunities for 429
                                     ↳ 5× pool.getActive() lookups
Total: 6 LLM calls
```

### With batch

```
BRAINS: 1 LLM call (OpenRouter)  → emits batch_execute([5 steps])
LOOP:   0 LLM calls              → executes 5 tools directly
HANDS:  1 LLM call (pool)        → sees results, continues
Total: 2 LLM calls
```

**4 fewer pool lookups, 4 fewer potential 429s, 4 fewer failover events.**

## Provider-Specific Implications

### Cerebras (highest priority, 3000 TPS)

- **Free tier has token/request limits.** Every LLM call saved by batching extends the free-tier budget.
- **Cerebras is the fastest provider (~3000 TPS).** When it IS available, the single post-batch call returns in ~100-200ms. Batch execution means we only burn this fast provider slot once instead of N times.
- **If Cerebras is on cooldown during a batch, it doesn't matter** — no LLM calls happen. By the time the batch finishes (~250ms for 5 tools), Cerebras may still be on cooldown, but we only need ONE call instead of five. One call through Groq is better than five through Groq.

### Groq (secondary, 250K TPM)

- **Token-per-minute limits.** Each batch of 5 saves ~4 × ~1500 tokens = ~6000 tokens of TPM budget. That's meaningful when Groq's TPM window is shared across the entire extension.
- **Same as Cerebras:** fewer calls = less chance of hitting the limit and triggering failover.

### OpenRouter (always-available fallback)

- **Cost matters here** — OpenRouter charges per token. Batch execution saves 4 LLM calls × ~1500 tokens = ~6000 tokens per batch. At typical rates (~$0.0005/1K tokens for gpt-oss-120b), that's ~$0.003 saved per batch.
- **OpenRouter also has burst rate limits** (though higher). During complex multi-batch tasks, the savings compound.
- **Smart model calls are unaffected** — BRAINS always goes through OpenRouter regardless.

## Key Insight: Batch + Pool = Fewer Failovers

The biggest win is that **batch execution reduces the number of times the pool is queried**, which means:

1. **Fewer cooldown triggers.** A 5-step form fill that would have made 5 fast-model calls now makes 1. The probability of hitting a 429 drops from `1-(1-p)^5` to just `p`.

2. **Failover latency avoided.** Each provider failover adds ~200-500ms (cooldown, rebuild request, retry). Avoiding 4 potential failovers saves 0-2s of latency variance.

3. **Provider cooldowns heal during batches.** A batch of 5 tools takes ~250ms. If Cerebras hit a 429 right before the batch, it won't heal (60s cooldown). But if it hit a 429 several batches ago, the batch-reduced cadence means more time passes between pool queries, giving cooldowns more time to expire.

## Batch Bail-Out and Provider Recovery

When a batch bails (element not found, error, navigation), the HANDS model needs to make an LLM call to decide what to do next. This call goes through the normal pool:

```
BRAINS: batch_execute([click 5, type 8, type 12, click 15])
LOOP:   step 1 OK → step 2 OK → step 3 FAIL (element 12 not found)
        → bail, attach results + error + fresh snapshot
HANDS:  1 LLM call (pool) → reads error, adapts
```

The bail-out recovery call uses whatever provider the pool returns. Because the batch saved 2 LLM calls before the failure, there's MORE rate-limit headroom available for the recovery call. **Batching makes recovery more reliable** because it preserves provider budget.

## Provider Selection for BRAINS' Batch Planning

The BRAINS model (smart, OpenRouter) emits the `batch_execute` tool call. This is a single LLM call that produces the entire script. The quality of the batch depends on the model's ability to:

1. **Correctly identify all element IDs** from the snapshot
2. **Order steps correctly** (e.g., click focus first, then type)
3. **Know when NOT to batch** (dynamic content, search results)

The smart model is better suited for this than the fast model because:
- Higher reasoning capability → more accurate element targeting
- Longer context handling → can process full page snapshots
- Better instruction following → respects batch constraints

The fast model CAN also emit `batch_execute` (post-handoff), but its batches should be shorter (2-3 steps) since it has weaker reasoning. The RFC doesn't need to restrict this — the fast model will naturally batch less ambitiously.

## Provider Interaction Summary

| Phase | Provider | LLM Calls | Rate Limit Risk |
|-------|----------|-----------|-----------------|
| BRAINS orientation (turns 1-2) | OpenRouter (MODEL_SMART) | 1-2 | Low (smart is low-frequency) |
| BRAINS emits batch | OpenRouter (MODEL_SMART) | 0 (part of above) | None |
| Batch execution | **None** (zero LLM calls) | 0 | **None** |
| HANDS post-batch | Pool (Cerebras→Groq→OR) | 1 | Low (single call) |
| Bail-out recovery | Pool (Cerebras→Groq→OR) | 1 | Low (budget preserved) |
| HANDS continues | Pool (Cerebras→Groq→OR) | 1-N | Normal |

## Design Recommendation for RFC-B

No changes needed to the provider architecture. Batch execution is **provider-transparent**:

1. **`batch_execute` is a tool, not an LLM call.** The loop intercepts it and runs tools directly. No provider interaction during execution.
2. **The pool works as-is** for the post-batch call. `getActive()` returns the best available provider.
3. **`fetchWithRetry` handles recovery** if the post-batch call hits a 429.
4. **No new provider configuration needed.** The batch size (max 10 steps) is independent of provider.

The only consideration: if the BRAINS model emits a `batch_execute` during its orientation turns, the batch runs under `MODEL_SMART` (OpenRouter). After the handoff, HANDS continues with the pool. This is fine — the batch itself makes zero LLM calls regardless of which model "owns" the turn.

## Quantitative Impact

### Scenario: 3 sequential tasks, each with a 5-step form fill

**Without batch (15 HANDS calls):**
- Cerebras: may hit rate limit after ~8 calls → failover to Groq
- Groq: may hit TPM limit after processing ~12K tokens → failover to OpenRouter
- OpenRouter: handles remaining ~3 calls at ~$0.0015

**With batch (3 HANDS calls):**
- Cerebras: 3 calls, well within limits → no failover needed
- Groq: never touched
- OpenRouter: only used for BRAINS (2 smart model calls)
- **5x fewer pool queries, zero failovers, ~$0.009 saved**

### Scenario: Provider budget over a 10-minute session (50 turns)

| Metric | Without Batch | With Batch (avg 4 steps/batch) |
|--------|--------------|-------------------------------|
| Fast model LLM calls | ~45 | ~15 |
| Pool queries | ~45 | ~15 |
| Expected 429 events (p=0.05/call) | ~2.3 | ~0.75 |
| Failover latency overhead | ~700ms avg | ~225ms avg |
| Cerebras token budget consumed | ~67,500 | ~22,500 |
| Groq TPM consumed | ~67,500 | ~22,500 |

**Batch execution makes the tri-provider failover system significantly more efficient by reducing the number of times it needs to activate at all.**
