# Designing Multi-Agent Systems -- Project Notes

**Book**: Designing Multi-Agent Systems: Principles, Patterns, and Implementation for AI Agents
**Author**: Victor Dibia (multiagentbook.com)
**Pages**: 400 (4 parts, ~20 chapters)

This is the implementation-oriented book. Where Gulli gives patterns and Rothman
gives context theory, Dibia provides the engineering blueprints for building agents
from scratch. Our agent loop, tool system, and orchestrator owe the most to this book.

---

## Part I: Foundations

### Ch 1: Understanding Multi-Agent Systems

**Book concept**: Two approaches to orchestration:
1. **Predefined workflows** -- explicit control flow (sequential, conditional, parallel)
2. **AI-driven autonomous orchestration** -- control flow emerges at runtime

The "jagged frontier" problem: AI capabilities are highly uneven. Tasks that appear
similar in difficulty may succeed or fail unpredictably. In multi-agent systems,
coordination breakdowns amplify this.

**Where we applied it**:
- We use BOTH approaches:
  - Predefined: the perception -> plan -> execute -> verify pipeline is fixed
  - Autonomous: within each phase, the LLM decides what to do (which tools, what order)
- The "jagged frontier" is exactly our executor nondeterminism problem (Failure
  Taxonomy #1). Same prompt + same page = different tool sequences across runs.

**What we learned**:
- The book's observation about "individual inconsistencies compounding in unexpected
  ways" in multi-agent systems matched our experience exactly. A 90% reliable
  executor + 90% reliable verifier = ~81% end-to-end reliability, not 90%.
- The book's decision framework (when to use single agent vs. multi-agent) helped
  justify our current architecture: browser automation genuinely needs planning +
  execution + verification as separate concerns.

### Ch 2: Multi-Agent Patterns

**Book concept**: Taxonomy of orchestration patterns:

| Pattern            | Control  | When to use                        |
|--------------------|----------|------------------------------------|
| Sequential         | Explicit | Steps depend on each other         |
| Conditional        | Explicit | Different paths based on input     |
| Parallel           | Explicit | Independent subtasks               |
| Plan-Based         | Emergent | Complex tasks needing decomposition|
| Handoff            | Emergent | Specialist agents take turns       |
| Conversation-Based | Emergent | Agents debate/discuss              |

**Where we applied it**:
- **Plan-Based**: `OrchestratorPlanner.buildNodes()` decomposes into TaskNode DAG
- **Handoff**: `orchestrator/handoff.ts` -- structured handoff between planner,
  executor, and verifier with artifact trail
- **Sequential**: within a plan, nodes execute in dependency order
  (`scheduling.ts` -- `getDependencyState()`, `getRunnablePendingNodes()`)
- **Conditional**: tool profiles change based on current plan step
  (`buildDomAwareProfile()` -- DOM-aware tool selection)

**What we learned**:
- We don't use the Conversation-Based (Group Chat) pattern at all. The book's
  examples show agents debating; our agents have clear roles with no negotiation.
  This is intentional -- debate adds latency and token cost without clear benefit
  in browser automation where actions are concrete, not opinions.
- The Handoff pattern was the most influential. The book's `handoff()` function
  that transfers context between agents became our `handoffArtifacts[]` trail.

---

## Part II: Building from Scratch

### Ch 3: UX Principles for Multi-Agent Systems

**Book concept**: Four design principles for multi-agent UX:
1. **Capability Discovery** -- users must understand what agents can do
2. **Cost-Aware Action Delegation** -- transparent about cost/time tradeoffs
3. **Observability and Provenance** -- show what agents did and why
4. **Interruptibility** -- users must be able to stop/redirect agents

**Where we applied it**:
- **Capability Discovery**: tool descriptions in system prompt; plan confirmation
  overlay shows the user what the agent intends to do before acting
- **Cost-Aware Delegation**: `SESSION_METRICS` broadcast every 3 turns + on
  completion; `showSessionMetrics` toggle; token cost tracked per turn
- **Observability**: trace viewer (`src/trace-viewer/`), structured logs,
  `TASK_PROGRESS` broadcasts, turn-by-turn streaming in side panel
- **Interruptibility**: `pause()` / `resume()` / `isPaused()` on AgentLoop;
  approval gates on HIGH-risk tools; plan confirmation can cancel

**What we learned**:
- The book's "reliability paradox" UX section was prescient for our project.
  Users see the agent handle complex forms perfectly, then fail on a simple
  button click. The jagged frontier is real and users need to understand it.
- The "Cost-Aware Action Delegation" principle drove our session metrics
  feature. Without visible cost, users couldn't make informed decisions about
  when to let the agent run vs. do it manually.
- Interruptibility was harder than expected. The book describes it simply, but
  implementing pause/resume in an async agent loop with pending tool calls,
  streaming responses, and background perception is complex.

### Ch 4: Building Your First Agent

**Book concept**: The Agent Execution Loop:
```
while not done:
    observe -> reason -> act -> update memory
```

Key components:
- `BaseAgent` foundation class with streaming events
- Model client with structured output
- Tool system with `BaseTool` / `FunctionTool` classes
- Memory (short-term via history, long-term via RAG)
- Middleware for control and observability
- OpenTelemetry integration

**Where we applied it**:
- `src/background/agent/loop.ts` -- our execution loop follows this exact pattern:
  ```
  while (turnCount < maxTurns && !aborted):
      refreshPerception()     // observe
      assembleLLMContext()     // reason (context engineering)
      callLLM()               // reason (model inference)
      dispatchTool()          // act
      updateHistory()         // update memory
  ```
- **BaseAgent pattern**: our `AgentLoop` class is the equivalent
  - `start()` returns `Promise<LoopResult>` (streaming via callbacks)
  - `injectFeedback()`, `getCurrentTurn()`, `getOriginalQuery()` -- public API
- **Structured output**: `tool_choice: "auto"` + function-calling schema
  - `ToolDefinition` type follows OpenAI function-calling format
  - Tool recovery: `recoverToolCallsFromText()` for malformed model output
- **Middleware**: `src/background/agent/middleware.ts` -- `AgentMiddleware` class
  - `evaluatePreTool()` -- approval, risk checks before execution
  - `evaluatePostTool()` -- error classification, retry decisions after execution
  - Tracks `disabledTools`, `bypassApprovals`, session timing

**What we learned**:
- The book's `BaseAgent` class is minimal and elegant. Our `AgentLoop` grew much
  larger because browser automation has concerns the book doesn't address:
  DOM snapshot management, perception agent orchestration, stagnation detection,
  content script communication.
- The book's `FunctionTool` pattern (auto-generate schema from function signature)
  is exactly our `ToolDefinition` approach. Tool parameter names must match between
  the LLM-facing schema, TypeScript types, and content script executor -- this
  consistency requirement was painful to discover and is not mentioned in the book.
- The `recoverToolCallsFromText()` function (parsing tool calls from malformed
  model output) is our addition. The book assumes models always produce valid
  function calls; in practice, ~5% of calls need recovery.

### Memory System (Ch 4.7-4.8)

**Book concept**: Two memory approaches:
- **Application-managed**: developer controls what's stored/retrieved automatically
- **Agent-managed**: agent explicitly decides what to store via tools

Short-term memory = conversation history (message list).
Long-term memory = RAG with embeddings.
The book introduces `BaseMemory` class with `add()`, `query()`, `clear()`.

**Where we applied it**:
- We use **application-managed** memory exclusively:
  - `ContextManager` auto-manages conversation history (compress, truncate)
  - `WorkspaceTurnMemory` auto-records turn outcomes (no agent decision)
  - `PerceptionAgent` auto-accumulates observations (no agent decision)
- We considered but rejected **agent-managed** memory:
  - Adding a `remember` tool would let the model decide what's important
  - Risk: model fills memory with irrelevant observations, degrading context
  - Our turn memory system is simpler and more reliable

**What we learned**:
- The book's distinction between application-managed and agent-managed memory
  was clarifying. We were implicitly application-managed but hadn't considered
  the alternative. The agent-managed approach could be valuable for long-running
  sessions where the model needs to curate its own context.
- The book's `BaseMemory` interface (`add`, `query`, `clear`) is a good
  abstraction we should consider adopting if we ever add long-term memory.

### Middleware & Observability (Ch 4.9-4.10)

**Book concept**: Middleware pattern for agent control and observability:
- `BaseMiddleware` with `pre_action()` / `post_action()` hooks
- OpenTelemetry integration for production monitoring
- Real-world middleware: rate limiting, cost tracking, content filtering, logging

**Where we applied it**:
- `src/background/agent/middleware.ts` -- `AgentMiddleware` class
  - `evaluatePreTool()` = book's `pre_action()` -- approval checks, risk assessment
  - `evaluatePostTool()` = book's `post_action()` -- error classification, retry logic
- Our trace system (`traces/*.jsonl`) serves the observability role
  - Not OpenTelemetry (we're a browser extension, not a server), but same principle
  - Trace viewer (`src/trace-viewer/`) for visual inspection
- `SESSION_METRICS` broadcasts = cost tracking middleware

**What we learned**:
- The book's middleware pattern fit our architecture perfectly. The pre/post
  hooks around tool execution are the natural place for approval gates,
  error handling, and metrics.
- We skipped OpenTelemetry because browser extensions can't easily run a
  Jaeger instance. Our JSONL traces serve the same purpose at lower complexity.
  If we ever need cross-service tracing, this decision should be revisited.

---

## Part III: Evaluation, Optimization, Responsible AI

### Evaluation Patterns

**Book concept**: Evaluate agents on:
- Task completion rate
- Number of steps/turns
- Tool call accuracy
- Cost per task
- Failure mode analysis

**Where we applied it**:
- Our E2E reports track exactly these metrics:
  - `Success` (task completion), `Turns` (steps), `Perceptions` (VLM calls),
    `Traces` (trace file links), `Prompt used`
- E2E report format (in CLAUDE.md) was designed around these evaluation dimensions
- `lab/knowledge/failure-taxonomy.md` -- systematic failure mode catalog

**What we learned**:
- The book emphasizes that *the same test run multiple times* gives different results.
  We confirmed this -- our E2E pass rate varies 5-10% across identical runs due to
  executor nondeterminism. The book recommends minimum 3 runs per condition for
  statistical significance (our experiment template requires this too).

---

## Part IV: Real-World Applications

The book's real-world examples (code generation, data analysis, research) don't
directly apply to browser automation, but the *patterns* transfer:

- **Code generation agent** -> our `execute_js` tool (sandboxed code execution)
- **Research agent** -> our perception + planning pipeline (gather information,
  form a plan, execute against the DOM)
- **Data analysis agent** -> our `read_page` + structured extraction pattern

---

## Key Patterns Summary: What We Took From Each Book

| Pattern                  | Gulli (ADP) | Rothman (CE) | Dibia (DMAS) | Our Implementation            |
|--------------------------|:-----------:|:------------:|:------------:|-------------------------------|
| Prompt chaining          | Ch 1        |              |              | Agent loop pipeline           |
| Routing/escalation       | Ch 2        |              |              | ProviderPool, tier switching  |
| Reflection/verification  | Ch 4        |              |              | Verifier, assessDoneSummary   |
| Tool system              | Ch 5        |              | Ch 4.6       | 39 tools, ToolMeta, profiles  |
| Planning                 | Ch 6        | Ch 4         | Ch 2         | TaskPlanner, OrchestratorPlanner |
| Multi-agent orchestration| Ch 7        | Ch 4         | Ch 2         | Orchestrator, handoff protocol|
| Memory management        | Ch 8        | Ch 6         | Ch 4.7       | ContextManager, TurnMemory    |
| Context engineering      |             | Ch 1-6       |              | 4-layer context assembly      |
| Goal monitoring          | Ch 11       |              |              | StagnationMonitor             |
| Error recovery           | Ch 12       | Ch 5         |              | fetchWithRetry, middleware    |
| Human-in-the-loop        | Ch 13       |              | Ch 3         | Approvals, clarification, plan confirm |
| UX principles            |             |              | Ch 3         | Trace viewer, session metrics |
| Middleware               |             |              | Ch 4.9       | AgentMiddleware pre/post hooks|
| Context reduction        |             | Ch 6         |              | Dynamic compression levels    |
| Output validation        |             | Ch 7         |              | validatePerceptionTagIds      |
| Evaluation               |             | Ch 8         | Part III     | E2E reports, failure taxonomy |
