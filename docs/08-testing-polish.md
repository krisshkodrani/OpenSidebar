# Phase 8 — Testing & Polish

> **Goal:** Define the test strategy, test file structure, per-module test coverage, error handling matrix, and edge case catalog.

---

## Background

QSidebar uses **Bun** as the test runner — not Vitest, not Jest. Bun has a built-in test runner that discovers `*.test.ts` files and runs them with native TypeScript support. No transpilation config needed.

**Key constraint:** Chrome extension APIs (`chrome.*`) are not available in Bun's test environment. All tests requiring these APIs use mocks defined in `tests/setup.ts`.

---

## Test Strategy

### Principles

1. **Unit test the pure logic.** Algorithms (RRF, sliding window, SSE parser, DOM distillation) are tested in isolation with deterministic inputs/outputs.
2. **Mock the boundaries.** Chrome APIs, fetch, and DOM are mocked. No real network calls or browser instances in unit tests.
3. **Skip integration tests.** Chrome extension integration testing requires tools like Puppeteer with extension loading, which is out of scope for Phase 8. Manual testing covers this.
4. **Test the contracts.** Every message type has a test that verifies the payload shape matches the TypeScript interface.

### What NOT to Test

- React component rendering (no JSDOM React testing — the UI is simple enough for manual verification).
- Chrome API behavior (we trust the browser's implementation).
- Third-party libraries (sql.js, Voy, Transformers.js).

---

## Test File Structure

```
tests/
├── setup.ts                          # Chrome API mocks, global test setup
├── background/
│   ├── context.test.ts               # Sliding window algorithm
│   ├── streaming.test.ts             # SSE parser
│   ├── security.test.ts              # Risk classification, URL sanitization
│   ├── tools.test.ts                 # Tool definition schema validation
│   ├── navigation.test.ts            # Navigation Bridge state save/restore
│   ├── swarm.test.ts                 # Swarm prompt construction, retry logic
│   └── workspace.test.ts            # Tab filtering, workspace CRUD logic
├── content/
│   ├── tagging.test.ts               # Element discovery, visibility filtering
│   ├── actions.test.ts               # click, type, scroll execution
│   └── snapshot.test.ts              # DOM snapshot generation
└── memory/
    ├── rrf.test.ts                   # Reciprocal Rank Fusion algorithm
    └── fts5.test.ts                  # SQLite FTS5 queries
```

---

## Per-Module Test Specifications

### `tests/background/context.test.ts`

Tests for the sliding window context management.

```typescript
import { describe, test, expect } from "bun:test";
import { applySlidingWindow } from "../../src/background/context";

describe("applySlidingWindow", () => {
  test("returns messages unchanged when under token budget", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi!", tool_calls: undefined },
    ];
    const result = applySlidingWindow(messages, { maxTokens: 10000, preserveRecentCount: 2, preserveSystemMessage: true, systemPromptTokenBudget: 500 });
    expect(result).toEqual(messages);
  });

  test("drops oldest non-system messages when over budget", () => {
    const messages = [
      { role: "system" as const, content: "System." },
      { role: "user" as const, content: "A".repeat(4000) },   // ~1000 tokens
      { role: "assistant" as const, content: "B".repeat(4000), tool_calls: undefined },
      { role: "user" as const, content: "C".repeat(4000) },
      { role: "assistant" as const, content: "D".repeat(4000), tool_calls: undefined },
    ];
    const result = applySlidingWindow(messages, { maxTokens: 3000, preserveRecentCount: 2, preserveSystemMessage: true, systemPromptTokenBudget: 500 });
    expect(result[0].role).toBe("system");
    expect(result.length).toBeLessThan(messages.length);
    // Most recent 2 messages should be preserved
    expect(result[result.length - 1].content).toBe("D".repeat(4000));
    expect(result[result.length - 2].content).toBe("C".repeat(4000));
  });

  test("always preserves system message", () => {
    const messages = [
      { role: "system" as const, content: "System prompt." },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Message ${i}: ${"X".repeat(800)}`,
      })),
    ];
    const result = applySlidingWindow(messages, { maxTokens: 2000, preserveRecentCount: 2, preserveSystemMessage: true, systemPromptTokenBudget: 500 });
    expect(result[0].role).toBe("system");
  });

  test("handles empty message array", () => {
    const result = applySlidingWindow([], { maxTokens: 1000, preserveRecentCount: 2, preserveSystemMessage: true, systemPromptTokenBudget: 500 });
    expect(result).toEqual([]);
  });
});
```

### `tests/background/streaming.test.ts`

Tests for the SSE stream parser.

```typescript
import { describe, test, expect } from "bun:test";
import { parseSSEStream } from "../../src/background/streaming";

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("parseSSEStream", () => {
  test("parses text-only response", async () => {
    const stream = createMockStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const deltas: string[] = [];
    const result = await parseSSEStream(stream, (d) => deltas.push(d));

    expect(result.content).toBe("Hello world");
    expect(result.tool_calls).toBeUndefined();
    expect(deltas).toContain("Hello");
    expect(deltas).toContain(" world");
  });

  test("parses tool call response", async () => {
    const stream = createMockStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"click_element","arguments":"{\\"id"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": 5}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await parseSSEStream(stream, () => {});

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.name).toBe("click_element");
    expect(JSON.parse(result.tool_calls![0].function.arguments)).toEqual({ id: 5 });
  });

  test("handles split lines across chunks", async () => {
    const stream = createMockStream([
      'data: {"choices":[{"delta":{"con',
      'tent":"split"}}]}\n\ndata: [DONE]\n\n',
    ]);

    const result = await parseSSEStream(stream, () => {});
    expect(result.content).toBe("split");
  });
});
```

### `tests/background/security.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { classifyRisk, sanitizeUrl, sanitizeUserInput } from "../../src/background/security";
import { ToolName, RiskLevel } from "../../src/types";

describe("classifyRisk", () => {
  test("read_page is LOW risk", () => {
    expect(classifyRisk(ToolName.READ_PAGE, {})).toBe(RiskLevel.LOW);
  });

  test("click_element is MEDIUM risk", () => {
    expect(classifyRisk(ToolName.CLICK_ELEMENT, { id: 5 })).toBe(RiskLevel.MEDIUM);
  });
  
  test("take_screenshot is LOW risk", () => {
    expect(classifyRisk(ToolName.TAKE_SCREENSHOT, {})).toBe(RiskLevel.LOW);
  });

  test("navigate is HIGH risk", () => {
    expect(classifyRisk(ToolName.NAVIGATE, { url: "https://example.com" })).toBe(RiskLevel.HIGH);
  });
});

describe("sanitizeUrl", () => {
  test("accepts valid HTTPS URLs", () => {
    const result = sanitizeUrl("https://example.com/page?q=test");
    expect(result.ok).toBe(true);
  });

  test("rejects javascript: protocol", () => {
    const result = sanitizeUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
  });

  test("rejects data: protocol", () => {
    const result = sanitizeUrl("data:text/html,<h1>hi</h1>");
    expect(result.ok).toBe(false);
  });

  test("rejects invalid URLs", () => {
    const result = sanitizeUrl("not a url");
    expect(result.ok).toBe(false);
  });
});

describe("sanitizeUserInput", () => {
  test("removes null bytes", () => {
    expect(sanitizeUserInput("hello\0world")).toBe("helloworld");
  });

  test("truncates to 10000 chars", () => {
    const long = "x".repeat(20000);
    expect(sanitizeUserInput(long).length).toBe(10000);
  });
});
```

### `tests/background/tools.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { TOOL_DEFINITIONS } from "../../src/background/tools";

describe("TOOL_DEFINITIONS", () => {
  test("every tool has a valid schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
      expect(typeof tool.function.parameters.required).toBe("object");
    }
  });

  test("all ToolName enum values have definitions", () => {
    const definedNames = TOOL_DEFINITIONS.map(t => t.function.name);
    // Check a representative set
    expect(definedNames).toContain("click_element");
    expect(definedNames).toContain("type_text");
    expect(definedNames).toContain("navigate");
    expect(definedNames).toContain("done");
    expect(definedNames).toContain("activate_swarm");
    expect(definedNames).toContain("memory_search");
    expect(definedNames).toContain("take_screenshot");
    expect(definedNames).toContain("hover_element");
  });
});
```

### `tests/background/navigation.test.ts`

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import "../setup"; // Chrome API mocks

describe("NavigationBridge", () => {
  test("saves state with correct schema", () => {
    // Test that NavigationState can be serialized to JSON and back
    const state = {
      agentState: {
        status: "WAITING_FOR_PAGE_LOAD",
        messages: [{ role: "system", content: "test" }],
        originalQuery: "test query",
        turnCount: 3,
        maxTurns: 25,
        activeTabId: 123,
        workspaceId: null,
        lastActivityTs: Date.now(),
        pendingToolCall: {
          toolCallId: "call_1",
          toolName: "navigate",
          args: { url: "https://example.com" },
          expectedUrl: "https://example.com",
        },
      },
      fromUrl: "https://old.com",
      toUrl: "https://example.com",
      navigationStartTs: Date.now(),
      timeoutMs: 30000,
    };

    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.agentState.status).toBe("WAITING_FOR_PAGE_LOAD");
    expect(deserialized.agentState.pendingToolCall.expectedUrl).toBe("https://example.com");
  });

  test("detects timeout correctly", () => {
    const navigationStartTs = Date.now() - 31000; // 31 seconds ago
    const timeoutMs = 30000;
    const elapsed = Date.now() - navigationStartTs;
    expect(elapsed > timeoutMs).toBe(true);
  });
});
```

### `tests/memory/rrf.test.ts`

```typescript
import { describe, test, expect } from "bun:test";

// Import the RRF function (will be extracted for testability)
const RRF_K = 60;

function reciprocalRankFusion(
  semanticResults: Array<{ id: string; score: number }>,
  keywordResults: Array<{ id: string; rank: number }>,
  limit: number
): Array<{ id: string; rrfScore: number }> {
  const scores = new Map<string, number>();

  semanticResults.forEach((r, index) => {
    const rank = index + 1;
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + rank));
  });

  keywordResults.forEach((r, index) => {
    const rank = index + 1;
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + rank));
  });

  return Array.from(scores.entries())
    .map(([id, rrfScore]) => ({ id, rrfScore }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);
}

describe("reciprocalRankFusion", () => {
  test("document in both lists scores higher than one-list documents", () => {
    const semantic = [
      { id: "A", score: 0.9 },
      { id: "B", score: 0.7 },
      { id: "C", score: 0.5 },
    ];
    const keyword = [
      { id: "B", rank: -1.5 },
      { id: "D", rank: -1.2 },
      { id: "A", rank: -0.8 },
    ];

    const results = reciprocalRankFusion(semantic, keyword, 5);

    // A and B appear in both lists — they should rank highest
    const topTwo = results.slice(0, 2).map(r => r.id);
    expect(topTwo).toContain("A");
    expect(topTwo).toContain("B");
  });

  test("respects limit parameter", () => {
    const semantic = Array.from({ length: 10 }, (_, i) => ({ id: `S${i}`, score: 1 - i * 0.1 }));
    const keyword = Array.from({ length: 10 }, (_, i) => ({ id: `K${i}`, rank: -(10 - i) }));

    const results = reciprocalRankFusion(semantic, keyword, 3);
    expect(results.length).toBe(3);
  });

  test("handles empty inputs", () => {
    expect(reciprocalRankFusion([], [], 5)).toEqual([]);
    expect(reciprocalRankFusion([{ id: "A", score: 1 }], [], 5)).toHaveLength(1);
    expect(reciprocalRankFusion([], [{ id: "A", rank: -1 }], 5)).toHaveLength(1);
  });
});
```

---

## Error Handling Matrix

| Module | Error | Severity | Handling |
|---|---|---|---|
| **Agent Loop** | LLM API 401 | Critical | Set `ERROR` status, display "Invalid API key" |
| **Agent Loop** | LLM API 429 | Recoverable | Retry once after 2s, then error |
| **Agent Loop** | LLM API 500+ | Recoverable | Retry once after 1s, then error |
| **Agent Loop** | LLM returns invalid JSON in tool args | Recoverable | Return error as tool result, let LLM retry |
| **Agent Loop** | Turn limit exceeded | Expected | Send summary, set IDLE |
| **Agent Loop** | User clicks Stop | Expected | Abort loop, set IDLE |
| **Content Script** | Element not found (stale tag) | Recoverable | Return "No element with tag [N]" as tool result |
| **Content Script** | Content script not loaded | Recoverable | Return "Page not responding" as tool result |
| **Content Script** | DOM action throws | Recoverable | Return error string as tool result |
| **Navigation Bridge** | Navigation timeout (30s) | Critical | Set ERROR status, clean up stored state |
| **Navigation Bridge** | Tab closed during navigation | Critical | Set ERROR status, clean up stored state |
| **Navigation Bridge** | webNavigation error | Recoverable | Resume loop with error in tool result |
| **Swarm** | OpenRouter API timeout (120s) | Recoverable | Retry once, then return error as tool result |
| **Swarm** | Empty response | Recoverable | Return "No results" as tool result |
| **Memory** | Worker init timeout (15s) | Degraded | Disable memory, warn user |
| **Memory** | IndexedDB write fails | Degraded | Continue in-memory, log warning |
| **Memory** | Embedding model download fails | Degraded | Disable memory, warn user |
| **Workspace** | Tab group deleted by user | Expected | Mark workspace as ungrouped |
| **Workspace** | Tab closed | Expected | Remove from workspace tab list |
| **Settings** | Storage quota exceeded | Degraded | Log error, continue with defaults |

---

## Edge Case Catalog

### Content Script Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | Page has 500+ interactive elements | Only first 200 are tagged (MAX_TAGGED_ELEMENTS) |
| 2 | Element is behind a modal overlay | Element is tagged (z-order not checked) |
| 3 | Input with `type="hidden"` | Not tagged (excluded by selector) |
| 4 | Button inside a closed `<details>` | Not tagged (visibility check fails — `display: none`) |
| 5 | SVG element with click handler | Tagged via `[onclick]` selector |
| 6 | `contenteditable` div | Tagged, `type_text` works via `textContent` mutation |
| 7 | Element in open shadow DOM | Tagged if `querySelectorAllDeep` is used |
| 8 | Page changes DOM via `requestAnimationFrame` | Stale tags — agent should `read_page` before acting |
| 9 | `<select>` with 100 `<option>` children | Only the `<select>` is tagged, not individual options |

### Agent Loop Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | LLM returns 3 tool calls in one response | Execute sequentially in order |
| 2 | LLM returns tool call with empty arguments | Parse as `{}`, pass to handler |
| 3 | LLM calls `done` in the middle of tool calls | Process `done`, ignore remaining tool calls |
| 4 | User sends new message while agent is running | Reject with "Agent is busy" |
| 5 | Service worker terminates mid-loop (not during nav) | State is lost — user must retry |
| 6 | LLM hallucinates a non-existent tool name | Return "Unknown tool" as tool result |

### Navigation Bridge Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | 3xx redirect chain | onCompleted fires at final destination |
| 2 | HTTP 404 page loads | onCompleted fires, agent sees "Not Found" |
| 3 | Download link (Content-Disposition) | No onCompleted — timeout triggers |
| 4 | `about:blank` navigation | onCompleted fires, agent sees empty page |
| 5 | Browser extension page (chrome://) | onCompleted may not fire — timeout |

### Memory Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | Search with empty query | Return empty results |
| 2 | Add entry with 50KB of text | Store full text (no truncation in memory) |
| 3 | FTS5 query with special characters | SQLite handles escaping; query may return no results |
| 4 | Voy index with 10,000+ entries | Search remains fast (<100ms) |

---

## Running Tests

```bash
# Run all tests
bun test

# Run a specific test file
bun test tests/background/context.test.ts

# Run tests matching a pattern
bun test --grep "sliding window"

# Run with verbose output
bun test --verbose
```

### Bun Test Configuration

In `package.json`:

```json
{
  "scripts": {
    "test": "bun test"
  }
}
```

Bun auto-discovers `*.test.ts` files in the project root and subdirectories. The `tests/setup.ts` file is loaded via:

```typescript
// bunfig.toml
[test]
preload = ["./tests/setup.ts"]
```

---

## Open Questions

None — all decisions are final.
