# Context Engineering for Multi-Agent Systems -- Project Notes

**Book**: Context Engineering for Multi-Agent Systems
**Author**: Denis Rothman (Sorbonne / Paris-Diderot)
**Pages**: 394 (17 chapters)

This book reframes prompt engineering as *context engineering* -- the quality of
output depends less on the model and more on the richness of the informational
environment you construct. This thesis directly shaped our `ContextManager` and
the perception layer.

---

## Core Thesis: Context > Model

**Book concept** (Ch 1): Five levels of context sophistication:
1. Basic prompt (zero context)
2. Better context (linear context)
3. Good context (goal-oriented)
4. Advanced context (role-based)
5. **Semantic blueprint** -- structured, multi-layered context with roles,
   retrieved data, tool outputs, user identity, and interaction history

**Where we applied it**:
- `src/background/agent/context.ts` -- `ContextManager` builds a Level 5 context:
  - **System prompt** (static rules, persona, capabilities) -> prefix-cached
  - **Perception output** (VLM page interpretation: LOCATION, CHANGES, BLOCKERS,
    VISUAL-ONLY, AFFORDANCES)
  - **Turn memory** (workspace-scoped prior turn outcomes)
  - **DOM snapshot** (element list with attributes, compacted)
  - **Conversation history** (compressed dynamically)
  - **Plan context** (current step objectives, success criteria)
  - **Stagnation signal** (if stuck, injected as context)
- `EXECUTOR_PERSONA` / `PLANNER_PERSONA` constants -- role-based context (Level 4)

**What we learned**:
- The book's "semantic blueprint" concept validated our multi-layer context assembly.
  Before reading this, our context was a flat concatenation of prompt + history + elements.
  Restructuring into named layers improved model comprehension measurably.
- The book's claim "context > model" matched our empirical finding in the perception
  A/B test: switching perception model (grok-4.1-fast vs gpt-5.4-mini) made no
  difference, but improving context (better element formatting, affordances section)
  did improve results.

---

## Ch 2-3: MCP-Based Multi-Agent System

**Book concept**: Build a multi-agent system using Model Context Protocol (MCP) for
inter-agent communication. Agents (Researcher, Writer, Orchestrator) communicate via
structured messages with validation. Dual RAG: procedural context (how-to) + factual
knowledge (what).

**Where we applied it**:
- We don't use MCP for inter-agent communication (our agents are in-process), but
  the Researcher/Writer/Orchestrator pattern maps directly to our architecture:
  - **Researcher** -> `PerceptionAgent` (observes the page, gathers facts)
  - **Writer** -> executor in `AgentLoop` (takes action based on gathered context)
  - **Orchestrator** -> `Orchestrator` class (plans, delegates, verifies)
- The dual-RAG pattern (procedural + factual) inspired our separation of:
  - Procedural context: system prompt rules, tool definitions, persona
  - Factual context: DOM snapshot, perception observations, turn memory

**What we learned**:
- The book's MCP message validation (`validateMCPMessage()`) maps to our
  `RuntimeMessage` discriminated union with exhaustive `never` checks in
  `src/sidepanel/bridge.ts`. Structured message validation prevents silent
  failures in cross-context communication.
- The dual-RAG separation is sound but we went further -- we have 4 context
  layers (static rules, dynamic perception, episodic memory, plan state),
  not just 2.

---

## Ch 4: Assembling the Context Engine

**Book concept**: A Context Engine has three core components:
1. **Planner** -- analyzes the task and determines which agents to invoke
2. **Executor** -- runs the selected agents in sequence
3. **Execution Tracer** -- records every step for debugging and auditing

**Where we applied it**:
- This maps 1:1 to our orchestrator architecture:
  - `src/background/orchestrator/planner.ts` -- `OrchestratorPlanner`
  - `src/background/orchestrator/index.ts` -- executor loop within `startTask()`
  - `src/background/agent/trace.ts` + `traces/*.jsonl` -- execution tracing
- The "Agent Registry" pattern (book's `AgentRegistry` class) maps to our
  tool metadata system (`tools/metadata.ts`) -- registry of available capabilities.

**Key parallel**: The book's "Planner decides which agents to call, Executor calls
them, Tracer records results" is exactly our "Planner decomposes into TaskNodes,
Orchestrator dispatches to executor, traces recorded per turn."

**What we learned**:
- The Execution Tracer was the most underrated component. The book emphasizes it
  early (Ch 4) and our trace viewer (`src/trace-viewer/`) has been invaluable for
  debugging. Without traces, we could not have done the E2E analysis work.
- The book's registry pattern (declare agent capabilities, let planner choose)
  influenced our tool profiles system -- the planner can restrict which tools
  the executor has access to per step.

---

## Ch 5: Hardening the Context Engine

**Book concept**: Production-grade context engines need:
- Centralized setup functions (avoid scattered initialization)
- Dependency injection (swap components for testing)
- Production-level logging (not just print statements)
- Proactive context management (don't wait for OOM)
- Modularized components (agents, registry, engine as separate modules)

**Where we applied it**:
- `src/background/agent/context.ts` -- proactive context management:
  - `COMPRESSION_TRIGGERS` -- token thresholds that trigger compression
  - Dynamic compression: NONE -> LIGHT -> MEDIUM -> HEAVY
  - `preserveRecent = 2` -- always keep last 2 messages uncompressed
  - Truncation at 150 chars for old tool results
- `src/background/agent/loop.ts` -- centralized agent loop with clean lifecycle:
  - `start()` -> returns `LoopResult { outcome, turnCount, summary }`
  - `pause()` / `resume()` / `isPaused()` -- clean state management
- `scripts/` -- 18 utility scripts for debugging, tracing, log analysis
- Modular structure: `agent/`, `orchestrator/`, `perception/`, `llm/`, `tools/`

**What we learned**:
- The book's "proactive context management" principle was the inspiration for our
  dynamic compression system. Rather than waiting for context overflow, we compress
  progressively as history grows. This prevents the cliff-edge where the model suddenly
  loses all context.
- The hardening chapter's emphasis on "module independence" pushed us to separate
  PerceptionAgent from the main loop -- it used to be inline helper functions,
  now it's a standalone class with `getState()` / `restoreState()`.

---

## Ch 6: Context Reduction with Summarizer Agent

**Book concept**: A dedicated Summarizer agent that compresses context while
preserving semantic content. "Micro-context engineering" -- careful selection of
what to keep vs. compress. Cost management through intelligent summarization.

**Where we applied it**:
- `src/background/agent/context.ts` -- `summarizeHistory()` function
  - Walks history, extracts `T{n}: tool args -> outcome` entries
  - Used during escalation: replaces raw history with compact timeline
  - Called in `summarizeTrajectory()` -- full context distillation
- History compression levels:
  - NONE: full element list, full history
  - LIGHT: reduce low-priority elements
  - MEDIUM: aggressive element pruning, summarize old turns
  - HEAVY: minimal elements, heavily summarized history
- Perception observation compression:
  - Recent 5 at full detail
  - Older entries: "Earlier: Visited N page(s)" one-liner

**What we learned**:
- The book's "micro-context engineering" concept was pivotal. We were losing
  signal in noise -- full DOM snapshots (500+ elements) overwhelmed the model.
  Selective compression (keep interactive elements, drop decorative ones) improved
  tool-call accuracy.
- The Summarizer-as-agent pattern (separate LLM call for summarization) is too
  expensive per-turn. We use heuristic compression (string truncation, element
  filtering) for turns 1-N, and LLM summarization only on escalation. The book
  acknowledges this tradeoff but doesn't solve it.

---

## Ch 7: High-Fidelity RAG and Defense

**Book concept**: Input sanitization, source attribution, and defense against
prompt injection. A "NASA-inspired" approach to reliability: verify every fact,
cite every source, defend every input.

**Where we applied it**:
- `src/background/perception/perception-agent.ts` -- `validatePerceptionTagIds()`
  - Post-processes VLM output to strip/correct hallucinated tag IDs
  - Checks each `[N]` reference against actual element list
  - Corrects mismatched descriptions -- a form of output validation
- `src/background/agent/verification.ts` -- `assessDoneSummary()`
  - Detects hedging language ("I tried but...", "unfortunately...")
  - Catches the model claiming success when it actually failed
- `src/background/agent/middleware.ts` -- tool input validation
  - `evaluatePreTool()` checks tool parameters before execution
  - `evaluatePostTool()` classifies errors (retryable vs terminal)

**What we learned**:
- The book's input sanitization focus is well-placed. Our `validatePerceptionTagIds()`
  was born from production failures where the VLM hallucinated element references.
  Without validation, the executor acted on non-existent elements.
- The "cite every source" principle influenced our trace format -- every turn
  records the exact perception output, tool calls, and model response, creating
  a full evidence chain.

---

## Chapters 8-17: Advanced Topics

Chapters we haven't directly applied yet but are relevant for future work:

- **Ch 8: Evaluation Agent** -- automated evaluation of agent output quality.
  We have `evals/` infrastructure but it's underused. Could integrate with
  lab experiment pipeline.
- **Ch 9: Cost Optimization** -- token budget strategies. We have `BudgetEstimator`
  but don't dynamically adjust context richness based on remaining budget.
- **Ch 10: Guardrails** -- safety boundaries. Our approval policy covers HIGH-risk
  tools, but we don't have guardrails on the content of model output.
- **Ch 13: Multi-Model Orchestration** -- using different models for different
  subtasks. We do this (executor/planner/perception on different models) but
  could be more systematic about model selection per task type.
- **Ch 15: Human Feedback Integration** -- using execution feedback to improve
  future performance. Our turn memory is a primitive version; the book describes
  richer feedback loops.

---

## Key Takeaway

The book's central insight -- that **context engineering is more important than model
selection** -- has been repeatedly validated in our project:

| Change type          | Impact on E2E pass rate | Evidence grade |
|----------------------|-------------------------|----------------|
| Model upgrade        | ~0% (perception A/B)    | A              |
| Context restructure  | +10-15%                 | B              |
| Prompt rewrite       | +21% (71% -> 92%)       | A              |
| Compression tuning   | +5-8%                   | B              |

The model matters less than what you put in front of it.
