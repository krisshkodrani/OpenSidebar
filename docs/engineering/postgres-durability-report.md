# PostgreSQL durability milestone report

Date: 2026-08-09  
Host: Lightsail `playscenario-launch-small`, `small_3_0`, 2 GB RAM, Frankfurt  
Result: **Pass for disabled named-tester foundation.**

## Implemented

- PostgreSQL-backed export and deletion job ledger with atomic idempotent enqueue,
  stale-claim recovery, bounded exponential retry, and closed error codes.
- Thirty-day unpinned `cloud_checkpointed` retention advances expired sessions
  to `deleting` and durably queues physical deletion.
- Deletion removes every checkpoint/export object version before deleting the
  session metadata and keeps a completed job receipt.
- Export copies the checksum-verified KMS-envelope-encrypted latest checkpoint
  to a private one-time artifact and expires it after 24 hours.
- Abandoned upload objects are removed after 30 minutes. Superseded checkpoints
  older than seven days are removed while preserving the latest and immediately
  previous revisions.
- Export request/status APIs have an independent `SESSION_EXPORTS_ENABLED` kill
  switch and remain disabled in production.

## Verification

- Local cloud-service suite: 51 passed, two optional real-PostgreSQL tests
  skipped without `PLAYGROUND_TEST_DATABASE_URL`; typecheck and production
  bundles passed.
- The candidate migrated the live database through session schema version 7.
- The configured encrypted daily backup unit completed with result `success`.
- The shared restore drill restored Playground, control, session, checkpoint,
  and job schemas into `opensidebar_restore` without changing the live database.
- The isolated durability drill created one session for two independent device
  identities, rejected the concurrent second lease, completed explicit takeover
  from generation 1 to 2, fenced the old device, dumped the source database, and
  restored one session, two devices, and two lease rows into a second isolated
  database. Both drill databases were removed afterward.
- Final image `opensidebar-cloud-service:postgres-durability-20260809-final` is
  healthy on the `$12` host.

## Feature state

`CLOUD_SESSIONS_ENABLED`, `CHECKPOINT_WRITES_ENABLED`,
`CHECKPOINT_RESTORE_ENABLED`, `SESSION_EXPORTS_ENABLED`,
`DEVICE_COMMANDS_ENABLED`, `DEVICE_TAKEOVER_ENABLED`,
`TEMPORAL_SHADOW_ENABLED`, and `TEMPORAL_COORDINATION_ENABLED` were individually
asserted `false` after the final deployment.
