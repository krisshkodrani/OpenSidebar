# RFC LP-10 — New-Element Diff Marking in the Element List

Lifecycle status: Decision stamped
Date: 2026-07-04
Decision date: 2026-07-04 (owner accepted the recommended decisions for the LP-9…LP-14 series in session)
Scope: `content/tagging/` (stable-ids already track cross-refresh identity), element-list formatting in `background/perception/perception.ts` grounding lines + agent context, one prompt-line addition, unit tests
Related: Perception SOTA audit (2026-07-04); browser-use serializer (`*[` convention); stable FNV-1a ID system (already shipped)

## Problem

The executor receives a full element list every turn but nothing tells it
*what changed* since its last action. After a click opens a dropdown or a
form reveals a validation error, the new elements are visually identical in
the list to the 200 pre-existing ones. The model must re-read everything or
guess — a known source of wasted turns and missed state changes.

The field's converged solution (browser-use mainline) is to set-diff element
identity across steps and prefix elements that are new since the last step
with `*`, with one system-prompt line explaining the convention. We are
unusually well positioned: our FNV-1a stable IDs already persist across
refreshes precisely so identity survives — the diff is a set operation we
already have the inputs for, where browser-use had to build CDP
backendNodeId tracking to get the same signal.

## Proposal

1. In the tagging pipeline, keep the previous snapshot's stable-hash set
   (already retained one refresh for the ID grace period). Mark each tagged
   element `isNew = !previousHashes.has(hash)` on the first snapshot after a
   DOM-modifying action; never mark on pure re-reads.
2. Element list rendering prefixes new elements: `*[42] button "Submit"`.
   Cap: if >50% of elements are new (navigation), suppress marking — a fully
   new page needs no diff noise (matches the URL-change perception
   invalidation boundary).
3. One line in the agent system prompt ("Elements prefixed `*` appeared
   since your last action — they are usually the result of it.") and one in
   the perception prompt's CHANGES section guidance.
4. Trace the count of new elements per turn (cheap progress signal; also
   useful evidence for the completion kernel later — out of scope here).

## Risks

- Prompt-length: one character per new element; negligible.
- False "new" marks when the 1000-element cap or 25 ms clickable-scan budget
  truncates differently across snapshots — mitigate by only diffing within
  elements that appear in both snapshots' capped sets, and suppressing marks
  when overflow metadata changed.
- Executor over-anchoring on `*` (clicking new elements reflexively) —
  covered by the prompt line's neutral phrasing; watch e2e traces.

## Verification

- Unit tests: dropdown-open fixture (new options marked), navigation
  (marking suppressed), truncation stability.
- E2E spot-check on multi-step-form and online-shop suites: no regressions,
  trace shows sane new-element counts.
- `pnpm run verify` green.

## Decision

Status: Approved

Chosen path:

- Set-diff stable hashes across snapshots after DOM-modifying actions; mark
  new elements with a `*` prefix in the element list; suppress marking when
  >50% of elements are new or overflow metadata changed; one explanatory
  line in the agent and perception prompts; per-turn new-element count in
  traces.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Feeding the new-element count to the completion kernel as evidence.

Do not do:

- No marking on pure re-reads; no diffing across navigation boundaries.

Evidence required before merge:

- Unit tests (dropdown fixture marks, navigation suppression, truncation
  stability); e2e spot-check on multi-step-form and online-shop suites;
  verify green.

Next action:

- Implement
