# RFC: Post-Action Verification Layer

## Status
Implementing

## References
- **Study**: "Autonomous Web Agent Reliability: Tree of Thoughts, State-Validation, and Tool-Recovery" (2025 analysis)
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems* (2025), Ch 7.5.3 ("evaluate failure programmatically first"), Ch 10 ("programmatic checks first, LLM second")
- **Book 2**: Antonio Gulli et al., *Agentic AI Design Patterns* (2025), Ch 4 (producer-critic)
- **Internal**: `docs/rfc/rfc-multi-turn-resilience.md` (S1: programmatic verification), `docs/articles/when-to-stop.md`
- **Constants file**: `src/background/agent/constants.ts`

## Context

### The Observability Gap

OpenSidebar's `StagnationMonitor.onSnapshotRefresh()` computes a `signatureDelta()` every turn — the fraction of DOM element signatures that changed since the last snapshot. This delta drives stuck detection: below 10% for several consecutive turns triggers escalation.

But the delta value is *discarded* after the stagnation check. The agent never learns whether its last action had any effect on the page. It must infer this from the next LLM call's perception of the page state — an expensive, latent, and unreliable feedback signal.

The study's Agent-E "Change Observer" pattern and Dibia's "programmatic checks first, LLM second" principle both argue that cheap programmatic verification should precede expensive LLM-based evaluation.

### Three Gaps

**Gap 1 (P0): No action effect signal.** The agent performs `click_element [42]`, the DOM barely changes, but the agent has no immediate feedback. It may try the same click again, or proceed assuming success. The `signatureDelta` already computes the answer — it's just not surfaced.

**Gap 2 (P1a): No pre-action feasibility check.** The agent wastes turns clicking disabled buttons, zero-size elements, or invisible inputs. `validateElementIds()` only checks existence (is the ID in the snapshot?), not interactability (can this element actually be clicked?). The study's VSA (Verification Before Action) pattern catches these before dispatch.

**Gap 3 (P1b): No micro-verification loop.** Macro verification exists: perception's `objectiveCheck`, plan monitor alignment checks. But there's no micro verification — "did THIS specific action succeed?" The study's Dual-Gating Reward pattern uses both levels: micro (did the DOM respond?) and macro (are we making progress toward the goal?).

## Design

### P0: Surface DOM Diff Signal

**Approach**: Compute `ActionEffect` inside `StagnationMonitor.onSnapshotRefresh()` by leveraging the symmetric difference already calculated by `signatureDelta()`. Expose via getter. Format and inject into conversation history in `loop.ts`.

**`ActionEffect` interface** (in `stagnation.ts`):
```typescript
export interface ActionEffect {
  deltaPercent: number;       // 0.0–1.0, fraction of elements that changed
  urlChanged: boolean;
  prevUrl?: string;
  currentUrl: string;
  elementsAdded: number;      // elements in current but not previous
  elementsRemoved: number;    // elements in previous but not current
  prevCount: number;
  currentCount: number;
}
```

**Injection in `loop.ts`** (after `stagnation.onSnapshotRefresh(snap)`):
- If `domModified` flag is set (a DOM-modifying tool was executed this turn):
  - `deltaPercent < 0.02 && !urlChanged` → inject: `"[Action effect: No observable DOM change — page state appears unchanged.]"`
  - Otherwise → inject formatted delta: `"[Action effect: 23% elements changed, URL changed, +4 new, -2 removed]"`
- Record `action_effect` trace event for observability.

**Cost**: Zero runtime overhead — the symmetric diff is already computed. The injection is a single `addMessage()` call (~30 tokens).

### P1a: Pre-Action Feasibility Check

**Approach**: New `preflightElementCheck()` function in `loop.ts`, called after `validateElementIds()` in both sequential and parallel tool dispatch paths. Uses snapshot data only — no DOM access.

**Checks** (for tools in `PREFLIGHT_CHECK_TOOLS` set):
1. `element.isDisabled === true` → hard error: `"Error: Element [N] is disabled and cannot be interacted with. Find an alternative or wait for it to become enabled."`
2. `element.rect.width === 0 && element.rect.height === 0` → hard error: `"Error: Element [N] has zero size (0x0) and cannot be clicked."`
3. `!element.isVisible` → soft warning (non-blocking): `"Warning: Element [N] is not visible in the viewport. Consider scrolling to it first, or it may be hidden."`

**Tool coverage**: `CLICK_ELEMENT`, `TYPE_TEXT`, `HOVER_ELEMENT`, `SELECT_OPTION`, `DRAG_AND_DROP`, `DRAW_STROKE`, `UPLOAD_FILE`, `RIGHT_CLICK`, `SET_CHECKBOX`, `REACT_SET_INPUT`.

### P1b: Dual-Gating (Micro + Macro)

**Approach**: Track `consecutiveZeroEffectTurns` in the loop. When a DOM-modifying tool produces `deltaPercent < 0.02` and no URL change, increment. Reset on any meaningful change.

**Escalation**: At `ACTION_EFFECT.WARNING_THRESHOLD` (3) consecutive zero-effect turns, inject: `"[Verification: Last 3 actions had no observable effect on the page. Your current approach is not working — try a fundamentally different strategy (different element, different tool, or different page area).]"`

**Constants** (in `constants.ts`):
```typescript
export const ACTION_EFFECT = {
  ZERO_THRESHOLD: 0.02,    // Below this delta, action had ~no effect
  WARNING_THRESHOLD: 3,     // Consecutive zero-effect turns before warning
} as const;
```

## Files Changed

| File | Change |
|------|--------|
| `src/background/agent/stagnation.ts` | `ActionEffect` interface, computation in `onSnapshotRefresh()`, `lastActionEffect` getter, clear in `reset()` |
| `src/background/agent/constants.ts` | `ACTION_EFFECT` thresholds |
| `src/background/agent/loop.ts` | `formatActionEffect()`, injection after snapshot refresh, `preflightElementCheck()`, `consecutiveZeroEffectTurns` tracking, dual-gating warning |
| `tests/background/stagnation.test.ts` | `ActionEffect` computation tests |
| `tests/background/loop-verification.test.ts` | `formatActionEffect()` and `preflightElementCheck()` tests |

## Testing

- **ActionEffect computation**: null before first call, correct delta/added/removed on state transitions, URL change detection, cleared by reset()
- **formatActionEffect**: no-change message below threshold, change message with formatted parts, URL change inclusion
- **preflightElementCheck**: disabled → error, zero-size → error, invisible → warning, normal element → null, non-applicable tool → null
- **Dual-gating**: counter increments on zero-effect, resets on change, warning injected at threshold

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Action effect messages clutter context window | Messages are short (~15 tokens), only injected when `domModified` is true |
| Preflight check blocks legitimate interactions with hidden elements | `isVisible` check is a soft warning, not a hard block |
| False positives on "no effect" (e.g., CSS-only changes not captured by element signatures) | Threshold is conservative (2%), and we only count elements — visual-only changes still get perception feedback |
