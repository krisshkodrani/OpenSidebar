# RFC: Auto-Recovery from Stale Element IDs

## Problem

Analysis of `logs/opensidebar_stop_at_12.jsonl` shows **29 "No element with tag" failures** across `click_element` (19), `type_text` (5), `hide_element` (3), and `read_element` (2). These are the remaining tool failures after the drag-and-drop, select_option, execute_js, find_element, and type_text description fixes.

Every failure follows the same pattern:
1. LLM gets element ID `[N]` from a snapshot
2. Something changes the DOM (popup dismissed, page navigated, slot filled, parallel loop)
3. LLM calls a tool with ID `[N]` — tool returns `"No element with tag [N]"`
4. LLM must burn a turn calling `read_page` to get fresh IDs
5. Repeat — sometimes 3-5 turns wasted per recovery

### Root Causes (by frequency)

| Cause | Count | Example |
|-------|-------|---------|
| Popup/overlay dismissed | 14 | Click "Close" → elements inside popup gone |
| Drag slot mutation | 6 | Fill slot → `<span>` label replaced by dropped content |
| SPA navigation | 5 | Step transition → all old IDs invalid |
| Hallucinated IDs | 5 | LLM fabricated ID (e.g. incremented by 1) |
| Parallel loop interference | 3 | Two loops sharing tab, one invalidates the other's IDs |
| Multi-turn staleness | 3 | 20-100+ turns elapsed between ID acquisition and use |

### Why It Happens (Code Path)

In `loop.ts`, snapshot refresh is gated on `domModified`:

```
loop.ts:1165  let domModified = false;
loop.ts:1229  if (DOM_MODIFYING_TOOLS.has(toolName) && !result.includes("Click intercepted")) {
loop.ts:1232    domModified = true;
loop.ts:2308  if (domModified && !doneSignaled) { /* refresh snapshot */ }
```

The `domModified` flag is only set when a DOM-modifying tool **succeeds**. When `click_element([42])` returns `"No element with tag [42]"`, the tool IS in `DOM_MODIFYING_TOOLS` and the result doesn't contain "Click intercepted", so `domModified = true` IS set. BUT — the element didn't actually exist, so the click didn't fire, and the snapshot that gets refreshed still reflects the same DOM state the LLM already had. The real problem is:

**The snapshot the LLM sees in its next turn's system prompt is built from `this.context.snapshot` — which was set by the PREVIOUS successful refresh. A stale-ID error means that snapshot is outdated, but we only refresh it if `domModified` is true. Since `click_element` IS dom-modifying, we DO refresh — but the refresh happens AFTER the error, and only helps the NEXT turn.**

The actual gap is more subtle: **when ALL tools in a turn fail with stale IDs and none are dom-modifying (e.g. `read_element`, `hide_element` on its own), no refresh occurs at all.** And even when refresh does occur, the LLM has already wasted a turn getting error messages instead of useful results.

## Proposed Solution

### Change 1: Force snapshot refresh on stale ID errors

**File:** `src/background/agent/loop.ts`

After the circuit breaker section (~line 2057), before the snapshot refresh gate:

```ts
// Force snapshot refresh when tools hit stale element IDs
// This ensures the LLM's next turn sees fresh IDs without wasting a read_page call
if (!domModified && !doneSignaled) {
  const recentMessages = this.context.getMessages();
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    if (msg.role !== "tool") break;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (content.includes("No element with tag")) {
      domModified = true;
      break;
    }
  }
}
```

This piggybacks on the existing refresh logic at line 2308. When any tool returns "No element with tag", we force `domModified = true` so the snapshot refreshes before the next LLM turn.

**Why this location:** The circuit breaker (lines 2059-2210) runs between tool execution and snapshot refresh. We insert after circuit breaker so the stale-ID counting still works correctly, but before the refresh gate so we can influence it.

**Cost:** One extra `DOM_SNAPSHOT_REQUEST` message per turn that has stale ID errors. This is the same cost as a `read_page` call that the LLM would make anyway — but we save a full LLM round-trip turn.

### Change 2: Enrich "No element with tag" error with available alternatives

**File:** `src/content/actions.ts`

Currently every tool returns the bare string `"No element with tag [N]"`. We can add nearby element suggestions to help the LLM recover in the same turn (similar to what `drag_and_drop` pre-validation already does):

```ts
// Helper at module level
function staleIdError(id: number): { success: false; result: string; navigated: false } {
  const tagMap = getTagMap();
  const available = Array.from(tagMap.keys()).sort((a, b) => {
    // Sort by proximity to the requested ID
    return Math.abs(a - id) - Math.abs(b - id);
  }).slice(0, 5);
  const hint = available.length > 0
    ? ` Nearby IDs: ${available.map(n => `[${n}]`).join(", ")}. Call read_page if none match.`
    : " No elements tagged — call read_page to refresh.";
  return {
    success: false,
    result: `No element with tag [${id}]${hint}`,
    navigated: false,
  };
}
```

Then replace all 14 occurrences of the bare `"No element with tag [${args.id}]"` pattern with `staleIdError(args.id)`.

**Token cost:** ~15-20 extra tokens per stale ID error. This is negligible vs the 500+ tokens per wasted LLM turn.

**Why nearby IDs:** When an element's hash changes slightly (e.g. text content updated, DOM path shifted by 1), the new ID is often numerically close to the old one because the FNV-1a hash produces a similar allocation sequence. Showing nearby IDs lets the LLM self-correct without a full `read_page`.

### Non-Changes (Considered and Rejected)

**Pre-validation for all tools (like drag_and_drop):** Rejected. This would add a `DOM_SNAPSHOT_REQUEST` before EVERY tool call, doubling message traffic. The drag_and_drop case is special because it takes TWO IDs (higher failure probability) and has expensive side effects (HTML5 drag events). For single-ID tools, the current approach (fail fast + auto-refresh) is cheaper.

**Extending the grace period from 1 to 2 cycles:** Rejected. The grace period preserves hash→ID mappings, not actual element references. A longer grace period just means stale hashes linger in memory — the element is still gone from `tagMap`, so tools still fail. The grace period helps when an element briefly disappears and reappears (e.g. React re-render); 1 cycle is sufficient for this.

**Retry within the tool executor:** Rejected. The content script doesn't have access to the snapshot refresh mechanism (that's in the service worker). Adding cross-context retry would complicate the messaging protocol. The loop-level approach is cleaner.

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `src/background/agent/loop.ts` | Force `domModified = true` when any tool result contains "No element with tag" | After ~line 2210, before line 2308 |
| `src/content/actions.ts` | Add `staleIdError()` helper; replace 14 bare error returns | All `"No element with tag"` sites |

## Verification

1. `npx bun run build` — clean build
2. `npx bun test` — no regressions (no existing tests assert on bare "No element with tag" strings)
3. `npx bun run lint` — no new errors
4. Manual verification: load a dynamic page, get a snapshot, trigger DOM change (click to dismiss popup), then use a stale ID — verify:
   - Error message includes nearby IDs
   - Next LLM turn sees a fresh snapshot (without needing `read_page`)

## Expected Impact

- **Saves 1 turn per stale-ID recovery** (no need for manual `read_page`)
- **Addresses 24/29 failures** (all except 5 hallucinated IDs, which are LLM reasoning errors)
- **~10-15% fewer total turns** on challenge runs with dynamic DOM
- **Zero performance cost** on happy path (no extra snapshot requests when tools succeed)
