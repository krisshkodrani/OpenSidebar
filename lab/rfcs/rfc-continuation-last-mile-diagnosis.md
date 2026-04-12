# Diagnosis: Continuation Tests Last Mile — Executor Narrates Instead of Acting

**Date**: 2026-04-11
**Status**: Diagnosis complete, solution proposed
**Affects**: All 7 continuation E2E tests (0/7 pass)

## What Works

1. **Turn memory persistence**: Fixed race condition. `persistWorkspaceTurnMemory` is now awaited before `TASK_COMPLETION` event broadcasts. Memory writes land in `chrome.storage.local` before Turn 2 reads.

2. **Turn memory injection**: Confirmed in traces. Turn 2's executor instruction contains:
   ```
   PRIOR WORKSPACE TURNS:
   Turn 1
   - User request: Set the ticket status to "In Progress" and add this comment: "Investigating..."
   - Outcome: completed
   - Result: The ticket TICKET-4271 now shows status In Progress...
   ```

3. **Test infrastructure**: Stable in recent runs. Turn 1 completes, Turn 2 starts with correct context.

## What Fails

Turn 2 produces **zero tool calls** on every run, with both executor models:

### gpt-5.4-mini (OpenRouter)
```
Turn 2 response: "The page already shows the status and the posted comment 
in the activity feed. I'll verify the visible feed entries and then report 
the result."
Tool calls: 0
```
The model narrates what it sees and what it plans to do, but never calls `read_page` or `done()`.

### Kimi K2.5 (Fireworks)  
```
Turn 2 response: <think>The user wants me to verify two things:
1. The current ticket status from the Properties panel
2. The activity feed sh...</think>
Tool calls: 0
Finish reason: undefined (response truncated or stream error)
```
The model reasons inside think tags but never produces a tool call after the think block. Additionally, Fireworks returns intermittent "LLM Request Failed" errors.

### The pattern

Both models receive a verification query ("Did it work? What's the status?") with full prior-turn context. Both correctly identify what to check. Neither produces tool calls. The response is pure text — reasoning or narration — that the loop treats as a text-only turn.

## Exact Code Path

1. **Turn 2 starts** → orchestrator loads memory → injects "PRIOR WORKSPACE TURNS" into planner query and executor instruction

2. **Planner decomposes** Turn 2 into 1 node: "Read the current ticket page to confirm status and activity feed"

3. **Executor receives** the node objective + memory brief + page snapshot

4. **LLM responds** with text-only content (no `tool_calls` in the response)

5. **Loop at `loop.ts:4211`**: `cleanContent = stripThinkTags(rawContent)` — for Kimi, this strips think tags leaving empty/short content. For gpt-5.4-mini, it passes through the narration.

6. **Loop at `loop.ts:4131`**: `recoverToolCallsFromText(cleanContent)` — tries to find JSON tool calls in text. Finds none (the text is narration, not JSON).

7. **Loop enters text-only handler** (`loop.ts:~8100`):
   - `detectAdmission(cleanContent)` — checks for success/failure phrases
   - For gpt-5.4-mini: "The page already shows" matches the pattern `/(?:is|are)\s+(?:now\s+)?(?:visible|displayed|shown)\s+on\s+(?:the\s+)?(?:page|screen)/i`
   - `evaluateTextAdmissionAdvanceGate` runs — but `consecutiveTextOnly` is only 1 (first text response), gate requires >= 2
   - Falls through to simple nudge: "Call done() to deliver the result"

8. **Next turn**: Model receives the nudge. May return empty response (Kimi) or repeat narration (gpt-5.4-mini). Eventually hits text-only escalation or timeout.

## Root Cause

The executor model receives a **verification query** where the answer is already visible in the page snapshot. The model's rational response is to describe what it sees — there's nothing to DO, the information is already there. But the harness needs a `done()` tool call to capture the answer.

This is a **mismatch between the task type and the tool-calling interface**:
- **Action tasks** ("click this", "type that"): Model calls tools naturally
- **Verification tasks** ("did it work?", "what's the status?"): Model describes what it sees in text, doesn't call tools because there's nothing to act on

The system prompt says "Act with at least one tool call in the same turn" but for verification queries, the model doesn't perceive reading as an "action" — it already has the page state in the snapshot.

## Proposed Solution

### Option A: Verification-Aware System Prompt Injection (recommended)

When the turn memory shows a prior completed turn and the current query is a verification/confirmation ("did it work?", "what's the status?", "confirm", "verify", "check if"), inject a specific instruction into the executor system prompt:

```
VERIFICATION TURN: The user is asking you to verify the result of a prior action.
You MUST call read_page() to inspect the current page state, then call 
done({"summary": "..."}) with the verified findings. Do NOT describe what you 
see in text — use tool calls only.
```

This is injected in `buildExecutorInstruction()` when:
1. `priorTurnMemoryBrief` is non-empty (prior turn exists)
2. Current query matches verification patterns: `/\b(did it|verify|confirm|check if|what('s| is) the (status|result|current)|does it show)\b/i`

**Why this works**: The model follows explicit instructions in the system prompt more reliably than implicit conventions. "You MUST call read_page()" is a direct command, not a general rule.

**Risk**: LOW — only fires on verification queries with prior turn context. Single-turn tests don't have prior turns, so no injection.

### Option B: Lower Text-Admission Gate for Verification Turns

Change `evaluateTextAdmissionAdvanceGate` to use `consecutiveTextOnly >= 1` (instead of >= 2) when the current query matches verification patterns and prior turn memory exists.

This lets the gate fire on the FIRST text response for verification turns, converting narration to done() faster.

**Why this helps**: Reduces the turn budget needed for verification from 3+ (narrate → nudge → maybe act) to 1 (narrate → gate fires → done).

**Risk**: MEDIUM — lowering the threshold increases false-positive risk on non-verification queries.

### Option C: Auto-done() for Read-Only Verification Nodes

When the planner creates a single node with a read-only tool profile and the node's objective matches verification patterns, and the executor's first response is text-only with the page snapshot containing the success criteria — synthesize a `done()` call from the text content.

**Why this works**: Verification nodes don't need DOM actions. If the page shows the answer and the model describes it, the answer is the text itself.

**Risk**: MEDIUM — auto-done bypasses the model's judgment about whether the verification actually succeeded.

### Recommendation

**A + B together.** The prompt injection (A) gives the model clear instructions. The lowered gate (B) catches it if the model still narrates despite the instruction. Together they address both the model compliance and the harness recovery paths.

## Files to Modify

| File | Change |
|---|---|
| `src/background/orchestrator/handoff.ts` | Inject verification prompt when prior turn memory exists and query matches patterns |
| `src/background/agent/loop.ts` | Lower gate threshold for verification queries in `evaluateTextAdmissionAdvanceGate` |

## Verification

```bash
# Primary target
npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-verify.test.ts

# If passing, full continuation suite
npx tsx scripts/run-e2e-progressive.ts continuation --dir=docs/e2e-reports/natural-v4-kimi
```

Target: continuation-verify passes (Turn 2 calls done() with status confirmation).
