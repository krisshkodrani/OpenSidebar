# Project Setup

This document describes the build system, configuration, and development environment for OpenSidebar.

## Overview

OpenSidebar is a Chrome Manifest V3 extension built with:

- **Vite 5** + **@crxjs/vite-plugin** for building and HMR
- **React 18** for the side panel UI
- **TypeScript 5.7** with strict mode
- **Tailwind CSS 3** for styling
- **npm** as the package manager, **tsx** for TypeScript execution, and **Vitest** for testing

## Directory Structure

```
opensidebar/
├── .env.example
├── .gitignore
├── .eslintrc.cjs
├── manifest.json              # Chrome MV3 manifest
├── package.json
├── postcss.config.cjs
├── tailwind.config.cjs
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── types/
│   │   └── index.ts           # All shared TypeScript types (single source of truth)
│   ├── background/           # Service worker
│   │   ├── background.ts     # Entry point, message router
│   │   ├── agent/            # Agent loop (single-step execution)
│   │   │   ├── loop.ts       # AgentLoop (LLM→tool→LLM cycle)
│   │   │   ├── context.ts    # ContextManager (sliding window + distillation)
│   │   │   ├── stagnation.ts # StagnationMonitor (stuck detection)
│   │   │   ├── step-labels.ts
│   │   │   ├── tool-recovery.ts
│   │   │   └── trace.ts      # TraceRecorder (session recording)
│   │   ├── orchestrator/     # Multi-step task pipeline
│   │   │   ├── index.ts      # Orchestrator (planner→executor→verifier)
│   │   │   ├── types.ts      # OrchestratorTask, TaskNode, evidence types
│   │   │   ├── planner.ts    # Task decomposition + retrospective
│   │   │   ├── verifier.ts   # Validation + dialogue + advocate
│   │   │   ├── handoff.ts    # Role transition context
│   │   │   ├── retry-policy.ts
│   │   │   ├── scheduling.ts
│   │   │   ├── budget-estimator.ts
│   │   │   ├── contracts.ts
│   │   │   └── memory-buffer.ts
│   │   ├── skills/
│   │   │   └── store.ts      # SkillStore (learn + replay)
│   │   ├── llm/              # Multi-provider LLM client (Cerebras/Groq/OpenRouter)
│   │   ├── tools/            # 57 tool definitions + React Toolkit
│   │   ├── memory/           # Memory bridge to offscreen
│   │   ├── workspaces/       # Workspace/Tab Group manager
│   │   ├── perception.ts    # Perception layer
│   │   ├── navigation.ts     # Navigation bridge
│   │   ├── keepalive.ts      # SW keepalive alarm
│   │   ├── streaming.ts      # SSE parser with usage capture
│   │   └── security.ts       # Risk classification
│   ├── content/              # Content script
│   │   ├── content.ts        # Message listener + auto-dismiss
│   │   ├── snapshot.ts       # DOM distillation
│   │   ├── tagging.ts        # Element tagging (stable hash IDs)
│   │   ├── actions.ts        # DOM actions
│   │   └── framework-detect.ts # React detection
│   ├── prompts/              # Prompt registry
│   │   ├── registry.ts       # Versioned prompt templates
│   │   ├── types.ts          # PromptId union type
│   │   └── render.ts         # Template rendering
│   ├── sidepanel/            # React UI
│   │   ├── App.tsx           # Main component
│   │   ├── store.ts          # Zustand state
│   │   ├── bridge.ts         # Message routing
│   │   ├── hooks/            # Custom hooks (speech-to-text)
│   │   └── components/       # 20+ UI components
│   ├── offscreen/            # Offscreen document (memory)
│   │   └── memory/
│   │       ├── main.ts       # SQLite + Voy coordination
│   │       ├── worker.ts     # Embeddings worker
│   │       └── utils.ts      # RRF algorithm
│   └── utils/                # Shared utilities
├── tests/                    # Test files mirror src structure (600+ tests)
├── docs/                     # Documentation
│   ├── architecture/         # Technical architecture
│   ├── features/             # Feature documentation
│   ├── guides/               # Runbooks and user guides
│   └── rfc/                  # RFC documents (archived + active)
├── evals/                    # Offline evaluation framework
├── scripts/                  # Build/dev scripts
├── traces/                   # Recorded agent sessions
└── logs/                     # Application logs
```

## Configuration Files

### package.json

Key dependencies:

- `react` + `react-dom` - UI framework
- `zustand` + `immer` - State management
- `lucide-react` - Icons
- `sql.js`, `voy-search`, `@huggingface/transformers` - Memory system
- `pdfjs-dist` - PDF text extraction

Key dev dependencies:

- `@crxjs/vite-plugin` - Chrome extension build tool
- `@types/chrome` - Chrome API types


### manifest.json

Required permissions:

- `sidePanel` - Side panel UI
- `activeTab` - Current tab info
- `tabs` - Tab management
- `tabGroups` - Workspace integration
- `storage` - State persistence
- `webNavigation` - Navigation detection
- `offscreen` - Memory worker

Host permissions:

- `https://openrouter.ai/*` - LLM API (OpenRouter)
- `https://api.cerebras.ai/*` - LLM API (Cerebras, fastest)
- `https://api.groq.com/*` - LLM API (Groq, fallback)

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" assert { type: "json" };
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/sql.js/dist/sql-wasm.wasm",
          dest: "wasm",
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["sql.js", "@huggingface/transformers", "voy-search"],
  },
  build: {
    rollupOptions: {
      input: {
        offscreen: "src/offscreen/memory/index.html",
      },
    },
  },
});
```

### tsconfig.json

- `target: ES2022` - Modern JavaScript features
- `strict: true` - Strict type checking
- `moduleResolution: bundler` - Vite-compatible
- Path alias: `@/*` → `src/*`

### tailwind.config.cjs

- `darkMode: "class"` - Manual dark mode toggle
- Custom colors: primary (blue), surface (light/dark)
- Fonts: Inter, JetBrains Mono

## Build Commands

```bash
# Development
npm run dev            # Vite dev server with HMR
npm run build          # Production build

# Quality
npm run lint           # ESLint (src/**/*.ts,tsx)
npm run fmt            # Prettier format src/
npm test               # Run all tests (600+)

# Logging & Traces
npm run logs           # Start log drain server (127.0.0.1:7589)
npm run logs:tail      # Show last 50 entries
npm run logs:errors    # Show error-level entries
npm run traces         # Trace query CLI (list, show, turns, stats, help)

# Evals
npm run evals          # Eval pipeline CLI (shows all subcommands)
npm run evals:critique # Replay golden cases + judge + generate report
npm run evals:validate # Structural validation of golden cases (offline)
npm run evals:perception # Perception eval
npm run evals:planner  # Planner eval
npm run evals:context  # Context eval
npm run evals:stagnation # Stagnation eval

# Prompts
npm run prompts:build  # Build compiled prompts
npm run prompts:check  # Check prompt consistency
```

## Development Workflow

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Create environment file:**

   ```bash
   cp .env.example .env
   # Edit .env with your API keys (optional for dev)
   ```

3. **Start dev server:**

   ```bash
   npm run dev
   ```

4. **Load extension:**
   - Open Chrome → Extensions → Developer mode ON
   - Click "Load unpacked"
   - Select the `dist/` folder

5. **Iterate:**
   - Edit code → HMR updates automatically
   - React components reload instantly
   - Service worker requires manual extension reload for changes

## Testing Setup

Tests use Vitest with Happy DOM for DOM simulation.

**tests/setup.ts** provides Chrome API mocks:

```typescript
(globalThis as any).chrome = {
    runtime: { sendMessage: ..., onMessage: ... },
    storage: { local: ..., sync: ... },
    tabs: { query: ..., create: ..., ... },
    // ... other APIs
};
```

Run specific test files:

```bash
npx vitest run tests/background/streaming.test.ts
npx vitest run --grep "AgentLoop"
```

## Logging System

OpenSidebar includes structured logging with multiple output destinations:

```bash
# Start log drain server (127.0.0.1:7589)
npm run logs

# Show last 50 entries
npm run logs:tail

# Show error-level entries
npm run logs:errors
```

Log file: `logs/opensidebar.jsonl` (JSONL format, 50MB rotation, 5 files max).

## Key Design Decisions

1. **@crxjs/vite-plugin v2 beta** - Only version supporting MV3 with HMR
2. **npm + tsx + Vitest** - Standard Node.js toolchain with TypeScript execution via tsx
3. **Single-file content script** - All logic in `content.ts` for simplicity
4. **Path aliases** - `@/` imports for clean module resolution
5. **Strict TypeScript** - Catches errors early, improves code quality

## Troubleshooting

**Port 5173 in use:**

- Change port in `vite.config.ts` server configuration

**Extension not updating:**

- Service worker changes require extension reload
- Content script changes require tab refresh

**Build errors:**

- Ensure Node.js 18+ is installed: `node --version`
- Clear `.vite/` cache if HMR issues persist
