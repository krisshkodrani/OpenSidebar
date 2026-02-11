# Phase 3a — Streaming Architecture

> **Goal:** Implement end-to-end SSE streaming from the LLM API through the service worker to the side panel UI, enabling real-time token-by-token display of agent responses.

---

## Background

The current `LLMClient.complete()` method uses `response.json()` — it waits for the entire LLM response before returning. The user sees nothing until the full response is ready. This creates a poor UX for long responses and makes the agent feel slow.

The fix is straightforward: enable `stream: true` in the API request, parse the SSE stream in the service worker, and forward text deltas to the side panel via `STREAM_CHUNK` messages. The side panel appends each delta to the current assistant message in real time.

This pattern is identical to how modern AI assistants stream responses.

---

## Design

### Data Flow

```
LLM API (SSE response)
    │
    ▼
parseSSEStream()              ← src/background/streaming.ts (NEW)
    │
    ├─ text delta ──────────► chrome.runtime.sendMessage({ type: "STREAM_CHUNK" })
    │                              │
    │                              ▼
    │                         bridge.ts listener → useStore().appendStreamDelta()
    │                              │
    │                              ▼
    │                         React re-render (token-by-token)
    │
    └─ tool_call delta ─────► accumulate in partialToolCalls Map
                                   │
                                   ▼ (on stream end)
                              return AssistantMessage { content, tool_calls }
```

### Files

| File                           | Change                                                   |
| ------------------------------ | -------------------------------------------------------- |
| `src/background/streaming.ts`  | **NEW** — SSE parser                                     |
| `src/background/llm/client.ts` | Add `completeStream()` method                            |
| `src/background/agent/loop.ts` | Switch from `llm.complete()` to `llm.completeStream()`   |
| `src/sidepanel/bridge.ts`      | Add `STREAM_CHUNK` handler                               |
| `src/sidepanel/store.ts`       | Add `appendStreamDelta()` and `finalizeStream()` actions |

---

## Implementation Details

### `src/background/streaming.ts`

```typescript
import { AssistantMessage, ToolCall, ToolName, MessageSource } from "../types";

/**
 * Parses an SSE stream from an OpenAI-compatible API.
 * Accumulates tool calls and text content.
 * Calls onTextDelta for each text chunk (for streaming to UI).
 */
export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void,
): Promise<AssistantMessage> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let content = "";
  const partialToolCalls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Keep incomplete last line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue; // Malformed JSON chunk — skip
      }

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      // Text content
      if (delta.content) {
        content += delta.content;
        onTextDelta(delta.content);
      }

      // Tool calls (accumulated across chunks)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!partialToolCalls.has(idx)) {
            partialToolCalls.set(idx, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: "",
            });
          }
          const partial = partialToolCalls.get(idx)!;
          if (tc.id) partial.id = tc.id;
          if (tc.function?.name) partial.name = tc.function.name;
          if (tc.function?.arguments)
            partial.arguments += tc.function.arguments;
        }
      }
    }
  }

  // Finalize tool calls
  const toolCalls: ToolCall[] = [];
  for (const [, partial] of partialToolCalls) {
    toolCalls.push({
      id: partial.id,
      type: "function",
      function: {
        name: partial.name as ToolName,
        arguments: partial.arguments,
      },
    });
  }

  return {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
```

### `src/background/llm/client.ts` — New `completeStream()` Method

Add alongside the existing `complete()` method:

```typescript
async completeStream(
  request: CompletionRequest,
  onTextDelta: (delta: string) => void
): Promise<CompletionResponse> {
  if (!this.apiKey) {
    throw new Error("LLM API Key is missing. Please configure it in settings.");
  }

  const payload = {
    model: request.model || this.model,
    messages: request.messages,
    tools: request.tools,
    temperature: request.temperature ?? 0.0,
    max_tokens: request.max_tokens,
    stop: request.stop,
    stream: true, // Enable streaming
  };

  const response = await fetch(this.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      ...(this.provider === "openrouter" ? {
        "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
        "X-Title": "QSidebar"
      } : {})
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API Error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body for streaming request");
  }

  const result = await parseSSEStream(response.body, onTextDelta);

  return {
    role: "assistant",
    content: result.content,
    tool_calls: result.tool_calls,
    finish_reason: result.tool_calls ? "tool_calls" : "stop",
    usage: undefined, // Usage not available in streaming mode
  };
}
```

### Agent Loop Integration

In `src/background/agent/loop.ts`, replace the `llm.complete()` call:

```typescript
// Before (non-streaming):
const response = await this.llm.complete({
  messages,
  tools,
  stop: ["Observation:"],
});

// After (streaming):
const response = await this.llm.completeStream(
  { messages, tools, stop: ["Observation:"] },
  (delta) => {
    chrome.runtime.sendMessage({
      type: "STREAM_CHUNK",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { delta, done: false },
    });
  },
);

// Signal stream end
chrome.runtime.sendMessage({
  type: "STREAM_CHUNK",
  requestId: crypto.randomUUID(),
  source: MessageSource.BACKGROUND,
  payload: { delta: "", done: true },
});
```

### Side Panel Store — New Actions

In `src/sidepanel/store.ts`:

```typescript
// Add to Actions interface:
appendStreamDelta: (delta: string) => void;
finalizeStream: () => void;

// Add to store implementation:
appendStreamDelta: (delta) =>
  set((state) => {
    const last = state.messages[state.messages.length - 1];
    if (last?.role === "assistant" && last.isStreaming) {
      last.content += delta;
    }
  }),

finalizeStream: () =>
  set((state) => {
    const last = state.messages[state.messages.length - 1];
    if (last?.role === "assistant" && last.isStreaming) {
      last.isStreaming = false;
    }
  }),
```

### Side Panel Bridge — STREAM_CHUNK Handler

In `src/sidepanel/bridge.ts` (or the message listener in `App.tsx`):

```typescript
case "STREAM_CHUNK": {
  const { delta, done } = message.payload;
  if (done) {
    useStore.getState().finalizeStream();
  } else {
    useStore.getState().appendStreamDelta(delta);
  }
  break;
}
```

---

## Streaming Message Lifecycle

1. User sends message -> `handleSend()` adds user message + placeholder assistant message (`isStreaming: true`, `content: ""`)
2. Background sends `AGENT_STATUS: THINKING`
3. LLM starts responding -> `STREAM_CHUNK` messages arrive with `delta` text
4. Store appends each delta to the last assistant message's content
5. React re-renders the `MessageBubble` with streaming cursor (pulsing block)
6. Final `STREAM_CHUNK` with `done: true` -> `finalizeStream()` sets `isStreaming: false`
7. If tool calls follow, the loop continues; otherwise `AGENT_STATUS: IDLE`

---

## Edge Cases

| Scenario                            | Handling                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Stream interrupted mid-token        | `parseSSEStream` returns whatever was accumulated. Partial content is still displayed.       |
| User clicks Stop during stream      | `AbortController.abort()` terminates the fetch. Partial content remains visible.             |
| Tool call split across many chunks  | `partialToolCalls` Map accumulates `function.arguments` string across chunks until `[DONE]`. |
| Empty stream (LLM returns nothing)  | `content` will be `null`, no tool calls. Loop handles this as a final empty response.        |
| Network error during stream         | Fetch throws, caught by agent loop error handler. Partial content lost.                      |
| `[DONE]` sentinel missing           | Reader hits `done: true` naturally. Same result — stream ends.                               |
| Multiple tool calls in one response | Each tool call has a unique `index`. The Map tracks them independently.                      |

---

## Testing

### `tests/background/streaming.test.ts`

Test the SSE parser with mock `ReadableStream`s:

1. **Text-only response** — verify content accumulation and delta callbacks
2. **Tool call response** — verify `tool_calls` array construction from chunked deltas
3. **Split lines across chunks** — verify buffer handling when SSE lines span chunk boundaries
4. **Mixed content + tool calls** — verify both are accumulated correctly
5. **Empty stream** — verify graceful handling

See Phase 8 RFC for exact test code.

---

## Open Questions

None — the SSE format is standardized (OpenAI-compatible) and both Cerebras and OpenRouter support it.
