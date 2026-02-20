# RFC: Structured Demo Labels & Post-Recording Modal

**Status:** Proposed
**Author:** k_shk
**Date:** 2026-02-20

---

## References

- Existing demo system: `src/background/demos/store.ts`, `src/content/recorder.ts`
- Golden eval builder: `src/background/golden/builder.ts`
- Side panel demo UI: `src/sidepanel/components/DemoRecordButton.tsx`, `DemoLibrary.tsx`
- RFC Multi-Turn Resilience: `docs/rfc/rfc-multi-turn-resilience.md`

---

## Context

The demo recording system lets users capture browser workflows and replay them as agent guidance. Today, a recorded demo carries only a `name` (free-text title) and an auto-extracted `urlPattern`. Matching is 60% URL similarity + 40% token overlap from the name.

This works for "same site, same task" recall but breaks down in three ways:

1. **Ambiguous intent.** A demo titled "Login" on `github.com` matches any query containing "login" on GitHub — even if the user is already logged in or wants to log *out*. The agent has no way to check applicability.

2. **No success criteria.** After replaying a demo's steps, the agent doesn't know whether it worked. It can't distinguish "the form submitted successfully" from "nothing happened because the page changed since recording."

3. **Poor cross-site transfer.** A demo titled "Fill checkout form" on `shop-a.com` never matches `shop-b.com` even though the workflow is structurally identical. Token overlap alone can't capture task semantics.

Meanwhile, the post-recording UX is a tiny inline text input that only asks for a name. Users skip the description field (it doesn't exist in the UI), and the golden-mode toggle is a separate, disconnected button. There's no natural moment to reflect on what was just recorded.

---

## Problems

**P1 — No applicability signal.** The agent injects demos based on keyword/URL overlap but has no way to check whether preconditions are met (e.g., "must be logged out", "must be on a product page"). This causes false-positive injections that confuse the agent.

**P2 — No outcome verification.** After following a demo's steps, the agent has no criteria to verify success. It can't tell whether to continue, retry, or escalate. The `uses` counter increments on injection, not on success.

**P3 — Weak semantic matching.** Matching relies on tokenized title words and URL similarity. Two demos solving the same class of problem on different sites never match each other. There's no task-level categorization.

**P4 — Throwaway post-recording UX.** The inline name input after recording is easy to dismiss with a default timestamp name. Users don't add descriptions. Golden mode is a separate toggle with no connection to the save flow. The result is under-labeled demos that match poorly.

**P5 — Golden dataset friction.** Golden recording requires toggling a separate "Au" button *before* recording. Users must decide upfront whether a recording is "eval-worthy." In practice, many good recordings are lost because the user didn't toggle golden mode beforehand.

---

## Non-Goals

- **Auto-generating labels from recorded actions.** Tempting, but unreliable — a sequence of clicks and types doesn't tell you the *intent*. The user knows what they were doing; we ask them.
- **Demo editing / step reordering.** Out of scope. The recording is append-only.
- **Demo sharing / import-export.** Future work, not in this RFC.
- **Changing the matching algorithm weights.** The 60/40 URL/token split stays. We add new signals on top.

---

## Solution

### S1 — Structured label fields on `Demonstration`

Add three optional fields to the `Demonstration` type:

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `goal` | `string` | What the demo achieves (verb phrase) | `"Log into the account"` |
| `preconditions` | `string[]` | When this demo applies (state assertions) | `["Must be logged out", "On login page"]` |
| `outcomeSignal` | `string` | How to verify success (observable page state) | `"URL contains /dashboard"` |

**Why strings, not enums:** Task types are unbounded. Enums would require maintenance and limit expressiveness. Free-text labels — written by the human who just performed the task — are richer and adapt to any domain.

**Why `preconditions` is an array:** Multiple independent conditions are common ("logged out" AND "on the right page"). An array makes each one checkable independently.

**Why `outcomeSignal` is singular:** There's usually one clear success indicator. If users need multiple, they can write a compound sentence. Keeping it a single string avoids over-engineering.

### S2 — Enhanced matching with labels

Extend `matchDemo()` to incorporate the new fields:

```
score = 0.45 * urlScore + 0.30 * tokenScore + 0.25 * goalScore
```

Where `goalScore` is token overlap between the user's query and the demo's `goal` field (same tokenization as `matchTokens`). If `goal` is empty, fall back to the current 60/40 split.

This means a demo with goal `"Complete checkout"` on `shop-a.com` can partially match a query like "check out on this site" even on `shop-b.com`, because the goal tokens overlap.

### S3 — Agent-visible preconditions and outcome signal

When injecting a demo into the system prompt, include the new metadata:

```
## Reference Demonstration: "Login flow"
Goal: Log into the account
Preconditions:
- Must be logged out
- On login page
Outcome: URL contains /dashboard

Adapt these steps to the current page — element IDs and positions may differ.
If preconditions are NOT met, skip this demonstration.
Verify the outcome after completing the steps.

1. Click "username field" (input type=text)
2. Type "user@example.com" in username
...
```

The agent now has explicit instructions to:
1. **Check preconditions** before following the demo (reduces false-positive replays)
2. **Verify the outcome** after completing the steps (enables success/failure detection)
3. **Skip the demo** if it doesn't apply (avoids confused behavior)

### S4 — Post-recording modal

Replace the inline name input with a modal dialog that appears when recording stops. The modal collects all metadata in one place.

**Modal layout (compact, single-column):**

```
┌─────────────────────────────────────┐
│  Save Demonstration                 │
│                                     │
│  Name                               │
│  ┌─────────────────────────────────┐│
│  │ Login flow                      ││
│  └─────────────────────────────────┘│
│                                     │
│  Description              (optional)│
│  ┌─────────────────────────────────┐│
│  │ Standard email/password login   ││
│  └─────────────────────────────────┘│
│                                     │
│  Goal                     (optional)│
│  ┌─────────────────────────────────┐│
│  │ Log into the account            ││
│  └─────────────────────────────────┘│
│                                     │
│  Preconditions            (optional)│
│  ┌─────────────────────────────────┐│
│  │ Must be logged out              ││
│  │ + Add precondition              ││
│  └─────────────────────────────────┘│
│                                     │
│  Outcome signal           (optional)│
│  ┌─────────────────────────────────┐│
│  │ URL contains /dashboard         ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌───┐                             │
│  │ ☐ │ Add to eval dataset         │
│  └───┘                             │
│                                     │
│  ┌──────────┐  ┌──────────────────┐│
│  │  Cancel   │  │   Save Demo      ││
│  └──────────┘  └──────────────────┘│
│                                     │
│  6 actions recorded                 │
└─────────────────────────────────────┘
```

**Behavior:**

- Modal appears as an overlay inside the side panel (not a browser popup)
- `Name` is the only required field, pre-focused
- `Description`, `Goal`, `Preconditions`, `Outcome signal` are optional, shown with placeholder hints
- `Preconditions` uses a chip/tag-style input — type + Enter to add, click X to remove
- `Add to eval dataset` checkbox replaces the old standalone golden toggle. Checked = golden mode for this recording. Default: unchecked.
- `Cancel` discards the recording entirely
- `Save Demo` sends `DEMO_RECORD_STOP` with all fields
- `Escape` key = Cancel, `Ctrl+Enter` = Save
- Footer shows action count as confirmation ("6 actions recorded")

### S5 — Unified golden toggle

Remove the standalone "Au" golden-mode toggle button from `DemoRecordButton`. Instead, the golden decision moves into the save modal (S4).

**Recording flow change:**

| | Before | After |
|---|--------|-------|
| 1 | Toggle golden mode (optional) | Click Record |
| 2 | Click Record | Perform actions |
| 3 | Perform actions | Click Stop |
| 4 | Click Stop | Modal appears |
| 5 | Type name in inline input | Fill name + labels + golden checkbox |
| 6 | Save | Save |

The key change: golden mode is decided **after** recording, not before. This is better because:
- Users don't know upfront if a recording will be "eval-worthy"
- All recordings capture the same data; golden mode just adds snapshot enrichment at save time
- One fewer pre-recording decision = less friction

**Implementation note:** To support post-hoc golden enrichment, the recorder must always capture enough data to reconstruct `GoldenAction[]` if requested. This means the content-script recorder should always track element descriptors (it already does), and on save with golden=true, the background script re-walks the actions to enrich with tag IDs and snapshots. This is a slight behavior change — currently golden mode captures snapshots *during* recording. The new approach captures snapshots *at save time* by replaying the selector chain against the final DOM state, or alternatively, always capturing lightweight snapshots during recording regardless of mode (they're discarded if golden isn't selected at save).

**Trade-off:** Always-capture is simpler but uses more memory during recording. Since demos are capped at 200 actions and snapshots are lightweight JSON, the memory cost is acceptable (~50KB per action × 200 = ~10MB worst case, typically much less).

### S6 — Label display in DemoLibrary

Update the `DemoLibrary` component to show the new metadata in the expanded view:

```
▶ Login flow                    3 steps · 2 uses
  ▼ (expanded)
  Goal: Log into the account
  Preconditions: Must be logged out · On login page
  Outcome: URL contains /dashboard
  URL: https://example.com/login
  1. Click "username field" (input type=text)
  2. Type "user@example.com" in username
  3. Click "Sign In" (button)
```

Labels are shown only when present (no empty "Goal: —" lines). Preconditions render as `·`-separated inline chips.

---

## Implementation

### Types (`src/types/index.ts`)

Add new fields to `Demonstration`:

```typescript
export interface Demonstration {
  id: string;
  name: string;
  description?: string;
  goal?: string;                // S1: verb phrase — what the demo achieves
  preconditions?: string[];     // S1: state assertions — when the demo applies
  outcomeSignal?: string;       // S1: observable page state — how to verify success
  createdAt: number;
  updatedAt: number;
  actions: DemoAction[];
  urlPattern: string;
  matchTokens: string[];
  uses: number;
  enabled: boolean;
}
```

Update `DEMO_RECORD_STOP` payload:

```typescript
// In RuntimeMessage union:
| {
    type: "DEMO_RECORD_STOP";
    source: "sidepanel";
    requestId: string;
    payload: {
      tabId: number;
      name: string;
      description?: string;
      goal?: string;
      preconditions?: string[];
      outcomeSignal?: string;
      golden?: boolean;          // S5: replaces pre-recording toggle
    };
  }
```

### Demo Store (`src/background/demos/store.ts`)

**`saveDemonstration()`** — accept new fields, include `goal` tokens in `matchTokens`:

```typescript
async saveDemonstration(params: {
  name: string;
  description?: string;
  goal?: string;
  preconditions?: string[];
  outcomeSignal?: string;
  actions: DemoAction[];
  recordingUrl: string;
}): Promise<Demonstration> {
  // ... existing cleanup logic ...

  // Tokenize name + description + goal for matching
  const matchSource = [params.name, params.description, params.goal]
    .filter(Boolean)
    .join(" ");
  const matchTokens = tokenize(matchSource);

  const demo: Demonstration = {
    id: crypto.randomUUID(),
    name: params.name,
    description: params.description,
    goal: params.goal,
    preconditions: params.preconditions?.filter(p => p.trim()),
    outcomeSignal: params.outcomeSignal?.trim() || undefined,
    // ... rest unchanged ...
    matchTokens,
  };
  // ...
}
```

**`matchDemo()`** — add goal-aware scoring (S2):

```typescript
matchDemo(query: string, currentUrl: string): Demonstration | null {
  const queryTokens = tokenize(query);
  let best: { demo: Demonstration; score: number } | null = null;

  for (const demo of demos) {
    if (!demo.enabled) continue;

    const urlScore = this.urlSimilarity(demo.urlPattern, currentUrl);
    const tokenScore = this.tokenOverlap(queryTokens, demo.matchTokens);

    // Goal-aware scoring when goal is present
    let score: number;
    if (demo.goal) {
      const goalTokens = tokenize(demo.goal);
      const goalScore = this.tokenOverlap(queryTokens, goalTokens);
      score = 0.45 * urlScore + 0.30 * tokenScore + 0.25 * goalScore;
    } else {
      // Fallback to original weights when no goal
      score = 0.6 * urlScore + 0.4 * tokenScore;
    }

    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { demo, score };
    }
  }

  return best?.demo ?? null;
}
```

**`formatDemoForContext()`** — include structured labels (S3):

```typescript
formatDemoForContext(demo: Demonstration): string {
  const lines: string[] = [];
  lines.push(`## Reference Demonstration: "${demo.name}"`);

  if (demo.goal) {
    lines.push(`Goal: ${demo.goal}`);
  }
  if (demo.preconditions?.length) {
    lines.push("Preconditions:");
    for (const p of demo.preconditions) {
      lines.push(`- ${p}`);
    }
  }
  if (demo.outcomeSignal) {
    lines.push(`Outcome: ${demo.outcomeSignal}`);
  }

  lines.push("");
  lines.push(
    "Adapt these steps to the current page — element IDs and positions may differ."
  );
  if (demo.preconditions?.length) {
    lines.push("If preconditions are NOT met, skip this demonstration.");
  }
  if (demo.outcomeSignal) {
    lines.push("Verify the outcome after completing the steps.");
  }
  lines.push("");

  // ... existing step formatting ...

  return lines.join("\n");
}
```

### Content Recorder (`src/content/recorder.ts`)

**S5 — Always-capture mode.** Remove the `goldenMode` branching. The recorder always captures `ElementDescriptor` (it already does). On `DEMO_RECORD_STOP` with `golden: true`, the background script enriches actions into `GoldenAction[]` using the captured descriptors and a fresh DOM snapshot request.

```typescript
// In recorder.ts: remove goldenMode parameter from startRecording()
// Always capture ElementDescriptor (already happens)
// Remove goldenAction emission during recording — defer to save-time enrichment
```

### Background (`src/background/background.ts`)

Update `DEMO_RECORD_STOP` handler to pass new fields and handle post-hoc golden enrichment:

```typescript
case "DEMO_RECORD_STOP": {
  const { tabId, name, description, goal, preconditions, outcomeSignal, golden } = msg.payload;

  // Save demo with labels
  const demo = await demoStore.saveDemonstration({
    name,
    description,
    goal,
    preconditions,
    outcomeSignal,
    actions: recordedActions,
    recordingUrl: currentUrl,
  });

  // Post-hoc golden enrichment if requested
  if (golden) {
    const goldenActions = await enrichForGolden(tabId, recordedActions);
    await buildAndSaveGoldenCases(goldenActions, name);
  }

  break;
}
```

### Side Panel — New Modal Component (`src/sidepanel/components/DemoSaveModal.tsx`)

New component replacing the inline name input in `DemoRecordButton`:

```tsx
interface DemoSaveModalProps {
  actionCount: number;
  onSave: (data: DemoSaveData) => void;
  onCancel: () => void;
}

interface DemoSaveData {
  name: string;
  description?: string;
  goal?: string;
  preconditions?: string[];
  outcomeSignal?: string;
  golden: boolean;
}
```

**Component structure:**
- Overlay backdrop (semi-transparent, covers side panel)
- Centered card with form fields
- `Name` input (required, autofocused)
- `Description` textarea (optional, 2-row)
- `Goal` input (optional, placeholder: "What does this demo achieve?")
- `Preconditions` chip input (optional, Enter to add, X to remove)
- `Outcome signal` input (optional, placeholder: "How to verify success?")
- `Add to eval dataset` checkbox
- Cancel / Save buttons
- Footer: "{N} actions recorded"
- Keyboard: Escape = cancel, Ctrl+Enter = save

### Side Panel — DemoRecordButton changes

```tsx
// Remove: goldenMode toggle button
// Remove: inline name input (showNameInput state)
// Add: showSaveModal state

const [showSaveModal, setShowSaveModal] = useState(false);

const stopRecording = () => {
  // Don't send DEMO_RECORD_STOP yet — show modal first
  setIsRecording(false);
  setShowSaveModal(true);
};

const handleSave = (data: DemoSaveData) => {
  sendMessage({
    type: "DEMO_RECORD_STOP",
    payload: { tabId, ...data },
  });
  setShowSaveModal(false);
};

// Render DemoSaveModal when showSaveModal is true
```

### Side Panel — DemoLibrary changes (S6)

Add label display to the expanded demo view:

```tsx
{expanded && (
  <div className="mt-2 space-y-1 text-xs text-warm-500">
    {demo.goal && <div>Goal: {demo.goal}</div>}
    {demo.preconditions?.length > 0 && (
      <div className="flex flex-wrap gap-1">
        {demo.preconditions.map((p, i) => (
          <span key={i} className="px-1.5 py-0.5 rounded bg-warm-200 dark:bg-warm-700">
            {p}
          </span>
        ))}
      </div>
    )}
    {demo.outcomeSignal && <div>Outcome: {demo.outcomeSignal}</div>}
    {/* ... existing step list ... */}
  </div>
)}
```

---

## Testing

### Unit Tests

**Demo Store:**
- `matchDemo()` with goal-aware scoring: verify that a demo with `goal: "checkout"` scores higher for query "complete checkout" than a demo without goal.
- `saveDemonstration()` with all new fields: verify they persist and round-trip.
- `formatDemoForContext()` with/without labels: verify correct prompt formatting, precondition skip instruction, outcome verification instruction.
- `matchTokens` includes goal tokens.
- Empty/whitespace preconditions are filtered out.

**Golden enrichment:**
- Post-hoc golden enrichment produces valid `GoldenAction[]` from plain `DemoAction[]`.
- Golden enrichment gracefully handles stale selectors (elements no longer in DOM).

### Manual Tests

1. Record a demo → stop → verify modal appears with all fields.
2. Fill only name → save → verify demo saved without optional fields.
3. Fill all fields → save → verify labels appear in DemoLibrary expanded view.
4. Check "Add to eval dataset" → save → verify golden cases written to traces.
5. Press Escape in modal → verify recording discarded.
6. Press Ctrl+Enter → verify save triggers.
7. Add/remove precondition chips → verify array updates correctly.
8. Record demo with goal "login" → new session, query "log in" on same site → verify demo matches with higher score.

---

## Impact

**Performance:** Negligible. Label fields add ~200 bytes per demo. Goal tokenization is O(n) on short strings. Always-capture mode adds ~50KB/action memory during recording (acceptable for max 200 actions).

**Matching quality:** Goal-aware scoring should improve cross-site matching for demos with explicit goals. No regression for demos without goals (falls back to original 60/40 weights).

**UX:** The modal adds one screen to the save flow but removes the need for a separate golden toggle and gives users a natural moment to label their recordings. The inline flow had 1 field; the modal has 6 fields but 5 are optional — minimum effort is unchanged.

**Agent behavior:** Precondition and outcome instructions in the prompt may cause the agent to skip demos it would have previously (incorrectly) followed. This is intentional — fewer false-positive demo injections is a quality improvement.

---

## Decision Log

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Label format | Free-text strings | Enum categories | Task types are unbounded; enums require maintenance and limit expressiveness |
| Preconditions type | `string[]` | Single string | Multiple independent conditions are common; array makes each checkable |
| Outcome signal type | Single string | `string[]` | Usually one clear success indicator; avoids over-engineering |
| Golden mode trigger | Post-recording checkbox | Pre-recording toggle | Users can't predict eval-worthiness upfront; post-hoc is lower friction |
| Snapshot capture | Always-capture during recording | On-demand at save time | Simpler implementation; memory cost acceptable (≤10MB worst case) |
| Modal vs inline | Modal overlay | Extended inline form | Modal is a natural "pause and reflect" moment; inline gets crowded with 6 fields |
| Matching weights | 0.45/0.30/0.25 (url/token/goal) | Equal weights | URL remains the strongest signal; goal is supplementary |
| Auto-label generation | Not included | LLM-inferred labels | Unreliable; user knows intent better than inference from click sequences |

---

## Rollout Plan

**Phase 1 — Types & Store (no UI change)**
- Add fields to `Demonstration` type
- Update `saveDemonstration()`, `matchDemo()`, `formatDemoForContext()`
- Migrate existing demos: new fields default to `undefined` (no migration needed — optional fields)
- Unit tests for matching and formatting

**Phase 2 — Save Modal**
- Implement `DemoSaveModal` component
- Wire into `DemoRecordButton` (replace inline input)
- Remove standalone golden toggle
- Update `DEMO_RECORD_STOP` message payload

**Phase 3 — Library & Agent**
- Update `DemoLibrary` expanded view to show labels
- Verify agent correctly uses preconditions/outcome instructions in prompt
- Manual end-to-end testing
