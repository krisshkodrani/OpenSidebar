# Device reconnect and handoff milestone report

Date: 2026-08-10  
Result: **Product, real-browser, and exact-host PostgreSQL acceptance passed behind disabled flags.**

## Delivered

- Added an authenticated device-coordination port for connection creation,
  lease reads/acquisition, same-device reconnect, heartbeat, and explicit
  takeover.
- Added a generation-checked `lease/reconnect` mutation. A newly created
  connection can replace the prior connection only for the same authenticated
  device, session, lease, and generation while the lease remains inside its
  active/grace window.
- Added an extension reconnect controller that recovers PostgreSQL truth,
  processes commands in sequence, and advances its local sequence only after a
  command is safely reconciled.
- Added durable attempt reconciliation: a command accepted but not started can
  resume after fresh validation; a command recorded as started is observed and
  never blindly dispatched again; terminal outcomes replay idempotently.
- Added explicit takeover handling. A second device cannot take over without a
  confirmation call, generation increments fence the old device, and the new
  device remains paused for checkpoint restore, re-grounding, and fresh
  approval.
- Added a persistent takeover safety gate armed before the server mutation. It
  survives extension-worker restart and cannot clear until the returned
  takeover generation matches an explicit Continue.
- Wired the published extension client to the reconnect controller. The cloud
  sessions panel now offers same-device reconnect and an explicit cross-device
  takeover confirmation that identifies the prior device and explains that
  website login state and tabs do not transfer.
- Takeover always enters the existing freshly observed, paused restore preview.
  The persistent fence is cleared only after the preview is still current and
  the user presses Continue, and before task execution begins.
- Added bounded command policies for `read_current_page` and reversible
  `type_text`. Text entry requires an authorized current origin, fresh snapshot,
  exactly one semantic target, a non-password editable field, no Enter/submit,
  and visible value read-back.
- Added semantic click commands, including sensitive clicks, behind a separate
  local approval handshake. A click requires exactly one actionable target, an
  initially unmet closed postcondition, an opaque digest-bound approval stored
  only in `chrome.storage.session`, and fresh post-action evidence. Approval is
  one-shot and expires within two minutes or when the command/cloud approval
  expires. Ambiguous targets, unobservable effects, non-click sensitive writes,
  origin mismatches, and malformed/internal page URLs remain deferred.

## Verification

- Focused reconnect, restore-safety, command-policy, and side-panel suites pass,
  including stale approval and interrupted-write recovery coverage.
- Cloud service suite: 52 passing tests; two optional PostgreSQL tests skipped
  because `PLAYGROUND_TEST_DATABASE_URL` was unavailable.
- Full extension Vitest suite passed.
- Extension and cloud-service typechecks passed.
- Production and E2E extension builds passed; the cloud-service bundle passed.
- Targeted ESLint passed with no errors or warnings after cleanup.
- The decomposition ratchet and `git diff --check` passed.
- A real Chrome/MV3 E2E launched two isolated extension browser profiles against
  a local production-shaped API. It proved:
  - same-profile service-worker restart preserves local storage;
  - a new connection rebinds the same lease without changing generation;
  - the replaced connection can no longer heartbeat;
  - profile B explicitly takes over at generation 2;
  - profile A is rejected after takeover; and
  - extension-local storage is isolated between profiles.
- Packaged-extension E2E passed for both the two-profile takeover path and the
  production disabled-gate path. The latter proves reconnect, takeover,
  restore, and Continue messages are rejected without page effects.
- A real Chrome E2E invokes the production command policy against an HTTP form
  and proves unique semantic resolution, text entry, and value verification
  without Enter or submission.
- The exact `$12` Lightsail host ran the candidate through the existing isolated
  durability drill. It proved same-device reconnect at generation 1, rejection
  of the replaced connection, concurrent-acquire rejection, takeover to
  generation 2, old-device fencing, and dump/restore into a second isolated
  database. The drill reported `liveDatabaseModified:false`.
- Both drill databases and the temporary candidate image/context were removed.
  The live API remained healthy and all eight session/device/Temporal flags
  were independently read back as `false`.

## Remaining product work

- Deploying a reviewed release image and activating any session/device
  flag require the later staged activation procedure. Neither occurred here.
- Non-click sensitive writes remain intentionally unsupported. Read, reversible
  text entry, and guarded reversible/sensitive clicks are implemented; staged
  named-tester activation remains a separate reviewed operation.

## Feature state

`CLOUD_SESSIONS_ENABLED`, `CHECKPOINT_WRITES_ENABLED`,
`CHECKPOINT_RESTORE_ENABLED`, `SESSION_EXPORTS_ENABLED`,
`DEVICE_COMMANDS_ENABLED`, `DEVICE_TAKEOVER_ENABLED`,
`TEMPORAL_SHADOW_ENABLED`, and `TEMPORAL_COORDINATION_ENABLED` remain disabled
on the Lightsail host. Temporal remains absent and non-authoritative.
