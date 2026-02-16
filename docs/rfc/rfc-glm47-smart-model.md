# RFC: Replace Grok 4.1 Fast with GLM-4.7 as Smart Model — Context-Efficient Escalation

## Problem

The current smart model (**Grok 4.1 Fast**, `x-ai/grok-4.1-fast:nitro` on OpenRouter) is not dense enough to reason through complex multi-step web automation tasks. When the agent escalates — because it's stuck on a tricky form, a multi-page workflow, or a puzzle — the smart model frequently fails to identify the root cause and formulate an effective strategy. This defeats the purpose of having a smart tier at all: the agent burns turns cycling between fast and smart without making progress.

**GLM-4.7** (`zai-glm-4.7` on Cerebras, `z-ai/glm-4.7` on OpenRouter) is significantly more capable at structured reasoning and strict instruction following. It's available on both Cerebras (3000 TPS inference speed) and OpenRouter (with prefix caching), which means we can build the same kind of priority-based failover pool we already use for the fast tier.

## Key Constraints (from analysis)

1. **GLM-4.7 has native reasoning.** Unlike Grok/O1, there is no `reasoning: { effort: "high" }` parameter. The model thinks by default. Sending the parameter may cause API errors. This collapses our 3-tier system (fast / smart-no-think / smart-with-think) into a simpler 2-tier system (fast / smart).

2. **Cerebras has prefix caching, but it's prefix-exact.** The cache key is the exact byte-for-byte prefix of the request: tools array + system prompt prefix. If we dynamically change the tool list (pruning per page), we break the cache for every page type and destroy the speed advantage. **Tools must remain static across all turns.**

3. **The guardian benefits from GLM-4.7.** Both `decompose()` and `validateDone()` are reasoning-heavy tasks where improved intelligence directly translates to better plans and stricter completion validation. The guardian should also switch.

## Current Architecture (What Changes)

### Model Constants (`llm/client.ts`)

| Constant | Current | Proposed |
|----------|---------|----------|
| `MODEL_SMART` | `x-ai/grok-4.1-fast:nitro` | `z-ai/glm-4.7` (OpenRouter) |
| `MODEL_SMART_CEREBRAS` | N/A | `zai-glm-4.7` (Cerebras, new) |

The fast tier is unchanged: `gpt-oss-120b` across Cerebras/Groq/OpenRouter.

### Three-Tier → Two-Tier Escalation

**Current** (3 tiers, `loop.ts:983-990`):
```
Tier 0: fast model (gpt-oss-120b), no reasoning
Tier 1: smart model (grok-4.1-fast:nitro), reasoning OFF
Tier 2: smart model (grok-4.1-fast:nitro), reasoning ON (effort: "high")
```

The distinction between tier 1 and tier 2 exists because Grok's reasoning was optional and expensive. With GLM-4.7, reasoning is always on — there's no "smart without thinking" mode.

**Proposed** (2 tiers):
```
Tier 0: fast model (gpt-oss-120b)
Tier 1: smart model (GLM-4.7), reasoning is native (always on)
```

This simplifies the escalation state machine. The `reasoningEnabled` flag, the tier 1→2 escalation path, and the `reasoningEffort` parameter in the API payload all go away.

### Escalation Trigger Points (Loop Touchpoints)

All escalation triggers in `loop.ts` currently distinguish tier 0→1 and 1→2. With 2 tiers, they simplify:

| Trigger | Current Behavior | Proposed |
|---------|-----------------|----------|
| **BRAINS→HANDS** (line 983-1044) | Start at tier 1, hand off to tier 0 after 2 turns | Start at tier 1 (GLM-4.7 with native thinking), hand off to tier 0. Identical flow, just no reasoning toggle. |
| **Voluntary `escalate` tool** (line 1596-1639) | Jump to tier 2, enable reasoning, permanent | Jump to tier 1 (already max), permanent. No reasoning toggle needed. |
| **Stuck detection** (line 2789-2893) | Tier 0→1 (no think), then 1→2 (enable think + screenshot) | Tier 0→1 (GLM-4.7, screenshots unlocked). Single escalation step. |
| **Step watchdog** (line 2553-2590) | Tier 0→1 or enable reasoning for tier 2 | Tier 0→1. Single step. |
| **Text-only escalation** (line 2988-3006) | Tier 0→1 or 1→2 | Tier 0→1. Single step. |
| **De-escalation** (line 2872-2889) | Smart→fast, reset reasoning flag | Smart→fast. No reasoning flag to reset. |

### Screenshot Access

Currently screenshots are locked to tier 2 only ("too expensive for fast/tier 1" — `loop.ts:441`). With 2 tiers, screenshots should unlock at tier 1 (the only smart tier). This is actually better: GLM-4.7 gets visual context on first escalation rather than requiring a second escalation step.

## Strategy 1: Smart Provider Pool

### Why

Currently `switchToSmart()` hardcodes OpenRouter (`loop.ts:287-296`). This means:
- No failover on 429 — if OpenRouter rate-limits the smart model, the agent is stuck
- No access to Cerebras speed (3000 TPS) for the smart tier
- No ability to leverage Cerebras prefix caching

### Design

Introduce a `SmartProviderPool` (or extend `ProviderPool` with a `tier` parameter) that mirrors the fast pool:

```
Priority: Cerebras (zai-glm-4.7) → OpenRouter (z-ai/glm-4.7)
```

Groq does not serve GLM-4.7 (currently), so it's excluded from the smart pool. If it becomes available later, adding it is a single-line change.

### Implementation

**Option A: Reuse ProviderPool.** Create a second `ProviderPool` instance for the smart tier:
```typescript
// In LLMClient constructor
this.smartPool = new ProviderPool(
  openRouterKey,      // fallback: z-ai/glm-4.7
  undefined,          // no Groq for smart
  cerebrasKey,        // primary: zai-glm-4.7
  "smart"             // new param to select smart model constants
);
```

This requires `ProviderPool` to accept a tier parameter that controls which model constants it uses. Minimal change: add a `modelMap` parameter or a `tier: "fast" | "smart"` flag.

**Option B: Dedicated SmartPool.** Keep it simple — just a pair of slots without the full pool class. The smart model is only used during escalation (short bursts), so over-engineering the pool is unnecessary:
```typescript
private smartProvider(): { provider: ProviderConfig; model: string } {
  if (this.cerebrasApiKey) {
    // TODO: check cooldown
    return { provider: cerebrasProvider(this.cerebrasApiKey), model: MODEL_SMART_CEREBRAS };
  }
  return { provider: openRouterProvider(this.openRouterApiKey), model: MODEL_SMART };
}
```

**Recommendation: Option A.** Reuse `ProviderPool` — the cooldown logic, `getNextFallback()`, and `getActive()` all apply equally. Just parameterize the model constants.

### switchToSmart() / switchToFast() Changes

```typescript
public switchToSmart(): void {
  const slot = this.smartPool.getActive();  // Cerebras first, then OpenRouter
  this.model = slot.model;
  this.provider = slot.provider;
}

public switchToFast(): void {
  const slot = this.fastPool.getActive();   // unchanged
  this.model = slot.model;
  this.provider = slot.provider;
}
```

### Failover During Smart Model Calls

The `fetchWithRetry()` method currently does provider failover only for the fast pool (`this.fastPool.cooldown()`). It needs to also handle smart pool failover:

```typescript
// In fetchWithRetry(), on 429:
const pool = isSmartModel ? this.smartPool : this.fastPool;
pool.cooldown(providerId);
const fallback = pool.getNextFallback(providerId);
```

This requires `fetchWithRetry` to know which pool to use, which can be passed as a parameter or determined from the current `this.model` value.

## Strategy 2: Prefix Cache Preservation

### How Cerebras Prefix Caching Works

Cerebras caches the exact byte prefix of each request. For our API calls, the cacheable prefix is:

```json
{
  "model": "zai-glm-4.7",
  "tools": [ ... all 52 tool definitions ... ],     // ~3K tokens, STATIC
  "messages": [
    { "role": "system", "content": "You are OpenSidebar... ## Rules..." }
                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                     Static rules prefix (~2K tokens)
```

Everything after the first dynamic content (page title, URL, elements) breaks the cache. So the cacheable prefix is approximately:

```
tools (52 definitions) + system prompt static rules ≈ 5-6K tokens
```

### Rules to Preserve Cache Hits

1. **Never prune the tool list.** All 52 tools must always be sent. Dynamic tool pruning (e.g., removing tools based on page type) would change the prefix on every page and destroy caching. This was our initial instinct — good thing we caught it.

2. **Keep the system prompt structure stable.** The static rules block (`SYSTEM_PROMPT_TEMPLATE` through the end of `## Tool Tips`) must come first, before any dynamic content. This is already the case in `context.ts:51-120`.

3. **The persona swap (`FAST_PERSONA` vs `SMART_PERSONA`) does NOT break the smart model's cache.** Because:
   - The cache is per-model. `zai-glm-4.7` and `gpt-oss-120b` have separate cache namespaces.
   - The smart model always uses `SMART_PERSONA`. It never sees `FAST_PERSONA`.
   - On re-escalation after de-escalation, the smart model's prefix is identical to its last call → cache hit on the static prefix.

4. **Plan status and dynamic content go AFTER static rules.** Already the case: `{{persona}}`, `{{planStatus}}`, `{{elements}}`, and `{{viewportText}}` are all at the bottom of the template.

### Estimated Cache Benefit

Per-turn savings when cache hits:

| Component | Tokens | Cached? |
|-----------|--------|---------|
| Tool definitions (52 tools) | ~3,000 | Yes |
| System prompt static prefix | ~2,500 | Yes |
| **Total cached** | **~5,500** | |
| Dynamic content (snapshot, history) | varies | No |

At 3000 TPS, 5.5K cached tokens save ~1.8 seconds per turn. Over a 3-turn smart model burst, that's ~5 seconds saved.

## Strategy 3: Context Distillation on Escalation

This is the biggest win. It solves the real problem: **even with caching, sending 40K+ tokens of raw conversation history to the smart model is wasteful and noisy.**

### Current Problem

When the agent escalates (`escalateModel()` in `loop.ts:785`), the context window expands to 64K:
```typescript
this.context.setMaxContextTokens(Math.max(this.baseContextTokens, 64000));
```

The smart model then receives the full raw conversation history — every tool call with verbose arguments, every tool result with full DOM snapshots, every "I'll now click button [5]" reasoning message. For a 10-turn session, this can be 30-50K tokens of history. The smart model has to wade through all of this to figure out what went wrong.

### Proposed: Distill Before Escalate

We already have a precedent: `extractAttemptSummary()` (loop.ts:136-209) does exactly this for strategy pivots. It walks through history, extracts tool name + key args + outcome, and categorizes into successes and failures. The output is a compact ~500 token summary.

**Proposal:** Extend this pattern into a full `distillForEscalation()` method on `ContextManager` that produces a structured situation report:

```
TASK: Log into the dashboard and export the sales report

ATTEMPT LOG (8 turns):
T1: read_page → Inputs: email [3], password [4]. Buttons: "Login" [5]
T2: type_text [3] "user@co.com" → OK
T3: type_text [4] "pass123" → OK
T4: click [5] → page reloaded, still on /login
T5: read_page → same form, red error: "Invalid credentials"
T6: type_text [3] "admin@co.com" → OK
T7: click [5] → same result, /login with error
T8: take_screenshot → login form with red error banner

STUCK: 2 login attempts failed. Credentials rejected.
```

### How It Works

1. **On escalation trigger**, before switching models, call `context.distillForEscalation()`.
2. This method:
   - Extracts the original user query (first user message).
   - Walks through all assistant→tool pairs in history.
   - For each pair: extracts tool name, key arguments (id, text, url), and first line of result.
   - Classifies as success/failure.
   - Formats as compact `T{n}: {tool} {args} → {outcome}` lines.
3. **Clears the raw history** and replaces it with:
   - The original user query.
   - The distilled attempt log as a single user message.
4. The smart model now sees: system prompt (~5K) + original query (~0.2K) + distilled log (~1K) + fresh DOM snapshot (in system prompt, ~3K) = **~10K total context**.

### Why This Is Better Than Raw History

| Aspect | Raw History (current) | Distilled (proposed) |
|--------|----------------------|---------------------|
| Context size | 30-50K tokens | ~10K tokens |
| Cerebras processing time (3000 TPS) | 10-17 seconds | ~3 seconds |
| Signal-to-noise ratio | Low (verbose DOM snapshots, LLM reasoning, full tool results) | High (only actions + outcomes) |
| Smart model comprehension | Must parse through noise to find the pattern | Pattern is pre-extracted and presented clearly |

### Relationship to `extractAttemptSummary()`

`extractAttemptSummary()` already does 80% of what we need. The differences:

| Feature | extractAttemptSummary() | distillForEscalation() |
|---------|----------------------|----------------------|
| Scope | Recent failures + successes | Full session timeline |
| Format | Bullet list | Numbered timeline with turn markers |
| Output | String (injected as user message) | Replaces entire history |
| Used by | `strategyPivot()` | `escalateModel()` |

**Implementation approach:** Extract the core logic into a shared `summarizeHistory()` utility. Both `strategyPivot()` and the new escalation distillation use it, just with different formatting.

### Context Window on Escalation

With distillation, we no longer need to expand to 64K:
```typescript
// BEFORE (current):
this.context.setMaxContextTokens(Math.max(this.baseContextTokens, 64000));

// AFTER (with distillation):
// No expansion needed — distilled context is ~10K, well within 32K default
```

This further improves cache efficiency: the context window is stable across escalation/de-escalation.

## Strategy 4: Guardian Migration

### Current

```typescript
// guardian.ts:59-67
constructor(openRouterApiKey: string) {
  this.llm = new LLMClient(
    openRouterApiKey,
    undefined, // no Groq
    undefined, // no Cerebras
    false,
    MODEL_SMART,
  );
}
```

The guardian hardcodes OpenRouter with `MODEL_SMART`. It uses `complete()` (non-streaming, small requests).

### Proposed

The guardian should use the same smart provider pool as the main agent loop:

```typescript
constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
  this.llm = new LLMClient(
    openRouterApiKey,
    undefined,       // no Groq for smart
    cerebrasApiKey,   // Cerebras for smart pool
    MODEL_SMART,
  );
}
```

This gives the guardian Cerebras-first inference with OpenRouter fallback. Since `decompose()` and `validateDone()` are small requests (512/256 max_tokens), Cerebras processes them in <1 second.

### Reasoning Parameter Removal

The `CompletionRequest.reasoningEffort` field and all its usage must be removed:

1. `llm/types.ts:48` — Remove `reasoningEffort` from `CompletionRequest`.
2. `llm/client.ts:431-443` — Remove the `reasoning: { effort }` spread in `complete()`.
3. `llm/client.ts:590-604` — Remove the `reasoning: { effort }` spread in `completeStream()`.
4. `loop.ts:990` — Remove `reasoningEnabled` flag.
5. `loop.ts:1142-1143` — Remove reasoning effort conditional.
6. All tier 1→2 escalation paths — Remove `reasoningEnabled = true` assignments.

The `isSmartModel` check changes from `this.model === MODEL_SMART` to checking against both `MODEL_SMART` and `MODEL_SMART_CEREBRAS`:
```typescript
const isSmartModel = [MODEL_SMART, MODEL_SMART_CEREBRAS].includes(this.model);
```

Or better: track it as a `modelTier` property on `LLMClient` rather than comparing model strings.

## Strategy 5: Think-Tag Handling

GLM-4.7 emits `<think>...</think>` blocks natively (similar to DeepSeek R1). Our existing infrastructure handles this:

- `stripThinkTags()` (`client.ts:74-84`) — strips `<think>` tags from non-streaming responses. Already works.
- `createThinkFilter()` (`client.ts:98-137`) — streaming filter for `<think>` tags across chunk boundaries. Already works.
- Think blocks are preserved raw in conversation history for reasoning chain continuity. Already works.

**No changes needed** to think-tag handling. The existing code was written to be model-agnostic.

One thing to verify: GLM-4.7's think tags. If the model uses a different format (e.g., `<thinking>` instead of `<think>`), we need to update the regex patterns. This should be tested empirically.

**Action item:** Test GLM-4.7's think tag format. If different, update:
- `stripThinkTags()` regex
- `createThinkFilter()` open/close tags
- `partialTagLen()` tag strings

## BRAINS→HANDS Pattern Update

The BRAINS→HANDS orientation (first 2 turns use smart model, then hand off to fast) works identically with GLM-4.7. The only difference:

- **Current:** Tier 1 (smart, no thinking) → orientation is "cheap" because no reasoning tokens.
- **Proposed:** Tier 1 (GLM-4.7, always thinking) → orientation costs more reasoning tokens.

**Consideration:** GLM-4.7's native reasoning during orientation is actually a feature, not a cost. The whole point of BRAINS→HANDS is to let the smart model analyze the page and start the task with good strategy. Better reasoning = better orientation = fewer wasted fast-model turns.

The `ORIENTATION.PHASE_TURNS = 2` constant may need tuning. GLM-4.7's reasoning might accomplish more in 2 turns, or it might need 3. Start with 2, measure, adjust.

## Implementation Plan

### Phase 1: Model Constants & Provider Pool

Files: `llm/client.ts`, `llm/types.ts`

1. Add `MODEL_SMART_CEREBRAS = "zai-glm-4.7"`.
2. Rename `MODEL_SMART` to `"z-ai/glm-4.7"`.
3. Parameterize `ProviderPool` to accept model constants (or create a second instance with smart model constants).
4. Add `smartPool` to `LLMClient`. Build it in constructor with Cerebras (if key present) → OpenRouter.
5. Update `switchToSmart()` to use `smartPool.getActive()` instead of hardcoding OpenRouter.
6. Update `fetchWithRetry()` to select the correct pool based on model tier.
7. Remove `reasoningEffort` from `CompletionRequest`.
8. Remove `reasoning: { effort }` from both `complete()` and `completeStream()` payloads.
9. Add `isSmartTier()` helper (replaces `this.model === MODEL_SMART` checks throughout).

### Phase 2: Tier Simplification

Files: `agent/loop.ts`, `agent/constants.ts`

1. Remove `reasoningEnabled` flag from loop state.
2. Collapse all tier 0→1→2 escalation into tier 0→1.
3. Remove tier 1→2 branches from: stuck detection, step watchdog, text-only escalation.
4. Unlock screenshots at tier 1 (was tier 2 only).
5. Remove `max_tokens` reduction for reasoning (was `2048` when `reasoningEnabled`, now always `LLM_CONFIG.MAX_TOKENS`).
6. Update `ESCALATION_NUDGE` if needed for GLM-4.7's reasoning style.

### Phase 3: Context Distillation

Files: `agent/context.ts`, `agent/loop.ts`

1. Add `distillForEscalation(originalQuery: string): void` to `ContextManager`.
   - Walks history, extracts tool→result pairs as compact timeline.
   - Clears history, injects original query + distilled summary.
2. Extract shared summarization logic from `extractAttemptSummary()` into a utility.
3. Call `distillForEscalation()` in `escalateModel()` before switching models.
4. Remove the 64K context expansion (no longer needed).
5. Verify `extractAttemptSummary()` (used by `strategyPivot()`) still works with the refactored utility.

### Phase 4: Guardian Migration

Files: `agent/guardian.ts`

1. Accept `cerebrasApiKey` in `PlanGuardian` constructor.
2. Pass it through to `LLMClient` so the guardian uses the smart pool.
3. Thread `cerebrasApiKey` from `background.ts` → `AgentLoop` → `PlanGuardian`.

### Phase 5: Tests & Verification

Files: `tests/background/agent.test.ts`, `tests/background/metadata.test.ts`

1. Update model constant references in tests.
2. Add test for smart pool construction and failover.
3. Add test for `distillForEscalation()` output format.
4. Test think-tag handling with GLM-4.7's actual output format.
5. Build and verify extension loads cleanly.

## Risks & Mitigations

### Risk 1: GLM-4.7's Think Tags Use Different Format
**Impact:** Think blocks leak into UI streaming, tool results, or conversation display.
**Mitigation:** Test empirically before merging. Update `stripThinkTags()` regex if needed. The filter is model-agnostic by design.

### Risk 2: Cerebras Rate Limits on GLM-4.7
**Impact:** Smart model falls back to OpenRouter frequently, negating speed gains.
**Mitigation:** The pool handles this automatically. OpenRouter's prefix caching kicks in as the fallback, so worst case is current behavior. Monitor `SESSION_METRICS` model breakdown to track failover frequency.

### Risk 3: Context Distillation Loses Important Detail
**Impact:** Smart model can't diagnose the problem because the distilled summary is too compact.
**Mitigation:** The distillation preserves: (a) the original query verbatim, (b) every tool action with key args, (c) every outcome's first line, (d) the current DOM snapshot in full. What it drops is verbose tool result bodies (full element lists, long text extractions) and LLM reasoning text. These are noise for diagnostic purposes. If we find cases where detail matters, we can tune the snippet lengths.

### Risk 4: Always-On Reasoning Increases Token Cost
**Impact:** GLM-4.7 uses reasoning tokens even during BRAINS→HANDS orientation where Grok didn't.
**Mitigation:** This is intentional — better reasoning during orientation leads to better plans. The cost increase is bounded: orientation is only 2 turns, and context distillation dramatically reduces prompt tokens on escalation. Net token spend should decrease due to fewer wasted turns.

### Risk 5: Provider Pool Adds Complexity to LLMClient
**Impact:** Two pools (fast + smart) to maintain, more state in `fetchWithRetry()`.
**Mitigation:** `ProviderPool` is already well-tested and simple. The smart pool is structurally identical — just different model constants and fewer providers (2 vs 3). The `isSmartTier()` helper cleanly selects which pool to use.

## Decision Record

| Decision | Rationale |
|----------|-----------|
| Keep all 52 tools in every request | Cerebras prefix caching requires exact prefix match. Dynamic pruning destroys cache. |
| 2-tier instead of 3-tier | GLM-4.7 reasons natively. No "smart without thinking" mode exists. Simplifies state machine. |
| Distill history on escalation | Reduces context from 40K→10K. Better signal/noise for smart model. Faster inference on Cerebras. |
| Don't expand to 64K on escalation | Distilled context fits in 32K. Eliminates context window churn. |
| Guardian uses smart pool | Decompose/validate benefit from GLM-4.7's reasoning. Small requests → Cerebras processes in <1s. |
| Reuse ProviderPool for smart tier | Avoid code duplication. Cooldown + failover logic is identical. |
