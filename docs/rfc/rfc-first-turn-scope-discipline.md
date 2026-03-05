# RFC: First-Turn Scope Discipline (Objective Boundaries, Perception Freshness, Decoy Resistance)

## Status
Proposed

## References
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems* (2025). Ch 5 &sect;5.5.3 "The Critical Observation Loop" &mdash; re-observe after every state-mutating action. Ch 5 &sect;5.2.1 "Explicit vs Implicit Planning" &mdash; implicit planning for dynamic interfaces. Ch 5 &sect;5.6.3 "Action Disambiguation" &mdash; ranking action targets by task relevance. Ch 5 &sect;5.3.1.1 "DOM Filtering" &mdash; remove irrelevant elements before model sees them. Ch 11 &sect;11.3.5 "Your Agents Don't Know When to Stop" &mdash; align termination with testable criteria. Ch 15 &sect;15.4.4 "Completion Criteria" &mdash; define what "done" means enumerably. Ch 15 &sect;15.5.1 "TaskStatusTool" &mdash; structured completion gate with rationale.
- **Book 2**: Antonio Gulli, *Agentic Design Patterns* (2025). Ch "Prompt Chaining" (lines 192-193) &mdash; decompose into unambiguous single-predicate steps. Ch "Contractor Model" (lines 3440-3442) &mdash; formalized contracts with negotiation phase to resolve ambiguity before execution. Ch 20 "Prioritization" (lines 3484-3489) &mdash; rank actions by significance to primary objective.
- **Book 3**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (Packt, 2025). Ch "Ambiguous Requests" (lines 5309-5318) &mdash; enrich context library with recognized goal templates; surface ambiguity rather than guessing.
- **Internal trace**: `0793f95c-0adb-41dc-9eec-c1141c91fb34` &mdash; step 5 challenge page. 24 turns, 8 turns to solve step 5 (should be 3), 16 wasted turns continuing on step 6 after objective was met.
- **Related RFC**: [Programmatic Verification](./rfc-programmatic-verification.md) &mdash; overlaps on the completion-gate mechanism (S1 there is prerequisite for F2 here).

## Context

### The Trace

Trace `0793f95c` records an executor tasked with: *"reveal the code in this step 5 and enter it to proceed to step 6 then click submit."*

| Phase | Turns | What happened | Root cause |
|-------|-------|---------------|------------|
| Find code | T1-2 | `inspect_hidden` found code `LURMNZ`, `type_text` entered it. | OK |
| Decoy detour | T3-5 | `read_page` &rarr; `find_element("Click Here")` &rarr; `click_element` on a decoy button instead of clicking Submit. | **Decoy distraction**: agent chose a surface-label match over the goal-relevant "Submit Code" button. |
| Stale re-check | T6-7 | `inspect_hidden` re-found the same code. Text-only turn (no tool call). | **Stale perception**: cached observation still showed pre-action state; agent didn't know the code was already typed. |
| Submit | T8 | Finally clicked "Submit Code". | Correction nudge forced a tool call. |
| Over-execution | T9-24 | URL changed to `/step6`. Agent kept going: Ctrl+A/C, typed step 6's code, solved step 6, tried to find "Move On", eventually `go_back`. | **Scope overshoot**: ambiguous objective + no completion gate + stale perception (LOCATION still showed "Step 5" for 4 turns after URL change). |

**Cost**: 24 turns (56s, 289K tokens, $0.035) for a task that should have taken 3 turns (~3s).

### What the Literature Says

Three books converge on the same structural diagnosis: the failures are not prompting issues &mdash; they are **architectural gaps** in the observe-decide-act loop.

**On continuing past the objective** (16 wasted turns):
- Dibia Ch 15 &sect;15.5.1: *"The TaskStatusTool forces the agent to explicitly evaluate whether requirements are met, not just implicitly decide to stop calling tools."* Our `done()` tool exists but the agent never called it because the objective was ambiguous &mdash; it could be read as "proceed to step 6, then click submit [on step 6]."
- Dibia Ch 15 &sect;15.4.4: *"If completion criteria are vague, the agent may stop prematurely [or over-execute]. Define what 'done' means with enumerable criteria."*
- Gulli, Prompt Chaining: *"Each step is simpler and less ambiguous... If the output of one prompt is ambiguous, the subsequent prompt may fail."*

**On stale perception** (4-turn LOCATION lag):
- Dibia Ch 5 &sect;5.5.3: *"When our agent clicks a button, we need to observe what happened... Each tool call potentially changes the interface state, so observation becomes critical."*
- Dibia Ch 5 &sect;5.2.1: *"Explicit planning works best for static, predictable interfaces... Implicit planning excels when working with dynamic interfaces where the interface state changes unpredictably during task execution."*

**On decoy distraction** (3 wasted turns):
- Dibia Ch 5 &sect;5.6.3: *"Developing robust disambiguation logic is crucial &mdash; determining which action or element is most relevant to the current task when multiple possibilities exist."*
- Dibia Ch 5 &sect;5.3.1.1: *"The DOM can contain irrelevant information which can make it difficult for the model to focus on the relevant parts of the interface. Filter the DOM to include only the most relevant elements."*
- Gulli Ch 20, Prioritization: *"The prioritization pattern enables agents to assess and rank tasks based on significance, urgency, dependencies... The agent should always ask: which action advances my stated objective?"*

**On ambiguous objectives** (root cause of over-execution):
- Gulli, Contractor Model: *"The contractor agent can analyze the initial terms and negotiate. This negotiation phase resolves misunderstandings before execution begins."*
- Rothman, Ambiguous Requests: *"The solution isn't more code: it's organizational design &mdash; enriching the context library with recognized patterns."*

## Problem

Five specific failure modes, ordered by impact:

### P1: No testable completion predicate (16 turns wasted)

The orchestrator's planner emits objectives as free-form natural language: *"reveal the code in this step 5 and enter it to proceed to step 6 then click submit."* The executor has no machine-checkable way to know the objective is satisfied. It must infer completion from vibes.

When the URL changed from `/step5` to `/step6` at T9, the task was objectively complete. But nothing in the system detected this because there was no predicate like `success_url_contains: "/step6"` to check against.

### P2: Perception cache not invalidated on URL change (4 turns wasted)

After Submit clicked the page at T8 and the URL transitioned to `/step6`, the perception LOCATION section continued to report *"Step 5 of a challenge"* for turns 10-13. The fingerprint-based cache treated the two pages as similar (same element template) and served stale observations.

The VLM re-observed at T14 and finally reported *"Challenge Step 6"* &mdash; but by then the agent had already committed 4 turns of step-6 work based on the stale "Step 5... Code accepted!" perception.

### P3: Compound objectives not decomposed (root cause of P1)

The instruction *"reveal the code... enter it... proceed to step 6... click submit"* contains 4 sub-goals in one sentence. The word "then" is ambiguous &mdash; it could mean temporal sequence ("do X then Y happens") or imperative sequence ("do X, then do Y"). The model interpreted it as the latter and treated step 6 as part of its scope.

The planner should have decomposed this into steps with explicit boundaries, or the executor should have used `clarify()` to resolve the ambiguity.

### P4: Decoy elements not filtered (3 turns wasted)

The challenge page contained multiple "Click Here" buttons with `text-color = bg-color` (invisible text). Our `deduplicateInvisibleElements()` groups these with an `[invisible-text]` flag, but still presents them in the element list. The agent clicked one of these instead of "Submit Code."

### P5: No goal-relevance check before action (3 turns wasted)

After typing the code at T2, the agent's next action should have been to click "Submit Code" (element [123]). Instead, it searched for and clicked "Click Here" (element [458]). There is no mechanism that asks: "does this action advance my current sub-goal (submit the code)?"

## Solution

### F1: Structured completion predicates from planner

**Change**: The planner emits a `completionPredicates` field per step alongside the objective text.

```typescript
interface PlanNode {
  objective: string;             // Existing: free-form instruction
  completionPredicates?: {       // New: machine-checkable signals
    urlContains?: string;        // e.g., "/step6"
    urlChanged?: boolean;        // Any URL change = success
    titleContains?: string;      // e.g., "Step 6"
    elementVisible?: string;     // e.g., "Code accepted"
    elementGone?: string;        // e.g., "Submit Code" button gone
  };
}
```

**Enforcement point**: After each tool execution in the agent loop, if `completionPredicates` is set, check the current snapshot against them. If all predicates pass, inject a system message: *"Completion predicates met: [details]. Call done() with your summary."*

This is the structural equivalent of DMA Ch 15 &sect;15.5.1's TaskStatusTool &mdash; but initiated by the system rather than relying on the agent to self-evaluate.

**Files**: `src/background/orchestrator/planner.ts` (emit predicates), `src/background/agent/loop.ts` (check after each tool execution), `src/types/index.ts` (extend `PlanNode`).

**Interaction with Programmatic Verification RFC**: The predicates proposed here are the same signals that RFC's `programmaticVerify()` function would check. F1 here provides the per-step predicates; the Programmatic Verification RFC provides the verification gate that consumes them.

### F2: Perception cache invalidation on URL change

**Change**: In the perception agent's fingerprint-based cache, treat URL changes as a hard cache-breaker regardless of element fingerprint similarity.

Currently `computeSnapshotFingerprint()` hashes `url + elementCount + sortedElementSignatures`. Two pages with similar structures (same template, different step number) can produce similar fingerprints. The URL component helps but a near-identical element list can dominate the hash.

**Fix**: In `PerceptionAgent.observe()`, before checking the fingerprint cache, compare the current URL against the last-observed URL. If the URL changed, invalidate the cache unconditionally and force a fresh VLM call.

```typescript
// In PerceptionAgent.observe()
const urlChanged = input.url !== this.lastObservedUrl;
this.lastObservedUrl = input.url;
if (urlChanged) {
  this.invalidateCache();  // Force fresh observation
}
```

This implements DMA Ch 5 &sect;5.5.3's principle that any state-mutating action must trigger re-observation &mdash; a URL change is the strongest possible signal that the page state has changed.

**Files**: `src/background/perception/perception-agent.ts`.

### F3: Planner decomposes compound objectives into single-predicate steps

**Change**: Add a decomposition guideline to the planner system prompt that rejects compound objectives and forces single-predicate steps.

Before (one node):
```
"reveal the code in this step 5 and enter it to proceed to step 6 then click submit"
```

After (two nodes):
```
Node 1: "Find the hidden code on step 5 and enter it into the input field"
  completionPredicates: { elementVisible: "Submit Code" }  // code is in the field

Node 2: "Click Submit Code to proceed to step 6"
  completionPredicates: { urlContains: "/step6" }
```

Each node has exactly one success predicate. The planner prompt should include the rule: *"Each step must have a single, testable completion condition. If a step has multiple success signals, split it."*

**Files**: `prompts/runtime/planner/decompose_system.md`, `src/background/orchestrator/planner.ts`.

### F4: Suppress invisible-text decoy elements from element list

**Change**: In `deduplicateInvisibleElements()`, when a group of 3+ same-tagName invisible-text elements is detected, **remove them from the element list entirely** instead of keeping them with an `[invisible-text]` flag. Only preserve the group summary line so the agent knows they exist if needed.

Currently:
```
[100] button "Decoy 1" [invisible-text]
[101] button "Decoy 2" [invisible-text]
...
```

After:
```
[invisible-text group] 20x button (IDs: 100,101,...): "Decoy 1","Decoy 2",...
```

The individual elements are already grouped &mdash; the change is to stop including the individual `TaggedElement` entries in the formatted output when they're part of a group. The group summary (which already exists) becomes the sole representation.

This directly implements DMA Ch 5 &sect;5.3.1.1: reduce noise before the model sees it.

**Files**: `src/background/agent/context.ts` (the code that calls `deduplicateInvisibleElements` and formats the result), `src/background/agent/context-formatting.ts` (the function itself &mdash; already returns `{ visible, groups }` where `visible` excludes grouped elements; verify the caller uses `visible` not the original array).

### F5: Goal-relevance check in system prompt

**Change**: Add a decision rule to the agent system prompt that requires checking action relevance before executing:

```markdown
- **Goal-relevance check**: Before calling a tool, verify the action advances
  your current sub-goal. Ask: "If this succeeds, am I closer to the completion
  criteria?" If the answer is unclear, prefer the most direct path (e.g., click
  Submit over exploring other buttons).
```

This is the lightweight version of Gulli Ch 20's Prioritization Pattern. A full action-ranking model is overkill for now &mdash; a prompt-level reminder to check relevance handles the 80% case. If traces show continued decoy engagement after this change, escalate to structural ranking.

**Files**: `prompts/runtime/agent/system.md`.

## Implementation

### Phase 1: Quick wins (F2, F4, F5)

These are small, self-contained changes with immediate impact.

| Fix | Effort | Files changed | Risk |
|-----|--------|---------------|------|
| F2: URL-change cache invalidation | ~20 lines | `perception-agent.ts` | Low &mdash; strictly additive |
| F4: Remove grouped invisible elements from formatted output | ~10 lines | `context.ts` | Low &mdash; verify caller already uses `visible` return value |
| F5: Goal-relevance prompt addition | ~5 lines | `system.md` + regenerate | Low &mdash; prompt-only |

### Phase 2: Completion predicates (F1, F3)

These require coordinated changes across planner, loop, and types.

| Fix | Effort | Files changed | Risk |
|-----|--------|---------------|------|
| F1: Predicate type + loop check | ~80 lines | `types/index.ts`, `loop.ts`, `orchestrator/planner.ts` | Medium &mdash; planner prompt change may affect decomposition quality |
| F3: Decomposition guideline | ~20 lines | `decompose_system.md`, `planner.ts` (prompt only) | Medium &mdash; may increase node count, need eval coverage |

**Dependency**: F1's loop-side predicate check should reuse the same signal infrastructure proposed in the [Programmatic Verification RFC](./rfc-programmatic-verification.md). Implement them together or sequence F1 after that RFC's S1.

## Testing

### Unit tests

- **F1**: Test `checkCompletionPredicates(snapshot, predicates)` with URL match, title match, element visible, element gone, and combination cases.
- **F2**: Test that `PerceptionAgent.observe()` forces a fresh call when URL changes, even when fingerprint matches.
- **F4**: Test that `deduplicateInvisibleElements` groups are excluded from `formatSnapshotElements` output (individual elements absent, group summary present).
- **F5**: Verify prompt contains goal-relevance check text after regeneration.

### Eval validation

Replay trace `0793f95c` through the eval pipeline after each phase:
- **Phase 1 target**: Perception updates to "Step 6" within 1 turn of URL change (not 4). Invisible-text decoys absent from element list.
- **Phase 2 target**: Agent calls `done()` within 1-2 turns of URL changing to `/step6`. Total turns &le; 5 (from current 24).

### Regression

- Run `npm run evals:critique` on full golden set after each phase to verify no regression in other pathologies.
- Manual test on 3 multi-step challenge pages to verify the planner emits predicates and the loop checks them.

## Impact

- **Token cost**: ~80% reduction on tasks like this trace (24 turns &rarr; ~5). The 16 over-execution turns alone cost ~180K tokens.
- **Latency**: ~70% reduction (56s &rarr; ~15s) from eliminating stale-perception lag and over-execution.
- **Reliability**: Completion predicates make success/failure deterministic rather than vibes-based. Fewer ambiguity-driven failures.
- **Risk**: F1/F3 change planner behavior &mdash; need eval coverage before shipping. F2/F4/F5 are low-risk and can ship independently.
