# Architecture Overview

OpenSidebar is an AI-powered Chrome extension that transforms the browser into an agentic workspace. This document provides a high-level overview of the system architecture.

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Side Panel                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Chat UI    │  │   Settings   │  │  Orchestrator    │  │
│  │  (React)    │  │   Drawer     │  │     Console      │  │
│  └──────┬──────┘  └──────────────┘  └──────────────────┘  │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Zustand Store + Immer                  │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │     Metrics Bar (token usage, cost tracking)        │    │
│  └────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────┘
                            │ Chrome Extension Messaging
┌───────────────────────────▼─────────────────────────────────┐
│                    Service Worker                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Orchestrator                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │ Planner  │  │ Executor │  │    Verifier       │   │   │
│  │  │ (smart)  │  │  (fast)  │  │  (smart+critic)  │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │ Retry    │  │ Handoff  │  │   Skills Store    │   │   │
│  │  │ Policy   │  │ Context  │  │   (learn+replay)  │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Agent Loop                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │  LLM     │  │ Context  │  │   Tool Registry   │   │   │
│  │  │ Client   │  │ Manager  │  │   (52 tools)      │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │ Progress │  │  Prompt  │  │   Trace           │   │   │
│  │  │ Tracker  │  │ Registry │  │   Recorder        │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ Navigation │  │   Memory   │  │  Workspace │            │
│  │  Bridge    │  │   Bridge   │  │  Manager   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Storage Logger (JSONL rotation)              │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│              Offscreen Document (Memory)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │  SQLite     │  │    Voy      │  │ Transformers.js   │   │
│  │  FTS5       │  │  (Vector)   │  │   (Embeddings)    │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ Chrome Tabs API
┌──────────────────────────────┴──────────────────────────────┐
│                  Content Script (per tab)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │  Element    │  │   DOM       │  │   Action          │   │
│  │  Tagging    │  │  Snapshot   │  │   Execution       │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
│  ┌─────────────┐  ┌──────────────────────────────────┐     │
│  │  Framework  │  │  Auto-dismiss (modals/banners)   │     │
│  │  Detection  │  └──────────────────────────────────┘     │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

## Communication Flow

### 1. User Sends Message

```
Side Panel → Background: USER_CHAT
Background: Orchestrator decides → single-step (AgentLoop) or multi-step (Planner)
Background → Content Script: DOM_SNAPSHOT_REQUEST
Content Script → Background: DOM_SNAPSHOT_RESPONSE
Background → LLM API: Streaming request
LLM API → Background: SSE chunks
Background → Side Panel: STREAM_CHUNK (real-time)
```

### 2. Tool Execution

```
Background → Content Script: TOOL_EXECUTE
Content Script → Background: TOOL_RESULT
Background → LLM: Include result in next prompt
```

### 3. Orchestrator Pipeline

```
Planner (smart LLM) → TaskNode graph
  [Pre-flight Review] ← Verifier validates plan (≥3 nodes)
Executor (fast LLM via AgentLoop) → result + StructuredEvidence
Verifier (smart LLM) → accept / retry / reroute
  [Advocate] challenges retries (low confidence)
  [Retrospective] planner learns from failures
  [Skill Learning] on success with teach mode
```

### 4. Memory Operations

```
Background → Offscreen: MEMORY_WORKER
Offscreen → Worker: embed request
Worker → Offscreen: embedding
Offscreen → Background: MEMORY_WORKER_RESPONSE
```

### 5. Navigation

```
Background → Chrome Tabs: tabs.update (navigate)
Background → Storage: Save state
Chrome → Background: webNavigation.onCompleted
Background → Content Script: DOM_SNAPSHOT_REQUEST (new page)
Background → Agent Loop: Resumed with new snapshot
```

### 6. Session Metrics

```
Background → Side Panel: SESSION_METRICS (every 3 turns + on completion)
Background → Side Panel: TASK_COMPLETION (with metrics summary)
```

## Technology Stack

| Layer               | Technology                                      |
| ------------------- | ----------------------------------------------- |
| **Platform**        | Chrome Extension Manifest V3                    |
| **Build**           | Vite 5 + @crxjs/vite-plugin                     |
| **Language**        | TypeScript 5.7 (strict mode)                    |
| **Package Manager** | Bun                                             |
| **UI**              | React 18 + Tailwind CSS 3.4                     |
| **State**           | Zustand + Immer                                 |
| **Fast LLM**        | GPT-OSS-120B (Cerebras → Groq → OpenRouter)     |
| **Smart LLM**       | GLM-4.7 (Cerebras → OpenRouter), native reasoning |
| **Vision LLM**      | OpenRouter API (configurable, default Qwen VL)  |
| **Embeddings**      | Transformers.js (all-MiniLM-L6-v2)              |
| **Vector Search**   | Voy (WASM)                                      |
| **Keyword Search**  | SQLite WASM (FTS5)                               |
| **Tests**           | Bun test runner + Happy DOM                      |

## Directory Structure

```
src/
├── background/          # Service worker code
│   ├── background.ts    # Entry point, message router
│   ├── agent/           # Agent loop (single-step execution)
│   │   ├── loop.ts      # AgentLoop (LLM→tool→LLM cycle)
│   │   ├── context.ts   # ContextManager (sliding window + distillation)
│   │   ├── stagnation.ts # StagnationMonitor (stuck detection)
│   │   ├── step-labels.ts
│   │   ├── tool-recovery.ts
│   │   └── trace.ts     # TraceRecorder
│   ├── orchestrator/    # Multi-step task pipeline
│   │   ├── index.ts     # Main orchestrator (planner→executor→verifier)
│   │   ├── types.ts     # OrchestratorTask, TaskNode, evidence types
│   │   ├── planner.ts   # Task decomposition + retrospective
│   │   ├── verifier.ts  # Validation + dialogue + advocate
│   │   ├── handoff.ts   # Role transition context
│   │   ├── retry-policy.ts
│   │   ├── scheduling.ts
│   │   ├── budget-estimator.ts
│   │   ├── contracts.ts
│   │   └── memory-buffer.ts
│   ├── skills/
│   │   └── store.ts     # SkillStore (learn + replay)
│   ├── llm/
│   │   ├── client.ts    # Multi-provider client (Cerebras/Groq/OpenRouter)
│   │   └── types.ts     # LLM types, ProviderConfig, TokenUsage
│   ├── tools/
│   │   ├── index.ts     # 52 tool definitions
│   │   ├── registry.ts  # ToolRegistry
│   │   ├── metadata.ts  # ToolMeta, pre-computed sets
│   │   └── react.ts     # React Toolkit (4 on-demand tools)
│   ├── memory/          # Offscreen document bridge
│   ├── workspaces/      # Workspace/Tab Group management
│   ├── vision.ts        # Vision LLM bridge
│   ├── navigation.ts    # Navigation Bridge
│   ├── keepalive.ts     # SW keepalive alarm
│   ├── streaming.ts     # SSE parser with usage capture
│   └── security.ts      # Risk classification
├── content/             # Content script (DOM access)
│   ├── content.ts       # Message listener + auto-dismiss
│   ├── snapshot.ts      # DOM distillation
│   ├── tagging.ts       # Element tagging (stable hash IDs)
│   ├── actions.ts       # Tool execution (DOM actions)
│   └── framework-detect.ts # React detection
├── prompts/             # Prompt registry
│   ├── registry.ts      # Versioned prompt templates
│   ├── types.ts         # PromptId union type
│   └── render.ts        # Template rendering
├── sidepanel/           # React UI
│   ├── App.tsx          # Main component
│   ├── store.ts         # Zustand state
│   ├── bridge.ts        # Message routing
│   ├── hooks/           # Custom hooks (speech-to-text)
│   └── components/      # 20+ UI components
├── offscreen/           # Offscreen document (memory)
│   └── memory/          # SQLite + Voy + RRF
├── types/               # TypeScript types
│   └── index.ts         # Single source of truth
└── utils/               # Shared utilities

tests/                   # Test files mirror src structure (600+ tests)
docs/                    # Documentation
evals/                   # Offline evaluation framework
scripts/                 # Build/dev scripts
traces/                  # Recorded agent sessions
logs/                    # Application logs
```

## Key Design Patterns

### 1. Message Passing

All inter-context communication uses typed discriminated unions (`RuntimeMessage`, 27+ members). Every message has `type` (discriminant), `requestId` (UUID), `source` (origin context), and optional `workspaceId`.

### 2. Two-Tier LLM Architecture

Independent provider pools for fast (GPT-OSS-120B) and smart (GLM-4.7) tiers. Automatic failover across Cerebras → Groq → OpenRouter. Smart tier uses native reasoning (no reasoning parameter).

### 3. Orchestrator Pipeline

Complex tasks decomposed via planner→executor→verifier with:
- **Structured evidence** attached to every completion
- **Cross-role reflexion** from verifier to planner on failures
- **Pre-flight review** for plans with 3+ nodes
- **Advocate triad** for balanced deliberation on low-confidence retries
- **Retrospective** for planner learning after task completion

### 4. Lane Isolation

Each orchestrator role (planner, executor, verifier) runs in its own isolated lane via `runInLane()`, preventing context contamination.

### 5. Skills System

Successful orchestrator runs can be saved as learned skills (teach mode). Skills are auto-replayed on similar future queries, skipping re-planning.

### 6. Streaming Architecture

SSE from LLM → parseSSEStream → STREAM_CHUNK → Zustand → React. Real-time text streaming with token usage capture.

### 7. Navigation Persistence

Agent state saved to `chrome.storage.local` before navigation, restored via `webNavigation.onCompleted` after page load.

### 8. Session Tracing

Full-fidelity recording of agent sessions for offline evaluation replay. Traces drain to `traces/` via log server.

## Security

### Risk Classification

Tools classified by risk level (LOW/MEDIUM/HIGH). Risk is informational — the agent operates autonomously with the stop button as safety mechanism.

### Input Sanitization

- User input truncated to 10k chars, null bytes stripped
- URLs validated (http/https only)
- API keys auto-redacted from logs

## Testing Strategy

| Test Type         | Location                     |
| ----------------- | ---------------------------- |
| Unit tests        | `tests/**/*.test.ts`         |
| Component tests   | `tests/sidepanel/*.test.tsx`  |
| Integration tests | `tests/background/orchestrator-*.test.ts` |
| Eval replay       | `evals/`                      |

**Coverage:** 600+ tests

## See Also

- [Project Setup](./project-setup.md) - Build configuration
- [Content Script](./content-script.md) - DOM interaction
- [Agent Loop](./agent-loop.md) - Core execution engine
- [Navigation Bridge](./navigation-bridge.md) - State persistence
- [Memory System](./memory-system.md) - RAG implementation
- [Tools](./tools.md) - 52 tool definitions
- [Types Reference](./types-reference.md) - TypeScript types
- [Message Protocol](./message-protocol.md) - Message passing
- [Side Panel UI](./sidepanel-ui.md) - React UI
- [Fast-Smart Collaboration](./fast-smart-collaboration.md) - Two-tier LLM system
