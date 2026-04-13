# Skills Roadmap

Date: 2026-04-13

Scope: OpenSidebar workflow skills and lab meta-skills

This roadmap separates:

- skills that already exist in the runtime skill layer
- skills that are worth adding next
- lab-only meta-skills that help improve the harness but should not necessarily become end-user workflow skills

The guiding rule is:

- tools stay generic
- workflow skills encode reusable browser-task discipline
- meta-skills improve research, trace analysis, and skill discovery

## Present Skills

### `structured-form-fill`

Status: present

Why it matters:

- high reuse across real sites
- strong deterministic verification surface
- captures submit-last discipline that generic prompting often misses

Relevant E2Es:

- `tests/e2e/multi-step-form.test.ts`
- `tests/e2e/continuation-abandon-restart.test.ts`
- `tests/e2e/support-ticket.test.ts`
- `tests/e2e/login.test.ts`

### `transactional-act-check-act`

Status: present

Why it matters:

- enforces mutation -> verify -> continue discipline
- reduces stale-state continuation
- important for confirm-gated or stateful UI workflows

Relevant E2Es:

- `tests/e2e/continuation-act-check-act.test.ts`
- `tests/e2e/continuation-verify.test.ts`
- `tests/e2e/support-ticket.test.ts`

Risk:

- can become too vague if treated as a generic "hard task" fallback

### `cross-tab-compare`

Status: present

Why it matters:

- strong fit for browser research and comparison tasks
- benefits directly from notes and workspace memory
- prevents premature synthesis before evidence is gathered

Relevant E2Es:

- `tests/e2e/continuation-cross-tab.test.ts`
- `tests/e2e/continuation-paginated-memory.test.ts`
- `tests/e2e/article-research.test.ts`

### `continuation-edit`

Status: present

Why it matters:

- high value for real user follow-up behavior
- preserves prior constraints while applying deltas
- supports revision-heavy browser tasks

Relevant E2Es:

- `tests/e2e/continuation.test.ts`
- `tests/e2e/continuation-cross-page-compose.test.ts`
- `tests/e2e/email-compose.test.ts`

### `hover-reveal-navigation`

Status: present

Why it matters:

- hover-driven interfaces are a real browser pathology
- generic prompting often collapses hover and click into one step
- clear workflow benefit: reveal first, verify, then act

Relevant E2Es:

- `tests/e2e/hover-menus.test.ts`

Risk:

- narrower than the core skills

### `budget-aware-execution`

Status: present

Why it matters:

- helps near turn-budget exhaustion
- useful for stopping blind retries and forcing goal narrowing
- bridges workflow discipline and harness-level recovery strategy

Relevant trace classes:

- `max_turns`
- `turn_limit_reached`
- repeated exploratory traces with no new evidence

Risk:

- may ultimately belong partly in harness policy rather than only as a workflow skill

### `cart-modify-checkout`

Status: present

Why it matters:

- transactional shopping flows are common and error-prone
- requires verifying state before proceeding to checkout

Relevant E2Es:

- `tests/e2e/continuation-cart-swap.test.ts`
- `tests/e2e/online-shop.test.ts`
- `tests/e2e/procurement-list.test.ts`

Risk:

- highest current overfitting risk because cart UIs vary widely

### `modal-overlay-recovery`

Status: present

Why it matters:

- overlays and blocking modals are one of the most common browser-use pathologies
- often causes repeated failed clicks and stale assumptions
- requires sequential dismissal with re-grounding between each

Relevant E2Es:

- `tests/e2e/continuation-act-check-act.test.ts`
- `tests/e2e/modal-overlays.test.ts`

### `navigate-read-return`

Status: present

Why it matters:

- round-trip lookup tasks are common in real browser use
- agents often over-decompose or forget the return leg
- captures the navigate-read-store-return discipline

Relevant E2Es:

- `tests/e2e/job-board.test.ts`
- `tests/e2e/go-back-chain.test.ts`

## Must-Have Skills

These are the highest-value workflow skills to keep and improve.

1. `structured-form-fill`
2. `transactional-act-check-act`
3. `cross-tab-compare`
4. `continuation-edit`
5. `hover-reveal-navigation`
6. `navigate-read-return`
7. `modal-overlay-recovery`

Why these rank highest:

- they encode recurring browser workflow structure
- they generalize across multiple sites and tasks
- they reduce execution variance without becoming site-specific scripts

## Worth Adding Next

### `autocomplete-select`

Why it is worth having:

- autocomplete is a distinct pattern that often fails if treated like normal typing
- selection from suggestions must be separated from text entry

What it should encode:

- type partial value
- wait for suggestions
- select explicit suggestion
- verify selected state rather than raw typed text

Target E2Es:

- `tests/e2e/autocomplete.test.ts`

### `pagination-collect-and-compare`

Why it is worth having:

- useful when comparisons depend on multiple paginated surfaces
- may be a specialization of `cross-tab-compare`, but worth promoting if traces support it

What it should encode:

- gather page N facts
- persist normalized notes before pagination
- continue until required comparison set is complete

Target E2Es:

- `tests/e2e/data-table.test.ts`
- `tests/e2e/continuation-paginated-memory.test.ts`

### `cart-modify-checkout`

Why it stays on the roadmap:

- still valuable, but should remain provisional until broader evidence exists

Roadmap stance:

- keep it active
- validate across more than one cart surface before treating it as fully mature

## Lab-Only Meta-Skills

These improve the harness-development loop rather than direct browser execution.

### `trace-pathology-analysis`

Purpose:

- read traces
- identify failure patterns
- generalize them into harness or skill problems

Why it matters:

- directly supports skill discovery and harness improvement

### `skill-candidate-mining`

Purpose:

- inspect recent traces
- cluster repeated workflow shapes or pathologies
- propose candidate skills with evidence

Why it matters:

- creates a repeatable intake path for new skills instead of ad hoc brainstorming

### `rfc-hypothesis-draft`

Purpose:

- convert trace evidence and research into a concrete change proposal

Why it matters:

- shortens the path from observed pathology to implementable design

## Prioritization

Recommended workflow-skill priority:

1. `structured-form-fill`
2. `transactional-act-check-act`
3. `cross-tab-compare`
4. `continuation-edit`
5. `hover-reveal-navigation`
6. `navigate-read-return`
7. `modal-overlay-recovery`
8. `autocomplete-select`
9. `pagination-collect-and-compare`
10. `cart-modify-checkout`

Note: Skills 1-7 are implemented and present. Skills 8-10 are candidates for future implementation.

Recommended lab meta-skill priority:

1. `trace-pathology-analysis`
2. `skill-candidate-mining`
3. `rfc-hypothesis-draft`

## Decision Rules

Promote a workflow into a product skill when:

- it appears repeatedly across traces or E2Es
- it has a stable multi-step structure
- it benefits from explicit evidence collection or verification
- it generalizes across more than one site or surface

Keep it out of product skills when:

- it is mostly site-specific
- it is better represented as a tool primitive
- it is really a harness policy rather than a workflow contract

Promote a pattern into a meta-skill when:

- it improves diagnosis, research, or skill discovery
- it is mainly useful to the lab rather than to end-user task execution
