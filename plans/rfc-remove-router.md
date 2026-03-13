# RFC: Remove Router — Let the Planner Classify Implicitly

**Status:** Proposed
**Date:** 2026-03-11
**Author:** k_shk + Claude

## Problem

Every user message currently goes through two serial LLM calls before the agent can act:

```
User message → Router (Gemini Flash Lite, ~1-2s) → Planner or fast-path → Executor
```

The router (`src/background/orchestrator/router.ts`) classifies queries into three routes:

| Route | Intent | What happens |
|-------|--------|-------------|
| `direct` | Q&A from page context | Create single executor node, skip planner |
| `agent` | Clear single objective | Create single executor node, skip planner |
| `plan` | Multi-step / ambiguous | Run planner to decompose into nodes |

**The problem:** `direct` and `agent` are functionally identical — both create a single executor node with the same code path (orchestrator/index.ts:1325-1375). The three-way classification collapses to a binary: "skip planner" vs "run planner". But the planner already makes this distinction — it returns `isSingleNode: true` for simple tasks and a multi-node plan for complex ones.

This means we're paying ~1-2 seconds of latency on every request for a classification that the planner performs implicitly.

## Proposal

Remove the router module entirely. Always run the planner. Let the planner's output be the classification:

```
Before: User message → Router (1-2s) → [Planner if "plan"] → Executor
After:  User message → Planner → Executor
```

The planner already returns:
- `isSingleNode: boolean` — whether the task is simple
- `difficulty: "simple" | "moderate" | "complex" | "extreme"` — task complexity
- `nodes: TaskNode[]` — 1 node for simple, N nodes for complex

A single-node plan from the planner IS the "agent" route. A multi-node plan IS the "plan" route. The "direct" route never existed architecturally — it ran the full executor loop anyway.

## Justification

### Latency savings
- Router call: ~1-2s (Gemini Flash Lite via OpenRouter, non-streaming)
- Planner call for simple tasks: ~2-4s (MiniMax M2.5, `isMultiStep: false` fast-path)
- **Net saving: 1-2s per request** — the planner was already running for complex tasks, and for simple tasks its overhead replaces (not adds to) the router

### Reduced complexity
- Delete `router.ts` (198 lines), its test file (277 lines), its prompt template
- Remove `RouteDecision` from task types
- Remove route classification trace events
- Simplify orchestrator's `startTask()` — no branching on route

### Literature support
- **Anthropic ("Building Effective Agents"):** "Start with the simplest architecture that could work... add additional components only if there is clear evidence they are needed."
- **Arize AI:** Routers are justified when routing to fundamentally different specialized agents. Ours routes to the same executor either way.
- **RopMura (arxiv):** Routing should work alongside planning, not before it.
- **Patronus AI:** "Using classifier LLMs for routing incurs additional cost and latency, so it's critical that benefits can justify the overhead."

### Cost impact
- Router model (Gemini Flash Lite): effectively free ($0/M tokens)
- Planner model (MiniMax M2.5): $0.27/$0.95 per M tokens
- For simple queries, the planner call costs ~$0.0003 (tiny prompt, short response)
- Negligible cost increase in exchange for significant latency reduction

## Affected Files

### Delete
| File | Lines | Purpose |
|------|-------|---------|
| `src/background/orchestrator/router.ts` | 198 | Router module |
| `tests/background/orchestrator-router.test.ts` | 277 | Router tests |
| `src/prompts/orchestrator.router.system` template | — | Router classification prompt |

### Modify
| File | Change |
|------|--------|
| `src/background/orchestrator/index.ts` | Remove `classifyRoute` import, delete route classification block (lines 1297-1375), always go to planner. Simplify `startTask()` flow. |
| `src/background/orchestrator/types.ts` | Remove `routeDecision?: RouteDecision` from `OrchestratorTask` (line 130) |
| `evals/planner-extractor.ts` | Remove `route_classified` event parsing (lines 249-288). Derive difficulty from `plan_decomposed` event's `difficulty` field instead. |
| `src/prompts/manifest.json` | Remove `orchestrator.router.system` entry |
| `CLAUDE.md` | Remove router references |

### No change needed
| File | Why |
|------|-----|
| `src/background/orchestrator/planner.ts` | Already returns `isSingleNode`, `difficulty` — no changes needed |
| `src/background/agent/planner.ts` | `decompose()` already handles simple vs multi-step — no changes needed |
| `src/background/orchestrator/lane-types.ts` | Planner interface unchanged |

## Orchestrator Flow (After)

```typescript
// startTask() — simplified
async startTask(task, input) {
  this.sendStatus(input.workspaceId, AgentStatus.THINKING, "Planning task...");

  // Always run planner
  const planner = this.deps.createPlanner(input.openRouterApiKey, modelOverrides);
  const tab = await chrome.tabs.get(input.tabId);
  const buildResult = await this.runInLane(task, "planner", async () =>
    planner.buildNodes(input.query, tab.title || "Untitled", tab.url || ""),
  );

  const nodes = buildResult.nodes;
  task.planClassification = {
    isSingleNode: buildResult.isSingleNode,
    difficulty: buildResult.difficulty,
  };

  // Plan confirmation (if multi-node and setting enabled)
  if (nodes.length >= 2 && input.settings.requirePlanConfirmation !== false) {
    // ... existing confirmation flow
  }

  // Execute nodes
  await this.runTask(task, input);
}
```

## Migration for Trace Analysis

Existing traces with `route_classified` events remain valid for historical analysis. New traces will only have `plan_decomposed` events. The eval extractor should derive difficulty from:
- `plan_decomposed.difficulty` (already present)
- `plan_decomposed.isSingleNode` (already present)
- `plan_decomposed.nodeCount` (already present)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Planner slower than router for simple queries | MiniMax M2.5 returns `isMultiStep: false` quickly for simple tasks (~2-4s total vs ~1-2s router + 0s planner = same or faster) |
| Planner makes wrong decomposition | Already possible today for `plan` route — no regression |
| Cost increase for simple queries | ~$0.0003 per simple query — negligible |
| Loss of `direct` route analytics | The `direct` classification was never used differently from `agent` — no real loss |

## Verification Plan

1. Run `npm run build` — clean compile
2. Run `npm test` — all existing tests pass (minus deleted router tests)
3. Run `npm run evals:critique` — compare pass rate before/after
4. Manual test: send simple query → verify no extra latency vs current fast-path
5. Manual test: send complex query → verify planner decomposes correctly
6. Check traces: `plan_decomposed` events should appear for all queries
