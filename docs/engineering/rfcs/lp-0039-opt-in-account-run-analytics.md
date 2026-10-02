# LP-39: Opt-in account run analytics

Status: Approved by the owner on 2026-09-29.

## Context

The extension already computes per-session tokens and spend for its local run UI.
The cloud account currently shows relay request quota and remote mission lifecycle
metadata. Those are different measurements. A useful account view needs to show
observed run activity and cost without uploading browsing content or silently
turning an unknown provider cost into zero.

This proposal is separate from fleet telemetry (LP-25), cloud session storage
(LP-29), and remote mission progress. It applies to newly observed runs only.

## Proposed contract

- Analytics is off by default. The signed-in account owner enables it in Settings.
  Enabling affects new run observations only. No historic local run scan or backfill.
- A versioned, bounded per-run snapshot may contain opaque run and device IDs,
  start/update/finish times, lifecycle state, configured provider and a model
  identifier only when one model is known, token
  counts, and USD spend with provenance (`provider_reported`, `estimated`, or
  `unknown`). A measured zero is distinct from `unknown`.
- It must not contain task instructions, messages, page titles, URLs, domains,
  screenshots, DOM content, tool output, raw traces, or arbitrary metadata.
- The authenticated service derives the account and device identity from the
  session, validates the full schema, and accepts monotonic sequence numbers so
  retries cannot replace newer data. It bounds request size and field lengths.
- During a remote mission, the extension may submit an observed provisional
  snapshot about every 15 seconds while connected. The terminal snapshot
  reconciles the final state and spend. A stale provisional estimate is labeled
  as such, never silently shown as final.
- Account analytics are retained for at most 90 days. A daily cleanup removes
  expired rows. Opt-out deletes existing synced rows and prevents future writes.
  The account UI explains that local session history is managed separately.
- The UI separates model spend from OpenSidebar relay quota. It shows the
  observation source, the last update time, and `Unknown` where cost data is
  unavailable. Totals exclude unknown spend and state coverage explicitly.

## Proposed verification

- Schema tests reject content fields, oversized payloads, non-finite/negative
  costs, and unknown enum values.
- API tests prove default-off behavior, account/device scoping, monotonic
  upsert, concurrent opt-out/write safety, 90-day expiry, and deletion.
- Extension tests prove no upload before consent, no backfill after opt-in,
  provisional updates for active remote runs, and terminal reconciliation.
- UI tests prove unknown versus measured zero, provisional versus final, and
  relay quota versus model spend labels.
- Manual network inspection confirms a real test run uploads only the allowlist.

## Decision

Status: Approved

Chosen path:

- Implement the opt-in, metadata-only account analytics contract described above
  for new run observations, with 90-day retention and deletion on opt-out.
- Distinguish provider-reported, estimated, and unknown model spend, and label
  active remote-mission snapshots as provisional until terminal reconciliation.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Owner decision on 2026-10-02: merge PR #188 with manual testing pending.
  Complete real-run analytics payload inspection and PostgreSQL acceptance
  (account/device scoping, monotonic writes, concurrent opt-out/write safety,
  retention, and deletion) before Chrome Web Store release.

Do not do:

- Do not backfill historic runs, upload page/task/trace content, silently collect
  before consent, or treat missing spend as measured zero.
- Do not combine model spend with relay request quota.

Evidence required before merge:

- Schema, API, extension, and UI tests listed under Proposed verification.
- Owner waived outstanding real-run payload inspection and PostgreSQL
  acceptance as merge gates on 2026-10-02, opting to test manually after merge.
  These checks remain required before Chrome Web Store release.

Next action:

- Implement
