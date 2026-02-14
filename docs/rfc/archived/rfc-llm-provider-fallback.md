# RFC: LLM Provider Automatic Fallback (Groq → OpenRouter)

**RFC Number**: 19  
**Author**: OpenSidebar Team  
**Status**: SUPERSEDED — Archived 2026-02-14. This RFC proposed Groq→OpenRouter fallback. Superseded by the priority-based failover implementation (Cerebras→Groq→OpenRouter) via `ProviderPool` in `llm/client.ts`. See commit `06579d3`.
**Date**: 2026-02-13

## Summary

This RFC proposes adding automatic fallback from Groq to OpenRouter when Groq experiences rate limiting (HTTP 429 errors). The fallback should use the same model (`openai/gpt-oss-120b`) on OpenRouter's infrastructure to maintain consistency while providing higher rate limits.

## Problem Statement

### Context

OpenSidebar uses a dual-model architecture for the agent loop:

| Model Role | Model                 | Provider   | Use Case                                    |
| ---------- | --------------------- | ---------- | ------------------------------------------- |
| Fast       | `openai/gpt-oss-120b` | Groq       | Standard agent operations (cheaper, faster) |
| Smart      | `minimax/m2.5`        | OpenRouter | Escalation, complex reasoning               |

The "fast" model runs through Groq due to its competitive pricing and speed. However, Groq has strict rate limits that can be quickly exhausted during extended agent sessions.

### Incident Analysis (2026-02-13)

The following log entries document the failure that prompted this RFC:

#### Timeline

1. **Turn 235** - Rate limit hit:

```json
{
  "ts": "2026-02-13T17:17:41.386Z",
  "lvl": "WARN",
  "src": "background",
  "cat": "agent",
  "msg": "LLM request failed (groq), retrying 1/3",
  "data": {
    "delay": 1035,
    "error": "LLM API Error (429): {\"error\":{\"message\":\"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01hrvcwxesfz08gyjc9dgpyrrz` service tier `on_demand` on tokens per minute (TPM): Limit 250000, Used 244875, Requested 5287. Please try again in 38.88ms. Need more tokens? Visit https://groq.com/self-serve-support/ to request higher limits.\",\"type\":\"tokens\",\"code\":\"rate_limit_exceeded\"}}\n",
    "model": "openai/gpt-oss-120b"
  }
}
```

2. **Turn 237** - Agent made a critical error after recovering from rate limit:

```json
{
  "ts": "2026-02-13T17:17:43.296Z",
  "lvl": "INFO",
  "src": "background",
  "cat": "agent",
  "msg": "LLM response",
  "data": {
    "turn": 237,
    "llmMs": 1983,
    "url": "https://serene-frangipane-7fd25b.netlify.app/step8?version=2",
    "text": null,
    "toolCalls": [
      "navigate({\"url\":\"https://serene-frangipane-7fd25b.netlify.app/step1?version=2\"})"
    ],
    "toolCount": 1
  }
}
```

3. **Consequence** - Agent navigated **backwards** from step 8 to step 1, completely resetting progress.

4. **Later rate limits** (turns 243, 244):

```json
{
  "ts": "2026-02-13T17:17:47.971Z",
  "lvl": "WARN",
  "src": "background",
  "cat": "agent",
  "msg": "LLM request failed (groq), retrying 1/3",
  "data": {
    "delay": 1269,
    "error": "LLM API Error (429): {\"error\":{\"message\":\"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01hrvcwxesfz08gyjc9dgpyrrz` service tier `on_demand` on tokens per minute (TPM): Limit 250000, Used 240889, Requested 10012. Please try again in 216.24ms. Need more tokens? Visit https://groq.com/self-serve-support/ to request higher limits.\",\"type\":\"tokens\",\"code\":\"rate_limit_exceeded\"}}\n",
    "model": "openai/gpt-oss-120b"
  }
}
```

### Root Cause

1. **Rate limiting caused request instability** - After hitting 429 errors and retrying, the LLM enters an unstable state
2. **Reasoning failure** - The model made a nonsensical decision to navigate backwards (from step 8 to step 1) instead of continuing forward
3. **No fallback mechanism** - There's no automatic failover to OpenRouter when Groq fails

### Impact

- **Agent performance**: Challenge progress was lost (step 8 → step 1)
- **User experience**: Frustrating to watch the agent reset progress
- **Reliability**: Single point of failure (Groq) impacts overall system reliability

## Proposed Solution

### Architecture

Add automatic fallback from Groq to OpenRouter in the `LLMClient` class:

```
┌─────────────────────────────────────────────────────────────┐
│                      LLMClient                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Primary: Groq (fast model)               │  │
│  │  - Model: openai/gpt-oss-120b                        │  │
│  │  - Lower latency, competitive pricing                │  │
│  │  - Rate limit: 250K TPM                              │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│                    429 Rate Limit                            │
│                          ↓                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Fallback: OpenRouter (same model)           │  │
│  │  - Model: openai/gpt-oss-120b (if available)         │  │
│  │  - Higher rate limits                                │  │
│  │  - Same model = no context loss                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Details

#### 1. Modified Constructor (`src/background/llm/client.ts`)

```typescript
constructor(
  openRouterApiKey: string,
  groqApiKey?: string,
  useGroq: boolean = false,
  model?: string,
) {
  this.openRouterApiKey = openRouterApiKey;
  this.groqApiKey = groqApiKey;  // NEW: Always store for fallback

  // Primary: Groq (if enabled)
  if (useGroq && groqApiKey) {
    this.model = model ?? MODEL_FAST_GROQ;
    this.provider = groqProvider(groqApiKey);
  } else {
    this.model = model ?? MODEL_FAST;
    this.provider = openRouterProvider(openRouterApiKey);
  }

  // NEW: Always configure fallback provider
  this.fallbackProvider = openRouterProvider(openRouterApiKey);

  this.fastModel = this.model;
  this.fastProvider = { ...this.provider };
}
```

#### 2. Enhanced `fetchWithRetry` Method

The core logic change in `fetchWithRetry`:

```typescript
private async fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
  signal?: AbortSignal,
): Promise<Response> {
  const RETRYABLE = new Set([429, 502, 503, 504]);
  let lastError: Error | null = null;
  let usedFallback = false;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    try {
      // Try primary (Groq) first
      const response = await fetch(url, { ...init, signal });

      // Success - check if we used fallback
      if (response.ok || !RETRYABLE.has(response.status)) {
        if (usedFallback) {
          logger.info("agent", "Provider fallback successful", {
            from: "groq",
            to: "openrouter",
            model: this.model,
          });
        }
        return response;
      }

      // Handle rate limiting - trigger fallback
      if (response.status === 429 && this.shouldFallback() && !usedFallback) {
        logger.warn("agent", "Rate limited on primary, falling back to OpenRouter", {
          model: this.model,
          provider: this.provider.providerId,
        });

        // Switch to fallback provider
        const fallbackInit = this.buildFallbackRequest(init);
        const fallbackResponse = await fetch(
          this.fallbackProvider.baseUrl,
          { ...fallbackInit, signal }
        );

        if (fallbackResponse.ok) {
          usedFallback = true;
          logger.info("agent", "Fallback to OpenRouter successful", {
            model: this.model,
          });
          return fallbackResponse;
        }
        // Fallback also failed - continue with retry logic
      }

      // Retryable error on current provider
      const body = await response.text();
      lastError = new Error(`LLM API Error (${response.status}): ${body}`);

    } catch (e: any) {
      // Network error - try fallback if we haven't
      if (!usedFallback && this.shouldFallback()) {
        logger.warn("agent", "Network error on primary, trying fallback", {
          error: e.message,
        });
        usedFallback = true;
        continue; // Retry with fallback
      }
      lastError = e;
    }

    // Retry logic continues...
  }
  throw lastError!;
}
```

#### 3. New Helper Methods

```typescript
private shouldFallback(): boolean {
  // Only fallback if:
  // 1. Currently using Groq as primary
  // 2. Have a fallback provider configured
  // 3. Not already on fallback
  return (
    this.provider.providerId === "groq" &&
    !!this.fallbackProvider &&
    this.fallbackProvider.apiKey !== this.provider.apiKey
  );
}

private buildFallbackRequest(init: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${this.fallbackProvider.apiKey}`,
      ...this.fallbackProvider.headers,
    },
  };
}
```

### Provider Availability

The `openai/gpt-oss-120b` model is available on OpenRouter:

| Provider   | Model               | Rate Limit (approx) |
| ---------- | ------------------- | ------------------- |
| Groq       | openai/gpt-oss-120b | 250K TPM            |
| OpenRouter | openai/gpt-oss-120b | Higher (tier-based) |

This means the same model can be used on both providers, ensuring:

- **No context loss** - Model weights are identical
- **Seamless failover** - LLM state preserved
- **Consistent behavior** - Same outputs expected

## Alternative Approaches Considered

### 1. Manual Provider Switching

**Rejected** - Requires user intervention; too slow for agentic use.

### 2. Always Use OpenRouter

**Rejected** - Groq is significantly cheaper and faster. The fallback preserves these benefits for normal operation.

### 3. Escalate to Smart Model on Failure

**Partial implementation** - The agent already escalates to MiniMax on consecutive failures. However, this doesn't help with rate limits during the escalation process itself.

### 4. Exponential Backoff Only

**Rejected** - The retry logic already exists but doesn't solve the underlying rate limit issue. Users would wait longer.

## Testing Strategy

### Unit Tests

1. `client.test.ts` - Test fallback triggering on 429
2. `client.test.ts` - Test fallback does NOT trigger on non-retryable errors
3. `client.test.ts` - Test fallback uses correct headers and model

### Integration Tests

1. Simulate rate limit - Verify fallback succeeds
2. Simulate fallback failure - Verify error handling
3. End-to-end challenge - Verify agent survives rate limits

### Manual Testing

1. Exhaust Groq rate limit intentionally
2. Verify automatic fallback to OpenRouter
3. Verify challenge continues without reset

## Logging & Monitoring

### New Log Events

```typescript
// Fallback triggered
logger.warn("agent", "Rate limited on primary, falling back", {
  model: "openai/gpt-oss-120b",
  fromProvider: "groq",
  toProvider: "openrouter",
});

// Fallback successful
logger.info("agent", "Provider fallback successful", {
  model: "openai/gpt-oss-120b",
  fromProvider: "groq",
  toProvider: "openrouter",
});

// Fallback failed
logger.error("agent", "Provider fallback also failed", {
  model: "openai/gpt-oss-120b",
  error: error.message,
});
```

## Configuration Requirements

### User Settings (Existing)

No new settings required. The fallback uses existing:

- `openRouterApiKey` - Already required for smart model
- `groqApiKey` - Already optional for fast model
- `useGroqFast` - Already controls Groq usage

### Environment Variables

None required - uses existing API key storage.

## Security Considerations

1. **API Key Storage** - No changes; keys already stored securely
2. **Fallback Trust** - OpenRouter is trusted provider (same as primary)
3. **Cost Management** - Fallback may increase OpenRouter usage; users should monitor

## Backward Compatibility

- **Existing users without Groq**: No change (use OpenRouter directly)
- **Existing users with Groq**: Automatic benefit (fallback on rate limits)
- **Settings**: No changes required

## Future Improvements

### 1. Bidirectional Fallback

If OpenRouter fails (e.g., 429), fallback to Groq:

```typescript
if (this.provider.providerId === "openrouter" && this.groqApiKey) {
  // Fallback to Groq
}
```

### 2. Fallback Health Monitoring

Track fallback usage to alert users:

```typescript
metrics.increment("llm.fallback.groq_to_openrouter");
```

### 3. Model-Specific Fallback

Allow different fallback models:

```typescript
this.fallbackModel = this.model; // Same model by default
// Or: this.fallbackModel = MODEL_FAST; // GPT-4o-mini
```

## Implementation Checklist

- [ ] Modify `LLMClient` constructor to always store both API keys
- [ ] Add `fallbackProvider` field
- [ ] Add `shouldFallback()` method
- [ ] Add `buildFallbackRequest()` method
- [ ] Modify `fetchWithRetry()` to trigger fallback on 429
- [ ] Add logging for fallback events
- [ ] Add unit tests for fallback logic
- [ ] Test manually with rate limit simulation
- [ ] Update documentation

## References

- [Groq Rate Limits](https://console.groq.com/settings/billing)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [LLMClient Source Code](./src/background/llm/client.ts)
- [Log Analysis](./logs/opensidebar.jsonl)

## Appendix: Log Excerpts

### Full Rate Limit Sequence

```
17:17:41.386 - Rate limit hit (turn 237)
17:17:43.296 - Agent navigates backward (BAD DECISION)
17:17:43.977 - Page not found (404)
17:17:44.492 - Agent confused, reading wrong page
17:17:44.603 - Snapshot shows "Page not found"
17:17:47.971 - Another rate limit (turn 243)
17:17:50.260 - Agent emits text instead of tools (unstable)
17:17:50.262 - Nudge triggered (consecutiveNudges: 1)
17:17:52.383 - Agent emits text instead of tools again
17:17:52.384 - Escalating to smart model
17:18:05.382 - Stream aborted (Agent stopped by user)
```

### What Should Have Happened

```
17:17:41.386 - Rate limit hit → FALLBACK TO OPENROUTER
17:17:43.296 - (No bad navigation - same model, stable)
17:17:47.971 - Rate limit (already on OpenRouter - higher limit)
17:17:50.260 - Continue normally
```
