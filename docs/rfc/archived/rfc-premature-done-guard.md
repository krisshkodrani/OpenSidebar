# RFC: Plan Guardian — Smart Model as Task Supervisor

**Status:** DONE — Archived 2026-02-14. PlanGuardian class implemented in `agent/guardian.ts` with decompose() + validateDone(). Integrated in loop.ts with MAX_DONE_REJECTIONS=3 safety valve. Usage tracked in session metrics.
**Author:** OpenSidebar team
**Date:** 2026-02-12
**Related:** [RFC: Agent UX Feedback](./rfc-agent-ux-feedback.md), [RFC: Token Usage & Cost Tracking](./rfc-token-usage-cost-tracking.md)

## Problem

The agent calls `done()` too early on multi-step tasks, treating sub-step completion as task-level completion. Examples of real-world failures this causes:

- **Multi-page checkout:** Agent fills the shipping form, calls `done()`, never reaches payment
- **Research across tabs:** Agent opens the first result, summarizes it, calls `done()` — ignores the rest
- **Complex form with validation:** Agent fills page 1 of 3, calls `done()` on submit
- **Sequential workflow:** Agent completes step 1, sees confirmation, treats it as full completion

Observed in logs: the model explicitly acknowledged being "23% complete" yet still called `done()`. `update_plan` was never called once despite being available. Each premature exit required the user to manually restart.

### Root Cause

**The same model executes AND judges completion.** MODEL_FAST is optimized for speed, not long-horizon task tracking:

1. Ignores `update_plan` despite system prompt instructions
2. Conflates step completion with task completion
3. Acknowledges incompleteness but terminates anyway
4. Has no external accountability — nothing validates `done()`

### Impact

| Metric | Observed (single session) |
|--------|----------|
| User restarts required | 3 |
| Wasted turns | ~199 across premature exits |
| User idle time | ~135s between restarts |
| `update_plan` calls | 0 (expected: many) |

## Solution

Separate **planning/judgment** from **execution** with a two-model architecture:

```
┌────────────────────────────────────────────────────────┐
│                   PLAN GUARDIAN                         │
│                   (MODEL_SMART)                         │
│                                                        │
│  1. Task start → decompose ANY query into subtasks     │
│  2. done() intercept → validate completion             │
│                                                        │
│  2 LLM calls per task. No tool defs. JSON output.      │
│  Task-agnostic — works on any site, any workflow.      │
└────────────┬─────────────────────────┬─────────────────┘
             │ plan                    │ approve/reject
             ▼                        ▲
┌────────────────────────────────────────────────────────┐
│                    EXECUTOR                             │
│                   (MODEL_FAST)                          │
│                                                        │
│  Runs agent loop every turn. DOM tools + navigation.   │
│  Follows the guardian's plan. Reports via update_plan.  │
│  Calls done() when it thinks it's finished.            │
└────────────────────────────────────────────────────────┘
```

### Design Principle: Generic, Not Task-Specific

The guardian must be **completely task-agnostic**. It decomposes any user query based on context — there are no templates, no site-specific rules, no hardcoded workflows. The same guardian logic handles:

- "Buy this item" (checkout flow: add to cart → shipping → payment → confirm)
- "Compare the top 3 results and pick the cheapest" (search → open tabs → extract prices → compare)
- "Fill out this application form" (multi-page form with validation)
- "Complete all the steps on this page" (the agent reads the page, understands the steps, and works through them)

For specialized tasks (puzzles, challenges, site-specific workflows), the user describes the goal in their input. The agent uses `memory_add` / `memory_search` to learn strategies across sessions. The code stays generic; intelligence comes from the LLM + memory.

### Cost

Guardian uses `LLMClient.complete()` (non-streaming, `client.ts:91`) with no tool definitions and short focused prompts:

| Call | Input tokens | Output tokens | When |
|------|-------------|---------------|------|
| `decompose` | ~300 | ~150 | Once at task start |
| `validateDone` | ~500 | ~50 | Each `done()` call |

Total: **~1000 tokens per task** (<1% of executor's per-task usage). Latency: ~0.5-1.5s per call, off the hot path.

## Implementation

### New file: `src/background/agent/guardian.ts`

```typescript
import { LLMClient, MODEL_SMART } from "../llm";
import { CompletionResponse, TokenUsage } from "../llm/types";
import { SubtaskSummary } from "../../types";
import { logger } from "../../utils";

/** Result of task decomposition */
export interface PlanDecomposition {
    subtasks: string[];
}

/** Result of done() validation */
export interface DoneValidation {
    approved: boolean;
    reason?: string;
}

const DECOMPOSE_SYSTEM = `You are a task planner for a browser automation agent.

Given a user task and page context, decide if it needs multiple steps.
- Simple tasks (one click, one field, one navigation): return {"isMultiStep": false}
- Multi-step tasks: return {"isMultiStep": true, "subtasks": ["step 1", ...]}

Rules:
- 3-15 subtasks. Each must be a concrete, verifiable browser action.
- Group related micro-actions (e.g. "fill name and email" not two separate steps).
- Last subtask should verify the overall goal was achieved.
- Be generic — derive steps from the task description and page context, not assumptions about the site.

Respond with JSON only.`;

const VALIDATE_SYSTEM = `You are a task completion judge for a browser automation agent.

The agent claims it finished. Review the plan and summary. Decide if the ENTIRE task is done.

Rules:
- ALL planned subtasks must be reasonably covered by the summary to approve.
- If only a subset is done, REJECT and state what remains.
- Partial completion is NOT completion. Be strict.
- Judge based on the original task goal, not just the plan steps.

Respond with JSON only:
- {"approved": true}
- {"approved": false, "reason": "You completed X but Y and Z remain. Continue with: ..."}`;

export class PlanGuardian {
    private llm: LLMClient;
    private usageCallback: ((usage: TokenUsage, llmMs: number) => void) | null = null;

    constructor(apiKey: string) {
        this.llm = new LLMClient(apiKey, MODEL_SMART);
    }

    setUsageCallback(cb: ((usage: TokenUsage, llmMs: number) => void) | null) {
        this.usageCallback = cb;
    }

    async decompose(
        query: string,
        pageTitle: string,
        pageUrl: string,
        signal?: AbortSignal,
    ): Promise<PlanDecomposition | null> {
        try {
            const start = Date.now();
            const response = await this.llm.complete({
                messages: [
                    { role: "system", content: DECOMPOSE_SYSTEM },
                    { role: "user", content: `Page: ${pageTitle} (${pageUrl})\nTask: ${query}` },
                ],
                max_tokens: 512,
                temperature: 0,
                signal,
            });
            const llmMs = Date.now() - start;
            if (response.usage) this.usageCallback?.(response.usage, llmMs);

            const text = (response.content || "").trim();
            const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleaned);

            if (!parsed.isMultiStep) return null;
            if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length < 2) return null;

            logger.info("agent", "Guardian decomposed task", {
                subtaskCount: parsed.subtasks.length,
            });
            return { subtasks: parsed.subtasks };
        } catch (err: any) {
            logger.warn("agent", "Guardian decompose failed, treating as simple task", {
                error: err?.message,
            });
            return null;
        }
    }

    async validateDone(
        query: string,
        plan: SubtaskSummary[],
        doneSummary: string,
        pageTitle: string,
        pageUrl: string,
        signal?: AbortSignal,
    ): Promise<DoneValidation> {
        try {
            const planText = plan
                .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
                .join("\n");

            const start = Date.now();
            const response = await this.llm.complete({
                messages: [
                    { role: "system", content: VALIDATE_SYSTEM },
                    {
                        role: "user",
                        content: `Original task: ${query}\n\nPlan:\n${planText}\n\nAgent summary: ${doneSummary}\n\nCurrent page: ${pageTitle} (${pageUrl})`,
                    },
                ],
                max_tokens: 256,
                temperature: 0,
                signal,
            });
            const llmMs = Date.now() - start;
            if (response.usage) this.usageCallback?.(response.usage, llmMs);

            const text = (response.content || "").trim();
            const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleaned);

            logger.info("agent", "Guardian validateDone", {
                approved: parsed.approved,
                reason: parsed.reason?.slice(0, 200),
            });
            return {
                approved: !!parsed.approved,
                reason: parsed.reason,
            };
        } catch (err: any) {
            logger.warn("agent", "Guardian validateDone failed, falling back to structural check", {
                error: err?.message,
            });
            // Fallback: structural check — reject if plan data shows incomplete
            const completedCount = plan.filter(s => s.status === "completed").length;
            if (completedCount < plan.length) {
                return {
                    approved: false,
                    reason: `Guardian unavailable. Structural check: ${completedCount}/${plan.length} subtasks completed. Continue.`,
                };
            }
            return { approved: true };
        }
    }
}
```

### Changes to `src/background/agent/loop.ts`

#### A. New imports and constants (top of file)

At line 1, add `PlanGuardian` to imports. Add constant:

```typescript
import { PlanGuardian } from "./guardian";

/** Max times done() can be rejected before the safety valve forces it through */
const MAX_DONE_REJECTIONS = 3;
```

#### B. New instance fields (after line 68)

```typescript
/** Plan guardian — smart model for decomposition and done validation */
private guardian: PlanGuardian;
/** Number of times done() has been rejected by the guardian */
private doneRejections = 0;
```

#### C. Constructor change (line 158-176)

After `this.llm = new LLMClient(apiKey)` at line 169, add:

```typescript
this.guardian = new PlanGuardian(apiKey);
```

#### D. Plan decomposition in `start()` (after line 220, before line 222)

After the user message is added (`this.context.addMessage(...)`) and before `this.statusHandler(AgentStatus.THINKING, "Analyzing...")`:

```typescript
// --- Guardian: decompose task into plan (task-agnostic) ---
if (!this.confirmPlan) {
    try {
        this.stepHandler({
            id: crypto.randomUUID(),
            type: "thinking",
            label: "Analyzing task scope...",
            status: "running",
            timestamp: Date.now(),
        }, false);

        const decomposition = await this.guardian.decompose(
            initialUserText,
            this.context.getSnapshot()?.title || "",
            this.context.getSnapshot()?.url || "",
            this.abortController!.signal,
        );

        if (decomposition) {
            this.taskId = crypto.randomUUID();
            this.taskStartTime = Date.now();
            this.planSubtasks = decomposition.subtasks.map((desc, i) => ({
                description: desc,
                status: i === 0 ? "running" as const : "pending" as const,
                turnsUsed: 0,
                turnBudget: 0,
            }));

            this.context.addMessage({
                role: "user",
                content: `[Plan Guardian]: This is a multi-step task (${decomposition.subtasks.length} steps). Your plan:\n`
                    + decomposition.subtasks.map((s, i) => `${i + 1}. ${s}`).join("\n")
                    + `\n\nExecute step 1 now. Call update_plan({subtasks, currentIndex, lastResult}) after each step to report progress. `
                    + `Do NOT call done() until ALL ${decomposition.subtasks.length} steps are complete.`,
            });

            chrome.runtime.sendMessage({
                type: "TASK_PROGRESS",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: {
                    taskId: this.taskId,
                    subtasks: this.planSubtasks,
                    currentIndex: 0,
                    totalTurnsUsed: 0,
                },
            }).catch(() => {});

            this.stepHandler({
                id: crypto.randomUUID(),
                type: "info",
                label: `Plan: ${decomposition.subtasks.length} steps`,
                status: "done",
                timestamp: Date.now(),
            }, false);
        }
    } catch (err: any) {
        logger.warn("agent", "Guardian decompose error (non-fatal)", { error: err?.message });
    }
}
```

#### E. Done guard (replace lines 735-798)

The current block at `loop.ts:735` (`if (toolName === ToolName.DONE)`) is replaced with:

```typescript
// DONE tool — guardian-validated exit
if (toolName === ToolName.DONE) {
    const summary = (args.summary as string) || "Task completed.";

    // Guardian validation: only when a plan exists
    if (this.taskId && this.planSubtasks.length > 0) {
        let shouldReject = false;
        let rejectReason = "";

        try {
            this.stepHandler({
                id: crypto.randomUUID(),
                type: "thinking",
                label: "Verifying completion...",
                status: "running",
                timestamp: Date.now(),
            }, false);

            const validation = await this.guardian.validateDone(
                this.originalQuery,
                this.planSubtasks,
                summary,
                this.context.getSnapshot()?.title || "",
                this.context.getSnapshot()?.url || "",
                this.abortController!.signal,
            );

            if (!validation.approved) {
                shouldReject = true;
                rejectReason = validation.reason || "Task is not yet complete.";
            }
        } catch (err: any) {
            // Guardian call failed — structural fallback
            const completedCount = this.planSubtasks.filter(s => s.status === "completed").length;
            if (completedCount < this.planSubtasks.length) {
                shouldReject = true;
                rejectReason = `Guardian unavailable. ${completedCount}/${this.planSubtasks.length} subtasks completed. Continue.`;
            }
        }

        if (shouldReject) {
            this.doneRejections++;
            logger.warn("agent", "DONE rejected", {
                turn: this.turnCount,
                rejections: this.doneRejections,
                reason: rejectReason.slice(0, 200),
            });

            if (this.doneRejections >= MAX_DONE_REJECTIONS) {
                logger.warn("agent", "DONE forced after max rejections", {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                });
                // Fall through to normal done handling
            } else {
                this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: `done() REJECTED: ${rejectReason}\n\nContinue working. Do NOT call done() until all steps are complete.`,
                });
                this.stepHandler({
                    id: crypto.randomUUID(),
                    type: "info",
                    label: `Not done yet (${this.doneRejections}/${MAX_DONE_REJECTIONS})`,
                    status: "warning",
                    timestamp: Date.now(),
                }, false);
                continue; // Resume executor loop
            }
        }
    }

    // --- Normal done handling (existing code, unchanged from line 736 onward) ---
    logger.info("agent", "DONE called", {
        turn: this.turnCount,
        url: this.context.getCurrentUrl(),
        summary: summary.slice(0, 300),
    });
    // ... rest of existing done logic (addMessage, stepHandler, statusHandler,
    //     TASK_COMPLETION broadcast, SESSION_METRICS broadcast, break) ...
}
```

#### F. Wire guardian usage callback (in `start()`, after line 225)

After the vision usage callback registration:

```typescript
// Register guardian usage callback for metrics tracking
this.guardian.setUsageCallback((usage, llmMs) => {
    this.recordUsage(
        { role: "assistant", content: null, finish_reason: "stop", usage } as CompletionResponse,
        llmMs,
    );
});
```

#### G. Reset `doneRejections` in `start()` (after line 197)

Add to the reset block:

```typescript
this.doneRejections = 0;
```

### Changes to `src/background/agent/context.ts`

#### A. Expose snapshot for guardian (after line 103)

```typescript
public getSnapshot(): DomSnapshot | null {
    return this.snapshot;
}
```

#### B. System prompt update (lines 37-50)

Replace `## Rules` section:

```
## Rules
- Always include your Think reasoning WITH tool calls. Never call tools blindly.
- After navigation or page change, re-read page state before acting.
- If an action had no visible effect, do NOT repeat it. Try an alternative.
- When a plan is provided, follow it step by step. Call update_plan after each step.
- Call done() ONLY when ALL planned steps are complete. Premature done() will be rejected.
- Work autonomously — do not ask the user for permission between steps.
```

Replace `## Multi-Step Planning` section:

```
## Multi-Step Planning
When the system provides a plan, follow it:
1. Execute the current step.
2. Call update_plan({subtasks: [...], currentIndex: N, lastResult: "what you did"}) to report completion.
3. Move to the next step. Repeat until all steps are done.
4. Only then call done() with a summary of everything accomplished.

If no plan is provided, the task is simple — act directly and call done() when finished.
Do NOT treat individual step completion as task completion.
```

### Changes to `src/background/agent/index.ts`

Add barrel export:

```typescript
export * from "./guardian";
```

### No changes to `src/types/index.ts`

`PlanDecomposition` and `DoneValidation` are local to `guardian.ts` — they don't cross context boundaries via messaging.

## Defense Layers

```
done() called by executor
  │
  ├─ No plan exists (taskId === null)
  │   └─ ALLOW — simple task, pass through
  │
  └─ Plan exists
      │
      ├─ Guardian LLM available
      │   ├─ Guardian approves → ALLOW
      │   └─ Guardian rejects → REJECT (inject reason, continue loop)
      │
      └─ Guardian LLM fails (network, 402, timeout)
          │
          ├─ Structural check: completed < total → REJECT
          └─ Structural check: all completed → ALLOW

      Safety valve: after 3 rejections → FORCE ALLOW (prevent infinite loop)
```

## Generic Examples

The guardian handles all of these with the same code:

| User input | Guardian decomposition |
|------------|----------------------|
| "Buy this item" | 1. Add to cart 2. Go to checkout 3. Fill shipping 4. Fill payment 5. Place order 6. Verify confirmation |
| "Compare prices of the top 3 search results" | 1. Search for the item 2. Open result 1, note price 3. Open result 2, note price 4. Open result 3, note price 5. Compare and report cheapest |
| "Fill out this job application" | 1. Fill personal info 2. Fill work history 3. Upload resume 4. Fill additional questions 5. Submit 6. Verify submission |
| "Click the login button" | `null` (simple task — no plan needed) |
| "Complete the challenge on this page" | Guardian reads page context, decomposes based on what the page says — no hardcoded challenge knowledge |

For specialized domains (puzzles, challenges), the user describes the goal in their prompt. The agent uses `memory_search` to recall strategies from previous sessions and `memory_add` to save what it learns. The code never hardcodes site-specific logic.

## Testing

### `tests/background/guardian.test.ts` (NEW)

```typescript
describe("PlanGuardian.decompose", () => {
    test("returns subtasks for multi-step query");
    test("returns null for simple query");
    test("returns null on malformed JSON");
    test("returns null on network error");
    test("returns null when subtasks array has < 2 items");
    test("reports usage via callback");
});

describe("PlanGuardian.validateDone", () => {
    test("approves when all steps complete");
    test("rejects partial completion with reason");
    test("falls back to structural check on LLM error");
    test("approves via structural fallback when all complete");
});
```

### `tests/background/done-guard.test.ts` (NEW)

| Test | Setup | Expected |
|------|-------|----------|
| `done() passes through when no plan` | `taskId = null` | Loop exits normally |
| `done() calls guardian when plan exists` | `taskId` set, subtasks | `validateDone` called |
| `done() rejected by guardian continues loop` | Guardian returns `approved: false` | Corrective message, loop continues |
| `done() forced after 3 rejections` | 3 prior rejections | Loop exits |
| `doneRejections resets on new start()` | Previous run had rejections | Counter is 0 |

### Manual validation

Use diverse tasks, not just one:

1. **Multi-page form:** Start a form that spans 3+ pages. Verify agent doesn't `done()` after page 1.
2. **Research task:** "Find and compare prices of X across 3 sites." Verify agent visits all 3.
3. **Simple task:** "Click the login button." Verify no guardian overhead (decompose returns null).
4. **Ambiguous scope:** "Set up my profile." Verify guardian decomposes based on what the page shows.

## Affected Files

| File | Change | Lines affected |
|------|--------|---------------|
| `src/background/agent/guardian.ts` | **NEW** | ~130 lines |
| `src/background/agent/loop.ts` | Import, fields, constructor, `start()` decompose, `done` guard, usage wiring | ~8 insertion points |
| `src/background/agent/context.ts` | `getSnapshot()` accessor, system prompt text | 1 method + ~15 lines of prompt |
| `src/background/agent/index.ts` | Barrel export | 1 line |
| `tests/background/guardian.test.ts` | **NEW** | ~100 lines |
| `tests/background/done-guard.test.ts` | **NEW** | ~80 lines |

## Alternatives Considered

### 1. Heuristic guards (regex + plan-exists check)

Brittle and task-specific. Can't distinguish "fill all 3 fields" (one step) from "complete all 30 challenges" (multi-step). The smart model understands semantics generically.

### 2. Self-validation (ask the executor "are you sure?")

Doesn't work. Logs show the model says "23% complete" and still calls `done()`. Same model can't judge itself.

### 3. Guardian on every turn

30x cost + ~1s latency per turn. The 2-call design is the sweet spot.

### 4. Replace MODEL_FAST entirely

Slower and costlier per turn. Flash excels at DOM execution — it just can't plan or judge. Guardian plays to each model's strength.

### 5. Hardcode task-type templates

E.g. "checkout = 5 steps, form = 3 steps". Violates generic-over-specific principle. Breaks on any site that doesn't match the template.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Guardian LLM fails | Structural fallback rejects done if plan incomplete |
| Guardian returns bad JSON | `try/catch` → structural fallback |
| Guardian wrongly rejects valid done | Safety valve after `MAX_DONE_REJECTIONS` (3) |
| Guardian wrongly approves premature done | Structural check as secondary opinion |
| Latency at task start | ~0.5-1.5s for decompose, before executor starts |
| Extra cost on simple tasks | `decompose()` returns null → zero overhead |
| Guardian decomposes poorly for unfamiliar sites | Agent uses memory to improve over time; guardian prompt is generic |

## Ship Plan

**Single PR.** Guardian creation + loop integration + prompt update + tests.

1. Create `guardian.ts` with `PlanGuardian` class
2. Add `getSnapshot()` to `ContextManager`
3. Update system prompt in `context.ts`
4. Wire guardian into `AgentLoop`: constructor, `start()` decompose, `done` guard, metrics
5. Add barrel export
6. Tests: `guardian.test.ts` + `done-guard.test.ts`
7. `bun test` + `bun run build` + manual validation on diverse tasks
