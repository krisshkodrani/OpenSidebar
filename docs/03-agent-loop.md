# Phase 3 — Agent Loop (Reflex Engine)

> **Goal:** Implement the core agent loop in the service worker: receive user messages, call Cerebras GPT-OSS-120b, parse tool calls, route them to the content script, feed results back, stream text to the side panel, and manage the sliding window context.

---

## Background

The agent loop is the brain of QSidebar. It runs in the service worker (`src/background/background.ts`) and orchestrates the Think → Act → Observe cycle. It uses the Cerebras API (OpenAI-compatible) with function calling to decide what to do next.

**Key constraint:** Service workers are ephemeral — Chrome terminates them after ~30 seconds of inactivity. The keepalive strategy and Navigation Bridge (Phase 4) address this.

---

## Design

### Files

| File | Responsibility |
|---|---|
| `src/background/background.ts` | Entry point, message listener, agent loop orchestration |
| `src/background/tools.ts` | Tool definitions (JSON schema), system prompt |
| `src/background/context.ts` | Sliding window context management |
| `src/background/streaming.ts` | SSE parser for Cerebras streaming responses |
| `src/background/security.ts` | Risk classification, input sanitization |

---

## System Prompt

The full system prompt sent as the first message in every conversation:

```typescript
export const SYSTEM_PROMPT = `You are QSidebar, a browser agent that helps users interact with web pages.

You can see the current page through a distilled DOM snapshot showing interactive elements tagged with numeric IDs like [1], [2], etc.

## Capabilities
- Click any tagged element using click_element
- Type text into input fields using type_text
- Scroll the page using scroll_page
- Read the full page content using read_page
- Navigate to URLs using navigate
- Open, close, and switch tabs
- Search and store information in your memory
- Delegate complex research tasks to the Deep Thought engine using activate_swarm

## Rules
1. ALWAYS call read_page first to understand the current page before taking any action.
2. When clicking or typing, use the exact numeric tag ID from the DOM snapshot.
3. After each action, call read_page again to see the updated page state.
4. If a page is loading, use wait(ms=2000) and then read_page.
5. When you have completed the user's task, call done with a summary.
6. Never fabricate element IDs — only use IDs from the most recent read_page result.
7. For complex multi-step research tasks, use activate_swarm instead of manual browsing.
8. Keep your text responses concise — the user sees your actions in the status bar.

## Context
You receive the current page state automatically. Interactive elements are shown as:
  [tag] <tagName attributes> "visible text"

To interact, use the tag number. Example: to click a button labeled "Search" with tag [5], call click_element(id=5).

## Vision
You can also see a screenshot of the current viewport by calling take_screenshot(). Use this when the DOM is confusing or visual layout is important.`;
```

---

## Tool Definitions

Full JSON schema for every tool passed to the LLM:

```typescript
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click an interactive element on the page by its tag number.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "The numeric tag ID of the element to click (e.g., 5 for [5])" }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text into an input field identified by its tag number.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "The numeric tag ID of the input element" },
          text: { type: "string", description: "The text to type" },
          pressEnter: { type: "boolean", description: "Whether to press Enter after typing. Default: false" }
        },
        required: ["id", "text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll_page",
      description: "Scroll the page up or down.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
          amount: { type: "integer", description: "Pixels to scroll. Default: 500" }
        },
        required: ["direction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description: "Read the current page content and get a fresh list of interactive elements. Call this before any action and after any page change.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the current tab to a URL. The page will reload and you must wait for it to load before taking further actions.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full URL to navigate to (must include https://)" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "activate_swarm",
      description: "Delegate a complex research or analysis task to the Deep Thought engine (Kimi k2.5). Use this for tasks that require browsing multiple pages, synthesizing information, or deep analysis. The swarm will work independently and return a comprehensive report.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Detailed description of the research task" },
          urls: { type: "array", items: { type: "string" }, description: "Optional: specific URLs to include as context" }
        },
        required: ["task"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "memory_search",
      description: "Search your memory for previously stored information. Uses semantic + keyword hybrid search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          limit: { type: "integer", description: "Max results to return. Default: 5" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "memory_add",
      description: "Store information in your memory for future reference.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The information to remember" },
          category: { type: "string", description: "Category tag (e.g., 'user_preference', 'research', 'note')" }
        },
        required: ["content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_tab",
      description: "Open a new browser tab with a URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to open" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "close_tab",
      description: "Close a browser tab.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "integer", description: "Tab ID to close. Omit to close the current tab." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "switch_tab",
      description: "Switch focus to a different browser tab.",
      parameters: {
        type: "object",
        properties: {
          tabId: { type: "integer", description: "Tab ID to switch to" }
        },
        required: ["tabId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a specified duration. Use after navigation or when waiting for content to load.",
      parameters: {
        type: "object",
        properties: {
          ms: { type: "integer", description: "Milliseconds to wait (max 5000)" }
        },
        required: ["ms"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "done",
      description: "Signal that you have completed the user's task. Always provide a summary of what was accomplished.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Summary of what was accomplished" }
        },
        required: ["summary"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "take_screenshot",
      description: "Capture a screenshot of the current visible viewport. Useful for understanding layout, charts, or visual elements not clear in the DOM.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "hover_element",
      description: "Hover over an element to reveal hidden menus or tooltips.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer", description: "The numeric tag ID of the element to hover" }
        },
        required: ["id"]
      }
    }
  }
];
```

---

## Agent Loop Pseudocode

```typescript
async function runAgentLoop(userMessage: string, tabId: number, workspaceId: string | null): Promise<void> {
  // 1. Initialize state
  const state: AgentLoopState = {
    status: AgentStatus.IDLE,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    originalQuery: userMessage,
    turnCount: 0,
    maxTurns: settings.maxTurns,
    activeTabId: tabId,
    workspaceId,
    lastActivityTs: Date.now(),
    pendingToolCall: null,
  };

  // 2. Broadcast THINKING status
  broadcastStatus(AgentStatus.THINKING, "Processing your request...");

  // 3. Main loop
  let keepGoing = true;
  while (keepGoing && state.turnCount < state.maxTurns) {
    state.turnCount++;
    state.lastActivityTs = Date.now();

    // 3a. Apply sliding window to stay within context limits
    state.messages = applySlidingWindow(state.messages);

    // 3b. Call Cerebras API (streaming)
    broadcastStatus(AgentStatus.THINKING, `Turn ${state.turnCount}/${state.maxTurns}`);
    let response: AssistantMessage;
    try {
      response = await callCerebras(state.messages);
    } catch (err) {
      broadcastStatus(AgentStatus.ERROR, `LLM error: ${(err as Error).message}`);
      return;
    }

    // 3c. Append assistant message to history
    state.messages.push(response);

    // 3d. If no tool calls, this is a text-only response — send to UI and continue
    if (!response.tool_calls || response.tool_calls.length === 0) {
      broadcastAgentResponse(response.content ?? "", false, []);
      keepGoing = false;
      break;
    }

    // 3e. Process each tool call sequentially
    const toolSummaries: ToolCallSummary[] = [];
    for (const toolCall of response.tool_calls) {
      const toolName = toolCall.function.name as ToolName;
      const args = JSON.parse(toolCall.function.arguments);

      // 3e-i. Classify risk
      const riskLevel = classifyRisk(toolName, args);
 
      // 3e-ii. Handle special tools
      if (toolName === ToolName.TAKE_SCREENSHOT) {
         const screenshotUrl = await chrome.tabs.captureVisibleTab(state.activeTabId, { format: "jpeg", quality: 60 });
         // In a real multimodal model, we'd send the image. For now, we simulate vision or store it.
         // Assuming we might pass it to a vision-capable model later or just log it.
         state.messages.push({ 
             role: "user", // Or "tool" with image content if supported
             content: [
                 { type: "text", text: "Here is the screenshot." },
                 { type: "image_url", image_url: { url: screenshotUrl } }
             ] 
         } as any); 
         toolSummaries.push({ toolName, args, result: "Screenshot captured", riskLevel, durationMs: 100 });
         continue;
      }


      // 3e-ii. Handle special tools (done, activate_swarm, memory, tab management)
      if (toolName === ToolName.DONE) {
        broadcastAgentResponse(args.summary, false, toolSummaries);
        keepGoing = false;
        break;
      }

      if (toolName === ToolName.ACTIVATE_SWARM) {
        broadcastStatus(AgentStatus.WAITING_FOR_SWARM, "Deep Thought engine working...");
        const report = await callKimiSwarm(args);
        state.messages.push({ role: "tool", tool_call_id: toolCall.id, content: report });
        toolSummaries.push({ toolName, args, result: report.slice(0, 200), riskLevel, durationMs: 0 });
        continue;
      }

      if (toolName === ToolName.MEMORY_SEARCH || toolName === ToolName.MEMORY_ADD) {
        const result = await executeMemoryTool(toolName, args);
        state.messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        toolSummaries.push({ toolName, args, result: result.slice(0, 200), riskLevel, durationMs: 0 });
        continue;
      }

      if (toolName === ToolName.CREATE_TAB || toolName === ToolName.CLOSE_TAB || toolName === ToolName.SWITCH_TAB) {
        const result = await executeTabTool(toolName, args, state);
        state.messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        toolSummaries.push({ toolName, args, result, riskLevel, durationMs: 0 });
        continue;
      }

      if (toolName === ToolName.WAIT) {
        const ms = Math.min(args.ms ?? 2000, 5000);
        await new Promise(resolve => setTimeout(resolve, ms));
        state.messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Waited ${ms}ms` });
        toolSummaries.push({ toolName, args, result: `Waited ${ms}ms`, riskLevel, durationMs: ms });
        continue;
      }

      if (toolName === ToolName.NAVIGATE) {
        // Navigation Bridge — save state and wait for page load
        broadcastStatus(AgentStatus.ACTING, `Navigating to ${args.url}`);
        await chrome.tabs.update(state.activeTabId, { url: args.url });

        state.status = AgentStatus.WAITING_FOR_PAGE_LOAD;
        state.pendingToolCall = {
          toolCallId: toolCall.id,
          toolName,
          args,
          expectedUrl: args.url,
        };
        await saveNavigationState(state);
        broadcastStatus(AgentStatus.WAITING_FOR_PAGE_LOAD, `Loading ${args.url}`);
        return; // Exit loop — Navigation Bridge will resume
      }

      // 3e-iii. DOM tools — send to content script
      broadcastStatus(AgentStatus.ACTING, `${toolName}(${JSON.stringify(args)})`);
      const start = performance.now();
      let result: ToolResultMessage["payload"];
      try {
        result = await chrome.tabs.sendMessage(state.activeTabId, {
          type: "TOOL_EXECUTE",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: { toolName, args, toolCallId: toolCall.id },
        });
      } catch (err) {
        result = {
          toolCallId: toolCall.id,
          success: false,
          result: `Content script error: ${(err as Error).message}`,
          navigated: false,
        };
      }
      const durationMs = Math.round(performance.now() - start);

      state.messages.push({ role: "tool", tool_call_id: toolCall.id, content: result.result });
      toolSummaries.push({ toolName, args, result: result.result, riskLevel, durationMs });

      // 3e-iv. If the action triggered navigation, engage Navigation Bridge
      if (result.navigated) {
        state.status = AgentStatus.WAITING_FOR_PAGE_LOAD;
        state.pendingToolCall = {
          toolCallId: toolCall.id,
          toolName,
          args,
          expectedUrl: null,
        };
        await saveNavigationState(state);
        broadcastStatus(AgentStatus.WAITING_FOR_PAGE_LOAD, "Page is loading...");
        return; // Exit loop — Navigation Bridge will resume
      }
    }

    // 3f. Broadcast tool summaries to UI
    if (toolSummaries.length > 0 && keepGoing) {
      broadcastAgentResponse("", true, toolSummaries);
    }
  }

  // 4. Turn limit reached
  if (state.turnCount >= state.maxTurns && keepGoing) {
    broadcastAgentResponse(
      `Reached maximum turns (${state.maxTurns}). Stopping. Here's what I accomplished so far.`,
      false,
      []
    );
  }

  // 5. Clean up
  broadcastStatus(AgentStatus.IDLE, "");
}
```

---

## Cerebras API Client

```typescript
const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

async function callCerebras(messages: ChatMessage[]): Promise<AssistantMessage> {
  const apiKey = await getApiKey("cerebras");

  const response = await fetch(CEREBRAS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-oss-120b",
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cerebras API error ${response.status}: ${body}`);
  }

  // Parse SSE stream
  return parseSSEStream(response.body!, (delta) => {
    // Forward each text chunk to the side panel
    chrome.runtime.sendMessage({
      type: "STREAM_CHUNK",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { delta, done: false },
    });
  });
}
```

---

## SSE Stream Parser (`streaming.ts`)

```typescript
/**
 * Parses an SSE stream from an OpenAI-compatible API.
 * Accumulates tool calls and text content.
 * Calls onTextDelta for each text chunk (for streaming to UI).
 */
export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void
): Promise<AssistantMessage> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let content = "";
  const toolCalls: ToolCall[] = [];
  // Track partial tool call accumulation
  const partialToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

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
        continue;
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
          if (tc.function?.arguments) partial.arguments += tc.function.arguments;
        }
      }
    }
  }

  // Finalize tool calls
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

  // Signal stream end to UI
  onTextDelta("");
  chrome.runtime.sendMessage({
    type: "STREAM_CHUNK",
    requestId: crypto.randomUUID(),
    source: MessageSource.BACKGROUND,
    payload: { delta: "", done: true },
  });

  return {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
```

---

## Sliding Window Context Management (`context.ts`)

### Algorithm

The sliding window keeps the conversation history within the LLM's context limit by dropping old messages while preserving critical ones.

```typescript
import { DEFAULT_SLIDING_WINDOW_CONFIG, type ChatMessage, type SlidingWindowConfig } from "../types";

/**
 * Estimates token count for a message.
 * Uses the ~4 chars per token heuristic (accurate enough for context management).
 */
function estimateTokens(message: ChatMessage): number {
  let text = "";
  if (typeof message.content === "string") {
    text = message.content;
  }
  if ("tool_calls" in message && message.tool_calls) {
    text += JSON.stringify(message.tool_calls);
  }
  return Math.ceil(text.length / 4);
}

/**
 * Applies the sliding window to a message array.
 *
 * Strategy:
 * 1. Always keep the system message (index 0).
 * 2. Always keep the Original User Query (index 1) to prevent "Goal Amnesia".
 * 3. Always keep the N most recent messages.
 * 4. Drop the oldest non-protected messages until under budget.
 * 5. If still over budget, truncate the system message.
 */
export function applySlidingWindow(
  messages: ChatMessage[],
  config: SlidingWindowConfig = DEFAULT_SLIDING_WINDOW_CONFIG
): ChatMessage[] {
  // Calculate total tokens
  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);

  if (totalTokens <= config.maxTokens) {
    return messages; // No trimming needed
  }

  const result = [...messages];

  // Identify protected indices
  const systemIdx = 0; // System prompt is always 0
  const goalIdx = 1;   // Original user query is always 1 (if it exists)
  const recentStartIdx = Math.max(
    goalIdx + 1,
    result.length - config.preserveRecentCount
  );
 
  // Drop messages from the middle (oldest first), skipping protected indices
  let i = goalIdx + 1;
  while (totalTokens > config.maxTokens && i < recentStartIdx) {
    totalTokens -= estimateTokens(result[i]);
    result.splice(i, 1);
    // Recalculate recentStartIdx as array length has changed
    const newRecentStart = Math.max(
      systemIdx + 1,
      result.length - config.preserveRecentCount
    );
    if (i >= newRecentStart) break;
  }

  return result;
}
```

---

## Security Module (`security.ts`)

```typescript
/**
 * Classifies the risk level of a tool invocation.
 */
export function classifyRisk(toolName: ToolName, args: Record<string, unknown>): RiskLevel {
  switch (toolName) {
    case ToolName.READ_PAGE:
    case ToolName.SCROLL_PAGE:
    case ToolName.MEMORY_SEARCH:
    case ToolName.WAIT:
    case ToolName.TAKE_SCREENSHOT:
    case ToolName.HOVER_ELEMENT:
      return RiskLevel.LOW;

    case ToolName.CLICK_ELEMENT:
    case ToolName.TYPE_TEXT:
    case ToolName.MEMORY_ADD:
    case ToolName.SWITCH_TAB:
      return RiskLevel.MEDIUM;

    case ToolName.NAVIGATE:
    case ToolName.CREATE_TAB:
    case ToolName.CLOSE_TAB:
    case ToolName.ACTIVATE_SWARM:
    case ToolName.DONE:
      return RiskLevel.HIGH;

    default:
      return RiskLevel.HIGH;
  }
}

/**
 * Sanitizes user input before sending to the LLM.
 * Prevents prompt injection via basic heuristics.
 */
export function sanitizeUserInput(text: string): string {
  // Remove null bytes
  let sanitized = text.replace(/\0/g, "");

  // Truncate to reasonable length
  sanitized = sanitized.slice(0, 10_000);

  return sanitized;
}

/**
 * Sanitizes URLs before navigation.
 */
export function sanitizeUrl(url: string): Result<string> {
  try {
    const parsed = new URL(url);
    // Block dangerous protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, error: `Blocked protocol: ${parsed.protocol}` };
    }
    return { ok: true, value: parsed.href };
  } catch {
    return { ok: false, error: `Invalid URL: ${url}` };
  }
}
```

---

## Service Worker Keepalive Strategy

Chrome terminates service workers after ~30 seconds of inactivity. During long agent loops, we maintain a keepalive alarm:

```typescript
const KEEPALIVE_ALARM = "qsidebar-keepalive";

function startKeepalive(): void {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // ~24 seconds
}

function stopKeepalive(): void {
  chrome.alarms.clear(KEEPALIVE_ALARM);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // No-op — just waking the service worker
  }
});
```

**Note:** The alarm fires every ~24 seconds, which is safely under Chrome's 30-second idle timeout. The minimum `periodInMinutes` for `chrome.alarms` is 0.5 minutes (30 seconds) in production, but during development it can be lower. For production, we use `chrome.alarms.create(name, { delayInMinutes: 0.4 })` and re-create it in the handler.

---

## Message Listener (Entry Point)

```typescript
// Main message handler in background.ts
chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === "USER_CHAT") {
    const { text, tabId, workspaceId } = message.payload;
    const sanitized = sanitizeUserInput(text);

    startKeepalive();
    runAgentLoop(sanitized, tabId, workspaceId)
      .catch((err) => {
        broadcastStatus(AgentStatus.ERROR, (err as Error).message);
      })
      .finally(() => {
        stopKeepalive();
      });

    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "STOP_AGENT") {
    // Set a flag that the agent loop checks each iteration
    agentLoopAbortController?.abort();
    broadcastStatus(AgentStatus.IDLE, "Stopped by user");
    stopKeepalive();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "SETTINGS_UPDATE") {
    chrome.storage.sync.set({ "qsidebar:settings": message.payload.settings });
    sendResponse({ ok: true });
    return true;
  }
});
```

---

## Error Handling

| Error | Handling |
|---|---|
| Cerebras API 401 (invalid key) | Set `ERROR` status, tell user to check API key |
| Cerebras API 429 (rate limit) | Retry once after 2 seconds, then error |
| Cerebras API 500+ (server error) | Retry once after 1 second, then error |
| Invalid tool call arguments | Return error string as tool result, let LLM self-correct |
| Content script not responding | Return error string as tool result with "Page not responding" |
| JSON parse error on tool args | Return error string as tool result |
| Service worker termination | Navigation Bridge restores state (Phase 4) |

---

## Testing

- `tests/background/context.test.ts` — sliding window algorithm, edge cases
- `tests/background/streaming.test.ts` — SSE parser with mock streams
- `tests/background/security.test.ts` — risk classification, URL sanitization
- `tests/background/tools.test.ts` — tool definition schema validation

---

## Open Questions

None — all decisions are final.
