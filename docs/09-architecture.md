# QSidebar: A Bimodal Open-Source Browser Agent

**Technical Architecture Document**
**Date:** February 2026
**Version:** 2.0 — Comprehensive Specification

---

## 1. Executive Summary

QSidebar is a Chrome Extension that transforms the browser into an agentic workspace. Unlike traditional chatbots, it actively navigates, reads, and interacts with web pages on behalf of the user.

It uses a **Bimodal Intelligence** architecture:

1. **Reflex Engine (Fast)** — Cerebras `gpt-oss-120b` at ~3,000 tokens/sec for real-time interactions: UI navigation, DOM manipulation, simple chat.
2. **Deep Thought Engine (Slow)** — OpenRouter `kimi-k2.5` for complex multi-page research, analysis, and synthesis via native agent swarm.

Additionally, it features a **Local Second Brain** — a fully client-side RAG system using Transformers.js embeddings, Voy vector search, and SQLite FTS5, combined via Reciprocal Rank Fusion (RRF).

**Key differentiators:**
- All memory stays in the browser (IndexedDB) — no external database.
- Visual DOM distillation with Vimium-style numeric tagging.
- Workspace isolation via Chrome Tab Groups.
- Navigation Bridge survives page loads and service worker termination.

---

## 2. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Runtime | Chrome Manifest V3 | — | Extension platform |
| Build | Vite + @crxjs/vite-plugin | 5.4 / 2.0-beta.28 | Bundler with HMR |
| UI | React | 18.3 | Side panel interface |
| Styling | Tailwind CSS | 3.4 | Utility-first CSS |
| Language | TypeScript | 5.7 | Strict mode, full type safety |
| Tests | Bun | built-in | Test runner (`bun test`) |
| Fast LLM | Cerebras API | — | GPT-OSS-120b (reflex) |
| Slow LLM | OpenRouter API | — | Kimi k2.5 (swarm) |
| Embeddings | Transformers.js | 3.3 | MiniLM-L6-v2 in web worker |
| Vector DB | Voy | 0.7 | WASM semantic search |
| Keyword DB | sql.js (SQLite WASM) | 1.11 | FTS5 full-text search |

---

## 3. System Architecture

### 3.1 Extension Contexts

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Browser                            │
│                                                                  │
│  ┌──────────────┐    ┌────────────────┐    ┌──────────────────┐ │
│  │  Side Panel   │    │ Service Worker  │    │ Content Script   │ │
│  │  (React UI)   │←──→│  (Agent Loop)   │←──→│  (DOM Access)    │ │
│  │              │    │                │    │                  │ │
│  │  - Chat      │    │  - Cerebras    │    │  - Tag elements  │ │
│  │  - Settings  │    │  - Tool routing│    │  - Execute clicks│ │
│  │  - Workspace │    │  - Context mgmt│    │  - Build snapshot│ │
│  │    selector  │    │  - Nav bridge  │    │                  │ │
│  └──────────────┘    └───────┬────────┘    └──────────────────┘ │
│                              │                                   │
│                    ┌─────────┴──────────┐                        │
│                    │ Offscreen Document  │                        │
│                    │                    │                        │
│                    │  - SQLite FTS5     │                        │
│                    │  - Voy vector DB   │                        │
│                    │  - Web Worker      │                        │
│                    │    (Transformers.js)│                        │
│                    └────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Communication Flow

All inter-context communication uses `chrome.runtime` messaging with typed, discriminated union payloads. Every message carries a `requestId` (UUID v4) for async correlation.

Full protocol: [`docs/message-protocol.md`](docs/message-protocol.md)

### 3.3 The Reflex Loop (Default Mode)

```
User Message → Service Worker → Cerebras API (streaming) → Tool Call?
                                                              │
                                                    ┌─────────┴──────────┐
                                                    │                    │
                                                  Yes                   No
                                                    │                    │
                                           Execute tool           Stream text
                                           (content script)       to side panel
                                                    │                    │
                                           Feed result back       Done (IDLE)
                                           to Cerebras
                                                    │
                                              Loop again
```

The loop runs until:
- The LLM calls `done()` with a summary.
- The turn limit is reached (default: 25).
- The user clicks Stop.
- An unrecoverable error occurs.

### 3.4 The Deep Thought Loop (Swarm Mode)

Activated exclusively via the `activate_swarm` tool. The Reflex Engine delegates complex research to Kimi k2.5 via OpenRouter. Kimi's internal agent swarm browses the web, synthesizes information, and returns a report. The report is fed back to the Reflex Engine as a tool result.

Details: [`docs/05-kimi-swarm.md`](docs/05-kimi-swarm.md)

### 3.5 The Second Brain (Memory)

A fully client-side RAG system:

1. **Embedding:** Transformers.js runs `all-MiniLM-L6-v2` (384 dimensions) in a web worker inside an offscreen document.
2. **Semantic search:** Voy (WASM) indexes and queries embeddings.
3. **Keyword search:** SQLite WASM with FTS5 and Porter stemming.
4. **Fusion:** Reciprocal Rank Fusion (k=60) combines both result sets.
5. **Persistence:** IndexedDB stores the SQLite database and Voy index.

Details: [`docs/06-memory-second-brain.md`](docs/06-memory-second-brain.md)

---

## 4. Core Technical Solutions

### 4.1 Visual DOM Distillation

**Problem:** Raw HTML is too large and ambiguous for LLMs.

**Solution:** The content script tags every interactive element with a numeric label `[N]` and produces a distilled snapshot:

```
[1] <a href="/login"> "Sign In"
[2] <input type="text" placeholder="Search..."> ""
[3] <button> "Submit"
[4] <a href="/about"> "About Us"
```

The LLM calls `click_element(id=3)` to click the Submit button — no ambiguity.

**Implementation:**
- Discovers elements via CSS selector list (a, button, input, textarea, select, [role=button], etc.).
- Filters by visibility (non-zero dimensions, not `display:none`, not `visibility:hidden`).
- Tags up to 200 elements per snapshot.
- Extracts viewport text via TreeWalker (up to 4000 chars).
- Pierces open Shadow DOM recursively.

Details: [`docs/01-content-script.md`](docs/01-content-script.md)

### 4.2 The Navigation Bridge

**Problem:** Page navigation destroys the content script and may terminate the service worker.

**Solution:** A state machine with persistence:

1. Before navigation: save `AgentLoopState` to `chrome.storage.local`.
2. During navigation: service worker listens for `chrome.webNavigation.onCompleted`.
3. After navigation: restore state, inject result message, resume agent loop.

**State machine:** `IDLE → THINKING → ACTING → WAITING_FOR_PAGE_LOAD → THINKING → ...`

Edge cases handled: back/forward, redirects, SPA navigation, tab close, network errors, timeout (30s).

Details: [`docs/04-navigation-bridge.md`](docs/04-navigation-bridge.md)

### 4.3 Workspace Context Isolation

**Problem:** The agent should not access unrelated tabs.

**Solution:** Chrome Tab Groups serve as visual workspaces. The agent loop checks workspace membership before every tool call. New tabs created by the agent are automatically added to the active workspace.

Details: [`docs/07-workspace-tab-groups.md`](docs/07-workspace-tab-groups.md)

### 4.4 Service Worker Keepalive

**Problem:** Chrome terminates service workers after ~30 seconds of inactivity.

**Solution:** `chrome.alarms` fires every ~24 seconds during active agent loops, preventing termination. Alarm is created when the agent loop starts and cleared when it ends.

---

## 5. Tool System

The LLM has access to 13 tools via OpenAI-compatible function calling:

| Tool | Risk | Description |
|---|---|---|
| `read_page` | Low | Get DOM snapshot with tagged elements |
| `click_element` | Medium | Click element by tag ID |
| `type_text` | Medium | Type into input by tag ID |
| `scroll_page` | Low | Scroll up/down |
| `navigate` | High | Navigate to URL (triggers Navigation Bridge) |
| `create_tab` | High | Open new tab |
| `close_tab` | High | Close a tab |
| `switch_tab` | Medium | Switch to different tab |
| `wait` | Low | Wait N milliseconds |
| `memory_search` | Low | Hybrid search in Second Brain |
| `memory_add` | Medium | Store information in Second Brain |
| `activate_swarm` | High | Delegate to Kimi k2.5 Deep Thought |
| `done` | High | Signal task completion |

Full JSON schemas: [`docs/03-agent-loop.md`](docs/03-agent-loop.md)

---

## 6. Sliding Window Context Management

The conversation history is managed by a sliding window algorithm that keeps total tokens within the LLM's context limit (default: 16,000 tokens).

**Strategy:**
1. Always preserve the system message.
2. Always preserve the 4 most recent messages.
3. Drop the oldest non-protected messages until under budget.
4. Token estimation: `ceil(charCount / 4)`.

Details: [`docs/03-agent-loop.md`](docs/03-agent-loop.md)

---

## 7. Security

### Risk Classification

Every tool call is classified as LOW, MEDIUM, or HIGH risk. This classification is used for UI display (colored badges) and future access control.

### Input Sanitization

- User text: null byte removal, length truncation (10,000 chars).
- URLs: protocol allowlist (http/https only), URL parsing validation.
- Tool arguments: JSON schema validation by the LLM API; runtime type checking.

### Data Privacy

- API keys are stored in `chrome.storage.sync` (encrypted at rest by Chrome).
- Memory data lives entirely in IndexedDB (local to the browser).
- No telemetry, no analytics, no external data collection.

---

## 8. File Structure

```
qsidebar/
├── manifest.json
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.cjs
├── src/
│   ├── types/index.ts           # All TypeScript types
│   ├── background/
│   │   ├── background.ts        # Service worker entry, agent loop
│   │   ├── tools.ts             # Tool definitions, system prompt
│   │   ├── context.ts           # Sliding window
│   │   ├── streaming.ts         # SSE parser
│   │   ├── security.ts          # Risk classification, sanitization
│   │   └── swarm.ts             # OpenRouter/Kimi client
│   ├── content/
│   │   └── content.ts           # DOM distillation, action execution
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── index.tsx
│   │   ├── index.css
│   │   └── App.tsx              # Main UI + all components
│   └── offscreen/
│       ├── offscreen.html
│       ├── offscreen.ts         # SQLite + Voy + message handling
│       └── memory-worker.ts     # Transformers.js web worker
├── tests/
│   ├── setup.ts
│   ├── background/
│   ├── content/
│   └── memory/
└── docs/                        # RFC documentation
```

---

## 9. Implementation Phases

| Phase | Name | Description | Doc |
|---|---|---|---|
| 0 | Project Scaffold | Build tooling, configs, empty extension | [`docs/00-project-scaffold.md`](docs/00-project-scaffold.md) |
| 1 | Content Script | DOM distillation, element tagging, action execution | [`docs/01-content-script.md`](docs/01-content-script.md) |
| 2 | Side Panel UI | React chat interface, settings, workspace selector | [`docs/02-sidepanel-ui.md`](docs/02-sidepanel-ui.md) |
| 3 | Agent Loop | Cerebras client, tool routing, sliding window, SSE parsing | [`docs/03-agent-loop.md`](docs/03-agent-loop.md) |
| 4 | Navigation Bridge | State persistence across page loads | [`docs/04-navigation-bridge.md`](docs/04-navigation-bridge.md) |
| 5 | Kimi Swarm | OpenRouter integration, Deep Thought delegation | [`docs/05-kimi-swarm.md`](docs/05-kimi-swarm.md) |
| 6 | Memory (Second Brain) | Embeddings, vector search, FTS5, RRF fusion | [`docs/06-memory-second-brain.md`](docs/06-memory-second-brain.md) |
| 7 | Workspaces | Tab Groups, context isolation | [`docs/07-workspace-tab-groups.md`](docs/07-workspace-tab-groups.md) |
| 8 | Testing & Polish | Test strategy, error handling, edge cases | [`docs/08-testing-polish.md`](docs/08-testing-polish.md) |

---

## 10. Type System

All types are centralized in `src/types/index.ts`. The complete reference with JSDoc comments is at [`docs/types-reference.md`](docs/types-reference.md).

Key types:
- `AgentLoopState` — full runtime state of the agent loop
- `DomSnapshot` / `TaggedElement` — content script output
- `RuntimeMessage` — discriminated union of all Chrome runtime messages
- `ToolDefinition` / `ToolCall` — OpenAI-compatible function calling
- `MemoryEntry` / `MemorySearchResult` — Second Brain data
- `Workspace` — Tab Group workspace
- `NavigationState` — Navigation Bridge persistence
- `UserSettings` — user-configurable options
- `Result<T>` — error-safe return type

---

## 11. Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| LLM for reflex | Cerebras GPT-OSS-120b | Fastest inference (~3000 tok/s), OpenAI-compatible API |
| LLM for research | Kimi k2.5 via OpenRouter | Native agent swarm, 128K context, single API key |
| Embedding model | all-MiniLM-L6-v2 | Small (23MB), fast, good quality, runs in browser |
| Vector DB | Voy | Pure WASM, no server, designed for browser use |
| Keyword search | SQLite FTS5 | Battle-tested, Porter stemming, runs as WASM |
| Fusion algorithm | RRF (k=60) | Robust to score scale differences, simple, proven |
| UI framework | React 18 | Familiar, well-typed, small side panel only |
| Styling | Tailwind CSS v3 | Utility-first, small bundle, dark mode support |
| Build tool | Vite + CRXJS | Best DX for Chrome extensions (HMR, manifest handling) |
| Test runner | Bun | Fast, built-in TypeScript, no config |
| State persistence | chrome.storage.local | Survives service worker termination |
| Memory persistence | IndexedDB | Handles large binary blobs (WASM DBs) |
| Context management | Sliding window | Simpler than summarization, deterministic |
| Token estimation | chars/4 | Good enough for context management, no tokenizer needed |
| Component structure | Single App.tsx | <500 lines, no routing needed |

---

## 12. License

MIT
