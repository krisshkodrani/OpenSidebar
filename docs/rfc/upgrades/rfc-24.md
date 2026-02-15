# RFC-024: Optimistic Execution Pipeline

* **Status:** Deferred (valid but not prioritized)
* **Created:** 2026-02-15
* **Context:** Reduces the critical path latency of the agent loop, aiming to meet the "10 seconds per step" constraint of the 30-step challenge.

## 1. Summary

This RFC proposes two major latency optimizations:

1. **Snapshot Piggybacking:** Merge the "Execute Tool" and "Refresh Snapshot" IPC calls into a single round-trip.
2. **Adaptive Network Waiting:** Replace hardcoded `setTimeout` delays (1-2s) with an event-driven `waitForNetworkIdle` check using the browser's Performance API.

Together, these changes are expected to reduce the time-between-turns (System Latency) from **~3.5s** to **~1.5s**, exclusive of LLM generation time.

## 2. Motivation

The current `AgentLoop` follows a strict serial process:

1. **LLM Generation:** "Click button X"
2. **Action Request:** Send `CLICK_ELEMENT` to content script. (~50ms)
3. **Action Execution:** Content script clicks.
4. **Hard Wait:** `await sleep(1000)` (or more for SPA mode) to ensure page settles. (~1000ms+)
5. **Action Response:** Return "Clicked X". (~50ms)
6. **Snapshot Request:** Send `GET_SNAPSHOT` to content script. (~50ms)
7. **Processing:** Tagging & Extraction. (~200ms)
8. **Snapshot Response:** Return massive JSON. (~100ms)

Total System Overhead: **~1.5s - 2.5s** per turn.

By piggybacking the snapshot onto the action response and using adaptive waits, we can collapse steps 2-8 into a single operation that returns as soon as the network is idle.

## 3. Technical Design

### 3.1 Adaptive Network Idle (`src/content/utils/network-idle.ts`)

Instead of guessing how long a page takes to load, we will monitor resource timing.

```typescript
// New utility: src/content/utils/network-idle.ts

export function waitForNetworkIdle(timeout = 2000, idleWindow = 200): Promise<void> {
  return new Promise((resolve) => {
    let lastActivity = performance.now();
    let timeoutId: number;
    let checkInterval: number;

    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length > 0) {
        lastActivity = performance.now();
      }
    });

    observer.observe({ entryTypes: ['resource', 'fetch', 'xmlhttprequest'] });

    // Polling check for idle window
    checkInterval = setInterval(() => {
      if (performance.now() - lastActivity > idleWindow) {
        cleanup();
        resolve();
      }
    }, 50);

    // Hard timeout fallback
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(); // Resolve anyway, don't error
    }, timeout);

    function cleanup() {
      observer.disconnect();
      clearInterval(checkInterval);
      clearTimeout(timeoutId);
    }
  });
}

```

### 3.2 Tool Execution Protocol Update (`src/content/content.ts`)

We will modify the `EXECUTE_ACTION` message handler to accept a `includeSnapshot: true` flag.

**Current Flow:**

```typescript
// src/content/content.ts (Pseudo-code)
case 'EXECUTE_ACTION':
  result = await execute(action);
  sendResponse(result);

```

**New Flow:**

```typescript
case 'EXECUTE_ACTION':
  // 1. Execute
  const result = await execute(action);
  
  // 2. Adaptive Wait (Block until settled)
  await waitForNetworkIdle(2000); 

  // 3. Optional: Piggyback Snapshot
  if (message.includeSnapshot) {
    const snapshot = await createSnapshot(); // From RFC-023
    sendResponse({ result, snapshot });
  } else {
    sendResponse({ result });
  }

```

### 3.3 Agent Loop Update (`src/background/agent/loop.ts`)

The loop must be updated to handle the combined response.

```typescript
// src/background/agent/loop.ts

// ... inside the loop ...

// 1. Execute Tool with Piggybacking
const actionResponse = await bridge.executeAction(toolCall, { includeSnapshot: true });

// 2. Process Result
this.addToHistory(toolCall, actionResponse.result);

// 3. Process Snapshot (if present)
if (actionResponse.snapshot) {
  this.currentSnapshot = actionResponse.snapshot;
  // Skip the separate 'refreshSnapshot' call
} else {
  // Fallback for tools that don't support piggybacking (e.g., browser native tools)
  this.currentSnapshot = await bridge.getSnapshot();
}

```

## 4. Risks & Trade-offs

* **Premature Snapshots:** `waitForNetworkIdle` might return too early if the site uses a delayed loader (e.g., `setTimeout(1000)` before fetching data).
* *Mitigation:* Keep the default timeout relatively safe (e.g., 2000ms) but allow the idle check to "short-circuit" it if the network is truly dead silent for 500ms.


* **Message Size:** Combining the Action Result and Snapshot into one message might hit Chrome Extension message size limits (usually ~64MB, so unlikely for text, but possible if we include screenshots later).
* *Mitigation:* The snapshot is just text/JSON. It should be fine. Screenshots (base64) should be handled via `chrome.storage.local` if they get too big, not message passing.



## 5. Implementation Plan

1. **Create `src/content/utils/network-idle.ts**`: Implement the `PerformanceObserver` logic.
2. **Update `src/content/content.ts**`: Modify the message listener to wait for idle and call `createSnapshot`.
3. **Update `src/background/agent/loop.ts**`: Refactor the main `while` loop to expect the combined object.
4. **Verify**: Run a test action (click link) and measure the time between "Action Sent" and "Next Prompt Generated". Target < 1.5s.

---

## Deferral Note (2026-02-15)

This RFC is **valid and genuinely useful** for SPA-heavy workflows. Adaptive network idle via `PerformanceObserver` is a better approach than hardcoded `setTimeout` delays, and snapshot piggybacking would reduce IPC round-trips.

**Deferred because**: The current system latency (~100ms SPA wait) is acceptable for the unified agent mode, and the implementation touches several critical paths (content script message handling, agent loop flow). Worth revisiting when latency becomes a bottleneck or when targeting faster step times.