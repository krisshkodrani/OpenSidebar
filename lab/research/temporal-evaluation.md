# Temporal.io Evaluation for OpenSidebar

**Date:** 2026-04-17
**Author:** Claude (research agent)
**Status:** Research complete, decision pending

---

## Executive Summary

Temporal.io is a durable execution platform that guarantees workflow code runs to completion regardless of infrastructure failures. It is a strong fit for AI agent orchestration in general (OpenAI Codex, Replit Agent 3 use it), but **cannot run inside a Chrome extension service worker** due to native Node.js dependencies. Adopting Temporal would require a **mandatory external backend**, fundamentally changing OpenSidebar from a standalone extension to a client-server application.

**Verdict:** The durability problems Temporal solves are real in OpenSidebar today, but the architectural cost of adoption is high. A lighter-weight durability layer built on `chrome.storage` is more appropriate for the extension's standalone deployment model.

---

## 1. What Temporal Offers

### Core Primitives

| Concept | What It Does | OpenSidebar Analogue |
|---------|-------------|---------------------|
| **Workflow** | Deterministic function that survives crashes via event-sourced replay | `orchestrator/index.ts` task runner |
| **Activity** | Non-deterministic side-effect (LLM call, tool execution) with automatic retry | `AgentLoop` tool dispatch |
| **Signal** | Async message to a running workflow (human-in-the-loop) | `CLARIFICATION_REQUEST/RESPONSE` |
| **Query** | Read-only state inspection | `getCurrentTurn()`, `getStagnationMonitor()` |
| **Child Workflow** | Sub-workflow with independent failure isolation | Multi-node `TaskNode` execution |
| **Timer** | Durable sleep that survives restarts (up to 100 years) | `keepalive` alarm (lossy) |
| **Saga** | Compensating transactions on failure | No current equivalent |

### Key Guarantees

- **Effectively exactly-once execution** — workflow logic replays deterministically; completed activities are never re-executed
- **Durable timers** — survive process crashes, deployments, infrastructure failures
- **Configurable retry policies** — per-activity: backoff, max attempts, non-retryable error types
- **Event History as audit trail** — every decision permanently recorded (1-90 day retention)
- **Workflow versioning** — safe code migrations without breaking in-flight workflows

---

## 2. Current OpenSidebar Durability Gaps

These are the real problems that motivate this evaluation.

### What IS Persisted Today

| State | Storage | Recovery |
|-------|---------|----------|
| Task structure (nodes, status, results) | `chrome.storage.local` checkpoint | Restored on SW restart (24h TTL) |
| Workspace turn memory (last 10 turns) | `chrome.storage.local` | Loaded into next turn's prompt |
| Session metrics (tokens, cost) | Checkpoint | Accumulated across restarts |
| Handoff artifacts + reflexion logs | Node state in checkpoint | Full history preserved |

### What is NOT Persisted (Critical Gaps)

| State | Impact of Loss |
|-------|---------------|
| **Agent loop LLM history** (`ContextManager.history`) | Resumed nodes restart with empty context, may re-execute steps |
| **Mid-turn tool execution state** | Tool call may complete but orchestrator never receives result |
| **Approval/escalation waiters** (Promise-based) | User loses approval prompts, must re-decide |
| **Stagnation fingerprints** | Cannot detect repeated failures across restarts |
| **Tool result cache** | Potential duplicate side-effects (cart additions, form submissions) |

### Concrete Failure Scenarios

1. **Duplicate Action Bug:** Service worker dies after `click(buyButton)` succeeds but before `done()`. On restart, executor has no memory of the click → clicks again → double purchase.

2. **Context Amnesia:** 15-turn research task, service worker restarts at turn 12. Node resumes with zero LLM history. Agent re-executes turns 1-11 worth of exploration, burning tokens and time.

3. **Lost Approval:** User is shown an approval overlay. Service worker unloads during the wait. Promise resolves to nothing. User must re-trigger the entire workflow to get re-prompted.

---

## 3. Why Temporal Cannot Run in the Extension

This is the **hard blocker**. The reasons are fundamental, not incidental:

| Requirement | Why It Fails in a Service Worker |
|------------|--------------------------------|
| `@temporalio/core-bridge` (Rust napi-rs) | Requires Node-API native modules — not available in browsers |
| `worker_threads`, `vm`, `async_hooks` | Node.js-only APIs, no browser equivalent |
| gRPC transport | Requires native HTTP/2 — browser `fetch` doesn't support it |
| V8 isolate creation | Temporal creates isolates via Node.js `vm` — browser V8 doesn't expose this |
| `@temporalio/worker` | Officially supports **Node.js 20/22/24 only** |

The `@temporalio/client` package has broader compatibility (Cloudflare Workers, Deno), but the **Worker** — which is the thing that actually runs your code — is Node.js only.

### What Adoption Would Require

```
Current:  Extension (standalone) ─── chrome.storage
                                      (checkpoints)

Proposed: Extension ──HTTP/WS──> Node.js Backend ──gRPC──> Temporal Server
                                   ├─ Temporal Worker (runs workflows)
                                   ├─ Activity Workers (LLM calls, tool dispatch)
                                   └─ PostgreSQL (event history)
```

This transforms OpenSidebar from a **zero-dependency browser extension** into a **client-server application** requiring:

- A running Node.js backend process
- Either Temporal Cloud ($100+/month) or self-hosted Temporal (PostgreSQL + 4 services)
- Network connectivity for every agent action
- ~10-50ms latency overhead per activity invocation

---

## 4. Temporal Cloud Pricing

| Plan | Minimum/Month | Included |
|------|--------------|----------|
| Essentials | $100 | 1M actions, 1 GB active storage |
| Business | $500 | 2.5M actions, 2.5 GB active |
| Enterprise | Annual (sales) | 10M actions |

**Pay-as-you-go:** $25-50 per million actions.

**Self-hosted:** Free (OSS), but realistically $200-500+/month in cloud infrastructure + significant ops time.

**Startup program:** $6,000 in free credits for companies with <$30M funding.

---

## 5. Alternatives Assessment

### If a Backend is Acceptable

| Platform | Pros | Cons | Cost |
|----------|------|------|------|
| **Temporal** | Battle-tested at scale (OpenAI, Replit), strongest guarantees, huge ecosystem | Heaviest ops burden, steepest learning curve (~1 month), native deps | $100+/mo cloud |
| **Trigger.dev v3** | Best TypeScript DX, checkpoint-resume (no determinism constraint), open source, AI-agent features built-in | Younger, APIs still evolving | Free tier → $50/mo |
| **Inngest** | Event-driven, serverless-first, AgentKit for multi-agent, Zod schemas | Proprietary cloud dependency | Free 50K runs/mo |
| **Restate** | Lightest weight (single Rust binary, no DB), durable async/await | Smallest community, least proven at scale | OSS free |

### If Standalone Extension is Required (Current Model)

None of the above platforms work. The only option is improving the in-extension durability layer.

---

## 6. Benefits IF Temporal Were Adopted

### Solved Problems

1. **No more duplicate actions** — Activity results are recorded in Event History; replay never re-executes completed activities
2. **Turn-level recovery** — Each LLM call is an Activity; workflow resumes from exact failure point
3. **Durable human-in-the-loop** — Signals survive process restarts; approval state is persistent
4. **Automatic retries with backoff** — Per-activity retry policies, non-retryable error classification
5. **Long-running task durability** — Workflows can run for days/weeks with durable timers
6. **Full audit trail** — Every decision, tool call, and result permanently recorded
7. **Saga/compensation** — If step 5 fails, automatically undo steps 1-4 (e.g., cancel a booking)
8. **Multi-agent coordination** — Child workflows for parallel task decomposition with independent failure isolation

### New Capabilities

- **Scheduled agent tasks** — Durable cron schedules for recurring agent jobs
- **Cross-session continuity** — Workflow state survives extension updates, browser restarts
- **Workflow versioning** — Safe code deployments without breaking in-flight agent tasks
- **Observability** — Built-in workflow history viewer, metrics, search

---

## 7. Costs of Adoption

### Architectural Costs

| Cost | Severity | Detail |
|------|----------|--------|
| **Mandatory backend** | **Critical** | Extension can no longer function standalone |
| **Offline impossible** | **High** | Every agent action requires backend connectivity |
| **Latency overhead** | **Medium** | +10-50ms per activity (tool call, LLM invocation) |
| **Deployment complexity** | **High** | Users must run/connect to a backend |
| **Payload size limit** | **Medium** | 2 MB per payload — DOM snapshots, LLM histories may exceed this |
| **Event History limit** | **Medium** | 51,200 events max — long agent conversations need Continue-As-New |

### Engineering Costs

| Cost | Severity | Detail |
|------|----------|--------|
| **Learning curve** | **High** | ~1 month for team to become productive; determinism constraints are unintuitive |
| **Architecture rewrite** | **High** | Agent loop, orchestrator, tool dispatch all need restructuring |
| **Split-brain testing** | **Medium** | Must test both extension and backend, plus their interaction |
| **Determinism discipline** | **Medium** | Workflow code cannot use `Date.now()`, `Math.random()`, direct I/O |
| **Migration path** | **High** | No incremental adoption — requires full orchestration layer rewrite |

### Operational Costs

| Cost | Severity | Detail |
|------|----------|--------|
| **Monthly spend** | **Medium** | $100-500/month (cloud) or $200-500/month (self-hosted infra) |
| **Ops burden** | **High** (self-hosted) | Database scaling, service monitoring, schema migrations |
| **Vendor lock-in** | **Medium** | Temporal's programming model is specific; migration to alternatives is non-trivial |

---

## 8. Temporal-Specific Risks for This Project

### 2 MB Payload Limit

OpenSidebar passes rich data between steps: DOM snapshots (can be 500KB+), LLM conversation histories (grows with turns), perception observations, screenshots (base64). The 2 MB Temporal payload limit would require:

- External storage (e.g., S3) for large payloads, with references passed through Temporal
- Aggressive compression of DOM snapshots and conversation history
- Screenshot data stored externally, not in workflow state

This adds significant complexity and latency.

### Event History Growth

Each agent turn generates multiple events: LLM call (activity start + complete), tool calls (1-3 per turn), perception (activity), verification (activity). A 30-turn agent conversation could generate 200-400 events. The 51,200 event limit with warning at 10,240 means:

- Long-running research tasks would need `continueAsNew()` (workflow migration)
- This adds implementation complexity and potential state loss at migration boundaries

### DOM Interaction Latency

The current architecture executes DOM tools synchronously within the service worker → content script bridge. Adding a Temporal round-trip:

```
Current:  AgentLoop → ContentScript → DOM (< 5ms)
Proposed: AgentLoop → HTTP → Backend → Temporal → Backend → HTTP → AgentLoop → ContentScript → DOM (50-150ms)
```

For rapid multi-click sequences, navigation, and form filling, this latency could degrade UX noticeably.

---

## 9. Recommended Alternative: Enhanced In-Extension Durability

Rather than adopting Temporal, address the specific durability gaps with targeted improvements to the existing `chrome.storage`-based checkpoint system:

### 9.1 Turn-Level Checkpointing

**Problem:** Only node-level checkpoints exist; agent loop history is ephemeral.

**Solution:** After each turn, persist a compressed snapshot of `ContextManager` state:

```typescript
interface TurnCheckpoint {
  nodeId: string;
  turn: number;
  historyDigest: CompressedHistory; // last N messages, compressed
  planState: PlanStatus;
  toolResultCache: Map<string, CachedResult>;
  perceptionState: PerceptionState;
}
```

**Storage:** `chrome.storage.local` with key `opensidebar:turn-checkpoints:{nodeId}`

**Cost:** ~50-100KB per checkpoint × 30 turns = 1.5-3MB per task. Well within `chrome.storage.local` limits (10MB default, unlimited with `unlimitedStorage` permission).

### 9.2 Tool Idempotency Keys

**Problem:** Duplicate side-effects after service worker restart.

**Solution:** Assign idempotency keys to mutation-sensitive tool calls:

```typescript
interface ToolExecution {
  idempotencyKey: string; // hash of (nodeId, turn, toolName, args)
  status: 'pending' | 'completed' | 'failed';
  result?: ToolResult;
  timestamp: number;
}
```

Before executing a tool, check if the idempotency key already has a completed result. If so, return the cached result without re-execution.

**Storage:** Persisted in turn checkpoint.

### 9.3 Durable Approval State

**Problem:** Approval/escalation waiters are Promise-based and lost on restart.

**Solution:** Persist pending approval requests to `chrome.storage.local`:

```typescript
interface PendingApproval {
  id: string;
  nodeId: string;
  type: 'tool_approval' | 'escalation' | 'clarification' | 'plan_confirmation';
  payload: unknown;
  createdAt: number;
}
```

On service worker restart, `restoreFromCheckpoints()` also restores pending approvals and re-displays them in the side panel.

### 9.4 Compensation Registry

**Problem:** No undo mechanism when multi-step tasks fail partway.

**Solution:** Register compensation actions for mutation-sensitive tools:

```typescript
const compensations: CompensationEntry[] = [];

// After successful cart addition:
compensations.push({
  toolName: 'click',
  args: { id: removeButtonId },
  description: 'Remove item from cart',
});
```

On task failure or cancellation, execute compensations in reverse order (saga pattern).

### 9.5 Comparison: Temporal vs In-Extension Enhancement

| Capability | Temporal | In-Extension Enhancement |
|-----------|---------|------------------------|
| Turn-level recovery | Full (activity replay) | Partial (checkpoint restore, some re-execution) |
| Duplicate prevention | Exact (event sourced) | Good (idempotency keys, ~99% coverage) |
| Durable timers | Yes (100 years) | Partial (`chrome.alarms`, 1-min minimum) |
| Saga/compensation | Built-in | Manual registry (simpler but functional) |
| Audit trail | Full event history | Trace server + local checkpoints |
| Offline operation | No | Yes |
| Standalone deployment | No | Yes |
| Backend requirement | Yes | No |
| Implementation effort | ~4-8 weeks (rewrite) | ~2-3 weeks (incremental) |
| Monthly cost | $100-500 | $0 |

---

## 10. When Temporal WOULD Make Sense

Temporal becomes the right choice if OpenSidebar evolves toward any of these:

1. **Server-side agent execution** — If the agent loop moves to a backend (e.g., for enterprise deployment), Temporal is the natural orchestration layer
2. **Multi-user/multi-device** — If tasks need to survive across browser sessions, devices, or users
3. **Regulated workflows** — If compliance requires a tamper-proof audit trail of every agent decision
4. **Day-long tasks** — If agent tasks span hours/days (e.g., monitoring a page for changes, multi-session research)
5. **Revenue-generating automation** — If reliability directly impacts revenue (e.g., automated purchasing, booking)

If any of these become requirements, re-evaluate Temporal Cloud or Trigger.dev as the orchestration backend.

---

## 11. Conclusion

| Dimension | Assessment |
|-----------|-----------|
| **Problem validity** | The durability gaps are real and worth fixing |
| **Temporal fit (general)** | Excellent for AI agent orchestration — proven at OpenAI, Replit |
| **Temporal fit (this project)** | Poor — requires mandatory backend, breaks standalone model |
| **Recommended path** | Enhance in-extension durability (turn checkpoints, idempotency keys, durable approvals) |
| **Temporal trigger** | Revisit if/when a backend becomes part of the architecture |

The durability problems Temporal solves are genuine weaknesses in OpenSidebar's current architecture. But the right fix is a targeted improvement to the existing checkpoint system, not an architectural transformation that would add a backend dependency, $100+/month in costs, and weeks of rewrite work. The in-extension approach gets 80% of the durability benefit at 20% of the cost.

---

## References

- [Temporal Documentation](https://docs.temporal.io/)
- [Temporal TypeScript SDK](https://docs.temporal.io/develop/typescript/core-application)
- [Temporal for AI](https://temporal.io/solutions/ai)
- [Temporal Cloud Pricing](https://temporal.io/pricing)
- [Temporal + OpenAI Agents SDK](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- [Temporal Ambient Agents](https://temporal.io/blog/orchestrating-ambient-agents-with-temporal)
- [Trigger.dev v3](https://trigger.dev/)
- [Inngest AgentKit](https://www.inngest.com/)
- [Restate](https://www.restate.dev/)
- [Grid Dynamics Case Study](https://temporal.io/blog/prototype-to-prod-ready-agentic-ai-grid-dynamics)
