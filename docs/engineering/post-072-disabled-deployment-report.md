# Post-0.7.2 disabled cloud deployment report

Date: 2026-08-11

Status: production deployment verified with cloud-session, checkpoint, device-command,
export, and Temporal capabilities disabled.

## Released client baseline

- Chrome Web Store item: `hakbnbbkiehiofnafdkcibbnkbdmjiha`
- Published version confirmed by the owner: `0.7.2`
- Repository manifest/package version: `0.7.2`
- The extension manifest includes `identity`; the client pins the production
  `opensidebar.com` API origin and derives the Chromium identity callback from
  the installed extension identity.

## Deployment baseline

- AWS account: `534344665432`, operator role session `aipoweredapps-admin`
- Lightsail instance: `playscenario-launch-small`, `small_3_0`, Frankfurt
- Previous image: `opensidebar-cloud-service:postgres-durability-20260809-final`
- Deployed image: `opensidebar-cloud-service:dashboard-disabled-20260811`
- Deployed image ID: `sha256:82bbbe2465bdbbbed95179adf64cafde08967c109bfa692f6719ddf2229792c4`
- Control migration: `2`; session migration: `7`
- Pre- and post-deployment session/checkpoint/device/lease/command/job row counts: zero
- Daily and weekly backup timers: enabled; the 2026-08-11 encrypted daily backup
  was present before deployment.

## Verification

- Cloud service tests: 60 passed, two PostgreSQL-only tests skipped locally.
- Extension cloud/session focused tests: 65 passed.
- Cloud service typecheck/build and dashboard typecheck/build passed.
- Candidate image passed the isolated disabled-control readiness smoke before
  replacing the live image.
- Live isolated restore passed without modifying the production database.
- PostgreSQL durability passed with two simulated browser profiles,
  lease-generation fencing, takeover, dump, and isolated restore.
- Public dashboard, sessions, activation, API health, Control Center bundle,
  target bundle, and target host returned HTTP 200.
- The complete public Playground run/command/one-time-launch/target-action/
  result/delete lifecycle passed after deployment.
- A routing defect found during acceptance was corrected: the apex CloudFront
  API origin policy now forwards the reviewed `Authorization` and `If-Match`
  headers. Authenticated `/account` and `/dashboard/summary` requests then
  returned 200 through `opensidebar.com`.
- An authenticated `/api/v1/sessions` request returned 403 with
  `cloud_session_access_not_enabled`, proving the deployed session path remains
  closed to the general tester allowlist.
- An authenticated relay request returned 503 with `relay_disabled` through
  both the apex and direct origin. Provider/local-mode regression tests passed
  73 assertions, preserving explicit Local BYOK behavior while relay is off.
- Post-deployment: API healthy, restart count zero, no OOM, no recent fatal log
  patterns, and no failed OpenSidebar systemd unit.

## Effective production flags

```text
CLOUD_CONTROL_ENABLED=true
EXTENSION_AUTH_ENABLED=true
CREDENTIAL_WRITES_ENABLED=false
PREFERENCE_WRITES_ENABLED=false
RELAY_ENABLED=false
CLOUD_SESSIONS_ENABLED=false
CHECKPOINT_WRITES_ENABLED=false
CHECKPOINT_RESTORE_ENABLED=false
SESSION_EXPORTS_ENABLED=false
DEVICE_COMMANDS_ENABLED=false
DEVICE_TAKEOVER_ENABLED=false
TEMPORAL_SHADOW_ENABLED=false
TEMPORAL_COORDINATION_ENABLED=false
```

The general cloud tester allowlist contains one subject. The dedicated session
tester and dashboard operator allowlists are empty. No named tester was activated
for cloud sessions by this deployment.

## Resource snapshot

- API memory: about 36 MiB of its 256 MiB limit.
- PostgreSQL memory: about 104 MiB of its 768 MiB limit.
- Host available memory: about 993 MiB.
- Root disk: 55% used, 26 GiB available.
- Swap had historical occupancy, but the deployment showed no OOM or restart;
  sustained swap activity remains a named-tester soak gate.

## Known repository-wide gate

The focused cloud/dashboard verification is green. The repository-wide lint
command remains blocked by pre-existing decomposition-ratchet excess in three
dirty extension files: `background/llm/client.ts`, `background/agent/loop.ts`,
and `background/orchestrator/index.ts`. This deployment did not modify those
budgets or claim that the full repository lint gate passed.
