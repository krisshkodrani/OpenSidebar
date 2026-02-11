# 12. Logging Strategy & Guidelines

> **Philosophy**: Logs are data. In an AI agent system, logs are the primary observability tool for debugging non-deterministic behavior. They must be structured, queryable (like `jq`), and context-aware.

---

## 1. The Challenge in Chrome Extensions

Chrome Extensions run in disjointed environments:
- **Background Service Worker**: The "server" (invisible, ephemeral).
- **Content Scripts**: The "eyes/hands" (isolated in tabs).
- **Side Panel / Popup**: The "frontend" (React UI).
- **Offscreen Documents**: Hidden generic workers.

**Problem**: Inspecting 4 different DevTools windows to trace one request is painful.
**Solution**: A Unified Logging Interface that captures context and optionally aggregates logs.

---

## 2. Structured Log Format (JSON)

Every log entry must be a valid JSON object when serialized, allowing for easy parsing.

### Schema

```typescript
interface LogEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Log level */
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  /** Where the log originated */
  source: "background" | "content" | "sidepanel" | "offscreen";
  /** High-level functional area */
  category: "agent" | "memory" | "tools" | "ui" | "system";
  /** Correlates logs across source boundaries (the "trace ID") */
  requestId?: string;
  /** Human readable summary */
  message: string;
  /** Structured data payload (the "meat") */
  data?: Record<string, unknown>;
}
```

### Example

```json
{
  "ts": "2024-06-12T10:00:00.123Z",
  "level": "INFO",
  "source": "background",
  "category": "agent",
  "requestId": "req_123abc",
  "message": "Tool execution completed",
  "data": {
    "tool": "click_element",
    "args": { "id": 12 },
    "durationMs": 45,
    "success": true
  }
}
```

---

## 3. Implementation Proposal (`src/utils/logger.ts`)

We will enforce logging discipline through a strictly typed `Logger` class.

### Features

1.  **Auto-Context**: Automatically includes `source` based on where it's instantiated.
2.  **DevTools Formatting**: Uses `console.groupCollapsed` for the `data` payload so the console isn't flooded, but data is inspectable.
3.  **Color Coding**: Visual distinction between sources (Background = Blue, Content = Green, etc.).
4.  **Production Stripping**: In `PROD` builds, `DEBUG` logs are completely removed by the bundler (via define replacement).

### Usage Guide for Developers

#### ❌ BAD
```typescript
console.log("Clicked button", id); // Loose, hard to search
console.error("Error", err); // No context
```

#### ✅ GOOD
```typescript
import { logger } from "@/utils/logger";

// 1. Simple Info
logger.info("Agent", "Starting reasoning loop", { intent: "search_google" });

// 2. Traced Debugging (critical for Agent flows)
logger.debug("Tools", "Executing click", { 
    id: 12, 
    element: "button#submit", 
    requestId: currentRequestId 
});

// 3. Error Handling
logger.error("System", "Failed to initialize memory", { error: err.message, stack: err.stack });
```

---

## 4. Querying Logs (`jq` style)

Since we log structured JSON objects (or close to it), we can filter easily in the Chrome Console or by exporting logs.

**Chrome Console Filter Options:**
- Just generic filter: `context:Agent`
- Regex filter: `/click_element/`

**Advanced**: We can build a simple "Log Exporter" in the Settings page that dumps the unified log history (if we choose to buffer it in memory) to a `.jsonl` file.

**`jq` One-Liners for the future (if we export logs):**

*Find all tool executions that failed:*
```bash
cat logs.jsonl | jq 'select(.category=="tools" and .data.success==false)'
```

*Extract all LLM thoughts:*
```bash
cat logs.jsonl | jq 'select(.category=="agent") | .data.thought'
```

---

## 5. Development Workflow

1.  **Strict Typing**: The `data` argument should be `Record<string, any>`, preventing passing random strings as the second argument.
2.  **Global Object**: Attach the logger to `window.__Q_LOGGER__` for emergency access in the console.

## 6. Phase 2 Integration

We will implement `src/utils/logger.ts` **immediately** at the start of Phase 2 logic (before building the UI components that rely on it).

### Proposed Action Plan

1.  Create `src/utils/logger.ts`.
2.  Replace all existing `console.log` in our scaffold with `logger.info`.
3.  Proceed with Phase 2 UI implementation using the new logger.
