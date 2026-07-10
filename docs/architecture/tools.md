# Tool System

OpenSidebar implements **52 tools** across four categories. Tools are defined in `apps/extension/src/background/tools/index.ts` with metadata in `apps/extension/src/background/tools/metadata.ts`.

## Tool Categories

### DOM Tools (Content Script)

These tools operate in the page context and manipulate the DOM directly.

| Tool                | Description                       | Arguments                                                                    |
| ------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `click_element`     | Click an element by tag ID        | `{ id: number }`                                                             |
| `type_text`         | Type text into an input field     | `{ id: number, text: string, pressEnter?: boolean }`                         |
| `scroll_page`       | Scroll the page or container      | `{ direction: "up" \| "down" \| "top" \| "bottom", id?: number }`            |
| `read_page`         | Get a fresh DOM snapshot          | `{}`                                                                         |
| `hover_element`     | Hover over an element             | `{ id: number }`                                                             |
| `find_element`      | Find element by visible text      | `{ text: string }`                                                           |
| `select_option`     | Select a dropdown option          | `{ id: number, value: string }`                                              |
| `press_key`         | Press a keyboard key              | `{ key: string, modifiers?: string[] }`                                      |
| `drag_and_drop`     | Drag an element to a target       | `{ sourceId: number, targetId: number }`                                     |
| `hide_element`      | Hide an element by ID             | `{ id: number }`                                                             |
| `read_element`      | Read specific attribute or text   | `{ id: number, attribute?: string }`                                         |
| `execute_js`        | Run JavaScript in page context    | `{ code: string }`                                                           |
| `upload_file`       | Upload a file to a file input     | `{ id: number, url?: string, profileFile?: "cv" }`                           |
| `right_click`       | Right-click on an element         | `{ id: number }`                                                             |
| `set_checkbox`      | Set checkbox/radio state          | `{ id: number, checked: boolean }`                                           |
| `click_coordinates` | Click at viewport X/Y coordinates | `{ x: number, y: number, description?: string }`                             |
| `inspect_hidden`    | Scan for hidden DOM elements      | `{ pattern?: string, maxResults?: number }`                                  |

### Page Assist Tools (Service Worker → MAIN world)

These tools inject scripts into the page's MAIN world via `chrome.scripting.executeScript` to modify page behavior. Toggle — call once to enable, again to disable.

| Tool           | Description                                     | Arguments |
| -------------- | ----------------------------------------------- | --------- |
| `xray_page`    | Force all hidden elements visible (CSS override) | `{}`      |

**`xray_page`** injects a `<style data-osb-xray>` that overrides `display:none`, `opacity:0`, `visibility:hidden`, and `aria-hidden`. Marked `domModifying: true` so the agent loop refreshes the DOM snapshot after toggling, allowing newly revealed elements to get tagged. Does not persist across navigations.

### Tab Tools (Service Worker)

These tools use Chrome APIs to manage tabs and navigation.

| Tool              | Description                     | Arguments                                             |
| ----------------- | ------------------------------- | ----------------------------------------------------- |
| `navigate`        | Navigate to URL or search query | `{ url?: string, query?: string }`                    |
| `create_tab`      | Open a new tab                  | `{ url: string }`                                     |
| `close_tab`       | Close a tab                     | `{ tabId?: number }`                                  |
| `switch_tab`      | Switch to a tab by ID           | `{ tabId: number }`                                   |
| `list_tabs`       | List open tabs in workspace     | `{}`                                                  |
| `go_back`         | Go back in browser history      | `{}`                                                  |
| `wait`            | Wait for dynamic content        | `{ seconds: number, reason?: string }`                |

### Browser API Tools

These tools interact with browser features like cookies, history, bookmarks, and downloads.

| Tool                | Description                    | Arguments                                                                      |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `get_cookies`       | Get cookies for a URL          | `{ url?: string }`                                                             |
| `set_cookie`        | Set a cookie                   | `{ url: string, name: string, value: string, domain?: string, path?: string }` |
| `delete_cookie`     | Delete a cookie                | `{ url: string, name: string }`                                                |
| `search_history`    | Search browser history         | `{ query: string, maxResults?: number }`                                       |
| `download_file`     | Start a file download          | `{ url: string, filename?: string }`                                           |

### Special Tools

These tools control the agent itself.

| Tool            | Description             | Arguments                                                                               |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `done`          | Mark task as complete   | `{ summary: string }`                                                                   |
| `escalate`      | Switch to smarter model | `{ reason: string }`                                                                    |

## Tool Execution Flow

```mermaid
sequenceDiagram
    participant LLM
    participant AgentLoop
    participant ToolRegistry
    participant ContentScript
    participant DOM

    LLM->>AgentLoop: Tool call
    AgentLoop->>ToolRegistry: execute(toolCall, tabId)

    alt DOM Tool
        ToolRegistry->>ContentScript: chrome.tabs.sendMessage(TOOL_EXECUTE)
        ContentScript->>DOM: Perform action
        DOM-->>ContentScript: Result
        ContentScript-->>ToolRegistry: TOOL_RESULT
    else Tab Tool / Browser API Tool
        ToolRegistry->>Chrome: chrome.tabs.* / chrome.* API
        Chrome-->>ToolRegistry: Result
    end

    ToolRegistry-->>AgentLoop: Result string
    AgentLoop->>ContextManager: Add tool result
```

## Adding a New Tool

### Step 1: Define the Tool Schema

In `apps/extension/src/background/tools/index.ts`:

```typescript
const MY_NEW_TOOL_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.MY_NEW_TOOL,
    description: "Description of what the tool does",
    parameters: {
      type: "object",
      properties: {
        param1: {
          type: "string",
          description: "What this parameter does",
        },
        param2: {
          type: "number",
          description: "Another parameter",
        },
      },
      required: ["param1"],
    },
  },
};
```

### Step 2: Register the Executor

In the same file, register the tool:

```typescript
toolRegistry.register(
  ToolName.MY_NEW_TOOL,
  MY_NEW_TOOL_DEF,
  async (args, tabId, signal) => {
    // Implementation
    return "Result string";
  },
);
```

### Step 3: Add Metadata (Optional)

In `apps/extension/src/background/tools/metadata.ts`:

```typescript
// If tool modifies DOM (triggers snapshot refresh)
DOM_MODIFYING_TOOLS.add("my_new_tool");

// If tool must run alone (not in parallel)
SEQUENTIAL_TOOLS.add("my_new_tool");

// Add to risk classification if needed
```

## Tool Metadata

### DOM_MODIFYING_TOOLS

Tools that modify the DOM and trigger a snapshot refresh after execution:

- `click_element`
- `type_text`
- `scroll_page`
- `hover_element`
- `select_option`
- `drag_and_drop`
- `hide_element`
- `xray_page`
- `navigate`
- `go_back`

### SEQUENTIAL_TOOLS

Tools that must execute alone (not in parallel with others):

- `navigate` - Changes page context
- `done` - Ends the agent loop

- `escalate` - Changes model
- `go_back` - Changes page context

## Risk Classification

Tools are classified by risk level (informational, not enforced):

- **LOW**: Read-only operations or reversible toggles
  - `read_page`, `scroll_page`, `list_tabs`, `get_cookies`, `search_history`, `read_element`, `inspect_hidden`, `xray_page`
- **MEDIUM**: Mutates page state
  - `click_element`, `type_text`, `hover_element`, `hide_element`, `select_option`, `set_checkbox`, `right_click`, `click_coordinates`
  - `set_cookie`, `delete_cookie`, `upload_file`
- **HIGH**: Navigation and browser management
  - `navigate`, `create_tab`, `close_tab`, `switch_tab`, `download_file`, `escalate`

## Tool Result Format

All tools return a string result:

- Success: Descriptive result (e.g., "Clicked element [5]", "Navigated to https://...")
- Error: `"Error: {description}"` (e.g., "Error: No element with tag 5")

## Tool Recovery

If the LLM returns tool calls as plain text instead of structured JSON, the system attempts to recover them:

See `apps/extension/src/background/agent/tool-recovery.ts` for the `recoverToolCallsFromText()` function.

## Testing Tools

```bash
# Run tool-related tests
pnpm exec vitest run --grep "tool"

# Test specific tool execution
pnpm exec vitest run --config apps/extension/vitest.config.ts apps/extension/tests/background/tools.test.ts
```

## Key Files

| File                               | Purpose                        |
| ---------------------------------- | ------------------------------ |
| `apps/extension/src/background/tools/index.ts`    | Tool definitions and executors |
| `apps/extension/src/background/tools/registry.ts` | ToolRegistry class             |
| `apps/extension/src/background/tools/metadata.ts` | Tool metadata (risk, flags)    |
| `apps/extension/src/content/actions/`             | DOM tool implementations       |
| `apps/extension/src/background/agent/loop.ts`     | Tool execution orchestration   |
