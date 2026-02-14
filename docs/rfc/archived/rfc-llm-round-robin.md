# RFC: LLM Provider Round-Robin with Failover (Groq → Cerebras → OpenRouter)

**RFC Number**: 20  
**Author**: OpenSidebar Team  
**Status**: SUPERSEDED — Archived 2026-02-14. This RFC proposed round-robin load balancing. The actual implementation uses priority-based failover (Cerebras→Groq→OpenRouter) with 60s cooldowns, not round-robin. See `ProviderPool` in `llm/client.ts`, commit `06579d3`.
**Date**: 2026-02-13

## Summary

This RFC proposes adding a round-robin load balancer across three LLM providers (Groq, Cerebras, OpenRouter) with automatic failover. The goal is to eliminate rate limiting (HTTP 429) errors that cause agent instability and reasoning failures.

## Problem Statement

### Context

OpenSidebar uses a dual-model architecture for the agent loop:

| Model Role | Model                 | Provider   | Use Case                                    |
| ---------- | --------------------- | ---------- | ------------------------------------------- |
| Fast       | `openai/gpt-oss-120b` | Groq       | Standard agent operations (cheaper, faster) |
| Smart      | `minimax/m2.5`        | OpenRouter | Escalation, complex reasoning               |

The "fast" model runs through Groq due to competitive pricing and speed. However, Groq has strict rate limits (250K TPM) that are quickly exhausted during extended agent sessions.

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
    "error": "LLM API Error (429): Rate limit reached for model `openai/gpt-oss-120b`...",
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
    "toolCalls": [
      "navigate({\"url\":\"https://serene-frangipane-7fd25b.netlify.app/step1?version=2\"})"
    ]
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
  "data": { "error": "LLM API Error (429): Rate limit reached..." }
}
```

### Root Cause

1. **Rate limiting caused request instability** - After hitting 429 errors, the LLM enters an unstable state
2. **Reasoning failure** - The model made a nonsensical decision to navigate backwards
3. **Single provider** - No fallback mechanism when Groq fails

### Impact

- Challenge progress was lost (step 8 → step 1)
- User frustration watching the agent reset
- Poor reliability due to single point of failure

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LLMClient (Round-Robin + Failover)               │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Provider Pool (in priority order)                 │  │
│  │                                                               │  │
│  │   ┌─────────┐   ┌──────────┐   ┌─────────────┐             │  │
│  │   │  Groq   │ → │ Cerebras │ → │ OpenRouter  │             │  │
│  │   │ (fast)  │   │ (backup) │   │  (premium)  │             │  │
│  │   └─────────┘   └──────────┘   └─────────────┘             │  │
│  │                                                               │  │
│  │   Round-robin: Request 1→Groq, 2→Cerebras, 3→OpenRouter    │  │
│  │   Failover: If one fails → try next in chain                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Cool-Off Period (3 minutes)                      │  │
│  │   • Failed provider marked as "cooling off"                  │  │
│  │   • After 3 mins, provider retried                          │  │
│  │   • If succeeds → rejoins pool                              │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Provider Comparison

| Provider   | Strengths                        | Weaknesses         |
| ---------- | -------------------------------- | ------------------ |
| Groq       | Cheapest, fast (TPM: 250K)       | Low rate limits    |
| Cerebras   | Fastest (3000 TPS!), good limits | Newer, less proven |
| OpenRouter | Most reliable, best rate limits  | Most expensive     |

**Same model on all providers**: `openai/gpt-oss-120b` is available on all three providers.

---

## Implementation Details

### 1. Provider Configuration

#### New Provider Factory Functions (`src/background/llm/client.ts`)

```typescript
// Existing
export function groqProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey,
    headers: {
      "Content-Type": "application/json",
    },
    providerId: "groq",
  };
}

// NEW: Cerebras provider
export function cerebrasProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: "https://api.cerebras.ai/v1",
    apiKey,
    headers: {
      "Content-Type": "application/json",
    },
    providerId: "cerebras",
  };
}

// Existing
export function openRouterProvider(apiKey: string): ProviderConfig {
  return {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.ai",
      "X-Title": "OpenSidebar",
    },
    providerId: "openrouter",
  };
}
```

### 2. Provider State Management

```typescript
interface ProviderState {
  config: ProviderConfig;
  enabled: boolean;
  coolOffUntil?: number;
  consecutiveFailures: number;
}

class LLMClient {
  private providers: ProviderState[] = [];
  private currentIndex: number = 0;
  private readonly COOL_OFF_DURATION_MS = 3 * 60 * 1000;
  private currentProviderId: string | null = null;
}
```

### 3. Round-Robin Provider Selection

```typescript
private getNextProvider(): ProviderConfig | null {
  const available = this.providers.filter(p =>
    p.enabled && (!p.coolOffUntil || Date.now() >= p.coolOffUntil)
  );

  if (available.length === 0) {
    const sorted = [...this.providers].sort(
      (a, b) => (a.coolOffUntil ?? 0) - (b.coolOffUntil ?? 0)
    );
    return sorted[0].config;
  }

  const provider = available[this.currentIndex % available.length];
  this.currentIndex++;

  this.currentProviderId = provider.config.providerId;
  return provider.config;
}
```

### 4. Failover Logic

```typescript
private async fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
  signal?: AbortSignal,
): Promise<Response> {
  const RETRYABLE = new Set([429, 502, 503, 504]);
  const triedProviders = new Set<string>();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const provider = this.getNextProvider();
    if (!provider) throw new Error("No providers available");

    triedProviders.add(provider.providerId);

    try {
      const response = await fetch(provider.baseUrl, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${provider.apiKey}`,
          ...provider.headers,
        },
        signal,
      });

      if (response.ok || !RETRYABLE.has(response.status)) {
        this.recordProviderSuccess(provider.providerId);
        return response;
      }

      const body = await response.text();
      this.recordProviderFailure(provider.providerId, response.status === 429);

    } catch (e: any) {
      if (e.name === "AbortError") throw e;
      this.recordProviderFailure(provider.providerId, false);
    }
  }

  throw new Error(`All providers failed: ${[...triedProviders].join(", ")}`);
}
```

### 5. Cool-Off Period Management

```typescript
private recordProviderFailure(providerId: string, isRateLimit: boolean): void {
  const provider = this.providers.find(p => p.config.providerId === providerId);
  if (!provider) return;

  provider.consecutiveFailures++;

  if (isRateLimit || provider.consecutiveFailures >= 2) {
    provider.coolOffUntil = Date.now() + this.COOL_OFF_DURATION_MS;
    logger.warn("agent", "Provider cooling off", {
      provider: providerId,
      coolOffSeconds: this.COOL_OFF_DURATION_MS / 1000,
    });
  }
}

private recordProviderSuccess(providerId: string): void {
  const provider = this.providers.find(p => p.config.providerId === providerId);
  if (!provider) return;

  provider.consecutiveFailures = 0;

  if (provider.coolOffUntil) {
    provider.coolOffUntil = undefined;
    logger.info("agent", "Provider recovered", { provider: providerId });
  }
}
```

---

## User Settings UI

### Settings Schema

```typescript
interface ProviderSettings {
  providers: {
    groq: { enabled: boolean; apiKey: string };
    cerebras: { enabled: boolean; apiKey: string };
    openrouter: { enabled: boolean };
  };
  coolOffDuration: number;
}
```

### Settings UI Components

Each provider gets a toggle card in Settings:

```
┌────────────────────────────────────────┐
│  ☁️ Groq                    [Toggle]  │
│  Fast, cheap                          │
│  API Key: ●●●●●●●● [Update]          │
│  Status: ● Active                     │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│  🧠 Cerebras               [Toggle]   │
│  Ultra-fast (3000 TPS)                 │
│  API Key: ●●●●●●●● [Update]           │
│  Status: ● Active                     │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│  🔗 OpenRouter             [Toggle]    │
│  Premium fallback                       │
│  Status: ● Active                     │
└────────────────────────────────────────┘
```

---

## Provider Indicator UI

### Side Panel Changes

#### Provider State Store

```typescript
interface SidePanelState {
  providerState: {
    currentProvider: "groq" | "cerebras" | "openrouter";
    availableProviders: string[];
    coolingOffProviders: string[];
    lastSwitch: number;
  };
}
```

#### Provider Indicator Component

```tsx
// src/sidepanel/components/ProviderIndicator.tsx
import { Brain, Cloud, Link2, Clock } from "lucide-react";

const PROVIDER_ICONS = {
  groq: Cloud,
  cerebras: Brain,
  openrouter: Link2,
};

const PROVIDER_COLORS = {
  groq: "text-orange-400",
  cerebras: "text-blue-400",
  openrouter: "text-purple-400",
};

export function ProviderIndicator() {
  const Icon = PROVIDER_ICONS[providerState.currentProvider] || Cloud;
  const colorClass = PROVIDER_COLORS[providerState.currentProvider] || "";

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400 px-3 py-1">
      <Icon className={`w-3 h-3 ${isAnimating ? "animate-spin" : ""}`} />
      <span>{providerState.currentProvider}</span>

      {providerState.coolingOffProviders.length > 0 && (
        <span className="flex items-center gap-1 text-yellow-400">
          <Clock className="w-3 h-3" />
        </span>
      )}
    </div>
  );
}
```

### Visual Design

```
┌─────────────────────────────────────────────────────────────┐
│  Thinking... [🧠 Cerebras ↻]                              │
│                                                             │
│  [Input field...]                              [Send]       │
└─────────────────────────────────────────────────────────────┘
```

**Animation**: Provider icon with rotating arrow (↻) indicating round-robin activity

---

## Logging & Metrics

### Log Events

```typescript
// Round-robin switch
logger.info("agent", "Using provider", {
  provider: "cerebras",
  requestNumber: 42,
});

// Provider failed
logger.warn("agent", "Provider failed, trying next", {
  provider: "groq",
  status: 429,
  nextProvider: "cerebras",
});

// Provider cooling off
logger.warn("agent", "Provider cooling off", {
  provider: "groq",
  coolOffMs: 180000,
});

// Provider recovered
logger.info("agent", "Provider recovered", {
  provider: "groq",
});
```

---

## Configuration

### Environment Variables

```bash
# Already existing
OPENROUTER_API_KEY=sk-or-v1-...
GROQ_API_KEY=gsk_...

# NEW
CEREBRAS_API_KEY=cks-...
```

---

## Implementation Checklist

### Phase 1: Core (LLM Client)

- [ ] Add Cerebras provider config
- [ ] Implement provider pool with state
- [ ] Implement round-robin selection
- [ ] Implement failover logic
- [ ] Implement cool-off period (3 min)
- [ ] Add logging for all provider events

### Phase 2: Settings UI

- [ ] Add provider toggle cards to Settings
- [ ] Add cerebras API key field
- [ ] Add cool-off duration setting
- [ ] Persist settings to storage

### Phase 3: Sidepanel UI

- [ ] Add providerState to store
- [ ] Create ProviderIndicator component
- [ ] Add to InputArea
- [ ] Handle PROVIDER_STATE messages from background
- [ ] Add animations

### Phase 4: Testing

- [ ] Unit tests for round-robin
- [ ] Unit tests for failover
- [ ] Unit tests for cool-off
- [ ] Manual testing with rate limits
- [ ] Test UI toggles

---

## Cost Analysis

| Provider   | Cost (approx) | Rate Limit |
| ---------- | ------------- | ---------- |
| Groq       | ~$0.20/M tok  | 250K TPM   |
| Cerebras   | ~$0.40/M tok  | Higher     |
| OpenRouter | ~$0.60/M tok  | Highest    |

**With round-robin**: Most requests hit Groq (cheapest), only fallback to expensive providers when needed.

---

## References

- [Groq Documentation](https://console.groq.com/docs)
- [Cerebras API](https://docs.cerebras.ai)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [LLMClient Source](./src/background/llm/client.ts)
