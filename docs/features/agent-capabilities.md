# Agent Capabilities

OpenSidebar features a multi-tier agent system with orchestrated task decomposition, learned skills, and conversation-driven collaboration between planner, executor, and verifier roles.

## Unified Agent Mode

OpenSidebar uses a single **Unified Mode** that combines the speed of parallel execution with the intelligence of adaptive planning.

### Key Features

- **Parallel Tool Execution**: Multiple non-conflicting actions in a single turn (e.g., reading several elements, checking multiple checkboxes).
- **Dynamic Context Compression**: Automatic history compression (NONE→LIGHT→MEDIUM→HEAVY) to maintain performance within token budgets.
- **Real-Time Streaming**: See the agent's thought process and actions character-by-character.
- **Context Distillation**: On escalation, `summarizeTrajectory()` compresses full history into a structured timeline (~1K tokens).

## Two-Tier LLM Architecture

| Tier | Model | Providers | Purpose |
|------|-------|-----------|---------|
| **Executor** (tier 0) | GPT-OSS-120B | Groq → OpenRouter | Default execution |
| **Planner** (tier 1) | DeepSeek V3.2 | OpenRouter | Planning, verification, escalation |

- GLM-4.7 has **native reasoning** (no reasoning parameter needed)
- Automatic failover with 60s cooldown per provider on 429 errors
- Token usage and cost tracked per model via `SessionMetrics`

## Orchestrator (Multi-Step Tasks)

For complex tasks, the orchestrator decomposes into a **planner→executor→verifier** pipeline:

1. **Planner** (planner model) decomposes the user query into a `TaskNode` graph
2. **Pre-flight Review** — verifier validates plans with 3+ nodes before execution
3. **Executor** (executor model) runs each node via the agent loop
4. **Verifier** (planner model) validates results against success criteria
5. **Retry/Reroute** — failed nodes get retried or sent back to planner

### Conversation Collaboration

The orchestrator uses structured multi-role conversations:

- **Structured Evidence**: Typed claims (tool_output/observation/inference) attached to every executor completion
- **Cross-Role Reflexion**: Verifier retry/reroute decisions flow back to planner as reflexion entries
- **Verifier-Critic Dialogue**: Multi-round debate for verification decisions
- **Advocate Triad**: On low-confidence retries, an advocate argues for the executor's work
- **Planner Retrospective**: After task completion with failures, planner extracts lessons learned

## Progress Tracking & Auto-Recovery

Sophisticated **Stuck Detection System** monitoring agent progress:

### Intervention Levels

1. **Escalate (3 stale turns)**: Switches to the planner model with distilled context and escalation screenshot.
2. **Give Up — Planner (8 stale turns)**: Stops if already on planner tier with 3+ text-only responses.
3. **Give Up — Executor (10 stale turns)**: Stops if on executor tier and no progress.

Additional watchdogs:
- **Step Watchdog**: Warns at 5 turns on a single plan step, force-escalates at 10.
- **Dead-End Detection**: Nudges at 3 identical outcomes, forces strategy pivot at 5 (sliding window of 6).

### Stale Element Recovery

When element IDs become stale (page changed dynamically):
1. Detects the "stale element" error
2. Refreshes the DOM snapshot
3. Retries the action with updated IDs

Stable hash-based element IDs (FNV-1a) minimize ID churn across snapshot refreshes.

## Loop Safety & Recovery

Mechanisms to prevent wasted turns and break out of stuck states:

### Failed-Action Memory

Blocks exact tool+args repeats that previously failed. `FAILED_ACTION_MEMORY` buffer holds the last 10 entries. After escalation, forces a strategy pivot if still failing after 5 turns.

### Redundant Action Detection

Sliding window of 8 recent actions. Warns at 2 consecutive repeats of the same action, blocks at 3 to prevent grinding loops.

### Stagnation Detection

Outcome fingerprinting via `normalizeOutcome()` detects when the agent keeps getting the same result. Reflection injected at 3 identical consecutive outcomes, strategy pivot forced at 5. Sliding window of 6 outcomes.

### Element ID Validation

Pre-dispatch check blocks `id=0` (never valid) and IDs not present in the current snapshot. Injects a hint with valid nearby IDs so the agent can self-correct.

### Tab Tool Taboo

Remembers tools that were blocked (e.g., `create_tab` when tab creation is restricted) and prevents re-attempts, saving turns.

### Tool Failure Circuit Breaker

Tracks consecutive tool failures. Warns at 4 failures, exits the loop at 6 to prevent infinite error cycling.

## Smart Element Tagging

Intelligent element selection ensures the most relevant elements appear within the tag budget:

### Task-Relevance Scoring

`scoreElement()` prioritizes elements by interaction value:
- Form inputs (`input`, `textarea`, `select`): +10
- Draggable elements and drop zones: +8
- Submit buttons and file inputs: +8
- Canvas elements: +6
- Elements with `name` or `id` attributes: +5

### Adaptive Element Cap

Default cap: 50 elements. Automatically raised to 75 on pages with `[draggable]` or dropzone elements (detected dynamically).

### Dynamic Tag Pinning

Elements found via `find_element` are assigned dynamic tags that survive 3 snapshot refresh cycles (`cyclesRemaining` TTL) with 5 overflow slots beyond the effective cap. Elements removed from the DOM are cleaned up immediately.

### Near-Identical Collapse

Groups similar elements (same tag name + text content) and keeps a maximum of 2 per group, reducing noise from repeated list items or table rows.

## Overlay Detection

Automatic and manual overlay/modal dismissal:

### Auto-Dismiss on Load (Janitor)

Runs on page load to clear cookie banners, consent dialogs, and notification popups using heuristic selectors for common frameworks (OneTrust, Google Funding Choices, generic patterns).

### Broadened Detection (Sprint 3)

Extended overlay selectors covering:
- `[aria-modal='true']`, `dialog[open]`, `<dialog>` elements
- `[data-modal]`, `[data-overlay]`, `[data-popup]` data attributes
- `.lightbox`, `.notification`, `.toast`, `.backdrop` class patterns
- Lowered viewport coverage threshold from 30% to 15% for earlier detection

### Manual Dismissal

The `dismiss_overlays` tool triggers on-demand modal cleanup via the `DISMISS_MODALS` message. Reports dismissed count, remaining overlays, and any captured text content.

## Skills System

Learned skills enable the agent to replay successful plans:

- **Teach Mode**: When ON and a task succeeds, the orchestrator extracts the plan as a reusable skill
- **Feedback Coaching**: During active runs, input area switches to amber "Send feedback..." mode for real-time guidance
- **Auto-Replay**: Matching skills are replayed on similar future queries
- **Management**: Settings → Learned Skills panel with pin/enable controls

## Perception Layer

The agent understands web pages through a vision-based perception layer:

- **Automatic perception**: After every DOM-modifying action, a screenshot + element summary is sent to a vision model
- **Structured output**: 6-section format (LAYOUT, STATE, CONTENT, VISUAL-ONLY, BLOCKERS, SPATIAL) at ~150 tokens
- **Provider failover**: Groq Llama 4 Scout (fastest) → OpenRouter GPT-4o-mini (fallback)
- **Fingerprint caching**: Unchanged pages skip redundant perception calls
- **Graceful degradation**: Element list always present even if vision fails

## React Toolkit

On-demand tools for React applications, gated behind framework detection:

- **`inspect_react`**: Read component state/props via fiber tree
- **`react_set_input`**: Set controlled input values using native value setter
- **`inspect_react_tree`**: Compact component hierarchy with state summaries
- **`wait_for_react`**: Poll until fiber tree stabilizes

Automatically enabled when React is detected on the page.

## Session Metrics

Real-time tracking of token usage and costs:

- Per-model breakdown (which provider actually served after failover)
- Compact display: `12.4K tokens · $0.0023 · 4.2s LLM · 850 tok/s`
- Cost from OpenRouter's inline `usage.cost`; Cerebras/Groq report tokens only
- Toggle via `showSessionMetrics` setting
