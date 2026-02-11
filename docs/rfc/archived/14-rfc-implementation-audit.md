# RFC vs Implementation Audit & Missing RFC Analysis

> **Date:** February 2026
> **Purpose:** Comprehensive audit of OpenSidebar codebase against Phase 0–8 RFCs, identification of missing RFCs for critical use cases, and prioritized remediation roadmap.

---

## Part 1: Implementation Gap Summary Per Phase

### Phase 0 — Project Scaffold: **COMPLETE** ✅

All configs, manifest, build, lint, test harness in place. Minor deviations (e.g. `<all_urls>` host_permissions instead of scoped API domains) are acceptable pragmatic choices.

---

### Phase 1 — Content Script: **~90%** ⚠️

| Requirement                                                  | Status     | Notes                                                                |
| ------------------------------------------------------------ | ---------- | -------------------------------------------------------------------- |
| INTERACTIVE_SELECTORS (18 selectors)                         | ✅ Done    | Exact match with RFC                                                 |
| isElementVisible() (6 checks)                                | ✅ Done    |                                                                      |
| tagElements() + visual labels                                | ✅ Done    | MAX_TAGGED_ELEMENTS=200                                              |
| inferRole, getVisibleText, extractAttributes, isDisabled     | ✅ Done    |                                                                      |
| buildSnapshot(includeText, refresh)                          | ✅ Done    |                                                                      |
| extractViewportText() via TreeWalker                         | ✅ Done    | 15k char limit                                                       |
| click_element (z-index check, nav detection, event dispatch) | ✅ Done    |                                                                      |
| type_text (char-by-char, pressEnter, form submit)            | ✅ Done    |                                                                      |
| scroll_page, read_page, hover_element, find_element          | ✅ Done    |                                                                      |
| Janitor (cookie banner auto-dismiss)                         | ✅ Done    | 5 patterns                                                           |
| Message listener (DOM_SNAPSHOT_REQUEST, TOOL_EXECUTE)        | ✅ Done    |                                                                      |
| **querySelectorAllDeep() — Shadow DOM support**              | ❌ Missing | Comment in code says "for now standard". RFC explicitly requires it. |
| **tests/content/actions.test.ts**                            | ❌ Missing | Zero tests for action execution (206 lines of untested code)         |

---

### Phase 2 — Side Panel UI: **~85%** ⚠️

| Requirement                                  | Status     | Notes                                                                                                                 |
| -------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Zustand + Immer store                        | ✅ Done    | `src/sidepanel/store.ts`                                                                                              |
| Bridge (message listener → store updates)    | ✅ Done    | `src/sidepanel/bridge.ts`                                                                                             |
| ChatMessage / MessageBubble component        | ✅ Done    |                                                                                                                       |
| InputArea (send/stop, Enter key)             | ✅ Done    |                                                                                                                       |
| Header component                             | ✅ Done    |                                                                                                                       |
| WorkspaceSelector component                  | ✅ Done    | `src/sidepanel/components/WorkspaceSelector.tsx`                                                                      |
| **SettingsDrawer**                           | ❌ Missing | RFC specifies full settings UI (API keys, max turns slider, memory toggle, theme selector). Not found as a component. |
| **ToolCallBadge (risk-colored, expandable)** | ❌ Missing | RFC specifies collapsible badges with risk-level colors                                                               |
| **StatusBar (animated dot per AgentStatus)** | ❌ Missing | RFC specifies per-status color + animation config                                                                     |
| **Dark mode toggle via class**               | ❌ Missing | `useEffect` for `document.documentElement.classList` not found                                                        |
| **Stream chunk handling in bridge**          | ⚠️ Partial | STREAM_CHUNK handler exists but streaming parser missing on backend                                                   |

---

### Phase 3 — Agent Loop: **~40%** 🔴 CRITICAL GAPS

| Requirement                                                     | Status     | Notes                                                                                                                                                                                       |
| --------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic agent loop (LLM → tool → LLM cycle)                       | ✅ Done    | `AgentLoop` class in `agent/loop.ts`                                                                                                                                                        |
| LLMClient (Cerebras API calls)                                  | ✅ Done    | `llm/client.ts`                                                                                                                                                                             |
| ToolRegistry singleton pattern                                  | ✅ Done    | `tools/registry.ts`                                                                                                                                                                         |
| 7 tools registered (click, type, scroll, read, memory×2, swarm) | ✅ Done    | `tools/index.ts`                                                                                                                                                                            |
| **8 tools NOT registered**                                      | ❌ Missing | navigate, create_tab, close_tab, switch_tab, wait, done, take_screenshot, hover_element — types exist but tool definitions absent. Won't appear in LLM function calling schema.             |
| **Special tool handling in loop**                               | ❌ Missing | All tools route through generic `toolRegistry.execute()` → content script. navigate/wait/done/screenshot/tab tools will **fail** because they need service-worker APIs, not content script. |
| **SSE streaming parser (`streaming.ts`)**                       | ❌ Missing | Entire module absent. No `stream: true` in API calls. User sees nothing until full response completes.                                                                                      |
| **Sliding window with token estimation**                        | ❌ Missing | Current: naive truncation to 20 messages. RFC: token-based windowing with Goal Amnesia prevention.                                                                                          |
| **Security module (`security.ts`)**                             | ❌ Missing | No `classifyRisk()`, no `sanitizeUrl()`, no `sanitizeUserInput()`. RiskLevel enum defined but unused.                                                                                       |
| **Service worker keepalive alarm**                              | ❌ Missing | No `chrome.alarms` usage. SW will terminate during long operations.                                                                                                                         |
| **System prompt completeness**                                  | ⚠️ Partial | Minimal template vs RFC's detailed rules (15 capabilities, 8 explicit rules, vision section)                                                                                                |
| **Cerebras streaming**                                          | ❌ Missing | `stream: true` not in payload, no response body stream parsing                                                                                                                              |

---

### Phase 4 — Navigation Bridge: **~5%** 🔴 CRITICAL — ALMOST ENTIRELY MISSING

| Requirement                                                  | Status     | Notes                                                                               |
| ------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| State persistence before navigation (`chrome.storage.local`) | ⚠️ Partial | Uses `session` not `local`; no NavigationState wrapper, no pendingToolCall tracking |
| **`webNavigation.onCompleted` handler**                      | ❌ Missing | No listener registered. Agent cannot resume after page load.                        |
| **`webNavigation.onErrorOccurred` handler**                  | ❌ Missing |                                                                                     |
| **`tabs.onRemoved` for navigation cleanup**                  | ❌ Missing | Only workspace-related handler exists                                               |
| **`resumeAgentLoop()` function**                             | ❌ Missing |                                                                                     |
| **`runtime.onStartup` stale state cleanup**                  | ❌ Missing |                                                                                     |
| **Timeout detection (30s)**                                  | ❌ Missing |                                                                                     |

---

### Phase 5 — Kimi Swarm: **~75%** ⚠️

| Requirement                             | Status     | Notes                                                                                 |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `callKimiSwarm()` function              | ✅ Done    | `src/background/swarm.ts`                                                             |
| OpenRouter API integration              | ✅ Done    | Correct headers and auth                                                              |
| Swarm system + user prompt construction | ✅ Done    |                                                                                       |
| Model selection (moonshot-v1-128k)      | ✅ Done    |                                                                                       |
| **Streaming response**                  | ❌ Missing | Uses non-streaming fetch. RFC specifies streaming with SSE + forwarding chunks to UI. |
| **Timeout + retry (120s, 1 retry)**     | ❌ Missing | No AbortController, no retry logic                                                    |
| **Report truncation (8000 char limit)** | ❌ Missing |                                                                                       |

---

### Phase 6 — Memory (Second Brain): **~35%** 🔴 SIGNIFICANT GAPS

| Requirement                                | Status     | Notes                                                                        |
| ------------------------------------------ | ---------- | ---------------------------------------------------------------------------- |
| Offscreen document lifecycle               | ✅ Done    | `memory/bridge.ts` — proper creation/reuse                                   |
| Message flow (background ↔ offscreen)      | ✅ Done    | Request/response with requestId correlation                                  |
| Embedding via Transformers.js (@xenova)    | ✅ Done    | But on main thread, not web worker                                           |
| IndexedDB storage for memory entries       | ✅ Done    |                                                                              |
| **Web Worker isolation for embeddings**    | ❌ Missing | Runs on offscreen main thread; RFC specifies separate `memory-worker.ts`     |
| **SQLite FTS5 keyword search**             | ❌ Missing | No sql.js usage despite being a dependency. FTS5Row type defined but unused. |
| **Voy vector search**                      | ❌ Missing | Brute-force cosine similarity used instead. Won't scale past ~1000 entries.  |
| **Reciprocal Rank Fusion (RRF) algorithm** | ❌ Missing | Only semantic search; `scores.keyword` hardcoded to 0                        |
| **IndexedDB persistence for SQLite + Voy** | ❌ Missing | Only entry-level IDB persistence                                             |
| **PDF text extraction**                    | ❌ Missing | pdfjs-dist is a dependency but unused                                        |

---

### Phase 7 — Workspaces: **~85%** ⚠️

| Requirement                                                       | Status     | Notes                                           |
| ----------------------------------------------------------------- | ---------- | ----------------------------------------------- |
| WorkspaceManager (create, delete, select)                         | ✅ Done    |                                                 |
| Chrome Tab Groups API                                             | ✅ Done    |                                                 |
| Storage persistence                                               | ✅ Done    |                                                 |
| Tab filtering in agent loop                                       | ✅ Done    |                                                 |
| WorkspaceSelector UI + message handlers                           | ✅ Done    |                                                 |
| Tab group change tracking                                         | ⚠️ Partial | `handleTabRemoved` has unfinished TODO comments |
| **Auto-grouping new agent-created tabs**                          | ❌ Missing |                                                 |
| **`addTabToWorkspace` / `removeTabFromWorkspace` public methods** | ❌ Missing |                                                 |

---

### Phase 8 — Testing: **~40%** 🔴

| RFC-Specified Test File                 | Status                         |
| --------------------------------------- | ------------------------------ |
| tests/setup.ts                          | ✅ Done                        |
| tests/content/tagging.test.ts           | ✅ Done                        |
| tests/content/snapshot.test.ts          | ✅ Done                        |
| tests/background/swarm.test.ts          | ✅ Done                        |
| tests/background/workspaces.test.ts     | ✅ Done                        |
| tests/sidepanel/store.test.ts           | ✅ Done (bonus — not in RFC)   |
| tests/utils/logger.test.ts              | ✅ Done (bonus — not in RFC)   |
| tests/background/agent.test.ts          | ✅ Done (bonus — not in RFC)   |
| **tests/content/actions.test.ts**       | ❌ Missing                     |
| **tests/background/context.test.ts**    | ❌ Missing                     |
| **tests/background/streaming.test.ts**  | ❌ Missing (code also missing) |
| **tests/background/security.test.ts**   | ❌ Missing (code also missing) |
| **tests/background/tools.test.ts**      | ❌ Missing                     |
| **tests/background/navigation.test.ts** | ❌ Missing (code also missing) |
| **tests/memory/rrf.test.ts**            | ❌ Missing (code also missing) |
| **tests/memory/fts5.test.ts**           | ❌ Missing (code also missing) |
| **bunfig.toml** (test preload config)   | ❌ Missing                     |

---

## Part 2: Gap Analysis — Missing RFCs

The audit identified 6 potential RFC gaps. After analysis (using modern AI assistants as a reference UX model), **none require a new RFC document**. They split into two categories:

### Category A: Already Spec'd — Just Needs Implementation

These gaps look missing at first glance, but the existing RFCs already contain the specs. No new design work needed.

**1. Streaming Architecture** — Phase 3 RFC already fully specifies: `parseSSEStream()`, tool_call delta accumulation, `[DONE]` sentinel, `STREAM_CHUNK` message forwarding. Pipeline: `LLM API (SSE) → parseSSEStream() → background → STREAM_CHUNK → bridge.ts → Zustand → React`. Identical to how modern AI assistants stream.

**2. Settings Persistence & Sync** — Phase 2 RFC already specifies the `SettingsDrawer` component. `UserSettings` type already defined. Standard Chrome extension pattern: `chrome.storage.sync` for settings, load on mount, broadcast `SETTINGS_UPDATE` on change. Matches modern AI assistant settings panels.

**3. Error Recovery & Graceful Degradation** — Phase 8 RFC has a complete error-handling matrix (17 rows mapping every error to severity + handling). Patterns follow modern AI assistants: inline error messages, retry affordance, graceful fallback when subsystems (memory, swarm) are unavailable.

### Category B: Decisions Resolved — No New RFC Needed

These gaps required product decisions. All three are resolved with "keep it simple, match modern AI assistants."

**4. User Confirmation for High-Risk Actions** — **Decision: No confirmation gate.** The agent acts autonomously once the user submits a task. The Stop button is the safety mechanism. Risk classification is still logged and displayed via ToolCallBadge (informational, not blocking). Gating navigate/close_tab would make multi-step tasks unusable.

**5. Multi-Tab Agent Coordination** — **Decision: Active-tab-only context.** When agent calls `switch_tab(tabId)`, that tab becomes active. Agent must call `read_page` to see the new tab's DOM. Previous tab's snapshot is gone from context (conversation history retains what was discussed). No multi-tab snapshot caching.

**6. Onboarding & First-Run Experience** — **Decision: Empty state with example prompts (deferred to post-P2).** If no API key is set, show "Set up your API key" card. Once configured, show 3-4 clickable example prompts. Matches modern AI assistants. Not a priority until core functionality works.

---

## Part 3: Prioritized Implementation Roadmap

Based on severity of gaps and user-facing impact:

### P0 — Blocks Core Functionality

1. **Register the 8 missing tools** (navigate, create/close/switch_tab, wait, done, take_screenshot, hover_element) in `tools/index.ts` with proper service-worker-side executors
2. **Add special tool handling in agent loop** — route navigate/tab/wait/done/screenshot to SW APIs instead of content script
3. **Implement SSE streaming parser** (`streaming.ts`) + enable `stream: true` in LLM client
4. **Implement `security.ts`** — classifyRisk, sanitizeUrl, sanitizeUserInput

### P1 — Required for Reliability

5. **Navigation Bridge** — `webNavigation.onCompleted`, state persistence to `chrome.storage.local`, `resumeAgentLoop`, timeout detection
6. **Service worker keepalive** — `chrome.alarms` during active agent loops
7. **Sliding window with token estimation** — replace naive 20-message truncation
8. **System prompt enrichment** — add all 8 rules from RFC, full tool capability list

### P2 — Required for Feature Completeness

9. **Memory: SQLite FTS5** — initialize sql.js, create FTS5 table, keyword search
10. **Memory: Voy vector search** — replace brute-force cosine similarity
11. **Memory: RRF algorithm** — combine semantic + keyword results
12. **Memory: Web Worker isolation** — move embeddings off main thread
13. **Swarm: timeout/retry + report truncation**
14. **UI: SettingsDrawer, ToolCallBadge, StatusBar** components
15. **Content: Shadow DOM support** (`querySelectorAllDeep`)

### P3 — Testing

16. `tests/content/actions.test.ts` — click, type, scroll, hover, find
17. `tests/background/context.test.ts` — sliding window
18. `tests/background/security.test.ts` — risk classification, URL sanitization
19. `tests/background/tools.test.ts` — schema validation
20. `tests/background/navigation.test.ts` — state save/restore
21. `bunfig.toml` with `[test] preload = ["./tests/setup.ts"]`
