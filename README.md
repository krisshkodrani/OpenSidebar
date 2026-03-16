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
  Navigate, click, type, and automate web tasks from a side panel using your own <a href="https://openrouter.ai">OpenRouter</a> key.
</p>

---

## Features

- Natural language browser automation: click, type, scroll, navigate, drag and drop, upload, inspect, and recover.
- Vision-backed perception: stateful page understanding with a structured five-section report.
- Multi-step orchestration: planner, executor, and verifier roles for harder tasks.
- 38 browser tools: generic primitives instead of site-specific flows.
- Plan confirmation and approval gates for sensitive operations.
- Auto-recovery: stale element handling, loop detection, and escalation when stuck.
- Built-in observability: traces, logs, trace viewer, and offline evals.
- Workspaces: isolated tab-group-backed runtime state.
- Bring your own key: no subscription, no hosted control plane, no telemetry.

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

## How It Works

```text
Side Panel (React/Zustand) <-> Service Worker <-> Content Script (DOM)
```

The extension runs in three isolated Chrome contexts. The service worker owns the agent loop and orchestrator, the content script reads and manipulates the page, and the side panel renders chat, plans, approvals, and traces.

| Component | Current Default |
| --- | --- |
| Executor LLM | `openai/gpt-4.1-mini` via OpenRouter |
| Executor fallback | `google/gemini-2.5-flash-lite` via OpenRouter |
| Planner LLM | `minimax/minimax-m2.5` via OpenRouter |
| Perception | `x-ai/grok-4.1-fast` via OpenRouter |
| UI | React 18 + Tailwind CSS + Zustand |
| Build | Vite |

## Evals

OpenSidebar ships with trace-based evals for both action quality and perception quality.

```bash
npm run ci:evals:offline
npx tsx evals/cli.ts perception-validate
npm run evals:critique
npm run evals:perception
```

Frozen perception baseline:

- default model: `x-ai/grok-4.1-fast`
- corrected v6 harness
- `18/20` pass on the checked-in perception suite

See [evals/README.md](./evals/README.md) for the current eval workflow.

## Security & Privacy

- API keys are stored in Chrome storage and only sent to configured model providers.
- No telemetry or analytics.
- URL sanitization blocks non-http(s) protocols.
- High-risk tools can require explicit approval.
- See [SECURITY.md](./SECURITY.md) for the security policy.
- See [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) for the full privacy policy.

## Documentation

- [Docs Index](./docs/README.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [Perception Layer](./docs/architecture/perception-layer.md)
- [Developer Guide](./docs/developer-guide.md)
- [Evals Guide](./docs/guides/evals-program.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

Useful commands:

```bash
npm run ci:lint
npm run ci:test
npm run ci:evals:offline
npm run ci:build
npm run test:e2e
```

## License

MIT. See [LICENSE](./LICENSE).
