# Phase 8a — Error Recovery & Graceful Degradation

> **Goal:** Define error handling behavior for every failure mode in OpenSidebar, including retry logic, user-facing error display, and graceful degradation when optional subsystems are unavailable.

---

## Background

The Phase 8 RFC contains a 17-row error-handling matrix (Module / Error / Severity / Handling). This RFC consolidates that matrix into actionable implementation specs with code patterns, retry strategies, and UI behavior.

The guiding principle matches modern AI assistants: errors appear as inline chat messages (red-tinted), the agent sets `IDLE` or `ERROR` status, and the user can retry by sending a new message. No modal dialogs, no blocking confirmations.

---

## Error Categories

### 1. LLM API Errors

These occur during `LLMClient.complete()` or `LLMClient.completeStream()`.

| HTTP Status                  | Classification                 | Handling                                                                                                   |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 401                          | **Critical** (invalid key)     | Set `ERROR` status. Show inline error: "Invalid API key. Check your settings." No retry.                   |
| 429                          | **Recoverable** (rate limit)   | Wait 2 seconds, retry once. If retry fails, set `ERROR` status with "Rate limited. Try again in a moment." |
| 500, 502, 503                | **Recoverable** (server error) | Wait 1 second, retry once. If retry fails, set `ERROR` with "LLM service unavailable."                     |
| Network error                | **Recoverable**                | Retry once after 1 second. Then error.                                                                     |
| Timeout (no response in 60s) | **Recoverable**                | Abort, retry once. Then error.                                                                             |

#### Implementation Pattern

```typescript
async function callWithRetry<T>(
  fn: () => Promise<T>,
  retries: number = 1,
  delayMs: number = 1000,
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Don't retry auth errors
    if (error.message?.includes("401")) throw error;

    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
}
```

Apply in the agent loop:

```typescript
const response = await callWithRetry(
  () => this.llm.completeStream({ messages, tools }, onTextDelta),
  1, // 1 retry
  1000, // 1 second initial delay
);
```

### 2. Tool Execution Errors

These occur when the content script fails to execute a DOM action.

| Error                             | Classification  | Handling                                                                                                       |
| --------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| Element not found (stale tag)     | **Recoverable** | Return `"Error: No element with tag [N] found. Call read_page to refresh."` as tool result. LLM self-corrects. |
| Content script not loaded         | **Recoverable** | Return `"Error: Page not responding. The content script may not be loaded on this page."` as tool result.      |
| DOM action throws                 | **Recoverable** | Return `"Error: {message}"` as tool result. LLM adapts.                                                        |
| Invalid tool arguments (bad JSON) | **Recoverable** | Return `"Error: Invalid arguments: {parse error}"` as tool result.                                             |
| Unknown tool name                 | **Recoverable** | Return `"Error: Unknown tool '{name}'. Available tools: ..."` as tool result.                                  |

**Key principle:** Tool errors are returned as tool messages, not thrown. The LLM sees the error and self-corrects. This is the standard pattern for function-calling agents.

```typescript
// In toolRegistry.execute():
try {
  const args = JSON.parse(toolCall.function.arguments);
  const result = await handler(args, tabId);
  return result;
} catch (error: any) {
  return `Error: ${error.message}`;
}
```

### 3. Navigation Bridge Errors

| Error                           | Classification  | Handling                                                                                             |
| ------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| Navigation timeout (30s)        | **Critical**    | Clear stored state, set `ERROR` status: "Navigation timed out."                                      |
| Tab closed during navigation    | **Critical**    | Clear stored state, set `ERROR` status: "Tab was closed."                                            |
| `webNavigation.onErrorOccurred` | **Recoverable** | Resume loop with error as tool result: `"Navigation failed: {error}. The page could not be loaded."` |

### 4. Subsystem Degradation

Optional subsystems (memory, swarm, workspaces) can be unavailable without blocking core agent functionality.

| Subsystem                                        | Failure Mode                | Degraded Behavior                                                                                                   |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Memory** — offscreen worker init timeout (15s) | Disable memory tools        | Agent operates without `memory_search`/`memory_add`. If LLM calls them, return `"Memory is currently unavailable."` |
| **Memory** — IndexedDB write fails               | Continue in-memory only     | Log warning. Entries stored in-memory array until next restart.                                                     |
| **Memory** — Embedding model download fails      | Disable memory              | Show one-time warning in chat: "Memory unavailable — embedding model failed to load."                               |
| **Swarm** — OpenRouter API unavailable           | Return error as tool result | `"Deep Thought engine is unavailable. Try again later or browse manually."`                                         |
| **Workspace** — Tab group deleted by user        | Mark workspace as ungrouped | `tabGroupId` set to `null`. Workspace still exists but tabs aren't visually grouped.                                |

#### Degradation Check Pattern

```typescript
// Before executing memory tools:
if (!memoryAvailable) {
  return "Memory is currently unavailable. Proceeding without memory.";
}

// memoryAvailable is set during initialization:
let memoryAvailable = false;
try {
  await initMemoryClient();
  memoryAvailable = true;
} catch (error) {
  logger.warn(
    "memory",
    "Memory initialization failed — operating without memory",
    { error },
  );
}
```

---

## User-Facing Error Display

### Inline Error Messages

Errors are displayed as assistant messages with a distinct visual style:

```typescript
// In the agent loop error handler:
this.messageHandler(
  `Something went wrong: ${error.message}`,
  [], // no tool calls
);
this.statusHandler(AgentStatus.ERROR, error.message);
```

The `MessageBubble` component detects error status and can style accordingly (e.g., red-tinted background). The user retries by sending a new message.

### Status Bar Error State

When `agentStatus === ERROR`:

- Status dot turns red (solid, not pulsing)
- Status detail shows the error message (truncated)
- Input is re-enabled (user can send a new message)

### No Blocking Modals

Following modern AI assistant patterns: errors never block the UI. No confirmation dialogs, no modal popups. The error appears inline, the agent stops, and the user decides what to do next.

---

## Retry Affordance

For recoverable errors that exhaust retries, the error message includes guidance:

```typescript
// Examples of user-facing error messages:
"Rate limited by the API. Please wait a moment and try again.";
"LLM service unavailable. Check your internet connection and try again.";
"Navigation timed out after 30 seconds. The page may be slow to load.";
```

The user's retry mechanism is simply sending a new message. There is no automatic retry button — keeping the UI simple.

---

## Error Logging

All errors are logged via the structured logger:

```typescript
logger.error("agent", "LLM API request failed", {
  status: response.status,
  error: errorText,
  model: payload.model,
  attempt: retryCount,
});
```

Error logs include:

- Module/category (agent, memory, navigation, tools)
- Error message and stack trace (if available)
- Context (which tool, which URL, which tab)
- Retry attempt number

---

## Complete Error-Handling Matrix

Reproduced from Phase 8 RFC with implementation notes:

| #   | Module         | Error                     | Severity    | Handling                          | Retry             |
| --- | -------------- | ------------------------- | ----------- | --------------------------------- | ----------------- |
| 1   | Agent Loop     | LLM API 401               | Critical    | `ERROR` status, "Invalid API key" | No                |
| 2   | Agent Loop     | LLM API 429               | Recoverable | Retry after 2s                    | 1x                |
| 3   | Agent Loop     | LLM API 500+              | Recoverable | Retry after 1s                    | 1x                |
| 4   | Agent Loop     | Invalid JSON in tool args | Recoverable | Error string as tool result       | LLM self-corrects |
| 5   | Agent Loop     | Turn limit exceeded       | Expected    | Send summary, set IDLE            | No                |
| 6   | Agent Loop     | User clicks Stop          | Expected    | Abort loop, set IDLE              | No                |
| 7   | Content Script | Element not found         | Recoverable | Error string as tool result       | LLM self-corrects |
| 8   | Content Script | Not loaded                | Recoverable | "Page not responding"             | No                |
| 9   | Content Script | DOM action throws         | Recoverable | Error string as tool result       | LLM self-corrects |
| 10  | Nav Bridge     | Timeout (30s)             | Critical    | `ERROR` status, clean up          | No                |
| 11  | Nav Bridge     | Tab closed                | Critical    | `ERROR` status, clean up          | No                |
| 12  | Nav Bridge     | webNavigation error       | Recoverable | Error string as tool result       | LLM adapts        |
| 13  | Swarm          | OpenRouter timeout (120s) | Recoverable | Retry once, then error            | 1x                |
| 14  | Swarm          | Empty response            | Recoverable | "No results" as tool result       | No                |
| 15  | Memory         | Worker init timeout       | Degraded    | Disable memory tools              | No                |
| 16  | Memory         | IndexedDB write fails     | Degraded    | Continue in-memory                | No                |
| 17  | Memory         | Embedding model fails     | Degraded    | Disable memory, warn user         | No                |
| 18  | Workspace      | Tab group deleted         | Expected    | Mark as ungrouped                 | No                |
| 19  | Workspace      | Tab closed                | Expected    | Remove from tab list              | No                |
| 20  | Settings       | Storage quota exceeded    | Degraded    | Log error, use defaults           | No                |

---

## Testing

### `tests/background/agent.test.ts` (extend existing)

Add error handling test cases:

1. LLM returns 401 -> agent sets ERROR status, no retry
2. LLM returns 429 -> agent retries once, then errors
3. Tool execution throws -> error string returned as tool result
4. Turn limit reached -> agent sends summary and stops

### Manual Testing

1. Set an invalid API key -> verify error message appears inline
2. Disconnect network during agent loop -> verify graceful error
3. Close tab during navigation -> verify error + cleanup
4. Disable memory worker -> verify agent works without memory tools

---

## Open Questions

None — error handling follows standard patterns and the error matrix is comprehensive.
