# OpenSidebar User Manual

**Version 0.6.0**

OpenSidebar is an open-source Chrome extension that turns your browser into an AI-powered agent. You describe a task in plain English — "buy the running shoes, apply coupon SAVE10, use express shipping" — and the agent navigates pages, clicks buttons, fills forms, and completes multi-step workflows autonomously.

Everything runs locally in your browser. The only external calls are to the LLM providers you configure through OpenRouter.

---

## Table of Contents

1. [Installation](#1-installation)
2. [First-Time Setup](#2-first-time-setup)
3. [The Interface](#3-the-interface)
4. [Giving the Agent a Task](#4-giving-the-agent-a-task)
5. [Understanding the Agent Loop](#5-understanding-the-agent-loop)
6. [Plans and Multi-Step Tasks](#6-plans-and-multi-step-tasks)
7. [Controlling the Agent](#7-controlling-the-agent)
8. [Approval, Clarification, and Escalation](#8-approval-clarification-and-escalation)
9. [Autonomy Modes](#9-autonomy-modes)
10. [Settings Reference](#10-settings-reference)
11. [Tools Reference](#11-tools-reference)
12. [Saved Prompts](#12-saved-prompts)
13. [Session Metrics and Cost Tracking](#13-session-metrics-and-cost-tracking)
14. [Traces and Debugging](#14-traces-and-debugging)
15. [Tips for Writing Good Prompts](#15-tips-for-writing-good-prompts)
16. [Troubleshooting](#16-troubleshooting)
17. [Architecture Overview](#17-architecture-overview)

---

## 1. Installation

### Prerequisites

- **Node.js 18+**
- An **OpenRouter** API key (get one at [openrouter.ai](https://openrouter.ai))
- **Google Chrome** (or a Chromium-based browser that supports Manifest V3 side panels)

### Build from Source

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
npm install
npm run build
```

The production build is output to the `dist/` folder.

### Load into Chrome

1. Open `chrome://extensions/` in your address bar.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked**.
4. Select the `dist/` folder from the cloned repository.

The OpenSidebar icon appears in your Chrome toolbar.

---

## 2. First-Time Setup

1. **Open the side panel** — Click the OpenSidebar icon in the toolbar. The side panel slides open on the right side of your browser.
2. **Enter your API key** — You'll see a welcome screen with an "Open Settings" button. Click it, go to the **Models** tab, and paste your OpenRouter API key.
3. **Save** — Click "Save Changes" at the bottom. You're ready to go.

That's all the required configuration. The extension ships with sensible defaults for everything else.

---

## 3. The Interface

The side panel has five main regions, top to bottom:

### Header Bar

The sticky top bar contains:
- **Mode badge** (left) — Shows your current autonomy mode (e.g., "Confirm all", "Autonomous").
- **"OpenSidebar" title** (center).
- **Saved Prompts** button (bookmark icon, right) — Opens your saved prompt library.
- **Settings** button (gear icon, right) — Opens the settings drawer.

### Plan Strip

Appears below the header when the agent is planning or executing a multi-step task. It has several modes:

- **Planning** — Animated "Planning..." text with a warm background while the planner model decomposes your task.
- **Confirmation** — Shows the numbered plan steps with a difficulty badge. You can review, add guidance, and approve or cancel.
- **Progress** — A segmented progress bar with status icons for each step (pending, running, completed, failed, skipped), an elapsed timer, and a "Skip step" button.
- **Completion** — Green tint showing all steps with their final status and total turn count.

Click the chevron to expand or collapse the plan strip for more detail.

### Message Feed

The scrollable conversation area. Messages appear in two styles:

- **Your messages** — Right-aligned gray bubbles. Feedback messages (sent while the agent is running) appear in amber.
- **Agent messages** — Left-aligned. May include:
  - Reasoning text (the agent's thinking).
  - A **step timeline** showing each tool the agent executed (click, type, scroll, etc.) with status icons and optional screenshot thumbnails.
  - A **completion card** when the task finishes, showing outcome status, summary, subtask results, and (optionally) session metrics.

Hover over any message to see its timestamp. Hover over a screenshot thumbnail in the step timeline to preview it; click it to open a full-size lightbox.

### Status Line

A thin bar above the input area showing real-time agent state:

- **Status indicator** — Animated spinner when thinking/acting, static dot otherwise.
- **Status label** — "Thinking", "Acting", "Waiting", "Paused", "Error", or "Stalled".
- **Detail text** — Brief description of what the agent is currently doing.
- **Model badge** — Which LLM model is active (e.g., "gemini-3-flash").
- **Turn counter** — "3/50" format showing current turn out of the maximum.
- **Pause/Resume buttons** — Appear when the agent is running.
- **Metrics** — Token count and cost (if enabled in settings).

### Input Area

The bottom panel changes based on agent state:

**When idle:**
- A text input field. Type your task and press Enter or click the send button.
- Slash command autocomplete — Type `/` to see available commands. Press Tab to accept.
- **Autonomy menu** at the bottom — A dropdown to switch between the four interaction modes.

**When the agent is running:**
- A **Stop** button (red) with a pulsing indicator.
- A **Feedback** field — Type guidance and send it to the agent mid-execution.
- "Press Esc to stop" hint.

**During approvals/clarifications:**
- An overlay replaces the input area (see [Section 8](#8-approval-clarification-and-escalation)).

---

## 4. Giving the Agent a Task

Type a task in plain English and press Enter. The agent will start immediately.

**Examples of what you can ask:**

| Category | Example prompt |
|----------|---------------|
| Shopping | "Add the wireless headphones to cart, apply coupon SAVE10, choose express shipping, and check out" |
| Forms | "Fill out the registration form with my info: John Doe, john@example.com, company Acme Corp" |
| Research | "Find the pricing page and tell me the cost of the Pro plan" |
| Navigation | "Go to Settings, change the email to admin@test.com, and save" |
| Reading | "Summarize this page in 3 bullet points" |
| Data entry | "Fill in all the fields in this multi-step wizard" |

You can also click one of the three **suggested actions** on the welcome screen:
- "Summarize this page"
- "Fill out this form"
- "Find pricing info"

### What makes a good prompt

- **Be specific.** "Buy the blue running shoes in size 10" is better than "buy shoes."
- **State the goal, not the steps.** The agent figures out how to navigate. But if ordering matters, numbered steps work well: "1. Click Settings 2. Change email to X 3. Save."
- **Include data the agent needs.** If it needs to type an email, include the email in your prompt.

See [Section 15](#15-tips-for-writing-good-prompts) for more detailed prompt guidance.

---

## 5. Understanding the Agent Loop

Every task runs through a **ReAct loop** — a cycle of reasoning and acting:

```
         ┌──────────────────────────────────────┐
         │                                      │
         ▼                                      │
   ┌──────────┐    ┌─────────┐    ┌──────────┐  │
   │  THINK   │───▶│   ACT   │───▶│ OBSERVE  │──┘
   │ (reason) │    │ (tool)  │    │ (result) │
   └──────────┘    └─────────┘    └──────────┘
```

Each iteration of this cycle is called a **turn**:

1. **Think** — The LLM receives the current page state (DOM snapshot, visible text, tagged elements) plus the full conversation history. It reasons about what to do next and decides which tool to call.

2. **Act** — The chosen tool executes against the real browser page: clicking a button, typing text, scrolling, navigating, etc.

3. **Observe** — The tool result (success/failure message) feeds back into the conversation. If the action modified the page, a fresh DOM snapshot is captured. The perception model may also take a screenshot and produce a visual interpretation.

4. **Repeat** — The loop continues until the agent calls `done()`, you click Stop, or the turn limit is reached.

### Two-Tier Model Architecture

The agent uses two LLM tiers:

| Tier | Default Model | Role |
|------|--------------|------|
| **Executor** | openai/gpt-5.4-mini | Fast, cheap. Handles routine interactions — clicking, typing, scrolling, reading. |
| **Planner** | minimax/minimax-m2.7 | Stronger reasoning. Decomposes complex tasks, recovers from stuck states, creates revised plans. |

The agent starts on the executor. If it gets stuck (repeated failures, no progress), it **escalates** to the planner automatically. After the planner orients and produces a strategy, it **hands off** back to the executor.

### Perception

Every time the page changes visually, a **perception model** (default: Grok 4.1 Fast) takes a screenshot and produces a structured interpretation:

- **LOCATION** — What page/screen the agent is on.
- **CHANGES** — What changed since the last observation.
- **BLOCKERS** — Popups, modals, or overlays that might block interaction.
- **VISUAL-ONLY** — Information only visible in the screenshot (not in the DOM text).
- **AFFORDANCES** — Clickable/interactive elements the agent should know about.

This visual grounding prevents the agent from acting blindly on DOM text alone.

---

## 6. Plans and Multi-Step Tasks

For complex tasks, the agent automatically invokes its **planner** before executing:

1. The planner model analyzes your request and decomposes it into **subtasks** (typically 2–8 steps).
2. Each step has an objective, success criteria, and verification strategy.
3. The planner assigns a **difficulty rating**: simple, moderate, complex, or extreme — which affects the turn budget.

### Plan Confirmation

If `Require Plan Confirmation` is enabled (default: yes) and the plan has 2+ steps, the plan strip shows the plan for your review:

- **Review steps** — Click "Expand step" to see success criteria for each.
- **Add guidance** — Click "Add guidance" to type instructions that modify the plan. The button changes to "Replan & Start."
- **Approve** — Click "Start" to begin execution.
- **Cancel** — Click "Cancel" to abort.

### During Execution

As the agent works through the plan:

- The plan strip shows a **progress bar** with step indicators.
- The currently running step has a spinning icon and shows the latest tool action.
- Completed steps show a green checkmark; failed steps show a red X.
- You can click **"Skip step"** to move past a stuck or unnecessary step.

### Replanning

If the agent encounters unexpected conditions (a page looks different than expected, a step fails repeatedly), the planner can **replan** — producing a revised set of steps without starting over from scratch.

---

## 7. Controlling the Agent

You have full control while the agent is running:

| Control | How | What it does |
|---------|-----|--------------|
| **Stop** | Click the red Stop button or press Esc | Immediately halts the agent loop. |
| **Pause** | Click the pause button in the status line | Freezes the agent after the current turn completes. |
| **Resume** | Click the resume button | Continues from where it paused. |
| **Send feedback** | Type in the feedback field and send | Injects a hint into the agent's next turn. Use this to course-correct ("try the other button", "the coupon field is at the bottom"). |
| **Skip step** | Click "Skip step" in the plan strip | Marks the current subtask as skipped and moves to the next one. |

---

## 8. Approval, Clarification, and Escalation

Three types of overlays can appear during execution, temporarily replacing the input area:

### Approval Overlay (Red)

Appears when the agent wants to perform a **high-risk action** (in modes that require approval):

- Shows which action needs approval and a brief description.
- **Countdown timer** — The overlay has a time limit (visible as a progress bar).
- **Approve** — Lets the action proceed.
- **Reject** — Blocks the action and tells the agent to try something else.

### Clarification Overlay (Blue)

Appears when the agent is **uncertain** and wants your input:

- Shows the agent's question.
- **Suggestion chips** — Quick-select answers the agent thinks are likely. Click one to respond instantly.
- **Text input** — Type a custom answer.
- **120-second timeout** — If you don't respond, the agent continues with its best guess.

### Escalation Overlay (Amber)

Appears when the agent needs you to make a **strategic decision**:

- Shows the reason for escalation.
- **Option buttons** — Multiple choices, with the recommended option highlighted.
- Each option may show an impact tooltip on hover.

---

## 9. Autonomy Modes

The autonomy menu at the bottom of the input area lets you choose how much oversight the agent gets:

| Mode | Description |
|------|-------------|
| **Ask before acting** | Every action requires your approval. Maximum control. |
| **Ask for risky actions only** | Low-risk actions (reading, scrolling) run automatically. High-risk actions (navigation, JS execution) need approval. This is the default. |
| **Confirm plans only** | Actions run automatically. Only multi-step plans require confirmation before execution. |
| **Act without asking** | Fully autonomous. No approvals, no plan confirmation. An amber warning banner appears as a reminder. |

You can switch modes at any time, even while the agent is running.

---

## 10. Settings Reference

Open settings via the gear icon in the header. Two tabs: **General** and **Models**.

### General Tab

#### Appearance
| Setting | Options | Default |
|---------|---------|---------|
| Theme | Light / Dark / System | System |

#### Agent
| Setting | Options | Default |
|---------|---------|---------|
| Max Turns | 30 / 50 / 100 / 200 / 500 | 30 |
| Allow Navigation | On / Off | On |

**Max Turns** — The maximum number of think→act→observe cycles the agent can perform per task. Higher values allow more complex tasks but cost more tokens.

**Allow Navigation** — When off, the agent cannot use navigate, create_tab, or go_back tools. Useful for restricting the agent to the current page.

#### Safety
| Setting | Options | Default |
|---------|---------|---------|
| Site Access Rules | Allow all sites / Block listed domains | Allow all |
| Blocklist | One domain per line | Empty |

When set to "Block listed domains," the agent will not interact with pages on those domains.

#### Display
| Setting | Options | Default |
|---------|---------|---------|
| Show session metrics | On / Off | Off |
| Expand tool details by default | On / Off | Off |

**Show session metrics** — When enabled, token usage and cost are displayed in the status line during execution and in the completion card afterward.

**Expand tool details** — When enabled, the step timeline under each agent message is expanded by default instead of collapsed.

#### Data
| Action | What it does |
|--------|-------------|
| Clear Chat History | Removes all messages from the current session |
| Clear Local Logs | Deletes the in-browser log ring buffer |
| Clear All Local Data | Factory reset — removes all settings, messages, logs, saved prompts |
| Export Logs | Downloads the log buffer as a `.jsonl` file |

### Models Tab

| Setting | Default | Description |
|---------|---------|-------------|
| API Key | *(required)* | Your OpenRouter API key. Stored locally in Chrome storage. |
| Nitro | Off | Appends `:nitro` to model IDs for faster inference on supported models. |
| Executor Model | openai/gpt-5.4-mini | The fast model used for routine tool execution. |
| Planner Model | minimax/minimax-m2.7 | The reasoning model used for task decomposition and recovery. |
| Perception Model | x-ai/grok-4.1-fast | The vision model used to interpret page screenshots. |

Each model selector shows a searchable dropdown with available models and their pricing (input/output cost per token). You can also type a custom model ID if your desired model isn't listed.

---

## 11. Tools Reference

The agent has **38 tools** — generic browser primitives that work on any website. Tools are grouped by category below.

### Reading & Inspection

| Tool | Risk | Description |
|------|------|-------------|
| `read_page` | Low | Captures the current viewport content: text, buttons, links, forms. |
| `read_element` | Low | Reads text or attributes (href, src, placeholder, etc.) from a specific element. |
| `find_element` | Low | Searches the page for elements matching a text query. |
| `inspect_hidden` | Low | Inspects elements hidden by CSS (display:none, visibility:hidden). |
| `xray_page` | Low | Toggles an overlay revealing all hidden elements on the page. |
| `get_cookies` | Low | Retrieves cookies for the current URL. |
| `search_history` | Low | Searches browser history by keyword. |

### Navigation

| Tool | Risk | Description |
|------|------|-------------|
| `navigate` | High | Navigate to a URL or run a search query in the current tab. |
| `go_back` | High | Browser back navigation. |
| `create_tab` | High | Open a new tab with a URL. |
| `close_tab` | High | Close a tab. |
| `switch_tab` | High | Switch focus to a different open tab. |
| `list_tabs` | Low | List all open tabs (read-only). |
| `create_window` | High | Open a new browser window. |

### Clicking & Interaction

| Tool | Risk | Description |
|------|------|-------------|
| `click_element` | Medium | Click an element by its tag ID. Supports multi-click (up to 10×). |
| `right_click` | Medium | Right-click an element (opens context menu). |
| `hover_element` | Medium | Hover over an element to trigger hover states. |
| `click_coordinates` | Medium | Click at raw (x, y) viewport coordinates. Useful for untagged elements. |
| `drag_and_drop` | Medium | Drag one element and drop it onto another. |

### Text & Form Input

| Tool | Risk | Description |
|------|------|-------------|
| `type_text` | Medium | Type text into an input or textarea. Optionally press Enter after. |
| `select_option` | Medium | Select a value from a `<select>` dropdown. |
| `set_checkbox` | Medium | Check or uncheck a checkbox or radio button. |
| `press_key` | Medium | Press a keyboard key (Enter, Escape, Tab, arrows, etc.) with optional modifiers. |

### Page Manipulation

| Tool | Risk | Description |
|------|------|-------------|
| `scroll_page` | Low | Scroll by direction, pixel amount, or to an absolute Y position. |
| `hide_element` | Medium | Hide a specific element from the page display. |
| `dismiss_overlays` | Medium | Auto-dismiss modals, cookie banners, and popup overlays. |
| `upload_file` | High | Upload a file to a file input from a URL. |
| `download_file` | Medium | Download a file to the user's Downloads folder. |

### Advanced

| Tool | Risk | Description |
|------|------|-------------|
| `execute_js` | High | Run JavaScript in the page context. Blocked: `location.*`, `window.open()`, `document.write()`, `eval()`, dynamic script injection. |
| `set_cookie` | High | Set a browser cookie. |
| `delete_cookie` | High | Delete a specific cookie. |

### Agent Control

| Tool | Risk | Description |
|------|------|-------------|
| `done` | Low | Signal task completion with a summary message. |
| `escalate` | Low | Request escalation to the planner model. |
| `wait` | Low | Pause for 1–10 seconds. |
| `clarify` | Low | Ask the user a question mid-execution. |
| `update_plan` | Low | Update the visible plan in the side panel. |
| `update_notes` | Low | Save working notes (up to 500 chars) for the agent's own reference. |
| `recall_demo` | Low | Retrieve a previously recorded demonstration. |

### Risk Levels Explained

- **Low** — Read-only or agent-internal. No page side effects. Auto-approved in all modes.
- **Medium** — Modifies page state (clicks, typing, form changes) but typically reversible via refresh or undo. Auto-approved unless you're in "Ask before acting" mode.
- **High** — Navigates away, manipulates cookies, runs JavaScript, or affects tabs/windows. These are the actions that require approval in "Ask for risky actions only" mode.

---

## 12. Saved Prompts

Saved prompts let you store frequently used tasks for one-click reuse.

### Creating a Saved Prompt

1. Click the **bookmark icon** in the header to open the Saved Prompts drawer.
2. Click the **+** icon.
3. Fill in:
   - **Title** — A short name (e.g., "Weekly report download").
   - **Content** — The full prompt text.
   - **Category** — Optional grouping (e.g., "Shopping", "Work").
4. Click **Save**.

### Using a Saved Prompt

1. Open the Saved Prompts drawer.
2. Click any prompt — its content is copied into the input field.
3. Edit if needed, then send.

### Managing Prompts

- Hover over a prompt to see **Edit** and **Delete** icons.
- Prompts are grouped by category in the drawer.
- All prompts are persisted in Chrome storage and survive browser restarts.

---

## 13. Session Metrics and Cost Tracking

Every agent session tracks token usage and cost. To see this data:

1. Go to **Settings → General → Display** and enable **Show session metrics**.

Once enabled, you'll see:

- **In the status line** — Live token count and cumulative cost during execution.
- **In the completion card** — After the task finishes, a collapsible "Session metrics" section showing:
  - Total tokens (prompt + completion).
  - Total cost (in USD, from OpenRouter's inline usage data).
  - LLM inference time vs. total wall-clock time.
  - Per-model breakdown when multiple models were used (executor, planner, perception).

Cost data comes directly from OpenRouter's API response — it reflects actual charges to your account.

---

## 14. Traces and Debugging

Every agent session is recorded with full fidelity. This is useful for understanding what the agent did, diagnosing failures, and improving prompts.

### Starting the Trace Viewer

```bash
npm run dev    # starts the extension + trace viewer
# or
npm run logs   # starts just the log server + trace viewer
```

Then open `http://127.0.0.1:7589/viewer` in your browser.

### What's in a Trace

Each recorded session contains:
- DOM snapshots at every turn.
- Full LLM request and response (system prompt, messages, tool calls).
- Tool execution results with timing.
- Screenshots and perception output.
- Token usage and cost per turn.
- Events: escalations, stagnation, retries, errors.

### Trace CLI

For quick terminal queries:

```bash
npm run traces              # Show help
npm run traces list         # List all recorded sessions
npm run traces show <id>    # Full detail for a session
npm run traces turns <id>   # Turn-by-turn summary
npm run traces stats        # Aggregate statistics
```

### Log Queries

```bash
npm run logs:tail           # Last 50 log entries
npm run logs:errors         # Error-level entries only
npx tsx scripts/log-query.ts search "click"   # Search logs by keyword
npx tsx scripts/log-query.ts stats            # Log statistics
```

Log files are stored at `logs/opensidebar.jsonl` with automatic 50MB rotation.

---

## 15. Tips for Writing Good Prompts

### Be Specific About Your Goal

| Weak | Strong |
|------|--------|
| "Buy shoes" | "Add the Nike Air Max 90 in size 10 to cart and proceed to checkout" |
| "Fill out the form" | "Fill out the contact form: name John Doe, email john@test.com, message 'Hello'" |
| "Find the price" | "Go to the Pricing page and tell me the monthly cost of the Pro plan" |

### Include Data the Agent Needs

The agent can only type what you tell it. If a form needs an email, include the email in your prompt.

### Use Numbered Steps for Ordering

When sequence matters:
```
1. Go to Settings
2. Change the display name to "Test User"
3. Click Save
4. Verify the success message appears
```

### Let the Agent Figure Out Navigation

You don't need to say "click the navigation menu, then click Settings." Just say "Go to Settings." The agent can see the page and figure out how to get there.

### For Research Tasks, State What You Want Back

```
Read the article and tell me:
- The main argument
- The three supporting points
- Any statistics mentioned
```

### When the Agent Gets Stuck

Send feedback mid-execution:
- "The button is below the fold, try scrolling down"
- "Use the search bar instead of browsing"
- "The coupon field is in the cart sidebar, not the main checkout"

---

## 16. Troubleshooting

### "Welcome" screen keeps showing / no API key field

Open Settings (gear icon) → Models tab → enter your OpenRouter API key → Save.

### Agent doesn't interact with the page

- Make sure the page has finished loading before sending a task.
- Some pages block content scripts (e.g., `chrome://` pages, Chrome Web Store). The agent can only work on regular web pages.
- Check that "Allow Navigation" is enabled in Settings if the task requires page changes.
- If the page uses heavy iframes, the agent may not see elements inside them.

### Agent keeps clicking the wrong element

Send feedback: "That's the wrong button. The correct one says 'Submit Order' at the bottom of the page." The agent will adjust.

### Agent is stuck in a loop

This triggers automatically — the stagnation monitor detects repeated identical states and intervenes (nudge → escalate → give up). You can also:
- Send feedback to redirect it.
- Click "Skip step" to move past the stuck subtask.
- Press Esc to stop entirely.

### "Insufficient credits" error

Your OpenRouter account is out of credits. Add funds at [openrouter.ai/credits](https://openrouter.ai/credits).

### Extension stops working after Chrome update

Rebuild and reload:
```bash
npm run build
```
Then go to `chrome://extensions/` and click the reload button on OpenSidebar.

### Trace viewer doesn't show sessions

Make sure the log server is running (`npm run logs` or `npm run dev`). Traces are only written to disk when the server is up. Sessions from when the server was down are lost (they stay in the browser's in-memory ring buffer briefly, but aren't persisted to files).

---

## 17. Architecture Overview

For those who want to understand what's happening under the hood.

### Three Execution Contexts

```
┌──────────────────┐     chrome.runtime      ┌──────────────────┐
│    Side Panel     │◄──────────────────────►│  Service Worker   │
│  (React/Zustand)  │     .sendMessage()      │   (Agent Loop)   │
└──────────────────┘                          └────────┬─────────┘
                                                       │
                                              chrome.tabs
                                              .sendMessage()
                                                       │
                                              ┌────────▼─────────┐
                                              │  Content Script   │
                                              │   (DOM Access)    │
                                              └──────────────────┘
```

- **Side Panel** — The React UI you interact with. Renders chat messages, plan strips, settings, approvals. Communicates with the service worker via Chrome's messaging API.

- **Service Worker** — The brain. Runs the agent loop, calls the LLM, decides which tools to use, manages plans, tracks stagnation, handles escalation. Lives in Chrome's background context.

- **Content Script** — The hands. Injected into every web page. Captures DOM snapshots, tags interactive elements with numeric IDs (`[1]`, `[2]`, `[3]`...), and executes actions (click, type, scroll) when instructed by the service worker.

### How a Turn Flows

1. Service worker builds a prompt: system instructions + DOM snapshot + tagged elements + conversation history.
2. Prompt is sent to the LLM via OpenRouter (streamed).
3. LLM returns reasoning text + tool call(s).
4. Service worker validates tool calls (risk check, safety gate).
5. Tool call is dispatched to the content script via `chrome.tabs.sendMessage`.
6. Content script executes the action on the real DOM and returns the result.
7. Result is added to conversation history.
8. If the action modified the DOM, a fresh snapshot is captured.
9. If visually significant, the perception model interprets a screenshot.
10. Loop back to step 1.

### Element Tagging

The content script scans the page for interactive elements (buttons, links, inputs, selects, etc.) and assigns each a numeric tag: `[1]`, `[2]`, `[3]`, etc. These tags appear in the DOM snapshot the LLM receives, so when the LLM says "click element [5]", the content script knows exactly which DOM node to target.

Tags are **stable** — they use hash-based IDs so the same element gets the same tag across page refreshes.

### Stagnation Detection

The stagnation monitor hashes the DOM state (URL + element count + element signatures) each turn. If the hash doesn't change across multiple turns, the agent is stuck:

- **6 stagnant turns** — Nudge: inject a reflection prompt asking the agent to reconsider its approach.
- **12 stagnant turns** — Escalate: switch to the planner model for a strategy revision.
- Repeats the nudge cycle every 6 turns after that.

### Context Window Management

The conversation history grows every turn. To keep it within the LLM's context window, the system applies progressive compression:

| Level | Strategy |
|-------|----------|
| NONE | Full history, no compression |
| LIGHT | Older messages truncated to 150 characters |
| MEDIUM | Only recent 2 turns preserved in full; older turns summarized |
| HEAVY | Aggressive summarization; trajectory distilled to a compact timeline |

Compression level is chosen automatically based on token budget utilization.

---

*For developer documentation, see [CONTRIBUTING.md](../CONTRIBUTING.md), [docs/developer-guide.md](developer-guide.md), and the [Architecture Overview](architecture/overview.md).*
