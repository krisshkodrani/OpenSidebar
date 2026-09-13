# Public Playground fixture rollout

The public `/app/playground` page uses twelve curated scenarios from the shared
ModelBench engine. The public IDs remain stable; their tasks and application
state come from the shared, versioned case definitions. The other benchmark
cases remain internal.

## Public behavior

- Sign in, create a run, copy its suggested task, and open the simulated application.
- Runs are account-owned, expire after two hours, and share the existing daily
  quota of 25 creations and limit of three active runs.
- Interactive tasks report their deterministic page-state result. Read-only tasks
  do not collect or grade agent answers. Public APIs reject arbitrary prompts,
  model identities, answers and trace payloads.
- Opening another run replaces the browser's active target session. An older
  target tab must be reopened from Playground; it cannot mutate the new run.
- Public operational state lives in `playground.scenario_*_v2`, separately from
  internal benchmark attempts and telemetry. Target responses contain only the
  shared engine's application projection.

## Deployment order

This change does not activate itself. Both feature flags default to false.
The owner approved a separate public Playground release in
[LP-36](rfcs/lp-0036-modelbench-100.md#decision) on 2026-09-13. Its merge gate is
the public fixture, privacy, browser and CI evidence. Snapshot, drain, deployment
smoke and rollback checks still precede public activation. The three full
reference baselines remain required for the full ModelBench harness cutover.

1. Record the current service image, database backup, CloudFront configuration
   and versioned control/target HTML and assets for rollback.
2. Deploy the API and additive migration `021_public_scenarios.sql` with
   `PLAYGROUND_MAINTENANCE=true` and `PLAYGROUND_V2_ENABLED=false`. Confirm old
   run creation returns 503 while existing target runs still work.
3. Wait for the existing two-hour run window to drain. Confirm there are no live
   v1 runs (`expires_at > now()` and `lifecycle <> 'expired'`). Do not shorten
   existing runs to accelerate the transition.
4. Apply the updated Lightsail proxy configuration and run
   `scripts/attach-lightsail-origin.mjs` with the existing deployment variables.
   The control distribution needs `/api/v2/playground/*`; the target distribution
   needs `/api/v2/playground-target/*`, `/scenario/launch/*`, and the host-only
   `__Host-os_scenario_target` cookie. Keep account cookies off the target policy.
5. Build and deploy the Playground assets using `scripts/deploy-sandbox.mjs`.
   Its boundary check follows every target script's manifest dependency closure.
   Public target HTML is published at `/scenario/index.html`. Immutable assets
   are retained for open tabs and rollback; asset removal is a separate operation
   after the rollback window.
6. Enable `PLAYGROUND_V2_ENABLED=true`, then set `PLAYGROUND_MAINTENANCE=false`.
   Verify a signed-in public account sees exactly twelve scenarios, can create
   and remove a private run, and can launch and complete an interactive fixture.
   Check a read-only fixture, expiry, owner isolation and an old target tab after
   opening a different run. Confirm the production control and target hosts load
   their separate asset/API paths.

## Rollback

Set maintenance true first. Retain the additive tables and target routes so v2
tabs can drain. Restore the recorded control/target HTML, service image and
CloudFront configuration only in the rehearsed order; restoring an older
service before v2 sessions drain ends those sessions. Use the database snapshot
only if required, accounting for subsequent account activity. Re-enable v1
creation only after the drained state and restored routes have been verified.

Do not remove the legacy implementation as part of this public-page connection.
Its removal remains part of LP-36's acceptance-gated harness cutover.
