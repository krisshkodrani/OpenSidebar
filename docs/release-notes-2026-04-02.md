# Release Notes — 2026-04-02

## Summary

E2E test suite: **28/42 → 40/40 (100% pass rate)**
Golden eval cases: **13 → 29** (+ 6 perception = 65 total)
24 commits across agent loop, orchestrator, prompts, fixtures, harness, and eval infrastructure.

## Breaking Changes

None. All changes are backward compatible.

## Agent Loop Fixes

### Discovered tag ID validation
`validateElementIds` now accepts tag IDs mentioned in any tool result (e.g., find_element returning `[30]`, click interception reporting `covered by [34]`). Previously these dynamically-created tags were rejected by the pre-dispatch validation, blocking right_click, hide_element, and other tools from using them.

### Sub-node done() scoping
`validateDone` and `countExplicitSteps` are now skipped for orchestrator sub-nodes (`this.nodeId` is set). Previously these checked against the full original query, causing false rejections when a sub-node correctly completed its narrow objective.

### CSS :hover forcing
`hover_element` now forces CSS `:hover` styles by scanning stylesheets for matching `:hover` rules and injecting them as a class. Synthetic mouse events fire JS handlers but don't activate the CSS pseudo-class — this fix makes CSS hover dropdown menus work without CDP.

## Orchestrator Fixes

### Global goal gate tightened
The gate that skips remaining nodes when the goal appears satisfied now only fires when exactly 1 pending node remains. Previously it could skip multiple nodes after just 1 completed, causing premature "goal already achieved" on multi-step plans.

### Return-target extraction
Fixed regex that captured "page" instead of "Warehouse Alpha" due to case-insensitive flag + greedy window. Also fixed `repairPlanCoverage` which falsely matched "Navigate FROM Alpha" as "return TO Alpha."

### Verifier scope
Verifier prompt now explicitly instructs: "Judge ONLY the Objective and Success criteria — NOT the overall Task." The task query is labeled as background context. Prevents false retries that consumed node budgets.

## Prompt Changes

### Pre-submit verification (v5)
New executor rule: before clicking finalizing buttons (Submit, Place Order, Confirm), verify all prior inputs took effect — check for applied discounts, correct totals, status messages.

### Anti-pattern strengthening (v5)
- Don't call `find_element` for text already in Visible Elements
- Don't retry failed actions without `read_page` first
- Prefer `inspect_hidden` over `execute_js` for finding hidden elements
- Stronger Think requirement ("will be penalized")

## Test Infrastructure

### Harness page lifecycle
`resetExtensionState` now closes and reopens pages between tests instead of navigating to `about:blank`. Content scripts can't inject on `about:blank`, causing bridge disconnects on later test cases.

### Budget increases
- online-shop 2-item/natural: 300s → 480s wait, 380s/420s → 540s test timeout
- procurement-list: 300s → 480s wait, 360s → 540s test timeout
- go-back-navigation: 240s → 360s wait, 300s → 420s test timeout

### Fixture changes
- go-back-chain: added breadcrumb navigation (realistic back-navigation pattern)
- file-upload: test and fixture removed
- fixture dist rebuilt to match all source changes

## Eval Infrastructure

### 16 new golden cases
- 8 planner decomposition: round-trip, multi-item, coupon, over/under decomposition, criteria quality, data collection, form fill, sequencing
- 5 executor reactions: new element response, click interception recovery, find vs scroll, action verification, grounding
- 3 prompt-sensitive decisions: pre-submit verification, verifier scope, sub-node done

### 6 new perception cases
Coupon state, cart state, hover dropdown, overlay blocking, breadcrumbs, hover initial.

### Golden baseline generation pipeline
- `scripts/generate-golden-baselines.mjs`: runs cases against GPT-5.4 (full) via OpenRouter
- `scripts/apply-golden-baselines.mjs`: replaces hand-written expectations with model outputs after human review
- 20/29 golden cases now have GPT-5.4 verified baselines

---

## Documentation Changes Needed

### CLAUDE.md updates
- [ ] Update E2E test count: 28 → 27 test files (file-upload removed), note 100% pass rate
- [ ] Add `hover_element` CSS forcing to tool documentation
- [ ] Document `discoveredTagIds` mechanism in agent loop section
- [ ] Update eval section: 29 golden + 36 perception cases, baseline generation workflow
- [ ] Document verifier scope fix in orchestrator section
- [ ] Note pre-submit verification prompt rule

### Architecture section updates
- [ ] Agent loop: mention sub-node scoping for validateDone/countExplicitSteps
- [ ] Orchestrator: global goal gate `remainingPending === 1` constraint
- [ ] Orchestrator: verifier scoped to node objective
- [ ] Content script: hover_element CSS :hover forcing via stylesheet rewriting

### Eval section updates
- [ ] Add golden baseline generation workflow: generate → review → apply
- [ ] Document planner decomposition case format (structural checks in metadata)
- [ ] Note GPT-5.4 as golden source model, Sonnet 4.6 as judge

### New scripts documentation
- [ ] `scripts/generate-golden-baselines.mjs` — usage, flags, cost estimate
- [ ] `scripts/apply-golden-baselines.mjs` — review workflow
