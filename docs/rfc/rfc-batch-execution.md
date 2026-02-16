# RFC-B: Batch Execution — Smart Pre-Plans, Fast Executes Without Roundtrips

## Summary

The BRAINS (smart model) emits a **tool-call script** — a concrete sequence of tool calls — during orientation. The HANDS (fast model) executes them back-to-back without consulting the LLM between steps. The fast model re-engages only when the batch completes, fails, or the DOM changes unexpectedly.

## Motivation

Currently, every single tool call requires a full LLM roundtrip:
```
LLM call (300-800ms) → tool exec (50ms) → snapshot (30ms) → LLM call (300-800ms) → ...
```

For a 5-field form fill, that's 5 LLM calls (~2-4 seconds of pure LLM latency) for what is essentially a deterministic sequence. The smart model already *knows* the sequence when it reads the page.

## Design

### New Concept: `ToolScript`

```typescript
interface ToolScript {
  /** Steps to execute in order */
  steps: ToolScriptStep[];
  /** What to verify after the batch completes */
  verifyCondition: string;
  /** When to bail out early */
  bailConditions: string[];
}

interface ToolScriptStep {
  tool: ToolName;
  args: Record<string, unknown>;
  /** Expected outcome — if actual result doesn't match, bail */
  expect?: string;
}
```

### New Tool: `batch_execute`

The smart model can call a new tool during orientation that emits a script:

```json
{
  "name": "batch_execute",
  "arguments": {
    "steps": [
      { "tool": "click_element", "args": { "id": 5 } },
      { "tool": "type_text", "args": { "id": 8, "text": "hello@example.com" } },
      { "tool": "type_text", "args": { "id": 12, "text": "password123" } },
      { "tool": "click_element", "args": { "id": 15 }, "expect": "navigation" }
    ],
    "verify": "Page should show dashboard after login",
    "bail_on": ["error", "unexpected modal", "element not found"]
  }
}
```

### Execution Flow

```
BRAINS (turn 1): reads page → emits batch_execute([click 5, type 8, type 12, click 15])
LOOP:  executes step 1 (click 5) → check result → OK
       executes step 2 (type 8)  → check result → OK
       executes step 3 (type 12) → check result → OK
       executes step 4 (click 15) → check result → navigated!
       → take snapshot, verify condition
HANDS (turn 2): sees batch results + new page state → continues with plan
```

**Zero LLM calls during batch execution.** The loop acts as a simple script runner.

### Bail-Out Logic (HANDS Agency)

The fast model retains agency through bail conditions:

1. **Tool error**: Any tool returns an error → bail, consult LLM
2. **Element not found**: Tag ID doesn't exist → bail, snapshot is stale
3. **Unexpected result**: If `expect` is set and result doesn't match → bail
4. **Navigation**: Page navigates mid-batch → bail, need fresh context
5. **Modal appears**: Overlay detected during execution → bail, dismiss first

On bail-out, the remaining steps are discarded. The LLM receives:
- Results of completed steps
- The bail reason
- A fresh snapshot

The LLM then decides what to do next — retry, adapt, or continue manually.

### Where Batch Lives in the Loop

```
loop.ts main loop:
  1. LLM call → response
  2. If response contains batch_execute:
     a. For each step in script:
        - Execute tool
        - Check bail conditions
        - If bail → break, add results to context
        - If OK → continue to next step
     b. After batch: take snapshot, add all results to context
     c. Continue to next LLM call (fast model takes over)
  3. Normal tool execution (unchanged)
```

### Integration with BRAINS→HANDS

```
Turn 0:  Guardian decomposes (smart model, non-streaming)
Turn 1:  BRAINS reads page, calls batch_execute([...5 steps...])
         Loop executes 5 steps with zero LLM calls
Turn 2:  HANDS (fast model) sees results, continues plan
Turn 3+: HANDS continues, may call batch_execute for more sequences
```

The fast model can also emit `batch_execute` — it's not restricted to the smart model.

### What Can Be Batched

**Good candidates** (deterministic, element IDs known):
- Form fills (type into multiple fields)
- Multi-click sequences (expand accordion → click item → confirm)
- Navigation chains (click link → wait → click next link)

**Bad candidates** (need LLM judgment between steps):
- Searches (need to read results before next action)
- Dynamic content (element IDs change after each action)
- Error recovery (need reasoning about what went wrong)

### Tool Definition

```typescript
const BATCH_EXECUTE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: "batch_execute",
    description: "Execute a sequence of tool calls without LLM roundtrips. Use for deterministic sequences where element IDs are known (form fills, multi-click flows). Execution stops on any error or unexpected result.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string", description: "Tool name" },
              args: { type: "object", description: "Tool arguments" },
              expect: { type: "string", description: "Expected outcome pattern (optional)" }
            },
            required: ["tool", "args"]
          },
          description: "Ordered list of tool calls to execute"
        },
        verify: { type: "string", description: "What to check after all steps complete" }
      },
      required: ["steps"]
    }
  }
};
```

### Constraints

- Maximum 10 steps per batch (prevent runaway scripts)
- Only non-sequential tools allowed in batch (no navigate, done, screenshot)
- Snapshot refresh happens once after the entire batch, not per-step
- Batch counts as 1 turn for escalation/progress tracking purposes
- Abort signal respected — batch stops immediately on user stop

## Implementation Complexity

| Component | Change | Effort |
|-----------|--------|--------|
| `types/index.ts` | New `ToolScript` types | Low |
| `tools/index.ts` | Register `batch_execute` tool | Low |
| `loop.ts` | Batch execution loop (intercept like escalate) | Medium |
| `constants.ts` | `MAX_BATCH_STEPS: 10` | Trivial |
| `metadata.ts` | Add `batch_execute` to sequential tools | Trivial |

**Total effort: ~1 session.** No architectural changes needed.

## Risks

- LLM may emit bad scripts (wrong element IDs, wrong order)
- Bail-out conditions need careful tuning to avoid false positives
- Batch results in context may be verbose (N tool results at once)
- Smart model needs good prompting to know when batching is appropriate
