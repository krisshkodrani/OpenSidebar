# Skills Audit

Date: 2026-04-12
Scope: First-pass audit of the curated workflow skills against overfitting risk and real-world reuse
Overall result: 5 skills reviewed; 3 strong general candidates; 1 boundary-risk candidate; 1 higher overfitting-risk candidate

| Skill | Current status | Overfitting risk | Main risk | Strongest E2E targets | Notes |
|---|---|---|---|---|---|
| `continuation-edit` | Strong | Low | Could be misused for first-pass drafting | `continuation`, `continuation-cross-page-compose` | Real browser workflow; revision-specific |
| `cross-tab-compare` | Strong | Low | Could be overused for single-page reading | `continuation-cross-tab`, `continuation-paginated-memory` | Good workflow shape; evidence gathering is explicit |
| `structured-form-fill` | Strong | Low | Could overlap with continuation-edit on editable drafts | `multi-step-form`, `continuation-abandon-restart` | Real-world form discipline; very reusable |
| `transactional-act-check-act` | Viable but needs boundary discipline | Medium | Too easy to turn into a generic "hard task" skill | `continuation-act-check-act`, `continuation-verify` | Must stay tied to explicit act -> verify -> continue flows |
| `cart-modify-checkout` | Provisional | Medium-high | Shopping UIs vary widely; could overfit to fixture assumptions | `continuation-cart-swap`, `online-shop` | Keep it about cart-state correction, not one site layout |

## Audit Standard

A skill is too specific if it:

- depends on fixture wording
- assumes one exact layout
- hardcodes one site's sequence
- quietly encodes one test's object model

A skill is too vague if it:

- becomes a generic fallback for "hard tasks"
- duplicates baseline prompt guidance
- does not identify a clear workflow boundary

The target is workflow-specific but site-agnostic.

## Findings

### `continuation-edit`

- Good boundary: revise existing work while preserving prior constraints
- Real-world relevance is high
- Main guardrail needed: do not route first-pass drafting here

### `cross-tab-compare`

- Good boundary: gather facts from multiple locations before comparing
- Real-world relevance is high
- Main guardrail needed: avoid routing single-page summarization here

### `structured-form-fill`

- Good boundary: multi-field entry with submit-last discipline
- Real-world relevance is high
- Main guardrail needed: avoid using it for freeform drafting tasks

### `transactional-act-check-act`

- Useful pattern, but the boundary must remain narrow
- It should mean:
  - mutate once
  - verify state
  - continue only after verification
- It should not mean:
  - any difficult workflow
  - any multi-step task

### `cart-modify-checkout`

- Valid workflow class, but easiest to overfit
- It should remain about correcting or modifying existing cart state
- It should not assume:
  - full cart page instead of mini-cart
  - coupon before or after cart correction on every site
  - one canonical checkout structure

## Conclusions

- The current skills are not obviously fixture-cheating.
- Three are already shaped at a broadly reusable level:
  - `continuation-edit`
  - `cross-tab-compare`
  - `structured-form-fill`
- Two need closer evidence-based monitoring:
  - `transactional-act-check-act`
  - `cart-modify-checkout`

## Recommended Next Validation

1. Add `Skills used` to E2E reports.
2. Add a short skill-summary section to the dated E2E report.
3. Review failed traces grouped by `selectedSkillId`.
4. Promote skills only after they show value across multiple distinct task surfaces.
