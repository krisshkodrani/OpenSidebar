# Continuation E2E Test Failure Diagnosis

**Date:** 2026-04-11
**Run duration:** 2282s (38 min)
**Result:** 0/9 passed (9 failed)
**Provider:** Fireworks (Kimi K2.5)
**Config:** `vitest.e2e.config.ts`, retry×1, single fork

---

## Executive Summary

All 9 continuation E2E tests failed due to **three interacting bugs** in the test harness — not in agent behavior. The agent actually completed Turn 1 successfully in 7 of 9 tests and called `done()` with correct data, but the test infrastructure failed to (a) extract the result, (b) deliver follow-up messages, or (c) handle post-completion LLM errors gracefully.

---

## Root Cause #1: `extractDoneMessage` checks wrong field name

**Impact:** 5 tests fail assertion immediately after a successful agent turn
**Severity:** Critical — masks correct agent behavior as failure

### Evidence

The `done()` tool definition (`src/background/tools/definitions.ts:196-214`) declares its parameter as `summary`:

```ts
// src/background/tools/definitions.ts:205
properties: {
  summary: { type: "string", description: "Your answer or report..." }
}
```

But `extractDoneMessage` in the tests checks for `args.message`:

```ts
// e.g. continuation-cross-tab.test.ts:44
if (tc.name === "done" && tc.args?.message) {
  return tc.args.message;
}
```

The trace data confirms the agent calls done correctly with `summary`:
```json
{"name":"done","arguments":"{\"summary\": \"The highest salary on the first page is **$61,924**...\"}"}
```

After `readTrace()` parses via `safeParseArgs()`, the result is `tc.args.summary` — but the test reads `tc.args.message` which is `undefined`, so `extractDoneMessage` returns `""`.

### Affected tests

| Test | Turn | Agent actually did | Test saw |
|------|------|--------------------|----------|
| continuation-cross-page-compose | Turn 1 | Called done() with dashboard metrics | `Turn 1: ` (empty) |
| continuation-cross-tab | Turn 1 | Called done() with Overview tab data | `Turn 1: ` (empty) |
| continuation-paginated-memory | Turn 1 | Called done() with salary data | `Turn 1 answer: ` (empty) |
| continuation-verify | Turn 2 | Called done() with verification report | `Turn 2 answer: ` (empty) |
| job-board | End | Called done() with job recommendations | `Done summary: ` (empty) |

### Fix

In every test that uses `extractDoneMessage`, change:
```ts
if (tc.name === "done" && tc.args?.message) {
  return tc.args.message;
```
to:
```ts
if (tc.name === "done" && (tc.args?.summary || tc.args?.message)) {
  return String(tc.args.summary ?? tc.args.message);
```

**Files to fix:**
- `tests/e2e/continuation-cross-tab.test.ts` (line ~44)
- `tests/e2e/continuation-cross-page-compose.test.ts` (line ~44)
- `tests/e2e/continuation-paginated-memory.test.ts` (has similar extraction)
- `tests/e2e/continuation-verify.test.ts` (has similar extraction)
- `tests/e2e/job-board.test.ts` (line ~41)

---

## Root Cause #2: Follow-up USER_CHAT dropped — "Ignoring concurrent USER_CHAT"

**Impact:** 5 follow-up turns silently never reach the agent
**Severity:** Critical — multi-turn tests structurally broken

### Evidence

The service worker logs show:
```
[agent] WRN Ignoring concurrent USER_CHAT for workspace
```

This happens because:
1. Test sends Turn 1 → agent processes → calls `done()` → `TASK_COMPLETION` event fires
2. Test detects completion, waits 4 seconds, calls `clearMonitoredEvents`, sends Turn 2
3. **But the agent loop hasn't fully terminated yet** — a post-completion LLM call (perception warmup or validation) is still in-flight
4. When Turn 2's `USER_CHAT` arrives, the agent rejects it as "concurrent" because the previous loop's teardown hasn't finished

Timeline from the log (continuation test):
```
Line 196: Turn 1 draft written successfully (151 chars)
Line 200: === TURN 2: Change to decline ===         ← test sends Turn 2
Line 203: WRN Ignoring concurrent USER_CHAT          ← DROPPED
Line 209: DONE called                                 ← Turn 1's done() is still processing
Line 212: ERR LLM Request Failed                      ← post-done perception call fails
```

The Turn 2 message arrives while Turn 1 is still in its `done()` teardown sequence.

### Occurrences

| Test | Dropped turn |
|------|-------------|
| continuation | Turn 2 (both retries) |
| continuation-abandon-restart | Turn 2 (retry 1), Turn 3 (retry 2) |
| continuation-verify | Turn 2 (retry 2) |

### Fix options

**Option A (test-side):** Wait for agent IDLE status before sending next turn, not just TASK_COMPLETION. Add a utility like:
```ts
async function waitForAgentIdle(ctx, timeoutMs, workspaceId) {
  // Poll until AGENT_STATUS:IDLE appears AFTER the last TASK_COMPLETION
}
```
Then call it between turns instead of just `clearMonitoredEvents + 4s delay`.

**Option B (agent-side):** Ensure the agent loop fully terminates (including perception cleanup) before the TASK_COMPLETION event is broadcast. The DONE handler should await all pending async work before signaling completion.

**Option C (agent-side):** Queue incoming USER_CHAT messages when a loop is tearing down, and process them after teardown completes, instead of silently dropping them.

---

## Root Cause #3: Post-completion LLM failures

**Impact:** 23 "LLM Request Failed" errors — all occur immediately after `done()` is called
**Severity:** Medium — causes delayed teardown (which triggers Root Cause #2)

### Evidence

Every `DONE called` log line is followed 1-3 lines later by `ERR [agent] LLM Request Failed`. This pattern is 100% consistent across all 19 DONE calls in the run.

These appear to be perception warmup or post-completion validation calls that fail because the Fireworks provider returns errors. The failures themselves don't affect the agent's work (it already completed), but they **delay the agent loop teardown**, which in turn triggers the concurrent USER_CHAT rejection (Root Cause #2).

### Fix

The post-completion LLM call should either:
1. Not be made at all after done() (skip perception warmup on task completion)
2. Be fire-and-forget so it doesn't block teardown
3. Have a short timeout so teardown isn't delayed by slow/failing providers

---

## Per-Test Detailed Breakdown

### 1. continuation-cross-page-compose (NEW)
- **Turn 1 (dashboard → read metrics):** Agent completed, called done(). Test extracted empty string due to Root Cause #1.
- **Assertion failed:** `Turn 1 should include numeric data from the dashboard`
- **The agent actually succeeded** — the done() call contains the dashboard metrics.
- **Fix:** Change `args.message` → `args.summary` in extractDoneMessage.

### 2. continuation (textarea rewrite)
- **Turn 1:** PASS — draft written ("Thursday at 2 PM works perfectly...")
- **Turn 2:** USER_CHAT dropped (Root Cause #2). Agent never received the "change to decline" instruction.
- **Result:** Draft unchanged from Turn 1 → timeout waiting for Monday/decline keywords.
- **Fix:** Wait for agent IDLE before sending Turn 2.

### 3. continuation-verify (act then verify)
- **Turn 1:** Agent acted on the support ticket (status changed, comment added).
- **Turn 2 (retry 1):** Extracted done() message was empty (Root Cause #1) — `Turn 2 answer: ` printed with no content.
- **Turn 2 (retry 2):** USER_CHAT dropped (Root Cause #2).
- **Fix:** Both Root Cause #1 and #2 fixes needed.

### 4. continuation-abandon-restart (clear form + refill)
- **Turn 1:** PASS — Form filled with Alice's data.
- **Turn 2 (retry 1):** USER_CHAT dropped (Root Cause #2). Fields still show Alice's data.
- **Turn 2 (retry 2):** Agent received Turn 2, filled Bob's data → PASS.
- **Turn 3 (retry 2):** USER_CHAT dropped (Root Cause #2). Timeout.
- **Fix:** Root Cause #2 fix (wait for IDLE).

### 5. continuation-act-check-act (dismiss overlays → observe → fill form)
- **Turn 1:** Agent called done() but overlays were not actually dismissed (agent may have read page and reported state without acting). `waitForOutcome` checker found `cookieDismissed: false`.
- **Possible additional issue:** Agent behavior — completed too early without actually dismissing overlays. May need prompt adjustment.
- **Fix:** Root Cause #2 fix + potentially review agent behavior here.

### 6. continuation-cross-tab (read tabs + synthesize)
- **Turn 1:** Agent called done() with tab data. Test extracted empty string (Root Cause #1).
- **Assertion failed:** `Turn 1 should include numeric data`
- **Fix:** Change `args.message` → `args.summary`.

### 7. continuation-paginated-memory (compare salary across pages)
- **Turn 1:** Agent called done() with salary data. Test extracted empty string (Root Cause #1).
- **Assertion failed:** `Turn 1 should report a salary number`
- **Fix:** Change `args.message` → `args.summary`.

### 8. continuation-cart-swap (add wrong item → swap → checkout)
- **Turn 1 (retry 1):** LLM Stream Request Failed mid-execution. Agent stalled, cart stayed empty. Timeout.
- **Turn 1 (retry 2):** Agent called done() but cart was still empty — agent may have called done() prematurely without adding the item. The `waitForOutcome` checker correctly identified `cart: []`.
- **Possible additional issue:** Agent behavior — called done() without completing the cart action. Prompt may need strengthening.
- **Fix:** Root Cause #3 fix helps, but agent behavior may need investigation.

### 9. job-board (NEW — browse 10 jobs)
- Agent visited only 1/10 jobs (`sr-fe-1`), then called done().
- `extractDoneMessage` returned empty (Root Cause #1), but even ignoring that, the agent didn't browse all jobs.
- **Possible issue:** Agent called done() too early — after reading the listing page and clicking into one job, it concluded and reported. The prompt says "review ALL 10 job listings" but the agent stopped after 1.
- **Fix:** Root Cause #1 fix + potentially increase maxTurns or strengthen prompt. May also need `allowNavigation: false` to be reviewed since clicking "View Details" and "Back to Listings" are within-page state changes, not navigation.

---

## Summary of Required Fixes

| Priority | Fix | Files | Effort |
|----------|-----|-------|--------|
| P0 | `extractDoneMessage`: check `args.summary` not `args.message` | 5 test files | Trivial |
| P0 | Wait for agent IDLE between multi-turn messages (not just TASK_COMPLETION + delay) | `helpers/utils.ts` + all multi-turn tests | Medium |
| P1 | Post-completion LLM calls should not block teardown | `src/background/agent/loop.ts` or orchestrator | Medium |
| P2 | Agent browses only 1 job before done() (job-board) | Prompt tuning or maxTurns | Low |
| P2 | Agent calls done() without dismissing overlays (act-check-act) | Prompt tuning | Low |
| P2 | Agent calls done() without adding to cart (cart-swap retry 2) | Prompt/agent investigation | Low |

---

## Appendix: Run Statistics

- **Total test duration:** 2282s
- **DONE calls observed:** 19 (across 9 tests × 2 retries)
- **LLM Request Failed:** 23 (all immediately post-DONE)
- **Concurrent USER_CHAT dropped:** 5
- **Agent completed Turn 1 successfully:** 7/9 tests
- **Failures purely from test harness bugs:** 7/9
- **Failures with possible agent behavior issues:** 2/9 (cart-swap, act-check-act)
- **Provider:** Fireworks / Kimi K2.5
