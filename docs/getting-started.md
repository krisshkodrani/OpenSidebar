# Getting Started

Get OpenSidebar running in under 5 minutes.

## Prerequisites

- **Node.js 18+** ([download](https://nodejs.org))
- **Google Chrome** (Manifest V3 extension)
- **OpenRouter API key** ([get one](https://openrouter.ai/keys)) — pay-as-you-go, no subscription

## Install

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
npm install
npm run build
```

## Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder from the project

## Configure

1. Click the OpenSidebar icon in the Chrome toolbar to open the side panel
2. Click the **gear icon** to open Settings
3. Paste your OpenRouter API key
4. Close Settings

## Your First Task

1. Navigate to any website
2. Type a task in the chat input, e.g.:
   - "Summarize this page"
   - "Fill in the contact form with John Smith, john@example.com"
   - "Find the pricing page and tell me the monthly cost"
3. Press Enter and watch the agent work

The orange border around the page indicates the agent is active. You can click **Stop** at any time.

## What Happens Under the Hood

Each turn, the agent:
1. **Observes** — reads the DOM snapshot and visual perception of the page
2. **Thinks** — reasons about the current state and best next action
3. **Acts** — executes a tool (click, type, scroll, navigate, etc.)
4. **Verifies** — checks if the action had the expected effect

For complex tasks, the orchestrator decomposes the goal into subtasks, runs each through the executor, and verifies completion before moving on.

## Development Mode

For live-reloading during development:

```bash
npm run dev    # Vite HMR + log server + trace viewer
```

This starts:
- **Extension** with hot module replacement on `localhost:5173`
- **Log server** on `localhost:7589` (receives structured logs from the extension)
- **Trace viewer** at `http://127.0.0.1:7589/viewer` (inspect agent sessions)

After making changes, reload the extension in `chrome://extensions/` to pick up service worker updates.

## Next Steps

- [Architecture Overview](./architecture/overview.md) — how the three Chrome contexts work together
- [Tools Reference](./features/tools.md) — all 38 browser tools
- [Developer Guide](./developer-guide.md) — testing, debugging, prompt workflow
- [Evals Guide](./guides/evals-program.md) — golden cases and the critique pipeline
