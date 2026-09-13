# Portable checkpoint restore milestone report

Date: 2026-08-09  
Result: **Implemented and verified behind disabled feature flags.**

## Delivered

- A closed, bounded validator rejects Chrome identifiers, DOM and selector
  state, credentials, cookies, headers, tokens, approval grants, and unknown
  nested fields.
- Schema v1 and the immediately previous closed schema are supported. Previous
  checkpoints migrate in memory; newer and runtime-incompatible payloads remain
  read-only.
- Checkpoints save locally before cloud upload. Cloud failure preserves the
  validated local copy.
- Authenticated listing, checkpoint selection, download, validation, and
  restore run in the background. The sidepanel calls neither checkpoint APIs
  nor Chrome directly.
- Restore creates new workspace and run IDs, freshly observes the selected page,
  invalidates historical element references, and presents a paused preview.
- Matching, changed, unavailable, unauthorized, logged-out, and navigated-after-
  preview states fail or warn closed. Unavailable and unauthorized pages cannot
  Continue; a page change after preview requires a new preview.
- Continue is the sole transition to execution. Historical approval is invalid,
  and an outcome-unknown action requires the user to explain what happened
  before execution.
- Continue binds the current tab to the exact new workspace, switches the
  sidepanel to it, and starts the orchestrator with the preallocated run ID and
  bounded checkpoint context.

## Verification

- Portable restore/checkpoint/cloud adapter focused suite: 19 passing tests,
  plus a sidepanel paused-preview/Continue interaction test.
- Shared authenticated cloud client and sidepanel client: 13 passing tests.
- Full extension Vitest suite passed.
- Cloud service suite: 52 passed; two optional real-PostgreSQL tests skipped.
- Extension and shared-types typechecks passed.
- Production and E2E extension bundles passed.
- A real Chrome/MV3 test proved list, prepare, and Continue are rejected by the
  disabled production gate and cause no page effect.
- Changed files pass ESLint with no errors and `git diff --check`.

## Feature state

Extension restore requires both `VITE_CLOUD_SESSIONS_ENABLED=true` and
`VITE_CHECKPOINT_RESTORE_ENABLED=true`; neither is set in production or E2E
configuration. Lightsail Compose defaults every LP-29 through LP-33 flag to
false. The latest host durability report independently asserts all eight cloud-
session, device, and Temporal flags false.

No cloud-session feature was activated as part of this milestone.
