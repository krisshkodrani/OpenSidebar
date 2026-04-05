# RFC: Unified Vision-Language Executor

**Status**: Draft v2 (post-Codex review)
**Date**: 2026-04-04
**Author**: Kris + Claude

## Problem

The agent currently makes **two LLM calls per turn**:

1. **Perception** (Grok 4.1 Fast, $0.20/$0.50): receives screenshot, outputs 5-section text interpretation (~600 input + ~200 output tokens, 5-20s latency)
2. **Executor** (GPT-5.4-mini, $0.75/$4.50): receives text interpretation + element list, produces tool calls (~2K input + ~500 output tokens, 2-5s latency)

This is expensive and slow:
- **Cost**: ~$0.0044/turn ($0.0003 perception + $0.0041 executor)
- **Latency**: 7-25s per turn (sequential: perception must finish before executor)
- **Information loss**: Perception compresses a screenshot into ~250 tokens of text. The executor never sees the actual page.

## Proposal

Replace the two-call pipeline with a **single VL (Vision-Language) model call** that receives both the screenshot AND the element list, then directly produces tool calls.

```
Current:  Screenshot -> Perception VLM -> text -> Executor LLM -> tool calls
                        (5-20s)                    (2-5s)

Proposed: Screenshot + Elements -> VL Executor -> tool calls
                                     (3-8s)
```

## Why This Works Now

1. **GPT-5.4-mini supports vision + tool calling simultaneously** -- already used as perception fallback
2. **`LLMMessage.content` already supports `ContentPart[]`** with `image_url` blocks (`llm/types.ts:15-20`)
3. **`complete()`/`completeStream()` handle multimodal messages** (`client.ts:731-748`)
4. **Screenshots are already captured** as JPEG data URLs in the loop (`loop.ts:2460`)
5. **Cheaper VL alternatives exist**: Qwen3-VL at $0.13/$0.52 is 8.6x cheaper on output than GPT-5.4-mini

## Current Perception Consumers (Codex finding #3)

Perception output is NOT just injected into the system prompt. It serves as **control-plane state** in six decision points:

| Consumer | Location | What it reads | Breaks without it? |
|----------|----------|--------------|-------------------|
| `planner.decompose()` | loop.ts:1698 | Full interpretation | Degraded plan quality |
| `triagePopups()` | loop.ts:2626 | BLOCKERS section, parses NUISANCE entries | Handled (returns 0) |
| `planner.monitorStep()` | loop.ts:2737 | Full interpretation for alignment check | Skipped (null guard) |
| `planner.replanFrom()` | loop.ts:2775, 2967 | Full interpretation for replan context | Falls back to "" |
| `shouldOmitPerceptionForDoneValidation()` | loop.ts:5393 | Checks if perception is trustworthy | Validation skipped |
| `context.setPageInterpretation()` | context.ts:772 | Injected into `{{pageInterpretation}}` | Shows fallback text |

Plus: 6 cache invalidation points, trace recording, warmup hydration.

**Implication**: Unified mode cannot simply skip perception and inject a screenshot. The six consumers need either replacement signals or graceful degradation.

## Architecture

### Proposed: Single VL Call with Structured Output

The VL executor receives the screenshot and produces **both tool calls AND a brief visual assessment** in the same response. The visual assessment replaces the 5-section perception output with a condensed format embedded in the model's reasoning.

**Screenshot Injection**: Added as a user message before each turn:
```typescript
{
  role: "user",
  content: [
    { type: "image_url", image_url: { url: screenshotDataUrl, detail: "low" } },
    { type: "text", text: "Current page screenshot." },
  ]
}
```

Using `detail: "low"` = ~85 tokens per image. The element list provides precise DOM data; the screenshot provides visual context, layout, and non-DOM content.

**System Prompt Change**: `## Page Interpretation` becomes:
```
## Visual Context
A screenshot of the current page is included above. Before acting:
1. ORIENT: What page is this? What state is it in?
2. VERIFY: Did your last action have the intended effect?
3. BLOCKERS: Any overlays, modals, errors, or loading states blocking interaction?
4. VISUAL-ONLY: Any prices, images, or text not in the element list?
Ground all actions in the [N] element tags from the Visible Elements list.
```

### Consumer Migration

| Consumer | Current source | Unified replacement |
|----------|---------------|-------------------|
| `planner.decompose()` | Perception text | State-diff evidence + page title/URL (already optional param) |
| `triagePopups()` | Parses BLOCKERS for NUISANCE | Executor calls `dismiss_overlays` when it sees modal in screenshot |
| `planner.monitorStep()` | Perception text | State-diff evidence + `ActionEffect` summary |
| `planner.replanFrom()` | Perception text | State-diff evidence + "" fallback (already handled) |
| `shouldOmitPerceptionForDoneValidation()` | Checks perception trustworthiness | Perception check replaced by `stateEvidence` (already wired into `validateDone` from idempotency guard work). Verifier sees deterministic DOM diff, not a screenshot. Known gap: visual-only state (error text without DOM change) not covered. |
| `{{pageInterpretation}}` | 5-section interpretation | "Visual Context" instruction block |

**Key insight**: `formatStateEvidence()` (from the idempotency guard work) already provides deterministic DOM change data. Combined with the executor seeing the screenshot, this covers most of what the 5-section interpretation provided -- without an extra LLM call.

### Provider Fallback (Codex finding #1)

**The `toTextOnlyMessages()` fallback is NOT safe for unified mode.** Stripping the image leaves the executor blind with no perception text to compensate.

**Fix**: When a provider rejects image content (422), unified mode **falls back to the full two-call pipeline** for that turn, not to text-only:

```typescript
// In completeStream(), on image rejection (422):
if (isImageRejection && this.useVLExecutor) {
  // Do NOT strip images and retry text-only.
  // Instead, signal the loop to fall back to separate perception.
  throw new VLFallbackError("Provider does not support vision");
}
```

In the loop:
```typescript
try {
  response = await this.llm.completeStream({messages, tools, ...});
} catch (err) {
  if (err instanceof VLFallbackError) {
    // Fall back to 2-call pipeline for this turn
    await this.refreshPerception(tabId);
    // Re-run executor without screenshot, with perception text
    response = await this.llm.completeStream({textOnlyMessages, tools, ...});
  }
}
```

This preserves the PerceptionAgent as a warm fallback -- it is NOT removed in unified mode, just bypassed on the happy path.

### Screenshot Refresh Policy (Codex finding #2)

**The current PerceptionAgent does NOT trust fingerprint equality indefinitely.** It has stale thresholds (1-4 turns) because visual-only changes (async loading, CSS animations, canvas updates) can happen without DOM fingerprint changes.

**Fix**: In unified mode, the screenshot is **always included** when one is captured. Do not skip based on fingerprint. The cost is only ~85 tokens at `detail: "low"` -- negligible vs. the risk of blinding the executor.

Image inclusion policy:
- **Every turn where a screenshot is captured**: Include it (detail=low, ~85 tokens)
- **First turn + URL change**: Include at detail=high (~765 tokens) for orientation
- **Panoramic first turn**: Include top/middle/bottom viewports (same as current)
- **No screenshot available** (capture failed, tab closed): Omit image, set `pageInterpretation` to fallback text

This means ~85 extra input tokens per turn. Over a 20-turn session, that is ~1,700 tokens -- $0.0013 on GPT-5.4-mini. Not worth optimizing away.

## Cost Analysis

### Per-Turn Cost Comparison

| Architecture | Input tokens | Output tokens | Cost/turn | Latency |
|-------------|-------------|---------------|-----------|---------|
| Current 2-call | ~3300 (800+2500) | ~700 (200+500) | $0.0044 | 7-25s |
| Unified GPT-5.4-mini | ~2585 (+85 image) | ~500 | $0.0042 | 3-8s |
| Unified Qwen3-VL Instruct | ~2585 (+85 image) | ~500 | $0.0006 | 3-10s |

### Per-Session Cost (20-turn task)

| Architecture | Cost/session | Latency reduction |
|-------------|-------------|-------------------|
| Current (Grok + GPT-5.4-mini) | $0.088 | baseline |
| Unified GPT-5.4-mini | $0.084 | **40-70% faster** |
| Unified Qwen3-VL Instruct | $0.012 | ~50% faster, 86% cheaper |

**Primary win is latency**, not cost, when using GPT-5.4-mini. Cost win comes from model substitution (Qwen3-VL).

## What We Lose and How We Compensate

### 1. Popup Auto-Triage

**Current**: Perception parses BLOCKERS for `NUISANCE [tagId] "text" -> click [dismissTagId]`, then auto-clicks dismiss buttons.

**Unified**: Executor sees the overlay in the screenshot and calls `dismiss_overlays` as a tool. This is manual (executor decides) vs. automatic (perception triggers), meaning overlays may persist 1-2 extra turns before the executor addresses them.

**Acceptable because**: The existing `autoDismissModals()` in content.ts already handles common cookie banners on page load. The perception-driven triage catches stragglers, but the executor with a screenshot will notice them too.

### 2. Plan Monitoring

**Current**: `planner.monitorStep(perception)` checks alignment between the perception text and the expected plan step, triggering deviation handling if needed.

**Unified**: Monitor receives `formatStateEvidence()` output instead of perception text. State-diff provides deterministic change data (elements added/removed, URL changes). Less nuanced than visual interpretation but more reliable.

**Risk**: Monitor might miss visual-only deviations (e.g., page shows an error that does not change DOM elements). Mitigated by: the executor itself sees the screenshot and should react to visual errors by adjusting its behavior.

### 3. Stateful Observation History

**Current**: `PerceptionAgent` maintains a 5-turn observation log with compressed overflow for trend detection.

**Unified**: Observation history is replaced by conversation history (tool results + `formatActionEffect()` injections). History compression might drop some context, but the state-diff evidence provides the critical "what changed" signal deterministically.

### 4. Dedicated Perception Tuning

**Current**: Perception prompt is optimized for visual analysis (temperature 0.1, max 600-800 tokens, structured output).

**Unified**: Perception reasoning competes with tool-calling reasoning in the same context. Risk: the model may under-invest in visual analysis. Mitigated by: explicit "Visual Context" instruction block that directs the model to assess the page before acting.

## Implementation Phases

### Phase 1: Feature flag + VL pipeline (~100 lines, not 40)

Corrected scope accounting for consumer migration:

**Files changed:**
- `src/background/agent/loop.ts` (~50 lines)
  - Add `useVLExecutor` flag (derived from settings)
  - In `refreshPerceptionAndTriage()`: when VL mode, capture screenshot but skip `refreshPerception()`
  - Inject screenshot as user message before LLM call
  - Add `VLFallbackError` catch block for provider fallback to 2-call pipeline
  - Replace perception consumers: monitorStep gets state-diff, triagePopups bypassed
- `src/background/agent/context.ts` (~20 lines)
  - Add `screenshotDataUrl` field + setter
  - In `getPrompt()`: inject image user message when screenshot is set
  - VL-mode `{{pageInterpretation}}` variant
- `src/background/agent/planner.ts` (~10 lines)
  - `monitorStep()`: accept state-diff evidence alongside/instead of perception text
  - `decompose()`: already optional, no change needed
- `src/types/settings.ts` (~3 lines)
  - Add `useVLExecutor?: boolean`
- `prompts/runtime/agent/system.md` (~10 lines)
  - "Visual Context" instruction block for VL mode

**PerceptionAgent is NOT removed** -- kept as warm fallback for provider failures and text-only models.

### Phase 2: Validation and measurement

- Run full E2E with GPT-5.4-mini unified vs. current 2-call baseline
- Measure: pass rate, per-turn latency, total cost, popup triage success
- Regression gate: must match or exceed 97.5% pass rate

### Phase 3: Model alternatives

Test Qwen3-VL Instruct and Grok 4.1 Fast as unified executors. Compare cost/quality tradeoffs.

### Phase 4: Cleanup (only after Phase 2 validates)

Remove perception-specific code paths if unified mode becomes default. Keep PerceptionAgent for text-only model fallback.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Provider rejects images | **High** | Fall back to 2-call pipeline (NOT text-only). PerceptionAgent kept warm. |
| Visual-only state changes missed | **Medium** | Always include screenshot (never skip on fingerprint). 85 tokens/turn cost. |
| Popup auto-triage slower | **Low** | Executor sees overlays in screenshot. content.ts autoDismiss covers common cases. |
| Plan monitoring less nuanced | **Medium** | State-diff evidence + executor visual grounding compensate. |
| Model under-invests in visual analysis | **Medium** | Explicit "Visual Context" instruction block. Prompt engineering per model. |
| Verifier lacks visual grounding | **Medium** | `validateDone` receives `stateEvidence` (deterministic DOM diff) not a screenshot. Covers DOM-observable changes. Visual-only errors (no DOM change) are a gap -- accepted as unified mode limitation. |
| Phase 1 scope creep | **Medium** | ~100 lines, not 40. Six consumer migration points identified. |

## Verification Plan

1. **Baseline**: Full E2E with current 2-call pipeline, record pass rate + per-turn latency + cost
2. **GPT-5.4-mini unified**: Same suite with `useVLExecutor: true`
3. **Popup regression test**: Specifically test modal-overlays, edge-cases (overlay dismissal)
4. **Plan monitoring regression**: Test multi-step-form, online-shop (plan deviation paths)
5. **Qwen3-VL unified**: Cost comparison run
6. **Provider fallback test**: Force image rejection, verify 2-call fallback fires

## Decision Points

- GPT-5.4-mini unified matches 97.5% pass rate -> ship as default
- Drops to 90-95% -> ship as opt-in, keep 2-call as default
- Qwen3-VL Instruct hits 90%+ -> viable budget mode
- Both drop below 85% -> keep current architecture
