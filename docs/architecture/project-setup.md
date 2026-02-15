# Project Setup

This document describes the build system, configuration, and development environment for OpenSidebar.

## Overview

OpenSidebar is a Chrome Manifest V3 extension built with:

- **Vite 5** + **@crxjs/vite-plugin** for building and HMR
- **React 18** for the side panel UI
- **TypeScript 5.7** with strict mode
- **Tailwind CSS 3** for styling
- **Bun** as the package manager and test runner

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
│   │   ├── background.ts     # Entry point
│   │   ├── agent/            # Agent loop
│   │   │   ├── loop.ts       # Main orchestration
│   │   │   ├── context.ts    # Context manager (sliding window)
│   │   │   ├── progress.ts    # Stuck detection
│   │   │   ├── executor.ts   # Tool execution
│   │   │   ├── guardian.ts   # Plan guardian
│   │   │   ├── step-labels.ts # Step labels
│   │   │   ├── tool-recovery.ts # Tool call recovery
│   │   │   └── trace.ts      # Session recording
│   │   ├── llm/              # LLM clients (multi-provider)
│   │   ├── tools/            # 52 tool definitions
│   │   ├── memory/           # Memory bridge
│   │   ├── workspaces/        # Workspace manager
│   │   ├── vision.ts         # Vision LLM
│   │   ├── navigation.ts      # Navigation bridge
│   │   ├── keepalive.ts      # SW keepalive
│   │   ├── streaming.ts       # SSE parser
│   │   └── security.ts       # Risk classification
│   ├── content/              # Content script
│   │   ├── content.ts        # Message listener + Janitor
│   │   ├── snapshot.ts       # DOM distillation
│   │   ├── tagging.ts        # Element tagging
│   │   └── actions.ts        # DOM actions
│   ├── sidepanel/            # React UI
│   │   ├── App.tsx          # Main component
│   │   ├── store.ts         # Zustand state
│   │   ├── bridge.ts        # Message routing
│   │   └── components/      # UI components
│   ├── offscreen/            # Offscreen document (memory)
│   │   └── memory/
│   │       ├── main.ts      # SQLite + Voy
│   │       ├── worker.ts    # Embeddings
│   │       └── utils.ts     # RRF
│   └── utils/               # Shared utilities
├── tests/                   # Test files (mirror src structure)
├── docs/                    # Architecture docs
│   └── architecture/
└── evals/                   # Offline evaluation framework
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
- `bun-types` - Bun runtime types

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

- `https://openrouter.ai/*` - LLM API (all models)

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
# Development with HMR
bun run dev

# Production build
bun run build

# Type checking
bun run lint

# Run tests
bun test

# Format code
bun run fmt

# Run evaluation suite
bun run evals

# Show eval statistics
bun run evals:stats

# Analyze evals with suggestions
bun run evals:analyze
```

## Development Workflow

1. **Install dependencies:**

   ```bash
   bun install
   ```

2. **Create environment file:**

   ```bash
   cp .env.example .env
   # Edit .env with your API keys (optional for dev)
   ```

3. **Start dev server:**

   ```bash
   bun run dev
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

Tests use Bun's built-in test runner with Happy DOM for DOM simulation.

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
bun test tests/background/streaming.test.ts
bun test --grep "AgentLoop"
```

## Logging System

OpenSidebar includes structured logging with multiple output destinations:

```bash
# Start log drain server (127.0.0.1:7589)
bun run logs

# Show last 50 entries
bun run logs:tail

# Show error-level entries
bun run logs:errors

# Query logs
bun run logs:query search <text>
```

Log file: `logs/opensidebar.jsonl` (JSONL format, 50MB rotation, 5 files max).

## Key Design Decisions

1. **@crxjs/vite-plugin v2 beta** - Only version supporting MV3 with HMR
2. **Bun over Node** - Faster installs, built-in test runner, TypeScript transpilation
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

- Ensure Bun is installed: `bun --version`
- Clear `.vite/` cache if HMR issues persist
