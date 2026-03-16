# Executor/Planner Model Collaboration

How two LLM tiers work together inside a single `AgentLoop` to solve browser automation tasks.

## The Two Tiers

| | Executor Model | Planner Model |
|---|---|---|
| **Models** | `gpt-4.1-mini` (OpenRouter) | `minimax-m2.5` (OpenRouter) |
| **Provider Pool** | `ProviderPool` — OpenRouter | `ProviderPool` — OpenRouter |
| **Reasoning** | Standard completion | Native reasoning (enabled by default) |
| **Persona** | "sharp, resourceful web automation expert" | "seasoned systems thinker" |
| **Role** | Handles routine observe→act cycles quickly | Breaks through when the executor model gets stuck |

The executor model runs by default. It's cheap, fast, and handles the vast majority of turns — clicking, typing, navigating, reading pages. The planner model (MiniMax M2.5) is called in when the executor model demonstrably can't make progress.

### Pool Architecture

Both tiers use `ProviderPool` with a generic `PoolConfig` interface:

```typescript
interface PoolConfig {
  openRouterModel: string;
}
```

Both pools use OpenRouter as the single provider.

```
Executor Pool:  OpenRouter (openai/gpt-4.1-mini)
Planner Pool:   OpenRouter (minimax/minimax-m2.5)
```

## Escalation Triggers

There are four paths from executor → planner. Each is a different signal that the executor model is stuck. The system is a flat two-tier model — there is only one escalation step (executor → planner), not a graduated series.

### 1. Voluntary Escalation (`escalate` tool)

The executor model can call the `escalate` tool when it recognizes a problem beyond its ability — riddles, puzzles, math, multi-step logic.

```
LLM output:  escalate({ reason: "This captcha requires spatial reasoning" })
```

**Behavior:**
- **Permanent** for the session — no automatic de-escalation
- Sets `voluntaryEscalation = true`
- Refreshes the DOM snapshot so the planner model sees current state
- Injects `ESCALATION_REFLECTION` to orient the planner model
- Runs context distillation (see below)

This is the cleanest path because the model self-identifies its limitation.

### 2. Stuck Detection (stale turns)

The `StagnationMonitor` fingerprints each turn's DOM snapshot (URL + element count + element signatures). If the fingerprint hasn't changed for consecutive turns, it fires signals:

```
Stagnant turns 1-5:   reflection ("try a different approach")
Stagnant turn 6:       escalate to planner model
```

**Behavior:**
- Takes a screenshot for visual context before escalating
- Performs a strategy pivot (clears the failing conversation tail)
- **Temporary** — will de-escalate when progress resumes

### 3. Text-Only Response Escalation (repeated non-tool output)

When the LLM responds with text but no tool calls, the loop treats it as a failure to act. Filler text (low-information narration like "I'll now click the button") is detected and fast-tracked — one filler response adds +2 to the counter.

```
1st text-only:   reflection ("you must call a tool")
2nd text-only:   escalate to planner model
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
1. context.summarizeTrajectory()  → compress history for planner model
2. llm.switchToPlanner()           → swap to planner pool (OpenRouter)
3. context.setModelTier("planner") → swap system prompt persona
4. Inject ESCALATION_REFLECTION         → orient the planner model
```

### Context Distillation

This is the key innovation replacing the old "expand to 64K context" approach. Instead of giving the planner model the full conversation history (which could be 40K+ tokens of noisy observe→act loops), `summarizeTrajectory()` compresses the entire history into a structured timeline:

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

This replaces 40K+ tokens of raw history with ~1K tokens of structured timeline, making 32K context sufficient for the planner model (no 64K expansion needed). The planner model gets the original query + a concise log of everything that was tried, which is all it needs to formulate a new strategy.

### ESCALATION_REFLECTION

The `ESCALATION_REFLECTION` is critical. It tells the planner model:

> You are now the upgraded model, brought in because the previous model got stuck.
> Review the conversation history and current page state. Then:
> 1. Identify what was attempted and why it failed.
> 2. Formulate a different strategy — do not repeat what already failed.
> 3. Call the appropriate tool to advance the task.
> If the page state is unclear, start with read_page.

### Planner Model

The planner model (MiniMax M2.5) provides stronger reasoning for complex multi-step tasks. Switching to the planner model is sufficient to get enhanced reasoning capabilities.

## De-escalation

Automatic escalations (triggers 2, 3, 4) are temporary. When the planner model makes progress (snapshot fingerprint changes, stale turns reset to 0), the loop evaluates whether to de-escalate:

```python
if on_planner_model
   and NOT voluntary_escalation      # voluntary stays permanent
   and escalation_cycles < 3         # max 3 round-trips
   and planner_tenure >= 3:          # ran for at least 3 turns
     → de-escalate to executor model
```

On de-escalation:

```
1. llm.switchToExecutor()          → swap back to executor pool (OpenRouter)
2. context.setModelTier("executor")  → swap persona back
3. Inject DEESCALATION_REFLECTION     → orient the executor model
4. cooldownRemaining = 3             → prevent immediate re-escalation
```

The `DEESCALATION_REFLECTION` tells the executor model:

> The smarter model made progress and you're back in control.
> Review the recent history to understand what was accomplished. Continue from where it left off.

### Cycle Limits

To prevent thrashing:

| Limit | Value | Purpose |
|---|---|---|
| `MAX_CYCLES` | 3 | Max escalation→de-escalation round-trips per session |
| `COOLDOWN_TURNS` | 3 | Turns after de-escalation before re-escalation is allowed |
| `MIN_PLANNER_TENURE` | 3 | Minimum turns the planner model must run before de-escalation |

After 3 cycles, the agent stays on whichever tier it's currently using.

## Lifecycle Example

A typical hard navigation task might play out like:

```
Turn  1 [executor/openrouter]   → navigate to login page           ✓
Turn  2 [executor/openrouter]   → type username                    ✓
Turn  3 [executor/openrouter]   → type password, click submit      ✓
Turn  4 [executor/openrouter]   → page has a CAPTCHA puzzle        ✗ stale
Turn  5 [executor/openrouter]   → tries clicking CAPTCHA           ✗ stale
Turn  6 [executor/openrouter]   → tries again                      ✗ stale
                            ↳ reflection injected
Turn  7 [executor/openrouter]   → still stuck                      ✗ stale
                            ↳ ESCALATE: distill + screenshot + reflection
                            ↳ History compressed: 7 turns → ~500 token timeline
Turn  8 [planner/openrouter] → analyzes screenshot + timeline, reasons about puzzle
Turn  9 [planner/openrouter] → solves CAPTCHA with execute_js   ✓ progress!
Turn 10 [planner/openrouter] → verifies success                 ✓
                            ↳ DE-ESCALATE: progress resumed, tenure=3
Turn 11 [executor/openrouter]   → continues with post-login flow   ✓
Turn 12 [executor/openrouter]   → fills out form                   ✓
Turn 13 [executor/openrouter]   → done()
```

The executor model handled 10 of 13 turns. The planner model was only used for the 3 turns where reasoning was needed.

## Provider Configuration

Both tiers use OpenRouter as the single provider:

### Executor Tier
```
OpenRouter (openai/gpt-4.1-mini)
```

### Planner Tier
```
OpenRouter (minimax/minimax-m2.5)
```

`fetchWithRetry` returns `{ response, actualProviderId, actualModel }` so metrics are attributed correctly.

## Key Design Decisions

1. **Two-tier, not three-tier.** The system is simple: executor (fast, cheap) → planner (stronger reasoning).

2. **Context distillation over context expansion.** Instead of expanding to 64K tokens and passing raw history, the system distills 40K+ tokens into ~1K of structured timeline, giving the planner model a cleaner signal.

3. **Voluntary escalation is permanent.** If the model knows it can't handle something, there's no reason to downgrade back — the task likely has more hard steps ahead.

4. **Automatic escalation is temporary.** The system assumes the hard part is localized and tries to return to the cheaper/faster model once progress resumes.

5. **Strategy pivot accompanies escalation.** Clearing the failing conversation tail prevents the planner model from being poisoned by the executor model's bad attempts.

6. **Screenshots at escalation.** The planner model gets visual context because DOM snapshots alone may not capture what's wrong (e.g., a visual CAPTCHA, a rendering bug).

7. **Same tool set for both models.** Both tiers have access to all tools. The difference is reasoning quality, not capability.

## Planner Integration

The `TaskPlanner` (task decomposition and completion validation) also uses MiniMax M2.5 via the planner pool:

```typescript
constructor(openRouterApiKey: string) {
  this.llm = new LLMClient(openRouterApiKey);
  this.llm.switchToPlanner(); // Uses planner pool: OpenRouter
}
```
