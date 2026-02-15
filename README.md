# OpenSidebar

A bimodal, open-source Chrome extension that transforms your browser into an AI-powered agentic workspace.

OpenSidebar can navigate, read, click, type, and research across web pages — all from a convenient side panel. It uses **OpenRouter** to access fast models (gpt-oss-120b via Cerebras/Groq/OpenRouter) for real-time interactions with dynamic model escalation to Grok 4.1 for complex tasks, plus a **local Second Brain** for persistent memory.

---

## Features

- **Browser Automation** — Click buttons, fill forms, scroll pages, and navigate — all via natural language commands.
- **Visual DOM Understanding** — Vimium-style numeric tagging of interactive elements. The AI sees `[3] <button> "Submit"` and calls `click_element(id=3)`.
- **Dynamic Model Escalation** — Fast model for instant actions, automatic escalation to more powerful models when needed.
- **Local Memory** — Hybrid semantic + keyword search (Transformers.js + SQLite FTS5 + Voy) with Reciprocal Rank Fusion. All data stays in your browser.
- **Auto-Managed Workspaces** — Chrome Tab Groups automatically organize your agent sessions. Click the extension icon on any tab to create a new workspace; tabs created by the agent auto-group together. Workspaces auto-delete when empty.
- **Per-Tab Sidebar** — Sidebar opens only when you click the extension icon and closes automatically when you switch tabs. Each tab gets its own sidebar session and workspace.
- **Navigation Survival** — Agent state persists across page loads and service worker restarts.
- **Streaming Responses** — Real-time text streaming from both LLM engines.

---

## Architecture

```
Side Panel (React) ←→ Service Worker (Agent Loop) ←→ Content Script (DOM)
                              ↕
                      Offscreen Document
                     (Memory: SQLite + Voy + Transformers.js)
```

| Component      | Technology                             |
| -------------- | -------------------------------------- |
| Fast LLM       | OpenRouter (gpt-oss-120b via Cerebras) |
| Smart LLM      | OpenRouter (Grok 4.1 Fast)             |
| Vision LLM     | OpenRouter (Qwen3 VL)                  |
| Embeddings     | Transformers.js (all-MiniLM-L6-v2)     |
| Vector Search  | Voy (WASM)                             |
| Keyword Search | SQLite WASM (FTS5)                     |
| UI             | React 18 + Tailwind CSS                |
| Build          | Vite + @crxjs/vite-plugin              |

Complete technical documentation: [docs/architecture/](./docs/architecture/)

---

## Screenshots

![Main Interface](docs/screenshots/main-interface.png)
_The OpenSidebar side panel with chat interface and welcome screen_

![Element Tagging](docs/screenshots/element-tagging.png)
_Interactive elements tagged with numeric IDs [1], [2], [3] for AI interaction_

![Settings Panel](docs/screenshots/settings-panel.png)
_API key configuration in the settings drawer_

![Agent Demo](docs/screenshots/agent-demo.gif)
_OpenSidebar automatically navigating and interacting with web pages_

> 📸 **Contributing Screenshots:** See [docs/screenshots/README.md](docs/screenshots/README.md) for guidelines on adding screenshots.

---

## Quick Start

### Prerequisites

- Node.js 18+
- An OpenRouter API key ([openrouter.ai](https://openrouter.ai))

### Install & Build

```bash
git clone https://github.com/OpenSidebar/OpenSidebar.git
cd OpenSidebar
bun install
bun run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder

### Development

```bash
bun run dev
```

This starts Vite with HMR. Load the `dist/` folder as an unpacked extension — changes auto-reload.

### Configure

1. Click the OpenSidebar icon to open the side panel
2. Click the settings gear icon
3. Enter your OpenRouter API key

---

## Commands

| Command         | Description                         |
| --------------- | ----------------------------------- |
| `bun run dev`   | Start dev server with HMR           |
| `bun run build` | Type-check and build for production |
| `bun run lint`  | Run ESLint                          |
| `bun test`      | Run tests (Bun)                     |
| `bun run fmt`   | Format with Prettier                |

---

## Documentation

### User Guides

- **[Features Overview](./docs/features/)** - Complete user-facing feature documentation
  - [Browser Automation](./docs/features/browser-automation.md) - Click, type, scroll, navigate
  - [Memory System](./docs/features/memory-system.md) - Local Second Brain
  - [Workspace Management](./docs/features/workspace-management.md) - Auto tab groups
  - [Streaming UI](./docs/features/streaming-ui.md) - Real-time responses
  - [Security & Privacy](./docs/features/security.md) - Privacy-first design

### Technical Architecture

- **[Architecture Overview](./docs/architecture/overview.md)** - System design and components
- **[Agent Loop](./docs/architecture/agent-loop.md)** - Core orchestration
- **[Memory System](./docs/architecture/memory-system.md)** - Implementation details
- **[Message Protocol](./docs/architecture/message-protocol.md)** - Inter-context messaging API
- **[Type Reference](./docs/architecture/types-reference.md)** - All TypeScript types

### Development

- **[RFCs](./docs/rfc/)** - Feature proposals and technical decisions
- **[Contributing Guide](./CONTRIBUTING.md)** - Development setup and guidelines
- **[Agent Guidelines](./AGENTS.md)** - Technical reference for developers

---

## Organization

OpenSidebar is developed by the **OpenSidebar Organization** — a community-driven effort to build the best open-source browser agent.

- **GitHub:** [github.com/OpenSidebar](https://github.com/OpenSidebar)
- **Repository:** [github.com/OpenSidebar/OpenSidebar](https://github.com/OpenSidebar/OpenSidebar)
- **Issues:** [github.com/OpenSidebar/OpenSidebar/issues](https://github.com/OpenSidebar/OpenSidebar/issues)

We welcome contributors of all skill levels!

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

1. Fork the repository from the OpenSidebar organization
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request against the main repository

---

## Security

See [SECURITY.md](SECURITY.md) for the security policy.

- API keys are stored in `chrome.storage.sync` (encrypted at rest by Chrome)
- All memory data stays locally in IndexedDB
- No telemetry, analytics, or external data collection
- URL sanitization blocks non-HTTP protocols

---

## License

MIT — see [LICENSE](LICENSE) for details.
