# OpenSidebar

A bimodal, open-source Chrome extension that transforms your browser into an AI-powered agentic workspace.

OpenSidebar can navigate, read, click, type, and research across web pages — all from a convenient side panel. It combines a **fast Reflex Engine** (Cerebras) for real-time interactions with a **Deep Thought Engine** (Kimi k2.5 swarm) for complex research, plus a **local Second Brain** for persistent memory.

---

## Features

- **Browser Automation** — Click buttons, fill forms, scroll pages, and navigate — all via natural language commands.
- **Visual DOM Understanding** — Vimium-style numeric tagging of interactive elements. The AI sees `[3] <button> "Submit"` and calls `click_element(id=3)`.
- **Bimodal Intelligence** — Fast model for instant actions, powerful model for deep research.
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
| Fast LLM       | Cerebras GPT-OSS-120b (~3000 tok/s)    |
| Research LLM   | Kimi k2.5 via OpenRouter (agent swarm) |
| Embeddings     | Transformers.js (all-MiniLM-L6-v2)     |
| Vector Search  | Voy (WASM)                             |
| Keyword Search | SQLite WASM (FTS5)                     |
| UI             | React 18 + Tailwind CSS                |
| Build          | Vite + @crxjs/vite-plugin              |

Full architecture: [OpenSidebar_Architecture.md](OpenSidebar_Architecture.md)

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
- A Cerebras API key ([cerebras.ai](https://cerebras.ai))
- An OpenRouter API key ([openrouter.ai](https://openrouter.ai)) — optional, for Deep Thought mode

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
3. Enter your Cerebras API key
4. (Optional) Enter your OpenRouter API key for Deep Thought mode

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

Comprehensive RFCs for each implementation phase:

- **[Technical Master Plan](./docs/11-technical-master-plan.md)**: The single source of truth for standards and roadmap.
- **[Architecture](./docs/09-architecture.md)**: Detailed system design and implementation plan.
- **[Critique & Plan](./docs/10-critique-plan.md)**: Analysis and roadmap (Gemini).
- **[Dev Logs](./docs/)**: Daily progress and RFCs.

| Doc                                                        | Description             | State    |
| ---------------------------------------------------------- | ----------------------- | -------- |
| [Types Reference](docs/types-reference.md)                 | All TypeScript types    | Complete |
| [Message Protocol](docs/message-protocol.md)               | Inter-context messaging | Complete |
| [Phase 0: Scaffold](docs/00-project-scaffold.md)           | Project setup, configs  | Complete |
| [Phase 1: Content Script](docs/01-content-script.md)       | DOM distillation        | Complete |
| [Phase 2: Side Panel](docs/02-sidepanel-ui.md)             | React UI                | Complete |
| [Phase 3: Agent Loop](docs/03-agent-loop.md)               | Core agent logic        | Complete |
| [Phase 4: Navigation Bridge](docs/04-navigation-bridge.md) | Page load survival      | Complete |
| [Phase 5: Kimi Swarm](docs/05-kimi-swarm.md)               | Deep Thought engine     | Complete |
| [Phase 6: Memory](docs/06-memory-second-brain.md)          | Local RAG system        | Complete |
| [Phase 7: Workspaces](docs/07-workspace-tab-groups.md)     | Tab Group isolation     | Complete |
| [Phase 8: Testing](docs/08-testing-polish.md)              | Test strategy           | Complete |

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
