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

## Common Workflows

### Run the app locally

Use this when you want the extension, log drain, and trace viewer running together.

```bash
npm run dev
```

What you get:

- Vite build/watch for the extension
- log server
- trace viewer at `http://127.0.0.1:7589/viewer`

### Build the extension

Use this before loading `dist/` into Chrome or before running the E2E suite manually.

```bash
npm run build
```

### Run unit and integration tests

Use this for the normal fast test pass.

```bash
npm test
```

### Run E2E tests

Use this when validating real browser behavior with the built extension.

Prerequisite:

- `OPENROUTER_API_KEY`

```bash
npm run test:e2e
```

Related surfaces:

- fixture pages under `tests/e2e/fixtures/`
- trace viewer
- dated reports under `docs/e2e-report-YYYY-MM-DD.md`

### Inspect logs and traces

Use this when debugging the agent loop, tool execution, or E2E runs.

```bash
npm run logs
npm run traces
```

Viewer:

- `http://127.0.0.1:7589/viewer`

### Run evals

Use this when measuring regressions or reviewing perception/action quality.

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

## Developer Surfaces

### App runtime

- side panel UI
- service worker agent loop
- content script DOM actions

### E2E harness

- real Chrome run with the built extension
- fixture server and task helpers
- dated report convention in `docs/`

### Observability

- structured logs
- JSONL traces
- trace viewer

### Evals

- offline structural validation
- critique runs
- perception validation

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
- [Dated E2E Report Example](./docs/e2e-report-2026-03-15.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

Most contributors will want:

```bash
npm run dev
npm test
npm run test:e2e
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow-oriented command guide.

## License

MIT. See [LICENSE](./LICENSE).
