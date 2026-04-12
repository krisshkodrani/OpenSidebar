# RFC: Batched Action Execution (Reduce Round Trips for Predictable Workflows)

## Status
Proposed

## References
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems* (2025). Ch 5 §5.2.1 "Action Sequence Generation" — explicit vs implicit planning; Ch 4 §4.6.2 "Tool Categories" — general-purpose vs task-specific tools; Ch 4 §4.11 "Agents as Tools" — wrapping multi-step sequences as single operations.
- **Book 2**: Antonio Gulli, *Agentic Design Patterns* (2025). Ch 3 "Parallelization" (lines 484-494) — parallel independent steps; Ch 6 "Planning" (lines 1091-1095) — dynamic vs fixed workflows; Ch 1 "Prompt Chaining" (lines 217-218) — parallel independent steps within a chain; Ch 17 "Scaling Inference Law" (lines 2919-2931) — smaller models with better context.
- **Book 3**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (Packt, 2025). Ch 4 "Executor" (lines 2512-2538) — resolve dependencies before execution; Ch 1 "SRL" — structured action decomposition; Ch 3 "Procedural RAG" — dynamic instruction retrieval for known workflows.
- **Internal**: `src/background/agent/loop.ts` (agent loop — 1 LLM call per tool execution), `src/background/tools/index.ts` (tool registry).

## Context

### The Problem: 1 LLM Call Per DOM Action

The agent loop follows a strict ReAct cycle: LLM → tool call → observation → LLM → tool call → ... Each tool execution triggers a return to the LLM for the next decision. For a 5-field form, that's:

```
Turn 1: LLM decides → type field 1  → snapshot
Turn 2: LLM decides → type field 2  → snapshot
Turn 3: LLM decides → type field 3  → snapshot
Turn 4: LLM decides → type field 4  → snapshot
Turn 5: LLM decides → type field 5  → snapshot
Turn 6: LLM decides → click submit  → snapshot
= 6 LLM calls
```

Most of these LLM calls are trivial — the model sees 5 empty form fields and fills them one by one. Turns 2-5 are predictable from the context visible at Turn 1.

### What the Literature Says

**Dibia (Ch 5 §5.2.1)** makes the explicit/implicit planning distinction: "For static, predictable interfaces (login forms, contact forms), the model can generate a complete action plan upfront in a single LLM call, then execute all steps without additional LLM calls. This contrasts with implicit planning where every step requires a new LLM call to observe state and decide the next action." He identifies the key decision criterion: **interface predictability**.

**Gulli (Ch 6, lines 1091-1095)** reinforces this: "Dynamic planning is a specific tool, not a universal solution. When a problem's solution is already well-understood and repeatable, constraining the agent to a predetermined, fixed workflow is more effective." The decision hinges on: "does the 'how' need to be discovered, or is it already known?"

**Gulli (Ch 3)** on parallelization: "Identify parts of the workflow that do not depend on the output of other parts and execute them in parallel." The agent already supports parallel tool calls, but rarely uses them for sequential form fields because each field type is a separate decision. Batching solves this differently — one decision, multiple executions.

**Dibia (Ch 4 §4.6.2)** on composite tools: "General-purpose tools enable maximum flexibility but increase the decision space. Task-specific tools constrain the agent's behavior, making it more predictable and reducing the number of turns needed." A `fill_form` composite that takes multiple field-value pairs would replace N individual `type_text` calls with 1.

**Rothman (Ch 4, lines 2512-2538)** on dependency resolution: "Resolve all `$$REFERENCE$$` placeholders by looking up prior results. Pass fully materialized context, never placeholders." This means the LLM can plan a full sequence with concrete references in one call if the dependencies are known upfront.

**Gulli (Ch 17, lines 2919-2931)** on the Scaling Inference Law: "A smaller model given a more substantial 'thinking budget' at inference time can occasionally surpass a much larger model." Investing more tokens in a single well-structured call (batched plan) is better than spreading the same reasoning across many thin calls.

### What OpenSidebar Already Supports

1. **Parallel tool calls** — The loop already executes multiple tool calls from a single LLM response in parallel. But the LLM rarely emits parallel `type_text` calls for form fields — it treats them sequentially.

2. **`fast_forward` tool** — Executes a series of actions rapidly. But it requires the LLM to have already decided the full sequence; it doesn't help the LLM *plan* the batch.

3. **Memory** — `memory_search` can retrieve previously learned workflows. Combined with batching, a remembered form-fill sequence could execute with zero LLM calls after retrieval.

## Problem

Two specific waste patterns:

**P1: Predictable form fills.** When the DOM snapshot shows a standard form with labeled fields and the user provides the data to fill, the LLM spends N turns doing trivially predictable work. Each turn costs: 1 LLM call + 1 DOM snapshot + context tokens for the snapshot. For a 10-field form, that's 10 unnecessary LLM round trips.

**P2: Navigation-then-interact sequences.** Patterns like "go to URL → wait for load → click element → wait → fill form" are highly predictable once the first action succeeds. But the agent returns to the LLM after every step.

## Solution

### S1: Batch Plan Prompt (Multi-Action Planning in One Call)

Instead of asking "what's the next action?" every turn, when the DOM snapshot reveals a predictable structure (form, list of links, table), prompt the LLM to emit **all actions for this page** in a single response as multiple tool calls.

**Implementation approach:** Add a context-aware hint to the system prompt when the DOM snapshot matches a predictable pattern:

```
BATCH HINT: The page contains a form with N labeled fields.
You may emit multiple tool calls in a single response to fill all fields at once.
Each tool call will execute in order. This is faster than one field at a time.
```

The LLM already supports emitting multiple tool calls per response — this just encourages it to do so for predictable patterns. No new tool is needed.

**Pattern detection heuristics (in context.ts):**

| Pattern | Detection | Hint |
|---------|-----------|------|
| Form with labeled fields | ≥3 elements with type=text/email/tel/password + associated labels | Batch fill hint |
| List of similar items | ≥5 elements with same tag + similar structure | Batch select/click hint |
| Navigation sequence | Agent on turn 1 with `navigate` as first action | Emit navigate + wait as parallel |

**Why a prompt hint and not a new tool?** The literature is clear: the simplest solution that works is best (Dibia Ch 1 §1.7). A prompt hint leverages existing parallel-tool-call support. A new composite tool adds to the 52-tool schema, consumes prefix cache budget, and requires its own executor logic.

### S2: Composite `fill_form` Tool (For High-Frequency Pattern)

For the most common predictable pattern (form filling), add a single composite tool that accepts multiple field-value pairs:

```typescript
{
  name: "fill_form",
  description: "Fill multiple form fields at once. Faster than individual type_text calls.",
  parameters: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", description: "Element tag ID" },
            value: { type: "string", description: "Value to type" }
          },
          required: ["id", "value"]
        },
        description: "Array of {id, value} pairs to fill"
      },
      submit_id: {
        type: "integer",
        description: "Optional: element tag ID of submit button to click after filling"
      }
    },
    required: ["fields"]
  }
}
```

**Executor:** Iterates over fields, calling the existing `type_text` action for each, then optionally clicks the submit element. Returns a combined result.

**Rationale from Dibia (Ch 4 §4.6.2):** "Task-specific tools constrain the agent's behavior, making it more predictable and reducing the number of turns needed." Form filling is the single most common multi-step predictable pattern in browser automation.

**Trade-off:** This adds 1 tool to the schema (~100 tokens). But it can save 3-9 LLM calls per form encounter. The net token savings is massively positive.

### S3: Procedural Memory for Learned Sequences

When the agent completes a multi-step sequence on a site (e.g., login flow), store the action sequence in memory via `memory_add` with a procedural tag. On future visits, `memory_search` retrieves the sequence, and the agent can execute it as a batch without re-reasoning each step.

This is Rothman's "Procedural RAG" pattern (Ch 3): "Store *how-to-act* instructions in a vector store and retrieve them dynamically, rather than hardcoding them in system prompts." Combined with Gulli's insight (Ch 6): "For known workflows, the agent should use a learned/memorized sequence rather than re-planning from scratch each time. This saves the planning LLM call entirely."

**Implementation:** No code change needed — this is a **prompt engineering** change. Add to the system prompt:

```
When you complete a multi-step workflow (login, checkout, search),
use memory_add to save the sequence for future reuse. Tag it with
category "procedure" and include the site domain.
When starting a task, use memory_search to check for saved procedures
for this site before planning from scratch.
```

The existing memory system handles storage and retrieval. The LLM just needs to be instructed to use it for procedural knowledge.

## Implementation

### S1: Batch Plan Hint

**File**: `src/background/agent/context.ts`

In the snapshot section of the system prompt builder, add pattern detection:

```typescript
function detectBatchablePattern(snapshot: DomSnapshot): string | null {
  const formFields = snapshot.elements.filter(el =>
    el.tag === "input" || el.tag === "textarea" || el.tag === "select"
  );

  if (formFields.length >= 3) {
    const withLabels = formFields.filter(el => el.label || el.placeholder);
    if (withLabels.length >= 2) {
      return `EFFICIENCY: This page has a form with ${formFields.length} fields. ` +
        `Emit multiple tool calls in one response to fill them all at once — ` +
        `this is faster than filling one field per turn.`;
    }
  }

  return null;
}
```

Call this in `buildSystemPrompt()` and append the hint if non-null.

### S2: `fill_form` Tool

**File**: `src/background/tools/index.ts`

Add registration:

```typescript
registry.register(
  ToolName.FILL_FORM,
  fillFormDefinition,
  async (args, tabId) => {
    const results: string[] = [];
    for (const field of args.fields) {
      const result = await executeAction(tabId, {
        tool: "type_text",
        args: { id: field.id, text: field.value },
      });
      results.push(`[${field.id}]: ${result.success ? "ok" : result.error}`);
    }
    if (args.submit_id !== undefined) {
      const clickResult = await executeAction(tabId, {
        tool: "click_element",
        args: { id: args.submit_id },
      });
      results.push(`submit [${args.submit_id}]: ${clickResult.success ? "ok" : clickResult.error}`);
    }
    return results.join("\n");
  },
  { risk: "medium", domModifying: true, sequential: true }
);
```

**File**: `src/types/index.ts`

Add `FILL_FORM` to `ToolName` enum and `ToolArgsMap`.

### S3: Procedural Memory Prompt

**File**: `src/prompts/registry.ts`

Append to the agent system prompt:

```typescript
const PROCEDURAL_MEMORY_HINT = `
## Procedural Memory
When you complete a multi-step workflow on a site (login, form fill, checkout, search):
- Save the action sequence with memory_add, category "procedure", including the site domain.
When starting a new task:
- Search memory for saved procedures for this site before planning from scratch.
- If a matching procedure exists, execute it directly — no need to re-reason each step.
`;
```

## Testing

### Unit Tests

**S1 — Batch hint:**
- Test `detectBatchablePattern()` returns hint for snapshot with 3+ form fields
- Test returns null for snapshot with <3 form fields
- Test returns null for non-form pages
- Test the hint text appears in `buildSystemPrompt()` output when pattern is detected

**S2 — fill_form tool:**
- Test that `fill_form` with 3 fields executes 3 `type_text` actions in order
- Test that `submit_id` triggers a click after all fields are filled
- Test that individual field failures are reported in the combined result
- Test that the tool is registered with correct metadata (domModifying, sequential)

**S3 — Procedural memory:**
- Test that the procedural memory hint appears in the system prompt
- Eval: run a login flow twice, verify the second run uses fewer LLM calls (memory retrieval + batch execution vs. step-by-step reasoning)

### Eval Pipeline

- Run existing eval suite with and without batch hints, compare:
  - LLM calls per form-fill scenario (primary metric — expect 50-80% reduction)
  - Task completion rate (must not regress — batching shouldn't break correctness)
  - Tokens per session (expect reduction from fewer round trips)

## Impact

### Performance

| Scenario | Before | After (S1+S2) | Savings |
|----------|--------|---------------|---------|
| 5-field form fill | 6 LLM calls | 1-2 calls | 67-83% |
| 10-field form fill | 11 LLM calls | 1-2 calls | 82-91% |
| Login flow (3 steps) | 4 LLM calls | 1-2 calls | 50-75% |
| Repeated workflow (S3) | N LLM calls | 1 call (memory retrieval) + batch | ~90% |

### Reliability

- Batch execution is actually **more** reliable for predictable patterns because the LLM makes one coherent decision rather than N incremental ones. Dibia (Ch 5 §5.2.1) notes that explicit planning "is efficient for static interfaces" precisely because it avoids incremental drift.
- The batch hint is non-coercive — if the LLM determines the page is too complex for batching, it can still emit one tool call at a time. This preserves the ReAct fallback for unpredictable pages.
- `fill_form` error handling per-field means a single field failure doesn't abort the entire batch.

### Risks

- **Stale element IDs in batch**: If filling field 1 triggers JavaScript that changes the DOM (e.g., dynamic form), fields 2-N might have stale IDs. Mitigated by: (a) the `fill_form` executor runs sequentially and can detect DOM changes between fills, (b) the prompt hint says "emit multiple tool calls" which the loop already handles with snapshot refresh between parallel calls for `domModifying` tools.
- **Over-batching complex forms**: Multi-step forms (wizard-style) where each "Next" button reveals new fields shouldn't be batched. The batch hint only triggers when ≥3 fields are visible simultaneously, which naturally excludes wizard forms.
- **Prefix cache impact**: Adding 1 tool (~100 tokens) to the schema is negligible vs. the 52 existing tools. The `fill_form` definition is small.

## Decision Log

| Decision | Chosen | Rejected Alternative | Rationale |
|----------|--------|---------------------|-----------|
| Primary mechanism | Prompt hint (S1) | New composite tool only | Prompt hint is zero-code-change, leverages existing parallel tool support. Composite tool is additive. |
| Composite tool scope | `fill_form` only | `fill_form` + `navigate_and_wait` + `search_site` | Start with the highest-frequency pattern. Others can be added if the pattern proves out. Dibia (Ch 1 §1.7): "Choose the simplest architecture." |
| Procedural memory | Prompt-only (S3) | Dedicated procedural store | The existing memory system already supports categories and search. A separate store adds complexity for no gain. Rothman: "leverage existing infrastructure." |
| Form detection threshold | ≥3 fields | ≥2, ≥5 | 2 fields is barely worth batching (saves 1 call). 5 is too conservative — 3-field login forms are the most common pattern. |
