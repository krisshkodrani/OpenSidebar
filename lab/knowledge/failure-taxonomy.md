# Failure Taxonomy

Recurring failure patterns observed in E2E test traces.
Updated by the trace-analysis scheduled task and manual observation.

Last updated: 2026-04-12

## Categories

### 1. Executor Nondeterminism [Grade: A]

The same prompt + page state produces different tool-call sequences across runs.
This is the single largest source of flakiness. Mitigation: retry, skills pipeline,
stronger executor models.

Evidence: perception A/B test (lab/research/), e2e-report-2026-04-09

### 2. Stale Element References [Grade: A]

Agent acts on a tag ID that no longer exists in the DOM (page navigated, SPA
re-rendered). Manifests as "element not found" errors mid-sequence.

Evidence: multiple trace files, BUG-001 (navigation timeout)

### 3. Modal/Overlay Interference [Grade: B]

Cookie banners, popups, or overlays block interaction with target elements.
`dismiss_overlays` tool exists but is not always invoked proactively.

Evidence: edge-cases E2E suite, online-shop-pro fixtures

### 4. Text-Only Response Loops [Grade: A]

Agent returns text instead of a tool call for multiple consecutive turns.
Nudge -> escalate -> give-up sequence handles this but burns turns.

Evidence: stagnation monitor data, multiple e2e reports

### 5. Verification False Positives [Grade: B]

Verifier reports task complete when the action was only partially performed.
State-diff verification (2026-04-04) partially addresses this.

Evidence: continuation-verify E2E tests, state-diff RFC

### 6. Cross-Tab Context Loss [Grade: C]

Agent loses track of state when operating across multiple tabs.
Turn memory (2026-04-12) is the current mitigation attempt.

Evidence: continuation-cross-tab E2E tests
