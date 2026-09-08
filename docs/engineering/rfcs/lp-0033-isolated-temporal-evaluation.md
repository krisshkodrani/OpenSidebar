# LP-33: Isolated Temporal OSS evaluation on a $7 Lightsail host

Date: 2026-08-09

## Goal

Evaluate whether the already validated Temporal OSS coordination model can run
on a separate 1-GB Lightsail instance without affecting the authoritative
OpenSidebar application host. The isolated host runs Temporal Server, its Node
worker, and dedicated PostgreSQL persistence. The experiment is shadow-only.

The application records content-free coordination events in a transactional
outbox. The isolated worker polls an authenticated internal HTTPS endpoint,
claims events idempotently, and is the only product process that connects to
Temporal. Temporal failure never blocks an authoritative request.

## Boundaries and rollout

- PostgreSQL/S3 and LP-29 through LP-31 remain authoritative.
- Temporal receives only opaque UUIDs, revisions, deadlines, timestamps, and
  closed event/status codes.
- No Temporal, PostgreSQL, admin, or UI port is public.
- Start with synthetic fixtures, then internal shadow traffic, then at most five
  named testers behind a server allowlist and a kill switch.
- The $7 topology is rejected on any privacy, replay, recovery, isolation,
  latency, disk, sustained-swap, OOM, or CPU-credit gate failure. Failure does
  not authorize a shared database or a larger server.

## Acceptance gates

Repeat LP-32's privacy, replay, restart, stuck-operation, backup/restore, and
corrected 25-device fixtures. Require reconnect-to-delivery p95 below five
seconds; physical memory below 85% with at least 150 MiB continuously available;
no OOM, restart, or sustained swap-out; at least 40% disk free; no application,
Celery, Playground, or authoritative-database health regression; and a seven-day
five-tester shadow soak before recommending adoption.

## Decision

Status: Parked

Chosen path:

- Retain the isolated deployment, spike implementation, and failed-gate evidence
  as research material.
- Continue with the existing PostgreSQL state machine as the only authoritative
  coordination implementation.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Reconsider Temporal only after measured PostgreSQL limitations justify a new
  owner-stamped RFC and separately budgeted topology.

Do not do:

- Do not provision another Temporal host, expose or enable Temporal, run shadow
  tester traffic, or make Temporal authoritative under this decision.

Evidence required before merge:

- The retained LP-33 report must record the failed latency and memory gates and
  deletion of the isolated host.

Next action:

- Archive
