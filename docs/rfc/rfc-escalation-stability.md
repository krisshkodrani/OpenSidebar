# RFC: Escalation Stability — Smart Model Tenure & Fingerprint Robustness

## Status

Proposed

## Problem

Two related issues cause the escalation/de-escalation cycle to misfire, wasting turns and model budget:

### 1. Premature de-escalation

When the agent escalates to the smart model, de-escalation triggers on the **first turn** where `contentFingerprint` changes. The check at loop.ts:2476 is:

```ts
} else if (wasStuck) {
  // fingerprint changed → "progress" → de-escalate immediately
  this.deescalateModel();
}
```

The smart model's very first tool call (e.g., `read_page`, `click`) modifies the DOM, the fingerprint changes, and the system concludes "progress made — switch back to fast." The smart model gets yanked before it finishes the step that the fast model couldn't handle.

**Observed failure mode:** Fast model gets stuck on a multi-field form → escalates → smart model clicks the first field → fingerprint changes → de-escalates → fast model gets stuck on the same form again → re-escalates → repeat until `MAX_CYCLES` exhausted.

### 2. Fingerprint sensitivity

`contentFingerprint()` in progress.ts treats **any** change to **any** tagged element as "progress":

```ts
function contentFingerprint(snap: DomSnapshot): string {
  const elSigs = snap.elements
    .map((e) => {
      const attrSig = STATE_ATTRS.filter((a) => a in e.attributes)
        .map((a) => `${a}=${e.attributes[a]}`)
        .join(",");
      return `${e.tagName}:${e.text.slice(0, 30)}:${e.isVisible ? 1 : 0}:${attrSig}`;
    })
    .sort()
    .join("|");
  return `${snap.elements.length}|${elSigs}`;
}
```

Problems:
- **False progress (→ premature de-escalation):** A loading spinner appearing, a notification badge incrementing, a tooltip rendering, or an animation frame changing all flip the fingerprint. The agent gets credit for DOM changes it didn't cause.
- **False stuck (→ unnecessary escalation):** The agent successfully performs a meaningful action (e.g., submitting a form that shows an inline success message) but the fingerprint changes so much between snapshots that it's treated as a full reset, masking subsequent stale turns where the agent is actually stuck on the next step.
- **Element count instability:** Sites with lazy-loaded content, virtual scrolling, or client-side routing can have large element count swings that make the fingerprint volatile even when the page is semantically unchanged.

## Solution

### A. Smart model minimum tenure

Add a `smartModelTurnStart` counter. When auto-escalation fires, record the current turn. Block de-escalation until the smart model has run at least `MIN_SMART_TENURE` turns. This guarantees the smart model gets enough runway to actually attempt the stuck step.

### B. Fingerprint delta threshold

Replace the binary `fp !== this.lastFingerprint` check with a proportional comparison. Compute the fraction of element signatures that changed. Only treat it as "progress" if the change exceeds a threshold — filtering out ambient DOM noise (spinners, badges, timers) while still detecting meaningful page transitions.

## Implementation

### File: `src/background/agent/constants.ts`

Add `MIN_SMART_TENURE` to `ESCALATION_LIMITS`:

```ts
export const ESCALATION_LIMITS = {
  MAX_CYCLES: 3,
  COOLDOWN_TURNS: 3,
  /** Minimum turns the smart model must run before de-escalation is allowed */
  MIN_SMART_TENURE: 3,
} as const;
```

### File: `src/background/agent/loop.ts`

**A. Track smart model tenure**

After the existing escalation state variables (~line 912):

```ts
let onSmartModel = false;
let voluntaryEscalation = false;
let escalationCycles = 0;
let cooldownRemaining = 0;
let smartModelStartTurn = 0; // NEW — turn when auto-escalation fired
```

At each auto-escalation site (3 locations), after setting `onSmartModel = true`:

```ts
smartModelStartTurn = this.turnCount;
```

At the de-escalation gate (~line 2490), add a tenure check:

```ts
// Before (current):
if (onSmartModel && !voluntaryEscalation && escalationCycles < ESCALATION_LIMITS.MAX_CYCLES) {

// After:
const smartTenure = this.turnCount - smartModelStartTurn;
if (
  onSmartModel &&
  !voluntaryEscalation &&
  escalationCycles < ESCALATION_LIMITS.MAX_CYCLES &&
  smartTenure >= ESCALATION_LIMITS.MIN_SMART_TENURE
) {
```

When tenure hasn't been met, the smart model stays active and the `wasStuck` flag resets normally — the smart model just doesn't get swapped out yet.

### File: `src/background/agent/progress.ts`

**B. Proportional fingerprint comparison**

Replace the binary fingerprint comparison with a delta ratio:

```ts
/** Minimum fraction of element signatures that must change to count as progress */
const PROGRESS_DELTA_THRESHOLD = 0.1; // 10% of elements must differ

/** Cheap content fingerprint — returns sorted set of element signatures */
function contentSignatures(snap: DomSnapshot): Set<string> {
  const sigs = new Set<string>();
  for (const e of snap.elements) {
    const attrSig = STATE_ATTRS.filter((a) => a in e.attributes)
      .map((a) => `${a}=${e.attributes[a]}`)
      .join(",");
    sigs.add(`${e.tagName}:${e.text.slice(0, 30)}:${e.isVisible ? 1 : 0}:${attrSig}`);
  }
  return sigs;
}

/**
 * Compute the fraction of element signatures that differ between two sets.
 * Uses symmetric difference / max(size) — so both additions and removals count.
 * Returns 1.0 if either set is empty (treat as full page transition).
 */
function signatureDelta(prev: Set<string>, curr: Set<string>): number {
  if (prev.size === 0 || curr.size === 0) return 1.0;
  let diffCount = 0;
  for (const sig of curr) {
    if (!prev.has(sig)) diffCount++;
  }
  for (const sig of prev) {
    if (!curr.has(sig)) diffCount++;
  }
  return diffCount / Math.max(prev.size, curr.size);
}
```

Update `ProgressTracker` to use these:

```ts
export class ProgressTracker {
  private lastSignatures = new Set<string>();
  private lastUrl = "";
  private staleTurns = 0;
  private pivotFired = false;
  private escalationFired = false;

  onSnapshotRefresh(snap: DomSnapshot): ProgressSignal | null {
    const currSigs = contentSignatures(snap);
    const url = snap.url || "";
    const delta = signatureDelta(this.lastSignatures, currSigs);
    const urlChanged = url !== this.lastUrl;

    this.lastSignatures = currSigs;
    this.lastUrl = url;

    // Meaningful content change — above noise threshold
    if (delta >= PROGRESS_DELTA_THRESHOLD) {
      this.staleTurns = 0;
      return null;
    }

    if (urlChanged) {
      // URL changed but content barely differs — partial credit
      this.staleTurns = Math.floor(this.staleTurns / 2);
      return null;
    }

    // Below threshold — treat as stale
    this.staleTurns++;

    // ... rest unchanged (nudge/pivot/escalate checks) ...
  }
}
```

**Key behavioral changes:**
- A single spinner appearing on a 50-element page = 1/50 = 2% delta → below 10% → counts as stale (correct).
- A form submission that swaps 8/50 elements = 16% delta → above 10% → counts as progress (correct).
- A full page navigation that replaces most elements → high delta → counts as progress (correct).
- An empty page (0 elements) → delta = 1.0 → always treated as progress (safe default).

### Reset method update:

```ts
reset() {
  this.lastSignatures = new Set<string>();
  this.lastUrl = "";
  this.staleTurns = 0;
  this.pivotFired = false;
  this.escalationFired = false;
}
```

## Testing

### Unit tests (`tests/background/progress.test.ts` — new or extend existing)

1. **Tenure gate:** Mock escalation at turn 5, verify de-escalation blocked at turns 6-7, allowed at turn 8 (`MIN_SMART_TENURE = 3`).
2. **Small DOM change:** Snapshot with 50 elements, change 2 element texts → delta = 4% → should NOT reset staleTurns.
3. **Large DOM change:** Snapshot with 50 elements, change 10 element texts → delta = 20% → SHOULD reset staleTurns.
4. **Full page swap:** Snapshot with 50 elements, replace all → delta = 100% → SHOULD reset staleTurns.
5. **Empty page:** Previous snapshot has elements, new snapshot empty → delta = 1.0 → SHOULD reset (safe).
6. **Element count swing:** 50 elements → 55 elements (5 added, none changed) → delta = 5/55 = 9% → below threshold → stale (correct — lazy-load noise).
7. **Backward compatibility:** Existing agent.test.ts tests still pass with the new fingerprint logic.

### Integration verification

1. `npx bun run build` — clean build
2. `npx bun test` — no regressions
3. `npx bun run lint` — no new errors
4. Manual: trigger escalation on a dynamic page (e.g., a site with notification badges), verify smart model stays for at least 3 turns before de-escalation.

## Impact

**Performance:** `signatureDelta()` is O(n) where n = number of tagged elements (typically 30-100). Two Set iterations per turn — negligible compared to the LLM call.

**Token cost:** Fewer wasted escalation/de-escalation cycles means fewer turns spent re-discovering context. Net savings on both fast and smart model usage.

**Agent effectiveness:** The smart model gets enough runway to actually solve the stuck step, rather than being yanked after one DOM change. The fast model doesn't get falsely de-escalated by ambient DOM noise.

**Risk:** The 10% threshold is a tuning parameter. Too high → the agent stays "stuck" longer before getting credit for real progress (slower nudge reset). Too low → noise still triggers false progress. 10% is a conservative starting point; can be adjusted based on trace analysis. The `MIN_SMART_TENURE` of 3 is deliberately low — enough for read_page + one action + observation, without locking in the expensive model too long.

## Files to modify

| File | Change |
|------|--------|
| `src/background/agent/constants.ts` | Add `MIN_SMART_TENURE: 3` to `ESCALATION_LIMITS` |
| `src/background/agent/loop.ts` | Add `smartModelStartTurn` variable, set at 3 escalation sites, check at de-escalation gate |
| `src/background/agent/progress.ts` | Replace `contentFingerprint` string comparison with `contentSignatures` + `signatureDelta` proportional check |
| `tests/background/progress.test.ts` | New/extended tests for delta threshold and tenure gate |
