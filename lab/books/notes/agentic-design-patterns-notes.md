# Agentic Design Patterns -- Project Notes

**Book**: Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems
**Author**: Antonio Gulli (Google)
**Pages**: 482 (21 chapters + appendices)

This book is the pattern catalog behind most of OpenSidebar's agent architecture.
Every chapter maps to at least one production subsystem.

---

## Ch 1: Prompt Chaining --> Agent Loop Pipeline

**Book concept**: Break complex tasks into sequential sub-prompts. Output of step N
feeds step N+1. Introduces modularity, debuggability, error isolation.

**Where we applied it**:
- `src/background/agent/loop.ts` -- the main agent loop IS a prompt chain:
  perception --> context assembly --> LLM call --> tool dispatch --> verification --> next turn
- `src/background/orchestrator/index.ts` -- orchestrator chains planner output into
  executor input, executor output into verifier input
- `src/prompts/runtime/` -- compiled prompt templates are the "sub-prompts" in the chain

**What we learned**:
- The book's linear chain model broke down for browser automation. We needed a
  *loop* (re-entering the same chain on DOM state change), not just a pipeline.
- Prompt chaining across turns requires careful context management -- the book
  underestimates how fast context windows fill when each chain step produces
  tool results, DOM snapshots, and perception output. This drove our compression work.

---

## Ch 2: Routing --> Provider Pool & Model Escalation

**Book concept**: Route requests to specialized sub-agents or models based on
input classification. A coordinator/router analyzes the request and delegates.

**Where we applied it**:
- `src/background/llm/client.ts` -- `ProviderPool` class with `getActive()` and
  `getNextFallback()`. Routes between OpenRouter, Groq, OpenAI, Fireworks.
- `LLMClient.switchToPlanner()` / `switchToExecutor()` -- tier-based routing.
  Executor handles routine turns; planner handles complex/stuck situations.
- `src/background/agent/stagnation.ts` -- stagnation triggers escalation, which
  is effectively routing from executor-tier to planner-tier model.
- Provider modes: `openrouter`, `openrouter-groq`, `openai-groq`, `fireworks`

**What we learned**:
- The book's routing pattern assumes you know upfront which agent to route to.
  In practice, we route *reactively* -- escalation happens when the executor
  demonstrates it can't handle the task (stagnation, text-only loops).
- Cooldown-based failover (60s on 429, permanent on 402) was not in the book
  but is essential for production multi-provider setups.

---

## Ch 4: Reflection --> Verifier & Self-Correction

**Book concept**: Generate output, then use a "reflector" agent to critique it.
Loop until the reflector says "CODE_IS_PERFECT" or max iterations reached.
Separate the generator and the critic for better results.

**Where we applied it**:
- `src/background/orchestrator/verifier.ts` -- `OrchestratorVerifier` class
  - `verifyNode()` judges executor output against success criteria
  - Decision types: `accept`, `retry`, `reroute`
  - Detects: `blocked`, `state_mismatch`, `insufficient_evidence`, `transient`
- `src/background/agent/verification.ts` -- `assessDoneSummary()` catches
  hedging language in the model's own completion ("I tried but...", "unfortunately...")
- `src/background/orchestrator/types.ts` -- `ReflexionEntry[]` tracks attempt
  history, enabling the verifier to learn from prior failures
- `handoffArtifacts[]` -- immutable log of phase transitions
  (planned -> executor_started -> executor_finished -> verifier_accept/retry/reroute)

**What we learned**:
- The book warns that using the same LLM as generator AND critic leads to
  blind spots. We confirmed this empirically -- the executor model sometimes
  declares success when verification should fail. Separating verifier onto
  the planner model improved accuracy.
- `programmaticVerify()` (heuristic-first, LLM-second) was our addition.
  The book's pure-LLM reflection is too slow and expensive for every turn.
- The reflexion log pattern (track all attempts + failure reasons) came directly
  from the Reflexion paper cited in this chapter.

---

## Ch 5: Tool Use --> 39-Tool System with Risk Stratification

**Book concept**: Tools transform LLMs from text generators into agents that can
sense, reason, and act. Define tools with clear schemas, let the LLM choose which
to invoke. Categories: information retrieval, data manipulation, code execution,
communication, system control.

**Where we applied it**:
- `src/background/tools/` -- 39 registered tools (38 in ToolName enum + escalate)
- `src/background/tools/metadata.ts` -- `ToolMeta` interface:
  `{ risk: RiskLevel, domModifying: boolean, sequential: boolean, cacheable?: type }`
- Pre-computed sets: `DOM_MODIFYING_TOOLS`, `SEQUENTIAL_TOOLS`, `CACHEABLE_TOOLS`
- 8 named tool profiles: `full`, `read_only`, `form_fill`, `navigate`, etc.
- `resolveToolProfile()` and `buildDomAwareProfile()` -- DOM-aware tool selection

**Risk levels** (our addition, not in the book):
- LOW: read_page, find_element, scroll_page, wait, inspect_hidden
- MEDIUM: click_element, type_text, select_option, drag_and_drop
- HIGH: navigate, create_tab, close_tab, go_back, execute_js, upload_file

**What we learned**:
- The book treats tools as a flat list. In browser automation, risk stratification
  is mandatory -- `execute_js` and `navigate` have fundamentally different safety
  profiles than `read_page`.
- Tool profiles (restricting available tools per task phase) prevent the LLM from
  reaching for destructive tools during read-only verification turns.
- `tool_choice: "auto"` is critical -- without it, models sometimes skip tool
  calls entirely and produce text-only responses (our #4 failure pattern).

---

## Ch 6: Planning --> TaskPlanner & Orchestrator

**Book concept**: Plan-then-act. Decompose complex tasks into sub-goals with
dependencies. Execute sub-goals sequentially or in parallel. Replan when
assumptions break.

**Where we applied it**:
- `src/background/agent/planner.ts` -- `TaskPlanner` class
  - `decompose()`: user query -> `PlanStep[]` with objective, successCriteria, dependencies
  - `planNextStep()`: adaptive replanning based on execution results
- `src/background/orchestrator/planner.ts` -- `OrchestratorPlanner` class
  - `buildNodes()`, `expandNode()`, `planNextHorizon()`
  - Converts decomposition into `TaskNode[]` dependency graph (DAG)
  - Horizon planning: replan next 1-3 steps based on completed summary
- `src/background/orchestrator/scheduling.ts` -- DAG scheduling
  - `getDependencyState()`, `getRunnablePendingNodes()` -- respects dependencies

**What we learned**:
- The book's planning examples assume stable environments (API calls, code generation).
  Browser DOM is highly dynamic -- plans go stale within seconds of page navigation.
  This drove our assumption drift detection (`buildAssumptionDriftSignal()` in handoff.ts).
- Multi-node plans (>=2 steps) require user confirmation before execution.
  `PLAN_CONFIRMATION_REQUEST/RESPONSE` messages, blue-themed overlay.
  The book mentions this briefly; we made it mandatory.
- Horizon planning (plan 1-3 steps ahead, not the whole task) was our adaptation
  to the browser's dynamism. Full upfront planning fails when the DOM changes.

---

## Ch 7: Multi-Agent --> Orchestrator Architecture

**Book concept**: Multiple specialized agents collaborate on complex tasks.
Communication models: direct messaging, shared blackboard, publish-subscribe.
Coordination patterns: sequential, parallel, hierarchical.

**Where we applied it**:
- `src/background/orchestrator/index.ts` -- `Orchestrator` class
  - Three lanes: planner, executor, verifier
  - Manages `OrchestratorTask` across workers
  - Checkpoints: persist task state (24h TTL) across browser sessions
- `src/background/orchestrator/types.ts` -- `TaskNode` with phase tracking:
  `planned -> planner_replan -> executor_started -> executor_finished -> verifier_accept`
- `src/background/orchestrator/handoff.ts` -- inter-agent handoff protocol
  - `formatHandoffBrief()`, `formatReflexionContext()` -- structured context transfer
  - `handoffDepth` tracks reroute depth (max 2)

**What we learned**:
- The book's multi-agent examples use independent agents with distinct LLM instances.
  We run planner/executor/verifier on the same LLM client (switching tiers), which is
  cheaper but creates subtle coupling -- the verifier may be biased toward the executor's
  style since they share training.
- Inter-agent communication via structured handoff artifacts (not free-form messages)
  was essential. Free-form handoffs caused context pollution.
- The book's "shared blackboard" pattern maps to our `handoffArtifacts[]` array.

---

## Ch 8: Memory Management --> Context & Turn Memory

**Book concept**: Short-term memory (conversation history), long-term memory
(retrieval-augmented), episodic memory (past experiences). Memory determines
whether an agent can learn and adapt across interactions.

**Where we applied it**:
- **Short-term**: `src/background/agent/context.ts` -- `ContextManager`
  - `maxHistory = 20` messages, configurable `maxContextTokens`
  - Dynamic compression: NONE -> LIGHT -> MEDIUM -> HEAVY based on token budget
  - `summarizeHistory()` -- distills conversation into compact timeline
- **Episodic/Turn memory**: `src/background/agent/memory.ts` -- `WorkspaceTurnMemory`
  - Last 10 turns per workspace, MAX_PROMPT_TURNS = 4 sent to LLM
  - `formatWorkspaceTurnMemoryForPrompt()` -- summarizes prior turn outcomes
  - Workspace-scoped: different tabs = different memory contexts
- **Perception memory**: `src/background/perception/perception-agent.ts`
  - `observationLog: ObservationEntry[]` -- stateful observation accumulation
  - `OBSERVATION_WINDOW = 5` recent entries at full detail, older compressed
  - Fingerprint-based caching to avoid redundant VLM calls

**What we learned**:
- The book's RAG-based long-term memory is overkill for browser sessions (typically
  <30 turns). Our workspace-scoped turn memory is simpler and sufficient.
- History compression was the single most impactful optimization for cost and
  quality. The book mentions it briefly; we built 4 compression levels.
- The perception agent's observation window (5 recent, older compressed) was
  inspired by the book's "sliding window" memory pattern but adapted for VLM output.

---

## Ch 11: Goal Setting & Monitoring --> Stagnation Monitor

**Book concept**: Self-review against quality checklist. Loop until the agent
self-assesses "True" (goals met) or max iterations reached. Monitor progress
toward objectives; detect when the agent is going in circles.

**Where we applied it**:
- `src/background/agent/stagnation.ts` -- `StagnationMonitor` class
  - DOM fingerprinting: hashes url + element count + sorted element signatures
  - `PROGRESS_DELTA_THRESHOLD = 0.1` (10% DOM change = progress)
  - Nudge at 6 stagnant turns, escalate at 12, repeat nudge every 6 after
  - Broadcasts `AGENT_STAGNATION` to side panel
- `src/background/orchestrator/handoff.ts` -- `buildAssumptionDriftSignal()`
  - Tokenizes planner assumptions, checks against current page state
  - Signals "potential plan-reality drift" when assumptions don't match

**What we learned**:
- The book's goal monitoring uses the LLM to self-assess progress. This is expensive
  and unreliable (the model that failed to make progress also fails to notice).
  Our fingerprint-based approach is deterministic and free.
- The escalation ladder (nudge -> escalate -> give-up) was our addition.
  The book's binary (pass/fail) monitoring misses the "gently redirect" case.

---

## Ch 12: Exception Handling --> Error Recovery & Retry Logic

**Book concept**: Agents must handle unexpected outcomes gracefully. Patterns:
retry with backoff, fallback to simpler strategy, escalate to human.

**Where we applied it**:
- `src/background/llm/client.ts` -- `fetchWithRetry()` with exponential backoff
  - 429: cooldown provider for 60s, try fallback
  - 402: disable provider for session
  - 5xx: retry with backoff
- `src/background/agent/middleware.ts` -- `AgentMiddleware.evaluatePostTool()`
  - Classifies errors: retryable vs. terminal
  - Tracks `disabledTools` for tools that consistently fail
- `src/background/tools/bridge.ts` -- empty-page snapshot retry
  - If elements drop N -> 0 after DOM action, retry at 300ms + 500ms
- `src/background/orchestrator/verifier.ts` -- retry/reroute on verification failure
  - `handoffDepth` max 2 prevents infinite retry loops

**What we learned**:
- The book's exception handling is model-centric (LLM decides how to recover).
  In browser automation, most failures are infrastructure failures (network, DOM timing)
  that need deterministic handling, not LLM reasoning.
- The "reroute" concept (try a completely different approach when retries fail)
  was directly inspired by this chapter's "fallback to simpler strategy" pattern.

---

## Ch 13: Human-in-the-Loop --> Approvals & Clarification

**Book concept**: Separate generator and validator roles. Keep humans in the loop
for high-stakes decisions. The agent should know when to ask vs. when to act.

**Where we applied it**:
- `src/background/agent/approval-policy.ts` -- `resolveApprovalPolicy()`
  - Only HIGH-risk tools require user approval (navigate, execute_js, etc.)
  - Three modes: `none`, `required`, `bypassed`
  - `requireApprovals` setting (default true)
- `src/background/agent/loop.ts` -- `clarify` tool interception
  - Agent calls `clarify` when ambiguous, intercepted before executor
  - `CLARIFICATION_REQUEST/RESPONSE` messages, 120s timeout
  - `ClarificationOverlay` with suggestion chips + text input
- Plan confirmation: multi-step plans paused for user review
  - `PLAN_CONFIRMATION_REQUEST/RESPONSE` messages
  - Approve / Cancel / Approve+feedback (triggers replan)

**What we learned**:
- The book emphasizes that the human should validate *output*. We also validate
  *intent* (plan confirmation before execution). This catches bad plans early.
- Risk-based approval thresholds are more usable than "approve everything" --
  users get fatigued approving safe actions. The book doesn't address this.
- The clarification tool (agent explicitly asks the user) was inspired by the
  book's observation that "the agent should know when to ask."

---

## Cross-Cutting Patterns Not in the Book

Things we built that the book doesn't cover:

1. **Perception as a separate agent** -- VLM-based page interpretation running
   alongside the text-based executor. The book assumes text-only input.
2. **Think-tag handling** -- preserving raw reasoning chains in history while
   stripping them from output. The book predates CoT/think-tag models.
3. **DOM snapshot compression** -- 4-level compression for element lists.
   The book's context engineering is about *text* context, not *DOM* context.
4. **Stale element recovery** -- hash-based stable element IDs across page
   refreshes. No analogue in the book's web-agnostic examples.
5. **Session cost tracking** -- per-turn token/cost accounting for budget control.
   The book mentions "Resource-Aware Optimization" (Ch 16) but doesn't provide
   production-grade implementation patterns.
