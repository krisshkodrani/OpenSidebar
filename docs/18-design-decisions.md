# Design Decisions Record

> **Goal:** Document resolved product and UX decisions for OpenSidebar that were identified as gaps during the RFC audit but don't require new technical RFCs — only a clear record of the decision and rationale.

---

## Decision 1: No User Confirmation Gate for High-Risk Actions

### Context

OpenSidebar's agent can perform high-risk browser actions: navigating to URLs, closing tabs, submitting forms, clicking buttons. The question was whether to gate these behind user approval (a confirmation dialog before each high-risk action) or let the agent act autonomously.

### Decision

**No confirmation gate.** The agent acts autonomously once the user submits a task.

### Rationale

- **User intent is established.** The user typed a request and pressed Send. They want the agent to complete the task.
- **Stop button is the safety mechanism.** The user can abort at any time by clicking Stop.
- **Gating breaks multi-step flows.** If the agent needs to navigate 5 pages, click 10 buttons, and fill 3 forms, asking for confirmation at each step makes it unusable.
- **Modern agent extensions precedent.** Leading AI assistants operate on the same principle — the user initiates, the agent executes, the user can stop.
- **Risk is informational, not blocking.** Tool calls still receive a `RiskLevel` classification (LOW/MEDIUM/HIGH). This is displayed in `ToolCallBadge` UI components for transparency. The user sees what the agent did, but after the fact.

### What This Means for Implementation

- `classifyRisk()` in `security.ts` still classifies every tool call
- Risk level is included in `ToolCallSummary` and displayed in the UI via `ToolCallBadge`
- No modal, toast, or blocking prompt before tool execution
- The agent loop's tool execution path has no conditional pause/resume logic

---

## Decision 2: Active-Tab-Only Context (No Multi-Tab Snapshots)

### Context

OpenSidebar has `create_tab`, `switch_tab`, and `close_tab` tools. The question was how DOM context flows when the agent operates across multiple tabs: should the agent see all tabs' DOM snapshots simultaneously, or only the active tab?

### Decision

**Active-tab-only context**, matching modern agent extension models.

### How It Works

1. The agent always sees the DOM snapshot of the **currently active tab**.
2. When the agent calls `switch_tab(tabId)`, that tab becomes the active tab.
3. The agent must call `read_page` to get the new tab's DOM snapshot.
4. The previous tab's DOM snapshot is **not retained** in context — it's gone.
5. However, the **conversation history** retains what the agent discussed about previous tabs (as text in assistant/tool messages).

### Rationale

- **Context window economy.** DOM snapshots are large (2-5K tokens each). Holding multiple tab snapshots would consume 10-25K tokens for just 5 tabs, leaving little room for conversation.
- **Simplicity.** One active snapshot is easy to reason about. "What is the agent looking at?" always has one answer.
- **Matches user mental model.** Users see one tab at a time. The agent operates the same way.
- **Conversation history provides continuity.** If the agent found a price on Tab A and needs to compare it on Tab B, the conversation history contains "Tab A showed $49.99". The LLM can reference this without needing the full DOM snapshot.

### What This Means for Implementation

- `read_page` always returns the active tab's snapshot (no tab ID parameter needed)
- The `ContextManager` holds at most one `DomSnapshot`
- `switch_tab` only calls `chrome.tabs.update(tabId, { active: true })` — it does NOT pre-fetch the new tab's snapshot
- The system prompt instructs the agent: "After switching tabs, call read_page to see the new tab."
- No snapshot caching layer needed

---

## Decision 3: Onboarding via Empty State + Example Prompts

### Context

New users installing QSidebar for the first time need to: (1) set up their API key, and (2) understand what QSidebar can do. The question was how much onboarding UX to invest in.

### Decision

**Empty state with example prompts + API key setup card.** Deferred to post-P2 priority.

### How It Works

#### State A: No API Key Configured

When `settings.cerebrasApiKey` is empty, the chat area shows:

```
┌─────────────────────────────┐
│                             │
│     [Key icon]              │
│                             │
│   Set up your API key       │
│   to get started            │
│                             │
│   [Open Settings]           │
│                             │
└─────────────────────────────┘
```

Clicking "Open Settings" opens the `SettingsDrawer`.

#### State B: API Key Set, No Messages

Once configured, the chat area shows example prompts:

```
┌─────────────────────────────┐
│                             │
│     Welcome to QSidebar     │
│                             │
│   Try asking:               │
│                             │
│   [Search for flights       │
│    to Paris on Google]      │
│                             │
│   [Fill out this form       │
│    with my info]            │
│                             │
│   [Summarize this page      │
│    and save to memory]      │
│                             │
│   [Find the cheapest        │
│    option on this page]     │
│                             │
└─────────────────────────────┘
```

Each example prompt is a clickable chip. Clicking it populates the input field with the text and focuses the input (does not auto-send).

### Rationale

- **Low effort, high value.** Example prompts teach by showing, not telling. 4 examples cover the main use cases (search, form fill, summarize, compare).
- **Modern AI assistants precedent.** Leading AI assistants use exactly this pattern — empty state with suggested prompts.
- **API key setup is critical path.** Without a key, nothing works. Making it the first thing the user sees is correct.
- **No wizard needed.** A multi-step onboarding wizard is over-engineered for a power-user tool. Users who install a Chrome extension for browser automation can handle "paste your API key."

### What This Means for Implementation

- Modify the existing empty state in `App.tsx` (currently shows a generic welcome message)
- Add a conditional check: `!settings.cerebrasApiKey` -> show API key card, else show example prompts
- Example prompts are hardcoded strings (no dynamic content)
- Clicking a prompt calls `setInputText(promptText)` and focuses the input
- This is **post-P2 priority** — the current generic welcome message is acceptable until core features work

### Example Prompts

```typescript
const EXAMPLE_PROMPTS = [
  "Search for flights to Paris on Google Flights",
  "Fill out this form with my information",
  "Summarize this page and save key points to memory",
  "Find the cheapest option on this page",
];
```

---

## Summary Table

| #   | Decision                                | Choice                                                   | Priority                     |
| --- | --------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| 1   | User confirmation for high-risk actions | No gate — agent acts autonomously, Stop button is safety | Implemented with tool system |
| 2   | Multi-tab DOM context                   | Active-tab-only, must `read_page` after `switch_tab`     | Implemented with agent loop  |
| 3   | Onboarding / first-run                  | Empty state + example prompts + API key card             | Post-P2                      |

---

## References

- Phase 2 RFC (02-sidepanel-ui.md) — SettingsDrawer, InputArea, component tree
- Phase 3 RFC (03-agent-loop.md) — Tool execution flow, system prompt rules
- Phase 14 (14-rfc-implementation-audit.md) — Gap analysis that surfaced these decisions
- Modern AI assistants — Reference UX model for all three decisions
