# OpenSidebar ↔ SOTA Gap Analysis

**Date:** 2026-06-08
**Scope:** Agentic orchestration architecture, evaluation results, and comparison to state-of-the-art web agent systems
**Goal:** Identify concrete gaps and prioritize bridging work

---

## 1. Current Architecture Summary

OpenSidebar implements a **plan→execute→verify→retry** pipeline across three isolated lanes:

### 1.1 Core Pipeline

```
User query
  → TaskPlanner.decompose() → TaskNode[] with dependency graph
  → Plan repair (repairPlanCoverage) → patches missing return/read steps
  → User confirmation (multi-step tasks)
  → Scheduler loop per node:
      1. Build executor instruction (objective + criteria + handoff context)
      2. Spawn AgentLoop instance with tool profile
      3. Agent executes (observe → think → act → done)
      4. Programmatic verification (token matching, URL/title change, evidence)
      5. If ambiguous → LLM verifier (accept/retry/reroute)
      6. On accept → advance; on retry → re-run with reflexion; on reroute → new node
  → Aggregate results → TASK_COMPLETION
```

### 1.2 Key Architectural Strengths

| Component | Implementation | Novelty vs. SOTA |
|-----------|---------------|-------------------|
| **Lane isolation** | 3 lanes (planner, executor, verifier) with circuit breakers, per-workspace quarantine, queue draining, configurable concurrency/failure thresholds | Strong — most SOTA systems lack lane-level fault isolation |
| **Deterministic completion kernel** | 14K-line `completion-kernel.ts` with typed contracts (NavigationContract, FormFillContract, ReadAnswerContract, etc.) and structured evidence ledger | Strong — goes beyond simple `done()` tool; most systems rely on LLM self-assessment |
| **Skill routing** | 3-layer: core workflow → enterprise packs → platform packs, with signal-gated activation | Strong — avoids prompt bloat; platform packs activate only on concrete evidence |
| **Resource-aware parallel scheduling** | NodeParallelContract with resource hints, dependency resolution, serialization of conflicting mutators | Ahead of most open-source agents |
| **Plan repair** | `repairPlanCoverage()` automatically patches missing return legs, missing report targets | Rare in open-source; most systems fail silently on incomplete plans |
| **Perception** | Dual-mode: `unified_vl` (revision-bound screenshot → executor directly) + model-free `structured` DOM grounding, with fingerprint/document-basis caching | Matches SOTA trend toward unified multimodal |
| **Durable persistence** | Full task state persisted to backend SQLite; resume from checkpoint across service worker restarts | Ahead of most browser extensions; matches enterprise requirements |
| **Context distillation** | Trajectory summarization on escalation from executor → planner tier | Good; comparable to Anthropic's approach |

### 1.3 Current Evaluation Results

From the WorkArena ServiceNow atomic baseline (seed 0, no retries, maxTurns=20):

| Metric | Result |
|--------|--------|
| Pass@1 (overall) | 33/33 (100%) |
| Category-balanced pass@1 | 100.0% |
| Median turns | 3 |
| p95 turns | 11 |
| Warnings | 0 |

**Important caveats:** Single-seed (seed 0) only; pass@2 not yet measured; broader WebArena categories not yet run; real-world user task success rates unknown.

### 1.4 Platform Pack Dependency Analysis

The 33/33 pass@1 depends heavily on the `servicenow-platform` pack. Without it,
the agent falls back to pure generic core skills. Estimated fallback performance
based on per-category analysis of what the platform skills provide:

| Category | With platform pack | Without (estimated) | Why |
|----------|-------------------|---------------------|-----|
| Menu navigation | 100% | ~80% | Simple menu is generic. Classic UI iframes break without platform awareness |
| Forms (create incident/change/user/problem/hardware) | 100% | ~40-50% | Glide field commits are ServiceNow-specific. Reference fields and choice lists won't commit correctly with generic `type_text` + `click_element` |
| List filter (6 tasks) | 100% | ~30% | ServiceNow condition builder is complex. Generic click-path construction is fragile |
| List sort (6 tasks) | 100% | ~50% | Column header clicks work sometimes; multi-field sort won't |
| Knowledge search | 100% | ~90% | Generic search + read is close to the structured flow |
| Dashboard / chart | 100% | ~60% | Agent would get values eventually but burn turns on chart interaction |
| Service catalog (9 tasks) | 100% | ~20% | Radio groups, quantity fields, cart routing are ServiceNow-specific |
| **Overall (estimated)** | **100%** | **~45-55%** | Form and catalog categories dominate failures |

**Key insight:** The platform pack proves the architecture works — when strong
platform signals are present, the right skills activate and performance is high.
The open question is: how does the generic core perform on **arbitrary,
non-ServiceNow websites**? That data does not exist yet, and it's the real
measure of the system's generality.

### 1.5 Skill Pack Architecture: Selection-Isolated, Not Runtime-Isolated

The 3-layer skill/pack system has a clean formal interface for **selection routing**:

```
SkillDescriptor → SkillPack → LoadedSkillContract → SkillCandidateDescriptor
                    ↓
resolveEligibleSkillCandidates(input) → CandidateDescriptor[]
                    ↓
selectPrimarySkill(candidates) → ONE SkillSelection
                    ↓
Only the winner's body reaches the executor prompt
```

Packs can be toggled on/off via `UserSettings.enabledSkillPackIds` — disable
`servicenow-platform` and its 8 skills vanish from the candidate pool. This part
is well-designed: the UI checkbox works, the routing pipeline respects it, and
the executor never sees deactivated skill bodies.

**However, the system is NOT a formal plugin architecture.** Three coupling
points prevent dynamic add/remove:

| Coupling point | Location | Impact |
|---------------|----------|--------|
| **Activation dispatch is hardcoded** | `skills.ts` — `getPackActivationReason()` uses `if (pack.id === "servicenow-platform")` chains | Adding a new platform pack requires editing this function |
| **Skills and bodies are inline const declarations** | `skills.ts` — `SKILL_CATALOG[]`, `SKILL_BODIES{}`, `BUILT_IN_SKILL_PACKS[]`, all in one 4000-line file | No `registerSkill()` / `registerPack()` API; no file-system discovery |
| **ServiceNow tools and controller leak into core** | `tools/index.ts` — `open_servicenow_module`, `configure_servicenow_form` are always in the 38-tool registry. `loop.ts` — `maybeRunServiceNowRecordFormController()` is ~900 lines, gated on `selectedSkillId` but physically in the core agent loop | Dead weight when pack is off; adds maintenance burden to core files |

To add a Salesforce pack today requires editing **4 separate core files**:
`skills.ts` (descriptors + bodies + activation dispatch), `tools/index.ts`
(tool definitions), and `loop.ts` (controller logic). Doable, but not
*pluggable*.

The architecture doc on skill routing explicitly defers this:

> *"Dynamic retrieval or plugin discovery should wait until the catalog is much larger."*

A true plugin interface would need:

```typescript
interface PackPlugin {
  readonly pack: SkillPack;
  readonly tools: ToolDefinition[];
  readonly skills: LoadedSkillContract[];
  readonly activation: (input: SkillMatcherInput) => ActivationResult | null;
  readonly controller?: (loop: AgentLoop) => Promise<LoopResult | null>;
}
// registerPack(new ServiceNowPlatformPack());
// registerPack(new SalesforcePlatformPack());
```

---

## 2. SOTA Landscape Survey

### 2.1 Tier 1: Frontier Lab Systems

#### Anthropic Computer Use
- **Architecture:** Direct tool use via `computer_use` tool (screenshot + mouse/keyboard). No separate planner/executor decomposition — the model itself handles strategy.
- **Perception:** Screenshot-only; VL reasoning inline with action selection.
- **Key differentiator:** SOTA on WebArena among single-agent systems. Model quality (Opus 4.8) reduces need for scaffolding.
- **Safety:** Built-in harm classifiers, no access to user data without permission.
- **Limitation:** Closed-source; requires Anthropic API; no user-customizable planning.

#### OpenAI Operator / CUA (Computer Using Agent)
- **Architecture:** GPT-based; screenshot + DOM hybrid perception. Uses reinforcement learning from human feedback (RLHF) for action grounding.
- **Perception:** Hybrid — vision model consumes screenshots; separate grounding model maps to DOM.
- **Key differentiator:** Tree-structured action space limits combinatorial explosion. Safety via confirmation UI and guard model.
- **Limitation:** Closed-source; tightly coupled to GPT models; no parallel execution.

#### Google Project Mariner (Gemini 2.0)
- **Architecture:** Chrome extension; operates in active browser tab. Uses Gemini's native multimodality.
- **Perception:** Screenshot + browser viewport; Gemini processes visual and textual context jointly.
- **Key differentiator:** Self-supervised training on web interaction data. Tight Chrome integration.
- **Limitation:** Research prototype; limited public API; no task decomposition.

### 2.2 Tier 2: Open-Source Systems

#### Browser-Use (Python)
- **Architecture:** Agent → Browser → Controller pattern. Agent produces actions; Browser manages Playwright; Controller executes.
- **Perception:** DOM extraction + optional screenshots. Set-of-marks for visual grounding.
- **Key differentiators:**
  - Multi-tab orchestration with persistent browser context
  - Memory system with session-level persistence
  - LLM-agnostic (GPT, Claude, Gemini, open-source models)
  - Custom action registration
  - Recently added parallel agent support
- **Gaps:** No deterministic completion verification; no plan repair; limited fault isolation.

#### WebVoyager
- **Architecture:** End-to-end vision-based agent. Screenshot → GPT-4V → action. No DOM parsing.
- **Perception:** Screenshot-only with set-of-marks interaction (numbered bounding boxes).
- **Key differentiator:** Simplicity — eliminates DOM dependency entirely.
- **Limitation:** No multi-step planning; no verification; no error recovery beyond LLM retry.

#### Agent S / OS-Copilot (Microsoft Research)
- **Architecture:** Experience-augmented hierarchical planning. Global workspace for cross-task memory.
- **Perception:** Multimodal (screenshot + accessibility tree).
- **Key differentiator:** Persistent memory across tasks; learns from past interactions.
- **Limitation:** Research code; not production-hardened.

### 2.3 Tier 3: Commercial Multi-Agent Systems

#### Manus AI
- **Architecture:** Multi-agent orchestration with specialized sub-agents (planning agent, execution agent, verification agent, summarization agent).
- **Key differentiator:** Hierarchical delegation — planning agent spawns sub-agents for sub-tasks.
- **Limitation:** Closed-source; architecture details inferred from behavior.

#### Convergence Proxy
- **Architecture:** WebRTC-based browser proxy; agent acts through proxy, not directly in browser.
- **Key differentiator:** Can operate on any website without extension installation.
- **Limitation:** Higher latency; proxy dependency; limited offline capability.

### 2.4 Emerging Patterns Across SOTA

| Pattern | Description | Adoption |
|---------|-------------|----------|
| **Unified multimodal** | Screenshot + action in one model call (no separate perception) | Anthropic, Google, OpenAI trending here |
| **Structured action spaces** | Tree/XML-constrained outputs instead of free-form tool calls | OpenAI CUA, WebVoyager |
| **Persistent memory** | Cross-session learning, user preference memory, site-specific adaptation | Agent S, Manus, emerging |
| **Self-correction loops** | Agent critiques its own output, retries with reflection | Reflexion pattern, Browser-Use |
| **Hierarchical planning** | Multi-level: strategic plan → tactical steps → atomic actions | Manus, Agent S |
| **Safety guard models** | Separate classifier that screens actions before execution | OpenAI Operator, Anthropic |
| **Human-in-the-loop at boundaries** | Pause before high-risk actions, not every action | Anthropic, OpenAI |
| **Deterministic verification** | Rule-based completion checks in addition to LLM self-assessment | OpenSidebar (rare in SOTA) |

---

## 3. Gap Analysis

### 3.1 Critical Gaps (User-Visible Impact)

#### GAP-1: No Cross-Session Learning Loop
**Current state:** No durable cross-session learning. The earlier GBrain-backed site-tip pipeline was removed; what remains is user-recorded website skills and the personal profile (both in `chrome.storage.local`), injected as executor/planner context. Task-run "extracted facts" are persisted to SQLite but never re-injected, so there's no automatic extraction of patterns from execution traces.

**SOTA comparison:** Agent S stores experience in a global workspace and retrieves relevant past interactions. Anthropic's computer use (via API) can be wrapped with persistent memory stores (Mem0, Chroma).

**Impact:** The agent makes the same mistakes on repeat visits to the same site. Each task starts from scratch.

**Recommendation:**
1. Add `TaskMemoryStore` that records (site, task_type, success_pattern, failure_pattern) tuples after each task
2. At plan time, retrieve relevant memories and inject into planner context
3. Priority: **High** — directly impacts repeat-task reliability

#### GAP-2: No Automated Regression Benchmarking
**Current state:** WorkArena evaluation is manual (`workarena-handoff.ts`, `workarena-suite.ts`). No CI-integrated benchmark that runs on every PR.

**SOTA comparison:** Browser-Use has benchmark scripts; WebArena has standard evaluation harness. OpenAI/Anthropic run internal evals on every model release.

**Impact:** Regressions in agent behavior are discovered during manual testing, not automatically. The 33/33 seed-0 baseline could silently degrade.

**Recommendation:**
1. Build a `pnpm run bench:quick` target that runs 5-10 representative E2E tasks
2. Integrate into CI (non-blocking, report-only initially)
3. Track pass@1 trend over time
4. Priority: **High** — essential for maintaining quality as the codebase grows

#### GAP-3: No Model-Aware Task Routing
**Current state:** Single executor model for all tasks. Planner always decomposes, executor always executes. No per-task model selection based on difficulty.

**SOTA comparison:** Manus routes tasks to different agent types. Some production systems use smaller models for simple tasks and larger models for complex ones.

**Impact:** Simple tasks (navigate to X) burn expensive planner calls. Complex tasks (multi-form workflows with validation) may use models that are too weak.

**Recommendation:**
1. Add `estimateTaskDifficulty()` in planner — returns `simple | moderate | complex`
2. Route simple tasks directly to executor (skip decomposition)
3. Route complex tasks to strongest available model
4. Priority: **Medium** — cost savings on simple tasks, reliability gains on complex ones

### 3.2 Architectural Gaps (Structural Improvements)

#### GAP-4: No Hierarchical Agent Delegation
**Current state:** Two-tier architecture (orchestrator → workers). Workers are flat — one worker per node. No sub-delegation.

**SOTA comparison:** Manus spawns sub-agents for sub-tasks. Agent S uses hierarchical planning. OpenAI's swarm framework (experimental) supports nested delegation.

**Impact:** Complex nodes (e.g., "research 5 products and compare prices") run as a single flat agent loop with 25+ turns. A hierarchical approach could decompose this into 5 read agents + 1 compare agent.

**Recommendation:**
1. Extend `TaskNode` to support `children: TaskNode[]` for recursive decomposition
2. Allow a worker to spawn sub-workers for parallel read operations
3. Aggregate sub-worker results before completing parent node
4. Priority: **Medium** — unlocks complex research/comparison tasks

#### GAP-5: No Visual Grounding (Set-of-Marks)
**Current state:** Element grounding is hash-based (FNV-1a of tagName+domPath+text+attrs → persistent integer map). Screenshots are sent as context but elements are referenced by text IDs (`[N]`), not visual markers.

**SOTA comparison:** WebVoyager overlays numbered bounding boxes on screenshots. Anthropic's computer use sees raw pixels. OpenAI's CUA uses visual grounding to map model intent to DOM actions.

**Impact:** On visually complex pages (dashboards, charts, image-heavy layouts), the agent can't use visual cues to identify targets. The `AFFORDANCES` validation post-processes VLM output to strip hallucinated tag IDs — a symptom of the grounding gap.

**Recommendation:**
1. Add optional set-of-marks rendering: overlay numbered boxes on screenshot before sending to model
2. Allow model to reference visual markers instead of (or in addition to) DOM tags
3. Use visual grounding as fallback when DOM tags are ambiguous
4. Priority: **Medium** — improves reliability on visually complex pages

#### GAP-6: No Streaming Action Execution
**Current state:** Agent waits for full LLM response, then executes tool calls sequentially (or parallel batch for read-only tools). No action-level streaming.

**SOTA comparison:** OpenAI's CUA streams actions as they're generated. Anthropic's computer use can interleave thinking and acting.

**Impact:** User-visible latency. On a 10-turn task, the user waits for think→act→observe cycles sequentially. Streaming could pipeline perception with action selection.

**Recommendation:**
1. Implement `action` streaming: begin executing tool calls as soon as they're parsed from the SSE stream (before full response is complete)
2. Requires careful abort handling — if a later tool call in the same turn fails validation, undo prior partial actions
3. Priority: **Low** — latency improvement, but adds complexity; safety concerns with partial execution

### 3.3 Safety & Robustness Gaps

#### GAP-7: No Action Guard Model
**Current state:** Tool risk classification (LOW/MEDIUM/HIGH) is informational. Approval gates are binary (requireApprovals on/off). No automatic screening of actions based on context.

**SOTA comparison:** OpenAI Operator has a separate guard model that scores each proposed action for safety. Anthropic's computer use has built-in harm classifiers that refuse dangerous actions.

**Impact:** With `requireApprovals: false`, the agent can perform any action including destructive ones (delete, purchase, submit). No contextual safety — e.g., "delete this record" on a production system vs. test system.

**Recommendation:**
1. Add `ActionGuard` that scores proposed tool calls for risk (not just tool-level, but context-level)
2. Integrate page context: "delete" on `/admin/users` is higher risk than "delete" on `/test/items`
3. Allow configurable thresholds per workspace
4. Priority: **High** — important for public launch (OSS BYOK roadmap)

#### GAP-8: No Idempotency Guarantees for Mutating Actions
**Current state:** `close_popups` was merged into `dismiss_overlays` which is idempotent (safe to repeat). But `click_element`, `type_text`, `select_option`, `apply_list_filter`, `configure_catalog_item`, and `submit` forms have no idempotency guard.

**SOTA comparison:** Stripe's API uses idempotency keys. Database transactions use ACID. Few browser agents address this — it's an open problem.

**Impact:** Duplicate submissions, double-clicks, repeated form fills. The state-diff verification (added 2026-04-04) detects some duplicates but doesn't prevent them.

**Recommendation:**
1. Add `idempotencyKey` to each mutating tool call — derived from (toolName, elementKey, intendedValue)
2. Before executing a mutating action, check if the same idempotencyKey was already successfully executed this turn/session
3. For form submission tools, verify current state before re-submitting
4. Priority: **Medium** — fixes a real class of bugs but requires careful per-tool implementation

### 3.4 Extensibility Gaps

#### GAP-12: Skills Are a Curated Catalog, Not a Plugin System

**Current state:** 31 skills and 3 packs defined as inline const declarations in a
single 4000-line `skills.ts` file. Activation dispatch is a hardcoded
`if (pack.id === "...")` chain. ServiceNow-specific tools (`open_servicenow_module`,
`configure_servicenow_form`) are permanently registered in the 38-tool registry.
~900 lines of ServiceNow controller logic live in `loop.ts`, gated on
`selectedSkillId` but physically in the core agent loop. User-facing pack toggles
exist in Settings UI, but there is no `registerPack()` / `registerSkill()` API,
no file-system discovery, and no lifecycle management (load/unload/hot-swap).

**SOTA comparison:** Browser-Use supports custom action registration. OpenAI's
GPT Actions and Anthropic's MCP (Model Context Protocol) allow tools to be
registered from external servers. LangChain has a `Tool` abstraction with
dynamic registration. The MCP pattern of tool servers that advertise capabilities
is becoming the standard for extensibility.

**Impact:**
- Adding a new platform pack (e.g., Salesforce, SAP, Zendesk) requires editing 4
  core files — no way to ship a pack independently
- No community contribution path for platform-specific skills
- Platform tools and controllers fatten the core runtime even when the pack is
  disabled
- Cannot dynamically load/unload packs based on deployment context (BYOK OSS vs.
  managed enterprise)
- Violates the Open/Closed Principle — core files must be modified to extend the
  system

**Recommendation:**
1. Define a `PackPlugin` interface: `{ pack, tools, skills, activation, controller? }`
2. Extract `servicenow-platform` into the first conforming implementation at
   `orchestrator/packs/servicenow/`
3. Add `registerPack()` / `unregisterPack()` with tool registry integration
4. Add pack-level lifecycle hooks: `onActivate`, `onDeactivate`
5. Priority: **P1** — architectural enabler for community contributions and
   enterprise platform support. Critical before the OSS BYOK launch generates
   demand for new platform adapters.

### 3.5 Performance & Efficiency Gaps

#### GAP-9: No Token Budget Enforcement
**Current state:** Token tracking exists (`SessionMetrics`) but is observational. No hard enforcement of token budgets at the orchestrator level.

**SOTA comparison:** Anthropic's API has `max_tokens`. OpenAI has token limits. LangChain has token budget managers.

**Impact:** A single complex task can consume 500K+ tokens without warning. The `DEFAULT_MAX_TOTAL_TOKENS` exists (1.6M for exhaustive review) but isn't actively enforced mid-task.

**Recommendation:**
1. Add `TokenBudget` class that tracks per-task token consumption in real-time
2. Hard-stop when budget exceeded (with warning to user)
3. Allow user to increase budget mid-task
4. Priority: **Medium** — cost control for BYOK users

#### GAP-10: Single Browser Tab Constraint
**Current state:** Orchestrator can manage multiple tabs (tab coordination, auxiliary tabs for parallel workers). But the primary execution model is one tab per node. Cross-tab state sharing is manual.

**SOTA comparison:** Browser-Use supports multi-tab orchestration with context sharing. Playwright-based agents can manage multiple pages naturally.

**Impact:** Cross-tab workflows (compare prices across 3 tabs, fill form using data from another tab) require explicit `switch_tab` + `read_page` sequences instead of parallel tab reading.

**Recommendation:**
1. Extend parallel worker model to support `TabContext` per worker
2. Allow workers to share read-only tab state (snapshots, extracted data)
3. Add `cross-tab-compare` as a first-class workflow skill
4. Priority: **Medium** — already partially addressed in parallel-work roadmap Stage 2

### 3.6 Evaluation & Observability Gaps

#### GAP-11: No User Task Success Telemetry
**Current state:** Traces are recorded locally. Run traces go to backend. But there's no aggregated view of user task success rates, common failure modes, or task completion time trends.

**SOTA comparison:** Commercial products (Operator, Copilot) have telemetry dashboards. Open-source tools (LangSmith, Phoenix) provide LLM observability.

**Impact:** Developers can't answer "what's our user-facing success rate?" or "what are the top 3 failure modes in production?"

**Recommendation:**
1. Add `TASK_OUTCOME` event to run traces with explicit success/failure + failure classification
2. Build a simple aggregation dashboard in trace viewer
3. Track: pass rate by category, median turns, top failure reasons, cost per task
4. Priority: **Low** — important for product decisions but not blocking core functionality

---

## 4. Gap Priority Matrix

| Gap | Category | User Impact | Implementation Complexity | Priority |
|-----|----------|-------------|---------------------------|----------|
| GAP-1: Cross-session learning | Critical | High | Medium | **P0** |
| GAP-2: Automated benchmarking | Critical | High | Medium | **P0** |
| GAP-7: Action guard model | Safety | High | Medium | **P0** |
| GAP-3: Model-aware routing | Critical | Medium | Low | **P1** |
| GAP-4: Hierarchical delegation | Architectural | Medium | High | **P1** |
| GAP-5: Visual grounding (SoM) | Architectural | Medium | Medium | **P1** |
| GAP-8: Idempotency guarantees | Safety | Medium | Medium | **P1** |
| GAP-12: Formalized pack plugin interface | Extensibility | High | High | **P1** |
| GAP-9: Token budget enforcement | Performance | Medium | Low | **P2** |
| GAP-10: Cross-tab state sharing | Performance | Medium | High | **P2** |
| GAP-6: Streaming action execution | Architectural | Low | High | **P3** |
| GAP-11: User telemetry | Observability | Low | Low | **P3** |

---

## 5. Where OpenSidebar Leads SOTA

It's worth acknowledging areas where OpenSidebar's architecture is ahead of common SOTA patterns:

1. **Deterministic completion verification** — The 14K-line completion kernel with typed contracts (FormFillContract, NavigationContract, ReadAnswerContract, etc.) and structured evidence ledger is more rigorous than any open-source web agent. Most rely entirely on LLM self-assessment ("The task is done").

2. **Lane-level fault isolation** — Circuit breakers per lane (planner, executor, verifier) with configurable failure thresholds, cooldown periods, and per-workspace quarantine. Most SOTA systems have no fault isolation; a single API error crashes the entire agent.

3. **Plan repair** — `repairPlanCoverage()` automatically detects and patches missing planning steps (return legs, report targets). No major SOTA system has comparable automatic plan repair.

4. **Resource-aware parallel scheduling** — `NodeParallelContract` with resource hints and dependency-aware serialization. Most open-source agents are purely sequential.

5. **Skill routing without prompt bloat** — Three-layer skill system with signal-gated activation. Only the selected skill body reaches the executor prompt. Contrast with systems that stuff the full tool catalog into every system message. <br>**Caveat:** Skills are a curated catalog, not a formal plugin system — adding a new platform pack requires editing 4 core files. Formalization is tracked as GAP-12.

6. **Durable persistence across service worker restarts** — Chrome MV3's service worker lifecycle is hostile; OpenSidebar's checkpoint-based persistence handles this gracefully.

---

## 6. Recommended Implementation Sequence

### Phase 1: Foundation (Next 2-4 Weeks)

```
GAP-3 (Model-aware routing) → GAP-9 (Token budget enforcement) → GAP-2 (Benchmark harness)
```

Start with low-complexity, high-impact changes. Model-aware routing immediately saves costs. Token budgets give users control. Benchmark harness prevents regressions while making other changes.

### Phase 2: Safety, Memory & Extensibility (Weeks 4-8)

```
GAP-7 (Action guard model) → GAP-1 (Cross-session learning) → GAP-12 (Pack plugin interface) → GAP-8 (Idempotency)
```

Safety before public launch. Memory enables compounding improvements. The pack
plugin interface is the architectural enabler for community contributions and
enterprise platform support — extract ServiceNow into the first conforming
implementation as proof of the interface. Idempotency fixes a real bug class.

### Phase 3: Advanced Architecture (Weeks 8-16)

```
GAP-5 (Visual grounding) → GAP-4 (Hierarchical delegation) → GAP-10 (Cross-tab state)
```

Visual grounding improves reliability on complex pages. Hierarchical delegation unlocks complex research tasks. Cross-tab state sharing enables multi-tab workflows.

### Phase 4: Polish (Ongoing)

```
GAP-6 (Streaming actions) → GAP-11 (User telemetry)
```

Latency improvements and observability after core capabilities are solid.

---

## 7. Success Metrics for Gap Closure

| Gap | Success Metric | Target |
|-----|---------------|--------|
| GAP-1 | Repeat-task success rate (same task, same site, 3rd attempt) | >95% |
| GAP-2 | Time to detect a regression | <1 hour (CI) |
| GAP-3 | Simple task cost reduction | >50% fewer tokens |
| GAP-4 | Complex research task completion rate | >80% for 5+ target tasks |
| GAP-5 | Visual page task success rate | >90% on dashboard/chart tasks |
| GAP-7 | Unsafe action prevention rate | 100% for configured risk thresholds |
| GAP-8 | Duplicate action rate | <1% of mutating tool calls |
| GAP-9 | Budget overrun rate | <5% of tasks exceed budget |
| GAP-12 | Packs addable without core file edits | 0 core files touched for new platform pack |
| GAP-10 | Cross-tab task completion rate | >85% |
| GAP-11 | User task success rate visibility | Dashboard within 1 week of launch |

---

## 8. References

### Internal Architecture Documents
- `docs/architecture/orchestrator.md` — Orchestrator design
- `docs/architecture/agent-loop.md` — Agent loop design
- `docs/architecture/parallel-work-roadmap.md` — Parallel work roadmap
- `docs/architecture/skill-routing-without-prompt-bloat.md` — Skill routing design
- `docs/evals/workarena-roadmap.md` — WorkArena evaluation roadmap
- `AGENTS.md` — Engineering policy

### SOTA Systems Referenced
- Anthropic Computer Use (`platform.claude.com/docs/en/docs/build-with-claude/computer-use`)
- OpenAI Operator / CUA (Computer Using Agent)
- Google Project Mariner (Gemini 2.0)
- Browser-Use (github.com/browser-use/browser-use)
- WebVoyager (end-to-end vision-based web agent)
- Agent S / OS-Copilot (Microsoft Research)
- Manus AI (multi-agent orchestration)
- Convergence Proxy (WebRTC browser proxy)
