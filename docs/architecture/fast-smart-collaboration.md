# Fast/Smart Model Collaboration

How two LLM tiers work together inside a single `AgentLoop` to solve browser automation tasks.

## The Two Tiers

| | Fast Model | Smart Model |
|---|---|---|
| **Models** | `gpt-oss-120b` (Cerebras/Groq/OpenRouter) | `glm-4.7` (Cerebras/OpenRouter) |
| **Provider Pool** | `ProviderPool` — Cerebras → Groq → OpenRouter | `ProviderPool` — Cerebras → OpenRouter |
| **Reasoning** | Standard completion | Native reasoning (enabled by default) |
| **Persona** | "sharp, resourceful web automation expert" | "seasoned systems thinker" |
| **Role** | Handles routine observe→act cycles quickly | Breaks through when the fast model gets stuck |

The fast model runs by default. It's cheap, fast (~3000 TPS on Cerebras), and handles the vast majority of turns — clicking, typing, navigating, reading pages. The smart model (GLM-4.7) has native reasoning enabled by default and is called in only when the fast model demonstrably can't make progress.

### Smart Pool Architecture

Both tiers use `ProviderPool` with a generic `PoolConfig` interface:

```typescript
interface PoolConfig {
  cerebrasModel?: string;
  groqModel?: string;      // Only used by fast tier
  openRouterModel: string;
}
```

The fast pool has 3 providers (Cerebras → Groq → OpenRouter). The smart pool has 2 providers (Cerebras → OpenRouter) — Groq does not serve GLM-4.7. Both pools share the same failover mechanics: 60s cooldown on 429, immediate fallback to next provider.

```
Fast Pool:   Cerebras (gpt-oss-120b)    → Groq (openai/gpt-oss-120b)    → OpenRouter (openai/gpt-oss-120b)
Smart Pool:  Cerebras (zai-glm-4.7)     → OpenRouter (z-ai/glm-4.7)
```

### Prefix Caching on Cerebras

Cerebras provides prefix caching with exact prefix match on Tools + System Prompt. Because the tool list is static (all 57 tools always present), and the system prompt only varies by model tier persona, the cache hit rate is high. This is critical for the smart model: ~5.5K tokens of tool definitions are cached on every call after the first.

**Important:** Dynamic tool pruning would break the cache for every new page type, destroying the speed advantage. Both tiers always send all 57 tools.

## Escalation Triggers

There are four paths from fast → smart. Each is a different signal that the fast model is stuck. The system is a flat two-tier model — there is only one escalation step (fast → smart), not a graduated series.

### 1. Voluntary Escalation (`escalate` tool)

The fast model can call the `escalate` tool when it recognizes a problem beyond its ability — riddles, puzzles, math, multi-step logic.

```
LLM output:  escalate({ reason: "This captcha requires spatial reasoning" })
```

**Behavior:**
- **Permanent** for the session — no automatic de-escalation
- Sets `voluntaryEscalation = true`
- Refreshes the DOM snapshot so the smart model sees current state
- Injects `ESCALATION_REFLECTION` to orient the smart model
- Runs context distillation (see below)

This is the cleanest path because the model self-identifies its limitation.

### 2. Stuck Detection (stale turns)

The `StagnationMonitor` fingerprints each turn's DOM snapshot (URL + element count + element signatures). If the fingerprint hasn't changed for consecutive turns, it fires signals:

```
Stagnant turns 1-5:   reflection ("try a different approach")
Stagnant turn 6:       escalate to smart model
```

**Behavior:**
- Takes a screenshot for visual context before escalating
- Performs a strategy pivot (clears the failing conversation tail)
- **Temporary** — will de-escalate when progress resumes

### 3. Text-Only Response Escalation (repeated non-tool output)

When the LLM responds with text but no tool calls, the loop treats it as a failure to act. Filler text (low-information narration like "I'll now click the button") is detected and fast-tracked — one filler response adds +2 to the counter.

```
1st text-only:   reflection ("you must call a tool")
2nd text-only:   escalate to smart model
3rd+ text-only (post-escalation):  give up (return IDLE to user)
```

**Behavior:**
- **Temporary** — subject to de-escalation
- Captures a screenshot before escalating

### 4. Step Watchdog (turns on same plan step)

When a multi-step plan is active, a watchdog tracks how long the agent spends on each subtask. If it exceeds the threshold without meaningful step progress, the watchdog force-escalates.

**Behavior:**
- **Temporary** — subject to de-escalation
- Performs a strategy pivot
- Injects a step-specific watchdog message + `ESCALATION_REFLECTION`

## What Happens at Escalation

Every escalation path does the same core steps:

```
1. context.summarizeTrajectory()  → compress history for smart model
2. llm.switchToSmart()             → swap to smart pool (Cerebras → OpenRouter)
3. context.setModelTier("smart")   → swap system prompt persona
4. Inject ESCALATION_REFLECTION         → orient the smart model
```

### Context Distillation

This is the key innovation replacing the old "expand to 64K context" approach. Instead of giving the smart model the full conversation history (which could be 40K+ tokens of noisy observe→act loops), `summarizeTrajectory()` compresses the entire history into a structured timeline:

```typescript
public summarizeTrajectory(originalQuery: string): void {
  const timeline = summarizeHistory(this.history);
  this.history = [];
  this.history.push({ role: "user", content: originalQuery });
  if (timeline.length > 0) {
    const report = `ATTEMPT LOG (${timeline.length} actions):\n${timeline.join("\n")}`;
    this.history.push({ role: "user", content: report });
  }
}
```

The `summarizeHistory()` utility walks the message history chronologically and extracts tool name + key args + outcome as compact entries:

```
T1: navigate url=https://example.com → Navigated to Example
T2: click_element id=5 → Clicked "Submit"
T3: type_text id=12 text="hello" → Typed into search field
T4: read_page → 15 elements, "Search Results"
```

This replaces 40K+ tokens of raw history with ~1K tokens of structured timeline, making 32K context sufficient for the smart model (no 64K expansion needed). The smart model gets the original query + a concise log of everything that was tried, which is all it needs to formulate a new strategy.

### ESCALATION_REFLECTION

The `ESCALATION_REFLECTION` is critical. It tells the smart model:

> You are now the upgraded model, brought in because the previous model got stuck.
> Review the conversation history and current page state. Then:
> 1. Identify what was attempted and why it failed.
> 2. Formulate a different strategy — do not repeat what already failed.
> 3. Call the appropriate tool to advance the task.
> If the page state is unclear, start with read_page.

### GLM-4.7 Native Reasoning

GLM-4.7 has reasoning enabled by default. Unlike some models that require a `reasoning: { effort }` parameter, GLM-4.7 thinks natively — no special API parameters needed. Sending reasoning parameters would cause API errors. This simplifies the escalation path: switching to the smart model is sufficient to get reasoning capabilities.

## De-escalation

Automatic escalations (triggers 2, 3, 4) are temporary. When the smart model makes progress (snapshot fingerprint changes, stale turns reset to 0), the loop evaluates whether to de-escalate:

```python
if on_smart_model
   and NOT voluntary_escalation      # voluntary stays permanent
   and escalation_cycles < 3         # max 3 round-trips
   and smart_tenure >= 3:            # ran for at least 3 turns
     → de-escalate to fast model
```

On de-escalation:

```
1. llm.switchToFast()          → swap back to fast pool (Cerebras → Groq → OpenRouter)
2. context.setModelTier("fast")  → swap persona back
3. Inject DEESCALATION_REFLECTION   → orient the fast model
4. cooldownRemaining = 3       → prevent immediate re-escalation
```

The `DEESCALATION_REFLECTION` tells the fast model:

> The smarter model made progress and you're back in control.
> Review the recent history to understand what was accomplished. Continue from where it left off.

### Cycle Limits

To prevent thrashing:

| Limit | Value | Purpose |
|---|---|---|
| `MAX_CYCLES` | 3 | Max escalation→de-escalation round-trips per session |
| `COOLDOWN_TURNS` | 3 | Turns after de-escalation before re-escalation is allowed |
| `MIN_SMART_TENURE` | 3 | Minimum turns the smart model must run before de-escalation |

After 3 cycles, the agent stays on whichever tier it's currently using.

## Lifecycle Example

A typical hard navigation task might play out like:

```
Turn  1 [fast/cerebras]   → navigate to login page           ✓
Turn  2 [fast/cerebras]   → type username                    ✓
Turn  3 [fast/cerebras]   → type password, click submit      ✓
Turn  4 [fast/cerebras]   → page has a CAPTCHA puzzle        ✗ stale
Turn  5 [fast/cerebras]   → tries clicking CAPTCHA           ✗ stale
Turn  6 [fast/cerebras]   → tries again                      ✗ stale
                            ↳ reflection injected
Turn  7 [fast/cerebras]   → still stuck                      ✗ stale
                            ↳ ESCALATE: distill + screenshot + reflection
                            ↳ History compressed: 7 turns → ~500 token timeline
Turn  8 [smart/cerebras]  → analyzes screenshot + timeline, reasons about puzzle
Turn  9 [smart/cerebras]  → solves CAPTCHA with execute_js   ✓ progress!
Turn 10 [smart/cerebras]  → verifies success                 ✓
                            ↳ DE-ESCALATE: progress resumed, tenure=3
Turn 11 [fast/cerebras]   → continues with post-login flow   ✓
Turn 12 [fast/cerebras]   → fills out form                   ✓
Turn 13 [fast/cerebras]   → done()
```

The fast model handled 10 of 13 turns. The smart model was only used for the 3 turns where reasoning was needed. Note: the smart model started on Cerebras (highest priority in smart pool) — if Cerebras was rate-limited, it would transparently fail over to OpenRouter.

## Provider Failover (Both Tiers)

Both tiers have independent resilience layers. Each tier's `ProviderPool` manages providers in priority order:

### Fast Tier
```
Priority 1: Cerebras  (gpt-oss-120b,          ~3000 TPS)
Priority 2: Groq      (openai/gpt-oss-120b,   250K TPM)
Priority 3: OpenRouter (openai/gpt-oss-120b,   fallback)
```

### Smart Tier
```
Priority 1: Cerebras  (zai-glm-4.7,           native reasoning + prefix cache)
Priority 2: OpenRouter (z-ai/glm-4.7,          fallback)
```

On a 429 (rate limit), the pool immediately falls back to the next provider with zero delay. The hit provider enters a 60-second cooldown. This is transparent to the agent loop — `fetchWithRetry` returns `{ response, actualProviderId, actualModel }` so metrics are attributed correctly, but the loop doesn't need to care which provider served.

OpenRouter is the absolute fallback for both tiers — even if cooled down, `getActive()` returns the last slot (OpenRouter) when all others are unavailable.

## Key Design Decisions

1. **Two-tier, not three-tier.** GLM-4.7 has native reasoning, so there's no need for a separate "smart-with-reasoning" tier. The system is simpler: fast (no reasoning) → smart (reasoning built-in).

2. **Context distillation over context expansion.** Instead of expanding to 64K tokens and passing raw history, the system distills 40K+ tokens into ~1K of structured timeline. This preserves Cerebras prefix caching (the static tool + system prompt prefix stays the same) and gives the smart model a cleaner signal.

3. **Smart model gets its own provider pool.** Previously the smart model was hardcoded to OpenRouter. Now it uses `ProviderPool` with Cerebras as priority — getting ~3000 TPS + prefix caching on the reasoning model too.

4. **Voluntary escalation is permanent.** If the model knows it can't handle something, there's no reason to downgrade back — the task likely has more hard steps ahead.

5. **Automatic escalation is temporary.** The system assumes the hard part is localized and tries to return to the cheaper/faster model once progress resumes.

6. **Strategy pivot accompanies escalation.** Clearing the failing conversation tail prevents the smart model from being poisoned by the fast model's bad attempts.

7. **Screenshots at escalation.** The smart model gets visual context because DOM snapshots alone may not capture what's wrong (e.g., a visual CAPTCHA, a rendering bug).

8. **Static tool list for cache preservation.** All 57 tools are always sent to both tiers. Dynamic pruning would break Cerebras prefix caching.

9. **Same tool set for both models.** Both tiers have access to all 57 tools. The difference is reasoning quality, not capability.

## Planner Integration

The `TaskPlanner` (task decomposition and completion validation) also uses GLM-4.7 via the smart pool:

```typescript
constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
  this.llm = new LLMClient(openRouterApiKey, undefined, cerebrasApiKey);
  this.llm.switchToSmart(); // Uses smart pool: Cerebras → OpenRouter
}
```

This means the planner benefits from Cerebras speed + prefix caching for both `decompose()` and `validateDone()` calls.
