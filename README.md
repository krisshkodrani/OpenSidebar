<p align="center">
  <img src="OpenSidebar.png" alt="OpenSidebar" width="128" />
</p>

<h1 align="center">OpenSidebar</h1>

<p align="center">
  <a href="https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml"><img src="https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js" /></a>
</p>

<p align="center">
  Open-source Chrome extension that turns your browser into an AI-powered agent.<br />
  Navigate, click, type, and automate web tasks from a side panel — bring your own API key via <a href="https://openrouter.ai">OpenRouter</a>.
</p>

<video src="docs/assets/demo-agent.mp4" width="100%" autoplay loop muted></video>

---

## Features

- **Natural language browser automation** — click, type, scroll, navigate, drag-and-drop, draw on canvas.
- **Visual DOM understanding** — Vimium-style element tagging with label association and inline clickable detection.
- **Perception layer** — vision-based page understanding via Gemini 2.5 Flash.
- **Two-tier LLM architecture** — fast executor model for observe-act cycles, planner model for complex reasoning. Automatic escalation when the executor gets stuck.
- **36 generic tools** — no site-specific heuristics. The agent adapts through prompting, not code.
- **Plan confirmation** — the agent pauses to show its plan before executing multi-step tasks.
- **Clarification** — the agent asks when something is ambiguous instead of guessing.
- **Stagnation detection** — snapshot fingerprinting detects stuck loops with graduated intervention.
- **Navigation survival** — persists state across page loads and service worker restarts.
- **Workspaces** — auto-managed via Chrome Tab Groups, each with isolated agent state.
- **Built-in observability** — full execution traces, trace viewer UI, structured logs, and an eval pipeline for testing agent quality.
- **Real-time streaming** — SSE-based responses with token usage and cost tracking.
- **Your keys, your data** — all inference through OpenRouter. No telemetry or analytics.

---

## Quick Start

### Prerequisites

- Node.js 18+
- An [OpenRouter](https://openrouter.ai) API key

### Install

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

### Configure

1. Click the OpenSidebar icon to open the side panel.
2. Open **Settings**.
3. Enter your OpenRouter API key.

---

## How It Works

```
Side Panel (React/Zustand) <--> Service Worker (Agent Loop) <--> Content Script (DOM)
```

The extension runs in three isolated Chrome contexts. The **service worker** orchestrates the agent loop (LLM → tool → LLM cycle), the **content script** generates DOM snapshots and executes actions on the page, and the **side panel** provides the chat interface.

| Component | Technology |
| --- | --- |
| Executor LLM | `openai/gpt-oss-120b` via OpenRouter |
| Planner LLM | `deepseek/deepseek-v3.2` via OpenRouter |
| Perception | Gemini 2.5 Flash via OpenRouter |
| UI | React 18 + Tailwind CSS + Zustand |
| Build | Vite |

---

## Security

- API keys stored in `chrome.storage.sync` — never sent anywhere except OpenRouter.
- All data stays in local browser storage and local files.
- No telemetry or analytics.
- URL sanitization blocks non-http(s) protocols.
- Tool risk classification (low/medium/high) with approval gates for destructive actions.
- See [SECURITY.md](SECURITY.md) for the full security policy.

---

## Documentation

- [Architecture Overview](./docs/architecture/overview.md)
- [Agent Loop](./docs/architecture/agent-loop.md)
- [Perception Layer](./docs/architecture/perception-layer.md)
- [Navigation Bridge](./docs/architecture/navigation-bridge.md)
- [Message Protocol](./docs/architecture/message-protocol.md)
- [Tools Reference](./docs/features/tools.md)
- [Security](./docs/features/security.md)
- [Evals Guide](./docs/guides/evals-program.md)

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide, including architecture, observability tooling, the eval pipeline, and how to add new tools.

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
npm install
npm run dev     # full dev stack: Vite HMR + log server + trace viewer
npm test        # make sure tests pass
npm run lint    # make sure linter passes
```

---

## License

MIT. See [LICENSE](LICENSE).
