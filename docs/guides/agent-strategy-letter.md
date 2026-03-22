# Technical Strategy Letter: OpenSidebar Browser Agent

*A deep-dive reference for engineers and AI practitioners on how a generic browser agent solves arbitrary browser tasks.*

---

## 1. Introduction & Design Philosophy

OpenSidebar is a Chrome extension that runs an autonomous browser agent. Given a natural-language instruction — "book a flight," "fill out this tax form," "find and compare prices across three sites" — it perceives the page, reasons about what to do, acts through the DOM, and verifies the result. It repeats this cycle until the task is done.

The core design principle is **generic over task-specific**. There are no site-specific heuristics anywhere in the system. The agent adapts through prompting and demonstrations, never through code. The guiding question behind every architectural decision: *"Would this work on a site I've never seen?"*

The entire LLM pipeline runs through a single provider, **OpenRouter**, with two model tiers:

| Tier | Model | Role |
|------|-------|------|
| Executor | `google/gemini-3-flash-preview` | Default for all turns — fast, cheap, good enough for most DOM interactions |
| Planner | `minimax/minimax-m2.5` | Activated on escalation for complex reasoning (puzzles, multi-step logic, recovery from stuck states) |

Both share the same `LLMClient` class. Escalation triggers `switchToPlanner()` — once the planner model is active, it stays active for the remainder of the session.

---

## 2. Perception: How the Agent Sees the Page

Every turn, the agent receives a **DOM snapshot** — a structured representation of the page state injected into the system prompt. The snapshot contains:

- **Tagged interactive elements** (max 50 per snapshot): buttons, inputs, links, selects, canvas elements, `[draggable]` elements, and anything matching ARIA roles (`role='button'`, `role='tab'`, etc.)
- **Visible content** (up to 15,000 chars raw, compressed dynamically): the visible text content, with lightweight structural markers (`## ` for headings, `- ` for list items, `\n` for block elements)
- **Scroll position**: `y/maxY` pixels with percentage and directional indicators ("more content below," "at bottom of page")
- **Page metadata**: title, URL

### Stable Element IDs

Elements are identified by **stable hash-based IDs** rather than ephemeral DOM indices. The hash is FNV-1a of four components concatenated:

```
tagName | domPath | text (first 30 chars) | attrSignature (id, name, type, role, href, aria-label, data-testid)
```

This hash maps to a persistent integer ID via a `hashToId` map that survives across snapshot refreshes. When an element disappears from the DOM, its ID enters a **1-cycle grace period** — it's kept for one more refresh in case the DOM is temporarily in flux (SPA transitions, animations). On the second consecutive absence, the hash is cleaned up.

On full page navigation (not SPA transitions), `resetStableIds()` clears the entire map and counter.

### Inline Clickable Detection

Beyond the standard `INTERACTIVE_SELECTORS` (20 CSS selectors covering `a[href]`, `button`, `input`, `[role='button']`, `canvas`, etc.), the content script runs a **Phase 2 scan** using a TreeWalker to detect elements with `cursor:pointer` in computed style that weren't captured by the selector list. This catches custom clickable divs, styled spans acting as buttons, and other non-semantic interactive elements.

The scan is **time-budgeted to 10ms** to avoid blocking on heavy pages. It only tags "leaf-ish" elements: text between 1-200 characters, 3 or fewer children, and not a large container (`div`, `section`, `nav`, etc. with >3 children).

### Label Association

For form elements (`input`, `textarea`, `select`), the tagging system resolves labels through three mechanisms in priority order:

1. **Explicit**: `<label for="elementId">` — queries `label[for="..."]`
2. **Implicit wrapper**: walks up to the nearest `<label>` ancestor and extracts its text (minus the input's own value)
3. **`aria-labelledby`**: resolves space-separated ID references and concatenates their text content

The resolved label is stored as a `label` attribute on the tagged element, giving the LLM critical context for understanding form fields.

### Compact Element Format

Each element is rendered in a single-line token-efficient format:

```
[1] button#submit type=submit "Submit"
[2] input name=email type=email placeholder=you@example.com "Email" (textbox)
[3] a href=/dashboard "Dashboard" (link)
```

The format is `[tag] tagName#id attrs "text" (role)`. Role is only shown when it differs from the tag name. Multi-word attribute values are quoted. Random hash IDs (detected by regex heuristics) are filtered out to save tokens.

---

## 3. The Core Loop: Observe, Think, Act, Verify

The agent loop (`AgentLoop.loop()`) is a while-loop bounded by `maxTurns` (default 30, user-configurable). Each iteration:

1. **Observe**: The system prompt is rebuilt with the current DOM snapshot (elements, visible content, scroll position, URL). If a plan is active, the current step is injected.

2. **Think**: The LLM is prompted to produce 2-3 lines of structured reasoning:
   - *What do I see?* (key page state, relevant elements)
   - *What will I do and why?* (connect observation to action)
   - *What should change?* (predicted outcome to verify next turn)

3. **Act**: The LLM emits one or more tool calls. These are dispatched to the content script (for DOM actions) or executed in the service worker (for `chrome.*` API calls).

4. **Verify** (next turn): The agent compares its predicted outcome against the actual page state. On mismatch, it states what went wrong and tries a different approach.

### Streaming & Think Tags

Streaming is always enabled. The LLM response is streamed via SSE, with text deltas forwarded to the side panel in real time via `STREAM_CHUNK` messages. `max_tokens` is set to 4096. `tool_choice: "auto"` is sent whenever tools are present.

Some models emit `<think>...</think>` reasoning blocks inline. These are handled at three levels:

- **Streaming UI**: A `createThinkFilter()` state machine suppresses think blocks from the text deltas sent to the side panel. It tracks chunk boundaries to avoid cutting in the middle of a tag.
- **Conversation history**: Think blocks are preserved **raw** in the message history. This is critical — the planner's reasoning chain continuity improves significantly when it can see its own prior reasoning.
- **Logic/logging**: `stripThinkTags()` produces `cleanContent` used for reflection detection, tool call recovery, and structured logging. The non-streaming `complete()` method (used by the TaskPlanner) strips think tags from its return value since the planner needs clean JSON for parsing.

---

## 4. The 38-Tool Ecosystem

The agent has 38 tools organized into categories:

### DOM Interaction (7 tools)
| Tool | Description | Sequential | DOM-Modifying |
|------|-------------|:----------:|:-------------:|
| `click_element` | Click by tag ID | No | Yes |
| `type_text` | Type into input, optional Enter | No | Yes |
| `select_option` | Select dropdown by visible text | No | Yes |
| `hover_element` | Hover to reveal menus/tooltips | No | Yes |
| `drag_and_drop` | Drag between `[draggable]` elements | No | Yes |
| `hide_element` | Set `display:none` on overlays | No | Yes |
| `draw_stroke` | Draw on canvas with coordinates | No | No |

### Inspection & Navigation (5 tools)
| Tool | Description | Sequential | DOM-Modifying |
|------|-------------|:----------:|:-------------:|
| `read_page` | Re-scan for fresh elements and text | No | Yes* |
| `scroll_page` | Scroll page or container | No | No |
| `find_element` | Text search, scroll to match, return tag ID | No | No |
| `navigate` | Go to URL, wait for load | Yes | No |

*`read_page` is marked `domModifying` so the loop refreshes the snapshot after it runs, keeping element tags in sync.

### Tab Management (3 tools)
| Tool | Description |
|------|-------------|
| `create_tab` | Open new tab (auto-adds to workspace) |
| `close_tab` | Close tab by ID |
| `switch_tab` | Switch to another tab |

### Agent Control (1 tool)
| Tool | Description | Sequential |
|------|-------------|:----------:|
| `escalate` | Request smarter model with reason | Yes |

### Meta (1 tool)
| Tool | Description | Sequential |
|------|-------------|:----------:|
| `done` | Signal completion with summary | Yes |

### Parallel vs. Sequential Execution

Tools are classified as **sequential** or **parallelizable** via the `ToolMeta` interface. The sequential set includes `navigate`, `done`, and `escalate`.

When the LLM emits multiple tool calls in a single turn:
- If **none** are sequential → all execute in parallel via `Promise.all()`
- If **any** are sequential → all execute one at a time in order

This means the agent can batch multiple `click_element` + `type_text` calls in one turn (e.g., filling a form), but a `navigate` always runs alone.

### DOM-Modifying Tools & Snapshot Refresh

After all tool calls in a turn complete, if any tool in the `DOM_MODIFYING_TOOLS` set was called (and `done` wasn't signaled), the loop performs **one batched snapshot refresh**. This includes a 100ms SPA wait, and if the element count drops from N to 0 (SPA hasn't rendered yet), it retries at 300ms and 500ms delays.

### Tool Call Recovery

When models emit JSON tool calls as plain text instead of using the `tool_calls` API field, `recoverToolCallsFromText()` extracts them. It parses the text for structured JSON matching the tool call schema and converts them into proper `ToolCall` objects. This is a reliability fallback — some models occasionally "forget" to use the function calling API.

---

## 5. Planning & Task Decomposition

### The TaskPlanner

Before the first LLM turn, a `TaskPlanner` instance (always using `MODEL_PLANNER`) analyzes the user's query and page context. It decides:

- **Simple task** (one click, one field, one navigation): returns `null`, no plan created
- **Multi-step task**: decomposes into 2-8 subtasks, each expected to require 1-5 tool calls

The planner's decomposition prompt enforces generic behavior: *"Be generic — derive steps from the task description and page context, not assumptions about the site."*

### Plan Injection

When a plan exists, it's injected into the system prompt every turn as an "Active Plan" section:

```
## Active Plan
Step 2 of 4: "Fill out the shipping address form"
Completed:
  1. Navigate to the checkout page [done]
Next: 3. Select shipping method
Execute the current step now and verify completion before continuing.
```

This keeps the agent oriented on exactly one step at a time, preventing it from jumping ahead or losing track.

### Advancing the Plan

When the agent completes a subtask, the loop advances plan state internally:

1. Updates `planSubtasks` status (completed / running / pending)
2. Updates the system prompt's plan section via `context.setPlanStatus()`
3. Broadcasts `TASK_PROGRESS` to the side panel
4. Returns a directive: *"NOW EXECUTE Step N of M: description"*

When `currentIndex` exceeds the subtask count, the directive becomes: *"All N steps are done. Call done() now with a summary of everything accomplished."*

### Done Validation

When the agent calls `done()` and a plan exists, the planner validates:

1. Sends the original query, plan subtasks, agent summary, and page context to `MODEL_PLANNER`
2. The validation prompt is strict: *"ALL planned subtasks must be reasonably covered by the summary to approve. Partial completion is NOT completion."*
3. If rejected, the rejection reason is injected as a tool result: `"done() REJECTED: [reason]. Continue working."`
4. **Safety valve**: After 3 rejections (`MAX_DONE_REJECTIONS`), the done is forced through regardless. This prevents infinite loops when the planner is overly strict.

---

## 6. Dynamic Context Management

The `ContextManager` implements a sliding-window conversation history with dynamic compression driven by token budget utilization.

### Compression Levels

| Level | Utilization | Visible Content | Element Text | Element Count | Attributes |
|-------|:-----------:|:-------------:|:------------:|:-------------:|:----------:|
| NONE | 0-50% | Full | Full | All 50 | All |
| LIGHT | 50-70% | 3,000 chars | 40 chars | All 50 | All |
| MEDIUM | 70-85% | 2,000 chars | 20 chars | All 50 | id, role, type, href, label, description |
| HEAVY | 85%+ | Removed | 15 chars | Top 10 | role, type, description |

The compression level is computed from estimated token counts: base template (~550 tokens), elements, visible content, plan status, and full history. Token estimation uses `text.length / 4` as a fast approximation.

### HEAVY Mode Element Scoring

In HEAVY compression, only the top 10 elements are kept, scored by navigation relevance:

| Pattern | Score |
|---------|:-----:|
| Text matches `/submit\|login\|sign\|search\|next\|continue/i` | +3 |
| Tag is `input`, `textarea`, or `select` | +2 |
| Tag is `a` with `href` | +1 |

### History Management

- **Goal Amnesia Prevention**: The first user message is always preserved in the prompt window, regardless of how many turns have elapsed. This prevents the agent from forgetting the original task.
- **Recent preservation**: The last 2 tool results are kept verbatim.
- **Old tool result compression**: Tool results beyond the 2 most recent are truncated to 150 characters (first line, up to 100 chars, plus `[truncated]`). Screenshot tool results become `[screenshot truncated]`.
- **Sliding window**: Messages are selected from the end (most recent) and packed until the token budget is exhausted. Assistant-tool pairs are grouped to avoid orphaned results.
- **Sanitization**: After windowing, orphaned tool results (whose assistant message was dropped) are removed. Assistant messages with missing tool results have their `tool_calls` stripped.

### Token Budget

The default context window is 32,000 tokens (`maxContextTokens`, user-configurable). 1,000 tokens are reserved for output. The system prompt is computed first; remaining budget goes to history.

---

## 7. Stuck Detection & Graduated Intervention

The `StagnationMonitor` detects stuck loops by **snapshot fingerprinting**. After each DOM-modifying action, it computes a fingerprint of the page state:

```
URL | elementCount | sorted(tagName:text[:30]:visibility:stateAttrs)
```

State attributes tracked: `disabled`, `checked`, `aria-expanded`, `value`, `selected`, `aria-selected`.

If the fingerprint is identical across consecutive turns, the stale counter increments. Intervention thresholds:

| Stale Turns | Action |
|:-----------:|--------|
| 6 | **Reflection**: Injects a structured prompt forcing the agent to apply the Verify step (expected vs. actual), then try ONE different approach from a specific list (screenshot, scroll, press_key, find_element) |
| 12 | **Escalate**: Switches to `MODEL_PLANNER`, takes fresh screenshot, instructs agent to start fresh analysis |
| 18, 24, ... | **Repeat reflection** every 6 turns after escalation |

On recovery (fingerprint changes after a stuck period), an `AGENT_STAGNATION` message with signal `"resolved"` is broadcast to the side panel, clearing the stuck banner.

---

## 8. Model Escalation

Escalation is a one-way upgrade from `MODEL_EXECUTOR` to `MODEL_PLANNER`. There are two paths:

### Voluntary Escalation

The agent calls `escalate({reason: "..."})`. The loop intercepts this before the executor:

1. Calls `llm.switchToPlanner()`
2. Refreshes the DOM snapshot (with retry — critical that the new model sees current state)
3. Injects `ESCALATION_REFLECTION` as the tool result

### Automatic Escalation

Triggered by either:

- **Stuck detection**: 12 consecutive stale fingerprints (see Section 7)
- **Repeated text-only responses**: After 2 consecutive reflections for text output (no tool calls), escalation fires

### The Escalation Reflection

Both paths inject the same constant:

> *You are now the upgraded model, brought in because the previous model got stuck. Review the conversation history and current page state. Then:*
> 1. *Identify what was attempted and why it failed.*
> 2. *Formulate a different strategy — do not repeat what already failed.*
> 3. *Call the appropriate tool to advance the task.*
> *If the page state is unclear, start with read_page.*

### Post-Escalation Behavior

If the agent calls `escalate` again after already being escalated, it receives:

> *Already using the most capable model. Escalation won't help further. Try a fundamentally different approach: read_page, or a completely different interaction strategy.*

---

## 9. Text-Only Response Handling

When the LLM returns text without any tool calls, the loop applies a graduated intervention:

1. **Turn 1, substantive text, no plan**: Likely answering a user question. Soft reflection suggesting `done({"summary": "..."})` to deliver the answer.

2. **Regular reflection**: Refreshes the snapshot and injects the `REFLECTION_MESSAGE`, which reminds the agent to either call a tool or wrap its answer in `done()`.

3. **Escalation gate (2 consecutive reflections)**: Switches to `MODEL_PLANNER`, refreshes snapshot, injects `ESCALATION_REFLECTION`.

4. **Give-up (3 consecutive reflections)**: Stops the loop, surfaces the last text response to the user with a "send a follow-up to continue" message.

5. **Ratio-based give-up**: After 10+ turns post-escalation, if >40% of all turns were text-only (no tool calls), the loop gives up.

---

## 10. Navigation Resilience

When the agent navigates to a new page (via `navigate()` or clicking a link that triggers navigation), the content script is destroyed. The navigation bridge handles this:

1. **Before navigation**: `AgentLoopState` (messages, turn count, pending tool call) is serialized to `chrome.storage.local` under key `opensidebar:agentState`.

2. **During navigation**: `webNavigation.onCompleted` and `webNavigation.onErrorOccurred` listeners wait for the page to load.

3. **After navigation**: The listener verifies the event matches the tracked tab (main frame only, `frameId === 0`), checks for timeout (30 seconds), waits 500ms for content script initialization, injects the navigation result as a tool message, and resumes the agent loop.

4. **Error handling**: If navigation fails (`onErrorOccurred`), the error is injected as a tool result so the agent can recover. If the tab is closed during navigation (`tabs.onRemoved`), the state is cleaned up.

5. **Stale cleanup**: On browser startup (`runtime.onStartup`), any navigation state older than the timeout is cleared.

URL history is tracked across multi-page workflows via `urlHistory[]`, included in the `TASK_COMPLETION` message at the end.

---

## 11. Pre-Agent Page Preparation

Before the first LLM turn, the content script runs `autoDismissModals()` to clear cookie banners, consent dialogs, and overlay modals that would obstruct the agent's view.

The dismissal runs in four phases:

**Phase A: Selector-based**
Queries for known patterns: `[role='dialog']`, `[role='alertdialog']`, `.modal`, `.overlay`, `.popup`, `.banner`, `.cookie`, `.consent`. For each match that's visible and has `position: fixed/sticky` or `z-index > 100`, it tries the close button first, then falls back to `display: none`.

**Phase B: Viewport-cover detection**
Scans all elements for `position: fixed/absolute` covering >50% of the viewport area. For each:
- If it's a backdrop (has `backdrop-filter` or semi-transparent `rgba` background) → hide directly
- Otherwise → try close button, then hide

Close button discovery priority:
1. `aria-label` containing "close" or "dismiss"
2. CSS class containing "close," "dismiss," "btn-close"
3. Buttons with `X`/`×`/`✕` text in the top-right quadrant of the overlay

**Phase C: ESC dispatch**
If anything was dismissed, dispatches a `keydown` event with `key: "Escape"` to catch keyboard-driven overlays.

**Phase D: Re-scan**
Detects remaining viewport-covering overlays. If any survive, they're dynamically tagged and reported as `survivingOverlays` in the snapshot, with a warning injected into the system prompt: *"WARNING: Overlay [tagId] covers N% of viewport — use click_element or hide_element to dismiss."*

---

## 12. Perception Layer

Instead of a manual `take_screenshot` tool, OpenSidebar uses an automatic **perception layer** (`src/background/perception.ts`) that runs after every DOM-modifying action. The `perceive()` function:

1. Captures the visible tab as a screenshot via `chrome.tabs.captureVisibleTab`
2. Sends the screenshot + element summary to a vision model for structured interpretation
3. Returns a compact 6-section interpretation (LAYOUT, STATE, CONTENT, VISUAL-ONLY, BLOCKERS, SPATIAL) at ~150 tokens — replacing ~4K of raw visible text

The perception layer uses OpenRouter with `x-ai/grok-4.1-fast` for vision-based page understanding. 429/4xx errors trigger retry with exponential backoff.

Response parameters: `max_tokens: 600`, `temperature: 0.1`, timeout 20s. Up to 2 retries with 800ms base delay and exponential backoff plus jitter. Fingerprint-based caching (via `computeSnapshotFingerprint()`) avoids redundant calls when the page hasn't changed.

Perception usage is tracked via `recordVisionUsage()` directly in the agent loop, so vision costs appear in session metrics.

---

## 13. Session Metrics & Cost Transparency

Every LLM call (agent turns, planner decomposition, planner validation, vision) reports token usage back to `AgentLoop.recordUsage()`. The accumulated `SessionMetrics` include:

- Total prompt/completion/combined tokens
- Total cost (from OpenRouter's inline `usage.cost` field — no extra API calls)
- Total LLM wall-clock time
- Total session wall-clock time
- LLM call count
- **Per-model breakdown**: when escalation occurred, the metrics show separate token/cost/call counts for each model used

Metrics are broadcast to the side panel as `SESSION_METRICS` messages every 3 turns and on completion. The side panel renders them in a compact `MetricsBar`: `12.4K tokens / $0.0023 / 4.2s LLM`. On task completion, a `CompletionSummary` shows full metrics with per-model breakdown.

The feature is opt-in via `showSessionMetrics` in user settings (default: off).

---

## 14. Service Worker Lifecycle

Chrome MV3 service workers can terminate after ~30 seconds of inactivity. During an agent loop run, the `keepalive.ts` module creates a repeating `chrome.alarms` alarm (~24-second interval) that prevents termination. The alarm is started when the loop begins and stopped when it ends.

For longer-term state preservation, the `ContextManager` auto-saves conversation history to `chrome.storage.session` after every message addition. On service worker restart, `loadState()` restores the history, allowing the loop to continue from where it left off.

---

## 15. Strengths and Known Limitations

### Strengths

- **Generic**: No site-specific code. Works on any website the user can visit.
- **Self-correcting**: The Verify step + stuck detection + model escalation create a multi-layered recovery system. The agent doesn't just try harder — it tries differently.
- **Cost-efficient**: Starts with the cheapest viable model, escalates only when needed. Dynamic compression adapts context to budget. Compact element format saves ~300-450 tokens per turn compared to verbose representations.
- **Vision-assisted**: The automatic perception layer interprets the page visually every turn, capturing spatial layout, canvas content, and non-DOM elements that pure DOM inspection would miss.
- **Transparent**: Session metrics expose exactly how many tokens and dollars each task costs, with per-model breakdowns.

### Known Limitations

- **50-element cap**: Pages with hundreds of interactive elements (e.g., complex dashboards, data tables) will only see the first 50 visible elements. The agent can mitigate this with `scroll_page` and `find_element`, but may miss elements entirely.
- **Perception latency**: Each perception call adds 1-3 seconds of latency for the vision model round-trip, though fingerprint-based caching avoids redundant calls.
- **Model-dependent reasoning quality**: The agent is only as good as the underlying LLMs. Gemini 3 Flash handles routine interactions well but struggles with complex multi-step logic. MiniMax M2.5 is stronger but slower and more expensive.
- **No iframe support**: The content script only sees the top-level document. Elements inside iframes are invisible to the agent.
- **Single-tab focus**: While tab management tools exist, the agent can only actively observe one tab at a time. Cross-tab coordination requires explicit switching.
- **No file upload/download**: The agent cannot interact with native file dialogs or manage downloads.

---

*This document reflects the implementation as of March 2026. All numbers, thresholds, and model names are verified against the source code.*
