# RFC: Circuit Breaker Cleanup — DRY Failure Detection, Snippet Fix, Merged Loops

## Status

Proposed

## Problem

Three related code-quality issues in `loop.ts`'s circuit breaker and attempt summary logic:

### 1. Duplicated failure detection (4 inline copies vs 1 compiled regex)

`FAILURE_PATTERN` was introduced in the performance audit as a compiled regex:

```ts
// loop.ts:85
const FAILURE_PATTERN = /^Error:|does not appear to be|No element with tag|Click intercepted|REJECTED/;
```

But it's only used in `extractAttemptSummary` (line 144). The circuit breaker sections duplicate the same logic with 4-check inline string matching in **three** separate places:

- **Section A** (lines 2143-2146): `content.startsWith("Error:") || content.includes("does not appear to be") || ...`
- **Section B** (lines 2200-2203): same 4 checks for `isFail`
- **Section C** (lines 2268-2272): inverted version for `isSuccess`, but also **adds** `REJECTED` (inconsistent with B which omits it)

This means:
- **Inconsistency**: Section B doesn't check for `"REJECTED"`, Section C does. `FAILURE_PATTERN` also includes it.
- **Maintenance risk**: Adding a new failure pattern requires updating 4 places.
- **Readability**: 4 lines of string checks vs 1 regex test.

### 2. Obscure `>>> 0` snippet extraction

In `extractAttemptSummary` (lines 171, 176):

```ts
const errorSnippet = content.slice(0, content.indexOf("\n") >>> 0 || 60).slice(0, 60);
```

The `>>> 0` (unsigned right shift) converts `-1` → `4294967295`, then `|| 60` doesn't trigger (4294967295 is truthy), so `.slice(0, 4294967295)` returns the full string, then `.slice(0, 60)` truncates.

This *works* but is a readability hazard. It also has a subtle edge case: when `indexOf("\n")` returns `0` (content starts with newline), `0 >>> 0` is `0`, then `0 || 60` gives `60` — so it takes 60 chars instead of 0. Not a real bug (error messages don't start with newlines), but the intent is unclear.

### 3. Sections B and C iterate tool_calls separately with duplicate lookups

Both Section B (same-tool repeat failure, lines 2188-2254) and Section C (redundant success detection, lines 2257-2329) independently:

1. Iterate `response.tool_calls!`
2. Call `recentMessages.find()` to locate the matching tool result by `tool_call_id`
3. Extract `resultContent` and classify as fail/success

These are two separate forward scans through `recentMessages` per tool call. Since tool results were just appended at the end, the finds scan from the beginning unnecessarily.

---

## Files to Modify

1. `src/background/agent/loop.ts` — All 3 fixes

---

## Changes

### 1. Add `isFailureResult()` helper, replace all inline checks

Create a helper next to `FAILURE_PATTERN`:

```ts
/** Test whether a tool result indicates failure */
function isFailureResult(content: string): boolean {
  return FAILURE_PATTERN.test(content);
}
```

Replace all 3 inline failure detection blocks:

**Section A** (lines 2142-2147):
```ts
// Before
if (
  content.startsWith("Error:") ||
  content.includes("does not appear to be") ||
  content.includes("No element with tag") ||
  content.includes("Click intercepted")
) {

// After
if (isFailureResult(content)) {
```

**Section B** (lines 2199-2203):
```ts
// Before
const isFail =
  resultContent.startsWith("Error:") ||
  resultContent.includes("does not appear to be") ||
  resultContent.includes("No element with tag") ||
  resultContent.includes("Click intercepted");

// After
const isFail = isFailureResult(resultContent);
```

**Section C** (lines 2267-2272):
```ts
// Before
const isSuccess =
  !resultContent.startsWith("Error:") &&
  !resultContent.includes("does not appear to be") &&
  !resultContent.includes("No element with tag") &&
  !resultContent.includes("Click intercepted") &&
  !resultContent.includes("REJECTED");

// After
const isSuccess = !isFailureResult(resultContent);
```

This also fixes the inconsistency: Section B was missing `REJECTED`, now all paths use the same regex.

### 2. Replace `>>> 0` with readable snippet extraction

Lines 171 and 176 in `extractAttemptSummary`:

```ts
// Before
const errorSnippet = content.slice(0, content.indexOf("\n") >>> 0 || 60).slice(0, 60);

// After
const nlIdx = content.indexOf("\n");
const errorSnippet = content.slice(0, nlIdx >= 0 ? nlIdx : 60).slice(0, 60);
```

Alternatively, extract a tiny helper used twice:

```ts
/** Take content up to first newline, capped at 60 chars */
function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return s.slice(0, nl >= 0 ? nl : 60).slice(0, 60);
}
```

Then both lines become `const snippet = firstLine(content);`

### 3. Merge B+C loops, pre-build tool result map

Pre-build a `Map<tool_call_id, string>` from the recent messages (O(n) once), then merge the B and C loops into a single pass over `response.tool_calls`:

```ts
// Pre-build tool_call_id → result content map (tool results are at the end)
const turnResults = new Map<string, string>();
for (let i = recentMessages.length - 1; i >= 0; i--) {
  const msg = recentMessages[i];
  if (msg.role !== "tool") break;
  if (msg.tool_call_id) {
    turnResults.set(msg.tool_call_id, typeof msg.content === "string" ? msg.content : "");
  }
}

// B+C merged: failure tracking + redundant success detection
for (const toolCall of response.tool_calls!) {
  const toolName = toolCall.function.name;
  const argsKey = toolCall.function.arguments.slice(0, 100);
  const resultContent = turnResults.get(toolCall.id) ?? "";
  const isFail = isFailureResult(resultContent);

  if (isFail) {
    // ... Section B logic (same-tool repeat failure) ...
  } else {
    // Reset failure counter on success
    toolFailCounts.delete(`${toolName}:${argsKey}`);
    // ... Section C logic (redundant success detection) ...
  }
}
```

Benefits:
- **1 loop** instead of 2 over `response.tool_calls`
- **O(1) lookups** instead of `recentMessages.find()` per tool call
- `turnResults` reverse scan stops at the first non-tool message (only scans results from this turn)

---

## Summary of Savings

| Fix | Lines removed | Lines added | Net |
|-----|-------------|-------------|-----|
| `isFailureResult()` helper | ~16 | ~5 | -11 |
| `>>> 0` snippet fix | 2 | 4 (or 6 with helper) | +2 |
| Merged B+C loops | ~40 | ~25 | -15 |
| **Total** | ~58 | ~34 | **-24** |

---

## Verification

1. `bun run build` — no build errors
2. `bun run lint` — no new lint errors
3. `bun test` — existing tests pass (circuit breaker behavior unchanged)
4. Verify via logs that:
   - `REJECTED` is now detected in Section B (was missed before)
   - Failure/success classification matches across all code paths
