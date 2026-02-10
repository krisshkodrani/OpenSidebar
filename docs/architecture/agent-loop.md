# Agent Loop

The agent loop is the core orchestration engine that runs in the service worker. It manages the Think → Act → Observe cycle, calling the LLM and executing tools.

## Architecture

**Location:** `src/background/agent/`

**Files:**

- `loop.ts` - Main `AgentLoop` class
- `context.ts` - `ContextManager` for conversation history

## AgentLoop Class

The `AgentLoop` orchestrates the entire agent lifecycle:

```typescript
class AgentLoop {
  private llm: LLMClient;
  private context: ContextManager;
  private isRunning = false;
  private abortController: AbortController | null = null;

  async start(
    initialUserText: string,
    tabId: number,
    initialSnapshot?: DomSnapshot,
  ): Promise<void>;
  stop(): void;
  async resume(
    savedState: AgentLoopState,
    newSnapshot?: DomSnapshot,
  ): Promise<void>;
}
```

### Lifecycle

1. **Initialize** - Load API keys, restore context from storage
2. **Add user message** - User's request to context
3. **THINKING** - Call LLM with streaming
4. **ACTING** - Execute tool calls sequentially
5. **OBSERVE** - Add tool results to context
6. **Repeat** until done or max turns reached

### Loop Pseudocode

```typescript
while (isRunning && turns < MAX_TURNS) {
  turns++;

  // 1. Get context window
  const messages = context.getPrompt();
  const tools = toolRegistry.getDefinitions();

  // 2. LLM call (streaming)
  status = THINKING;
  const response = await llm.completeStream({ messages, tools }, (delta) =>
    sendStreamChunkToUI(delta),
  );

  // 3. Add assistant message
  context.addMessage({
    role: "assistant",
    content: response.content,
    tool_calls: response.tool_calls,
  });

  // 4. Handle response
  if (response.tool_calls) {
    status = ACTING;

    for (const toolCall of response.tool_calls) {
      // Check workspace permissions
      if (!workspaceManager.isTabInActiveWorkspace(tabId)) {
        // Return error
      }

      // Execute tool
      const result = await toolRegistry.execute(toolCall, tabId);

      // Add tool result
      context.addMessage({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });

      // Handle special tools
      if (toolCall.name === ToolName.DONE) {
        status = IDLE;
        return; // Exit loop
      }
    }
  } else {
    // Text-only response
    status = IDLE;
    return; // Exit loop
  }
}
```

## Context Management

The `ContextManager` manages conversation history with sliding window truncation.

### Sliding Window Algorithm

Keeps conversation within token limits while preserving critical context:

1. **Always keep:**
   - System message (index 0)
   - Original user query (index 1) - prevents "Goal Amnesia"
   - N most recent messages

2. **Drop oldest first:**
   - Remove middle messages until under token budget
   - Never drop protected indices

3. **Token estimation:**
   - Uses chars/4 heuristic (~4 chars per token)
   - Fast and accurate enough for context management

```typescript
function applySlidingWindow(
  messages: ChatMessage[],
  config: SlidingWindowConfig,
): ChatMessage[] {
  // 1. Calculate total tokens
  // 2. If under budget, return as-is
  // 3. Identify protected indices (system, goal, recent)
  // 4. Drop middle messages oldest-first
  // 5. Return truncated array
}
```

### Context Persistence

Context survives service worker restarts via `chrome.storage.session`:

```typescript
// On initialization
await context.loadState(); // Restore from storage

// On each message
context.addMessage(msg);
await context.saveState(); // Persist to storage
```

This is critical because Chrome terminates service workers after ~30 seconds of inactivity.

## System Prompt

The system prompt provides instructions and context to the LLM:

```
You are QSidebar, a browser agent that helps users interact with web pages.

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
You can also see a screenshot of the current viewport by calling take_screenshot(). Use this when the DOM is confusing or visual layout is important.
```

## Streaming

The agent uses Server-Sent Events (SSE) for real-time LLM responses:

### parseSSEStream

Parses SSE stream, accumulating text and tool calls:

```typescript
async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void,
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();

  let buffer = "";
  let content = "";
  const partialToolCalls = new Map<number, PartialToolCall>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;

      // Handle text content
      if (delta.content) {
        content += delta.content;
        onTextDelta(delta.content);
      }

      // Handle tool calls (accumulated across chunks)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          // Accumulate partial tool call...
        }
      }
    }
  }

  // Finalize tool calls and return
}
```

### Streaming Flow

1. LLM API returns SSE stream
2. `parseSSEStream` reads chunks
3. For each text delta, calls `onTextDelta`
4. Background sends `STREAM_CHUNK` to side panel
5. Side panel appends delta to streaming message
6. On completion, finalizes message

## Tool Execution

The agent supports 16 tools across three categories:

### Content Script Tools (DOM)

- `click_element` - Click tagged element
- `type_text` - Type into input
- `scroll_page` - Scroll up/down
- `read_page` - Get page snapshot
- `hover_element` - Hover over element
- `find_element` - Find by text

### Service Worker Tools (Chrome APIs)

- `navigate` - Navigate to URL
- `create_tab` - Open new tab
- `close_tab` - Close tab
- `switch_tab` - Switch to tab
- `wait` - Wait for duration
- `take_screenshot` - Capture viewport

### Special Tools

- `memory_add` - Save to memory
- `memory_search` - Search memory
- `activate_swarm` - Deep Thought delegation
- `done` - Task completion

## Safety & Limits

### Max Turns

Default: 10 turns per conversation
Prevents infinite loops and runaway agents

### Workspace Isolation

Each turn checks if tab is in active workspace:

```typescript
const isAllowed = await workspaceManager.isTabInActiveWorkspace(tabId);
if (!isAllowed) {
  return "Error: Tab not in active workspace";
}
```

### Risk Classification

Tools classified by risk level (LOW/MEDIUM/HIGH):

- LOW: Read-only (read_page, scroll_page)
- MEDIUM: Mutates state (click_element, type_text)
- HIGH: Navigation/tabs (navigate, close_tab)

Risk is logged and displayed in UI (informational only).

### Abort Handling

User can stop the agent at any time:

```typescript
public stop() {
    this.abortController?.abort();
    this.isRunning = false;
}
```

On abort, loop catches `AbortError` and exits cleanly.

## Navigation Bridge Integration

When `navigate` is called:

1. Save agent state to `chrome.storage.local`
2. Navigate tab to new URL
3. Exit agent loop
4. Wait for `webNavigation.onCompleted`
5. Restore state and resume loop
6. Continue from where it left off

See [Navigation Bridge](./navigation-bridge.md) for details.

## Testing

**tests/background/agent.test.ts** - Agent loop lifecycle
**tests/background/context.test.ts** - Sliding window algorithm
**tests/background/streaming.test.ts** - SSE parser
**tests/background/security.test.ts** - Risk classification
**tests/background/tools.test.ts** - Tool schema validation

## Key Files

| File                              | Purpose             |
| --------------------------------- | ------------------- |
| `src/background/agent/loop.ts`    | AgentLoop class     |
| `src/background/agent/context.ts` | ContextManager      |
| `src/background/llm/client.ts`    | LLM API client      |
| `src/background/streaming.ts`     | SSE parser          |
| `src/background/tools/index.ts`   | Tool definitions    |
| `src/background/security.ts`      | Risk classification |
