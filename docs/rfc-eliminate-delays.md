# RFC: Eliminate Idle Delays — Do Useful Work Instead of Sleeping

## Problem

The agent loop burns **100-800ms of dead time per turn** on `setTimeout` delays scattered across tools, navigation, and snapshot logic. These waits exist to let SPAs render, content scripts initialize, or DOM settle — but the agent does **nothing** during them. Over a 20-turn session, that's 2-16 seconds of wasted wall time.

Delays are especially harmful because they compound: a turn with `type_text` → 100ms SPA wait → snapshot → modal dismiss → 50ms settle → another snapshot is already 150ms+ of pure sleep. Multiply across every DOM-modifying turn.

## Inventory of All Delays

### Hot Path (every DOM-modifying turn)

| Location | Duration | Purpose |
|----------|----------|---------|
| `loop.ts:2474` | 100ms | SPA wait after DOM-modifying tool, before snapshot |
| `loop.ts:2489-2508` | 300ms + 500ms | Retry delays when snapshot returns 0 elements (empty-page recovery) |
| `content.ts:402` | 50ms | DOM settle after overlay auto-dismiss during snapshot |

**Per-turn cost**: 100ms minimum, up to 950ms on retry paths.

### Cold Path (navigation, init, error recovery)

| Location | Duration | Purpose |
|----------|----------|---------|
| `navigation.ts:190` | 500ms | Wait for content script after cross-page navigation |
| `tools/index.ts:1432` | 100ms | Wait for content script after `navigate` tool |
| `tools/index.ts:1620` | 100ms | Wait for content script after `go_back` |
| `tools/index.ts:1635` | 100ms | Wait for content script after `go_forward` |
| `background.ts:588` | 100ms | Wait for content script after injection during nav resume |
| `tools/screenshot.ts:30` | 100ms | Wait for tag overlays to render before capture |
| `loop.ts:877` | 300ms | Snapshot retry after escalation (once per escalation) |
| `vision.ts:65` | 800-1600ms | Exponential backoff on vision API failure |
| `llm/client.ts:406` | 1000-4000ms | Exponential backoff on LLM API failure |

### Analysis

Two root causes account for ~80% of delays:

1. **"Is the DOM ready?"** — We sleep and hope. No feedback signal.
2. **"Is the content script alive?"** — We sleep and hope. No handshake.

## Proposed Solutions

### Strategy 1: Replace Sleep-Then-Check with Poll-Until-Ready

Instead of `sleep(100ms)` → `getSnapshot()`, send a **readiness probe** that the content script answers only when the DOM has settled.

```
Background                    Content Script
    |                              |
    |-- DOM_READY_PROBE ---------->|
    |                              |-- starts MutationObserver
    |                              |-- waits for 2 idle frames (no mutations)
    |                              |-- or 50ms hard cap, whichever first
    |<--- DOM_READY_ACK -----------|
    |                              |
    |-- DOM_SNAPSHOT_REQUEST ----->|
```

**Benefit**: On fast pages (most pages), DOM settles in 1-2 frames (16-32ms). On slow SPAs, we wait only as long as needed (up to 50ms cap). The 100ms fixed delay drops to ~20ms average.

**Implementation**: Add `DOM_READY_PROBE` / `DOM_READY_ACK` to `RuntimeMessage`. Content script uses `MutationObserver` + `requestAnimationFrame` to detect quiescence. Hard cap prevents infinite wait.

### Strategy 2: Overlap Delays with Useful Work (Tool Combos)

When the loop must wait (e.g., after navigation), do useful work concurrently instead of sleeping:

**After DOM-modifying tools (current: sleep 100ms → snapshot):**
```ts
// BEFORE: serial, 100ms wasted
await sleep(100);
const snap = await getSnapshot(tabId);

// AFTER: overlap — start thinking while DOM settles
const [snap, _] = await Promise.all([
  getSnapshotWithReadinessProbe(tabId),  // waits for DOM internally
  this.precomputeNextTurnContext(),       // compress history, prune old messages
]);
```

**After navigation (current: sleep 500ms → resume):**
```ts
// BEFORE: 500ms dead wait
await sleep(500);
const snap = await getSnapshot(tabId);

// AFTER: poll content script readiness + do work
const [snap, _] = await Promise.all([
  pollContentScriptReady(tabId, { timeout: 2000 }),  // exponential probe: 50, 100, 200ms
  this.context.compressHistory(),                      // useful work during wait
]);
```

### Strategy 3: Content Script Ready Signal (eliminates init waits)

Instead of 5 locations guessing "is the content script alive yet?", have the content script **announce itself**:

```ts
// content.ts — on initialization
chrome.runtime.sendMessage({
  type: "CONTENT_SCRIPT_READY",
  source: MessageSource.CONTENT,
  payload: { tabId },
});
```

Background maintains a `Set<number>` of ready tab IDs. Navigation/tool code checks the set instead of sleeping:

```ts
// BEFORE: sleep and hope
await sleep(100);

// AFTER: wait for signal (with timeout)
await waitForContentScriptReady(tabId, { timeout: 2000 });
```

This eliminates **all 5 content-script-init delays** (navigation.ts:190, tools/index.ts:1432/1620/1635, background.ts:588).

### Strategy 4: Merge Snapshot + Dismiss into Atomic Operation

Currently: auto-dismiss overlays → sleep 50ms → build snapshot → scan survivors.
Three serial steps. Instead, make it one:

```ts
// content.ts — DOM_SNAPSHOT_REQUEST handler
// Already dismissed overlays inline. Skip the 50ms sleep.
// The snapshot itself re-queries the DOM — mutations from dismiss
// are synchronous (display:none, click). No async render needed.
```

The 50ms sleep after `autoDismissModals()` is likely unnecessary — `display: none` and `.click()` are synchronous DOM mutations. The snapshot builder reads the DOM synchronously after. Remove it and verify no regression.

### Strategy 5: Speculative Snapshot Pipeline

Start the snapshot request **before** tools finish when we know a DOM-modifying tool is running:

```
Turn N:  LLM response → tool_1 (click) → tool_2 (type) → [wait] → snapshot → Turn N+1
Proposed: LLM response → tool_1 (click) → tool_2 (type) → snapshot(speculative) → Turn N+1
                                                              ↑ started immediately,
                                                                content script waits for idle internally
```

The content script's snapshot handler already does overlay dismissal. Adding a readiness probe inside it means the snapshot request itself becomes the "wait" — no separate sleep needed.

### Strategy 6: Eliminate Empty-Page Retry Cascade

The 300ms + 500ms retry loop (loop.ts:2489) fires when snapshot returns 0 elements after a DOM action. This is the "SPA hasn't rendered yet" case. Replace with:

```ts
// Instead of: sleep(300) → retry → sleep(500) → retry
// Use: single snapshot request with built-in DOM readiness wait
const snap = await getSnapshot(tabId, { waitForElements: true, timeout: 800 });
```

Content script: if `waitForElements` is set and elements are 0, use MutationObserver to wait for first child insertion, then snapshot. Cap at timeout. This collapses 800ms of serial sleeps into a single responsive wait.

## Priority & Impact

| Strategy | Impact | Effort | Avg Time Saved/Turn |
|----------|--------|--------|---------------------|
| S4: Remove 50ms dismiss sleep | High | Trivial | 50ms (every snapshot with overlays) |
| S3: Content script ready signal | High | Low | 100-500ms (navigation turns) |
| S1: DOM readiness probe | High | Medium | 60-80ms (every DOM-modifying turn) |
| S6: Smart empty-page retry | Medium | Medium | 300-800ms (SPA transitions) |
| S2: Overlap with useful work | Medium | Medium | 100ms (every DOM turn) |
| S5: Speculative snapshot | Low | High | 50-100ms (architectural change) |

## Recommended Implementation Order

**Phase 1 — Quick Wins (1 session)**
1. Remove the 50ms dismiss sleep (S4) — verify synchronous mutations don't need it
2. Content script ready signal (S3) — eliminate all init waits
3. Replace 100ms SPA wait with readiness probe (S1 lite) — `requestAnimationFrame` × 2 instead of `setTimeout(100)`

**Phase 2 — Structural (1-2 sessions)**
4. Full DOM readiness probe with MutationObserver (S1)
5. Smart empty-page retry (S6)
6. Overlap delays with history compression (S2)

**Phase 3 — Optimistic Pipeline**
7. Speculative snapshot (S5) — only if profiling shows it's worth the complexity

## Non-Goals

- **Error recovery delays** (LLM backoff, vision retry): These are correct. Don't touch exponential backoff for API failures.
- **Keepalive alarm**: Infrastructure, not a delay.
- **Memory/workspace timeouts**: Error handling, not hot path.

## Metrics

Track before/after:
- **Avg turn latency** (LLM time excluded) — target: cut non-LLM time by 40%
- **Snapshot acquisition time** — target: p50 < 30ms, p99 < 100ms
- **Navigation resume time** — target: < 200ms (from 600ms+)
