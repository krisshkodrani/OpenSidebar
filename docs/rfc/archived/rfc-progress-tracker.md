# RFC: Progress Tracker — Turn-Level Observability for the Agent Loop

**Status:** DONE — Archived 2026-02-14. Phase 1 fully implemented: snapshot fingerprinting, graduated intervention (nudge at 6, escalate at 12), AGENT_STUCK broadcasts.
**Author:** OpenSidebar team
**Date:** 2026-02-11

## Problem

The agent loop has no concept of progress. It executes tools turn after turn with no ability to detect:
- Actions having no observable effect (clicking decoy buttons)
- Repetitive tool call patterns (click A, click B, click A, click B...)
- Model escalation triggered too late or on wrong signal

**Evidence:** In a 2026-02-11 run, the agent spent 61 turns stuck on `step2?version=3`, clicking decoys. Escalation fired at turn 69 (on text-only nudge) instead of turn ~38 (when actions stopped having effect). The agent falsely called `done()` at turn 93.

## Design: Snapshot Fingerprinting

Track whether DOM-modifying actions produce observable page changes.

### Why not URL-based?

SPAs, forms, dashboards — all legitimate multi-turn work on one URL. URL-only detection would false-positive constantly.

### Why fingerprinting?

A `DomSnapshot` contains `url`, `elements[]` (with `tagName`, `text`, `isVisible`), and `viewportText`. A cheap hash of these fields changes iff the page meaningfully changed. Only computed after DOM-modifying actions (click, type, select, hover, drag, hide), so read-only turns (screenshot, read_page, find_element, scroll) don't count as "stale."

### Fingerprint Function

```ts
function snapshotFingerprint(snap: DomSnapshot): string {
  const elSigs = snap.elements
    .map(e => `${e.tagName}:${e.text.slice(0, 30)}:${e.isVisible ? 1 : 0}`)
    .sort()
    .join("|");
  return `${snap.url}|${snap.elements.length}|${elSigs}`;
}
```

### Graduated Intervention

| Stale turns | Action |
|-------------|--------|
| 1–5 | Silent — building evidence |
| 6 | **Nudge**: inject message telling agent to change strategy |
| 7–11 | Silent |
| 12 | **Escalate**: switch to smarter model + nudge |
| 13–17 | Silent |
| 18+ | **Every 6 turns**: repeat nudge |

### Genericity Table

| Scenario | Fingerprint changes? | Stuck signal? |
|----------|---------------------|---------------|
| Decoy buttons (no DOM effect) | No | Yes — correct |
| Form fill (element text changes) | Yes | No — correct |
| SPA navigation (elements swap) | Yes | No — correct |
| Submit → success message | Yes | No — correct |
| Click real button → modal opens | Yes | No — correct |
| Scroll (new elements visible) | Not triggered (scroll isn't DOM-modifying) | N/A |

## Persistence

`ProgressTracker` state is ephemeral (lives in the `loop()` call). It doesn't need persistence because:
- Service worker restart → `ContextManager.loadState()` restores history, but the loop restarts from turn 0
- Navigation → `NavigationState` handles resume, progress resets naturally
- New task → fresh `AgentLoop.start()` creates new tracker

## Implementation

### Files

| File | Action |
|------|--------|
| `src/background/agent/progress.ts` | NEW — `ProgressTracker` class |
| `src/background/agent/loop.ts` | EDIT — wire tracker + enhanced logging |
| `src/background/agent/context.ts` | EDIT — add `getCurrentUrl()` getter |
| `src/background/agent/index.ts` | EDIT — barrel export |
| `tests/background/progress.test.ts` | NEW — 9 unit tests |

### Enhanced Logging (in loop.ts)

1. **LLM response log**: includes `url: this.context.getCurrentUrl()`
2. **Tool result logs**: `result.slice(0, 300)` (was 120)
3. **DONE tool**: explicit log with `{ turn, url, summary }`
4. **Stuck detection**: `logger.warn("agent", "Progress stuck detected", { turn, type, staleTurns, url })`

### Nudge & Escalation Messages

**Nudge** (injected as user message):
> STUCK DETECTION: Your last several actions had no visible effect on the page. The elements you are interacting with may be decoys or non-functional. Change strategy: take_screenshot, read_page, scroll_page, or look for non-obvious elements.

**Escalate** (injected as user message + model switch):
> STUCK DETECTION: 12+ actions with no page change. Switching to a stronger model. Reassess the entire page — your previous approach failed.

## Testing

9 unit tests in `tests/background/progress.test.ts`:

1. First call returns null (baseline)
2. Changed fingerprint returns null (progress)
3. Nudge at 6 stale turns
4. Silent between thresholds (1–5)
5. Escalation at 12 stale turns
6. Escalation fires only once
7. Continued nudges after escalation (every 6)
8. Text change on same URL = progress
9. `reset()` clears state

## Phase 2: Proposed Enhancements

Phase 1 handles the core detection + intervention loop inside the service worker. Phase 2 extends the tracker to broadcast signals outward and catch subtler patterns.

### 2a — Broadcast `AGENT_STUCK` to Side Panel

Currently, stuck signals (nudge/escalate) are invisible to the user — they only inject messages into the LLM context. Phase 2a adds a new `AGENT_STUCK` runtime message so the side panel can surface the state visually.

```ts
// New RuntimeMessage variant
interface AgentStuckMessage extends BaseMessage {
  type: "AGENT_STUCK";
  source: MessageSource.BACKGROUND;
  payload: {
    signal: "nudge" | "escalate" | "resolved";
    staleTurns: number;
    url: string;
    /** Human-readable explanation */
    message: string;
  };
}
```

**Emit points in `loop.ts`:**
1. When `ProgressTracker.onSnapshotRefresh()` returns a non-null signal → send `AGENT_STUCK` with `signal: "nudge" | "escalate"`
2. When `onSnapshotRefresh()` returns `null` after a prior stuck signal → send `AGENT_STUCK` with `signal: "resolved"`

The side panel rendering of this message is specified in **RFC: Agent UX Feedback** (`StuckBanner` component).

### 2b — Tool-Call Pattern Analysis

Snapshot fingerprinting catches "no page change" stuck loops. But the agent can also get stuck in a **tool-call oscillation** — alternating between two or more actions that each produce slight DOM changes (e.g., toggling a dropdown open/closed).

Detection approach:
1. Maintain a sliding window of the last 8 tool calls (name + args hash)
2. After each tool call, check for a repeating cycle of length 2 or 3 within the window
3. If a cycle repeats ≥ 3 times, emit a `ProgressSignal` of type `"pattern"` (new variant)

```ts
// Extended ProgressSignal
export interface ProgressSignal {
  type: "nudge" | "escalate" | "pattern";
  message: string;
  staleTurns: number;
}
```

The `"pattern"` signal uses a distinct nudge message:
> STUCK DETECTION: You are repeating the same sequence of actions in a loop. Break the cycle — try a completely different approach or use read_page to reassess.

**Priority:** Lower than 2a. Pattern detection adds complexity and may have false positives (legitimate retries). Start with 2a, gather data from logs, then decide if 2b is worth the cost.

## Future Work

- **Per-subtask stuck detection**: Combine with [RFC: Task Decomposition](./rfc-task-decomposition.md) — each `SubtaskRunner` creates its own `ProgressTracker` instance, enabling per-subtask escalation and failure attribution.
- **User-facing stuck UX**: See [RFC: Agent UX Feedback](./rfc-agent-ux-feedback.md) for the `StuckBanner` component, hint injection, and "Skip Step" controls.
- **Heuristic tuning**: The current thresholds (nudge at 6, escalate at 12) are based on one 93-turn stuck run. Collect more data via the log drain and tune.
