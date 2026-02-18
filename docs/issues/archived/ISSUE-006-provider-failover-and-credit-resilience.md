# ISSUE-006: Provider Failover/Credit Handling Can Collapse Run Stability

Severity: High (upgraded from Medium)
Status: Open
Date identified: 2026-02-17
Updated: 2026-02-17 (trace analysis — 21 rapid failures quantified)
Area: LLM client provider selection/failover and budget resilience

## Summary

Provider-side interruptions (aborted streams, insufficient credits) generate repeated request failures that degrade run continuity. The Cerebras credit exhaustion error is treated as a transient 429 with a 60-second cooldown, but credits don't replenish — so the provider keeps being retried every 60 seconds, failing 21 times in rapid succession.

## Evidence

- `logs/opensidebar.jsonl`:
  - **21 Cerebras credit exhaustion failures** in rapid succession across the session
  - Error: `Insufficient Cerebras credits. Add credits at cloud.cerebras.ai.`
  - Each failure triggers a 60s cooldown, then Cerebras is retried → fails again → cooldown → retry...
  - Multiple `LLM Stream Request Failed` (aborted stream cases)
  - 1 `Provider rate-limited, failing over`
- The 60s cooldown is designed for rate limits (429), which are transient. Credit exhaustion is **permanent** for the session but is handled identically.
- During these failure windows, the agent stalls or receives degraded responses from slower fallback providers.

## User-visible impact

- 21 wasted LLM requests that were guaranteed to fail.
- Each failure adds latency (network round-trip + 60s cooldown wait before next attempt).
- Run may stop or become erratic for reasons unrelated to browser state.
- Can amplify existing loop/stuck behavior.

## Root cause hypothesis

1. **Credit exhaustion is classified as transient.** The `ProviderPool` treats all non-200 responses the same way — cooldown and retry. It doesn't distinguish between "rate limited, try again in 60s" and "credits gone, stop trying."
2. **No permanent disable mechanism.** There's no way to mark a provider as "dead for this session" so it's never retried.
3. **Error message parsing is missing.** The error text `Insufficient Cerebras credits` is not pattern-matched to trigger permanent disable.

## Recommended fix direction

1. **Classify error types.** Parse error responses into: (a) transient rate limit → cooldown + retry, (b) permanent failure (credit exhaustion, auth invalid, account suspended) → disable for session, (c) server error → limited retry.
2. **Permanent disable for credit exhaustion.** On first `Insufficient credits` response, remove the provider from the pool for the remainder of the session. No cooldown, no retry.
3. **Notify UI.** Send a one-time `PROVIDER_DISABLED` message to the side panel so the user knows Cerebras is offline and can add credits if desired.
4. **Circuit breaker.** After 3 consecutive failures from any provider (regardless of error type), disable for the session.

## Acceptance criteria

1. Credit exhaustion triggers **single-shot permanent disable**, not 21 retried failures.
2. Stream aborts recover to stable provider within bounded retries.
3. User receives clear status notification when a provider is disabled.
4. Zero wasted LLM calls to permanently failed providers.
