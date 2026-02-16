# Fast/Smart Model Collaboration

How two LLM tiers work together inside a single `AgentLoop` to solve browser automation tasks.

## The Two Tiers

| | Fast Model | Smart Model |
|---|---|---|
| **Models** | `gpt-oss-120b` (Cerebras/Groq/OpenRouter) | `grok-4.1-fast:nitro` (OpenRouter) |
| **Provider** | `ProviderPool` — Cerebras → Groq → OpenRouter failover | Direct OpenRouter (bypasses pool) |
| **Context window** | Base (default 32K) | Expanded to 64K |
| **Persona** | "sharp, resourceful web automation expert" | "seasoned systems thinker" |
| **Role** | Handles routine observe→act cycles quickly | Breaks through when the fast model gets stuck |

The fast model runs by default. It's cheap, fast (~3000 TPS on Cerebras), and handles the vast majority of turns — clicking, typing, navigating, reading pages. The smart model is called in only when the fast model demonstrably can't make progress.

## Escalation Triggers

There are four paths from fast → smart. Each is a different signal that the fast model is stuck.

### 1. Voluntary Escalation (`escalate` tool)

The fast model can call the `escalate` tool when it recognizes a problem beyond its ability — riddles, puzzles, math, multi-step logic.

```
LLM output:  escalate({ reason: "This captcha requires spatial reasoning" })
```

**Behavior:**
- **Permanent** for the session — no automatic de-escalation
- Sets `voluntaryEscalation = true`
- Refreshes the DOM snapshot so the smart model sees current state
- Injects `ESCALATION_NUDGE` to orient the smart model

This is the cleanest path because the model self-identifies its limitation.

### 2. Stuck Detection (9 stale turns)

The `ProgressTracker` fingerprints each turn's DOM snapshot (URL + element count + element signatures). If the fingerprint hasn't changed for 9 consecutive turns, it fires an `escalate` signal.

```
Turn 1-3:   stale → nudge ("try a different approach")
Turn 4-6:   stale → pivot (clear failing history, retry on fast model)
Turn 7-9:   stale → escalate to smart model
```

**Behavior:**
- Takes a screenshot for visual context before escalating
- Performs a strategy pivot (clears the failing conversation tail)
- **Temporary** — will de-escalate when progress resumes

### 3. Text-Only Response Escalation (repeated non-tool output)

When the LLM responds with text but no tool calls, the loop treats it as a failure to act. The progression:

```
1st text-only:   nudge ("you must call a tool")
2nd text-only:   strategy pivot on fast model
3-4th text-only: escalate to smart model + pivot
5th+ text-only:  give up (return IDLE to user)
```

Filler text (low-information narration like "I'll now click the button") is detected and fast-tracked — one filler response counts as 2 nudges, skipping straight to pivot.

**Behavior:**
- **Temporary** — subject to de-escalation
- Captures a screenshot before escalating

### 4. Step Watchdog (15 turns on same plan step)

When a multi-step plan is active, a watchdog tracks how long the agent spends on each subtask. If it exceeds 15 turns without calling `update_plan()`, the watchdog force-escalates.

**Behavior:**
- **Temporary** — subject to de-escalation
- Performs a strategy pivot
- Injects a step-specific watchdog message + `ESCALATION_NUDGE`

## What Happens at Escalation

Every escalation path does the same core steps:

```
1. llm.switchToSmart()        → swap to MODEL_SMART on OpenRouter
2. context.setModelTier("smart") → swap system prompt persona
3. context.setMaxContextTokens(64000) → expand context window
4. Inject ESCALATION_NUDGE    → orient the smart model
```

The `ESCALATION_NUDGE` is critical. It tells the smart model:

> You are now the upgraded model, brought in because the previous model got stuck.
> Review the conversation history and current page state. Then:
> 1. Identify what was attempted and why it failed.
> 2. Formulate a different strategy — do not repeat what already failed.
> 3. Call the appropriate tool to advance the task.
> If the page state is unclear, start with read_page or take_screenshot.

The smart model sees the full conversation history (expanded to 64K tokens) so it can analyze what the fast model tried and why it failed.

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
1. llm.switchToFast()          → swap back to fastest available provider
2. context.setModelTier("fast")  → swap persona back
3. context.setMaxContextTokens(base) → shrink context window
4. Inject DEESCALATION_NUDGE   → orient the fast model
5. cooldownRemaining = 3       → prevent immediate re-escalation
```

The `DEESCALATION_NUDGE` tells the fast model:

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
Turn  1 [fast/cerebras]  → navigate to login page           ✓
Turn  2 [fast/cerebras]  → type username                    ✓
Turn  3 [fast/cerebras]  → type password, click submit      ✓
Turn  4 [fast/cerebras]  → page has a CAPTCHA puzzle        ✗ stale
Turn  5 [fast/cerebras]  → tries clicking CAPTCHA           ✗ stale
Turn  6 [fast/cerebras]  → tries again                      ✗ stale
                           ↳ nudge injected
Turn  7 [fast/cerebras]  → tries 
                 ✗ stale
Turn  8 [fast/cerebras]  → tries take_screenshot            ✗ stale
Turn  9 [fast/cerebras]  → still stuck                      ✗ stale
                           ↳ ESCALATE: pivot + screenshot + nudge
Turn 10 [smart/openrouter] → analyzes screenshot, reasons about puzzle
Turn 11 [smart/openrouter] → solves CAPTCHA with execute_js  ✓ progress!
Turn 12 [smart/openrouter] → verifies success                ✓
                           ↳ DE-ESCALATE: progress resumed, tenure=3
Turn 13 [fast/cerebras]  → continues with post-login flow   ✓
Turn 14 [fast/cerebras]  → fills out form                   ✓
Turn 15 [fast/cerebras]  → done()
```

The fast model handled 12 of 15 turns. The smart model was only used for the 3 turns where reasoning was needed.

## Provider Failover (Within Fast Tier)

The fast tier has its own resilience layer independent of escalation. `ProviderPool` manages three providers:

```
Priority 1: Cerebras  (gpt-oss-120b,          ~3000 TPS)
Priority 2: Groq      (openai/gpt-oss-120b,   250K TPM)
Priority 3: OpenRouter (openai/gpt-oss-120b,   fallback)
```

On a 429 (rate limit), the pool immediately falls back to the next provider with zero delay. The hit provider enters a 60-second cooldown. This is transparent to the agent loop — `fetchWithRetry` returns `{ response, actualProviderId, actualModel }` so metrics are attributed correctly, but the loop doesn't need to care which provider served.

This means the fast model can sustain high throughput even under rate limiting, and only escalates to the smart model for reasoning ability, not capacity.

## Key Design Decisions

1. **Voluntary escalation is permanent.** If the model knows it can't handle something, there's no reason to downgrade back — the task likely has more hard steps ahead.

2. **Automatic escalation is temporary.** The system assumes the hard part is localized and tries to return to the cheaper/faster model once progress resumes.

3. **Strategy pivot accompanies escalation.** Clearing the failing conversation tail prevents the smart model from being poisoned by the fast model's bad attempts.

4. **Screenshots at escalation.** The smart model gets visual context because DOM snapshots alone may not capture what's wrong (e.g., a visual CAPTCHA, a rendering bug).

5. **The smart model gets a bigger context window.** 64K vs 32K lets it see more of the failed history to reason about what went wrong.

6. **Same tool set for both models.** Both tiers have access to all 52 tools. The difference is reasoning quality, not capability.
