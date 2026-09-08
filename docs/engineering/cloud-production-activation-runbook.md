# Cloud production activation runbook

This runbook separates the already-submitted 0.7.2 Cloud BYOK release from the
later cloud-session, portable-checkpoint, device-command, and Temporal work.
Chrome Web Store approval authorizes testing the shipped client; it does not
automatically enable any server write or orchestration capability.

## Invariants

- Local mode remains usable at every stage.
- The allowlist contains only named internal testers during acceptance.
- Server flags are enabled one capability at a time and never by deploying a
  different image solely to change a flag.
- A provider key remains local until its cloud copy verifies and the user
  explicitly activates it.
- Cloud-session, checkpoint, command, takeover, and Temporal flags remain off
  throughout the 0.7.2 acceptance sequence.
- A failed stage rolls back to the last verified stage before investigation.
- No production acceptance step uses synthetic success as evidence for a real
  provider, browser, identity redirect, cancellation, or revocation boundary.

## Evidence captured for every stage

Record the UTC time, deployed image digest, extension version and ID, tester
Cognito subject, enabled flags, request IDs, HTTP status classes, relevant
coarse metrics, rollback result, and operator. Never record provider keys,
tokens, prompts, page content, screenshots, account email, or response bodies.

## Gate 0: Web Store approval

1. Confirm the existing item `hakbnbbkiehiofnafdkcibbnkbdmjiha` reports
   version 0.7.2 as Published.
2. Install/update only from that item and confirm version 0.7.2 in
   `chrome://extensions`.
3. Confirm the published package requests `identity` and contains the expected
   Cognito domain and extension client ID.
4. Confirm the public Store listing and privacy policy describe optional Cloud
   mode, encrypted credentials, transient relay processing, account data, and
   synchronized safe preferences.

Stop if Chrome assigns a different extension ID, the version is not 0.7.2, or
the public disclosures are stale.

## Gate 1: authentication only

Expected flags:

```text
CLOUD_CONTROL_ENABLED=true
EXTENSION_AUTH_ENABLED=true
CREDENTIAL_WRITES_ENABLED=false
PREFERENCE_WRITES_ENABLED=false
RELAY_ENABLED=false
```

1. Sign in through Cognito PKCE from the published extension.
2. Verify account/device display, token refresh, extension restart recovery,
   explicit sign-out, and sign-in again.
3. Revoke the device from the account page and prove the next authenticated
   call fails; link it again for the remaining gates.
4. Confirm an unallowlisted account receives no Cloud capability.

Rollback disables `EXTENSION_AUTH_ENABLED` and verifies Local mode still starts.

## Gate 2: credential verification and storage

Enable `CREDENTIAL_WRITES_ENABLED` for the allowlisted tester only.

1. Upload one OpenRouter or Fireworks key through the migration UI.
2. Verify the provider accepts it and the account reports only fingerprint and
   verification status.
3. Confirm the original key remains in local storage before activation.
4. Restart the extension and verify both the verified cloud record and retained
   local key state remain coherent.
5. Delete the cloud credential and prove the local key still works directly.
6. Repeat upload, explicitly activate Cloud mode, then verify the local provider
   key is removed and is never returned by any account API.

Rollback disables credential writes. Existing encrypted records remain
deletable; Local mode requires the user to enter a local key again if it was
explicitly removed during activation.

## Gate 3: safe-preference synchronization

Enable `PREFERENCE_WRITES_ENABLED` while relay remains disabled.

1. Change provider/model, theme, maximum turns, and one presentation preference
   on device A; verify revisioned cloud state and import on device B.
2. Create a concurrent edit and prove stale `If-Match` receives a conflict
   instead of overwriting the winner.
3. Verify approvals, navigation/site restrictions, telemetry consent, personal
   profile, traces, diagnostics, authentication tokens, and session/checkpoint
   data never enter the preference document.
4. Disable synchronization and verify local settings continue independently.

Rollback disables preference writes; the last cloud preference document remains
readable/importable only according to the current product behavior.

## Gate 4: relay

Enable `RELAY_ENABLED` only after Gates 1-3 pass.

1. Run one real streamed request for each configured provider and verify first
   token, completion, model allowlist, and coarse usage accounting.
2. Abort a stream from the extension and prove upstream cancellation plus a
   terminal non-active request record.
3. Retry the same request ID and prove idempotent handling.
4. Exercise invalid model, invalid credential, provider 401/429/5xx, quota
   exhaustion, API restart, and network interruption.
5. Audit service logs and PostgreSQL for prompt, response, screenshot, tool,
   provider-key, authorization-header, and email canaries.
6. Disable the relay and prove Cloud mode fails closed without silently using a
   local key; switch explicitly to Local mode and prove direct operation.

Rollback sets `RELAY_ENABLED=false`, runs the public smoke test, and confirms
account/auth routes remain healthy.

## Gate 5: limited beta

After a 24-hour internal soak with no security, privacy, quota, cancellation, or
data-loss finding, re-enable the accepted stages for the named tester allowlist.
Do not broaden the allowlist until backup alarms, encrypted-object restore, KMS
failure behavior, and device revocation have each been observed successfully.

## Later cloud-session activation

The following capabilities are a separate release and remain disabled even when
all 0.7.2 gates pass:

```text
CLOUD_SESSIONS_ENABLED=false
CHECKPOINT_WRITES_ENABLED=false
CHECKPOINT_RESTORE_ENABLED=false
DEVICE_COMMANDS_ENABLED=false
DEVICE_TAKEOVER_ENABLED=false
TEMPORAL_SHADOW_ENABLED=false
TEMPORAL_COORDINATION_ENABLED=false
```

LP-32 did not pass the shared-host latency/isolation gate. Temporal shadow and
coordination therefore have no activation stage on this topology. PostgreSQL is
the only coordination authority. Reconsidering Temporal requires a new owner
decision and an isolated topology that repeats LP-32's failed gates.

Session capabilities require a separately reviewed extension release containing
the matching portable-checkpoint and device-protocol client. Web Store approval
of 0.7.2 alone is not authorization to begin these gates. Before every stage,
record the published extension version/ID, server image digest, migration
versions 003 and 004, tester subject/device IDs, starting database/object counts,
and the currently effective flag set.

Use `set-cloud-session-stage.sh` on the host. It changes only the session flags,
restarts with automatic environment rollback on failure, verifies health and the
effective stage, and always forces both Temporal flags off.

Session rollout has two independent server-side gates. The stage selects the
maximum available capability, while `CLOUD_SESSION_TESTER_SUBJECTS` selects the
specific Cognito subjects allowed to reach any session or device-coordination
route. It must be nonempty for every stage above `disabled` and must be a subset
of `CLOUD_TESTER_SUBJECTS`. After the environment change is applied by a service
restart, removing a subject from the general allowlist blocks its existing
bearer session and refresh token on the next request; removing it from the
session allowlist blocks session and device-coordination routes while leaving
accepted account capabilities available.

Before activating a real stage, populate the environment with Cognito subjects
(never email addresses), then preview the exact transition without restarting:

```sh
CLOUD_TESTER_SUBJECTS=<subject-a>,<subject-b>
CLOUD_SESSION_TESTER_SUBJECTS=<subject-a>
DRY_RUN=true /opt/opensidebar/infra/lightsail/set-cloud-session-stage.sh sessions
```

The preview is not authorization to activate. Review its output, confirm both
Temporal flags remain false, return to `disabled`, and record an owner go/no-go
decision before running the command without `DRY_RUN=true`.

The operator may inspect `/dashboard/activation` before that decision. This is
a read-only projection available only to `CLOUD_OPERATOR_SUBJECTS`; it reports
effective flags and the named-tester count but contains no mutation endpoint,
subject list, email list, secrets, session content, or activation button.

### Session Gate S0: disabled baseline

Run `set-cloud-session-stage.sh disabled`.

1. Prove every session, checkpoint, lease, and command route returns its
   capability-disabled response for an authenticated published client.
2. Prove local session execution, local checkpoints, Local BYOK, Cloud relay,
   account sign-out, credential deletion, and safe-preference import remain
   independent.
3. Record PostgreSQL/S3/KMS health and verify no Temporal container or public
   port exists.

Stop if disabled routes mutate a table/object, if Local mode changes behavior,
or if the server's effective flags differ from the environment.

### Session Gate S1: metadata and explicit creation

Run `set-cloud-session-stage.sh sessions` for one named tester.

1. Create a session only after explicit Cloud Sessions consent; repeat the same
   idempotency key and prove exactly one session exists.
2. List/get/update with ownership, cursor, `If-Match`, stale-revision, bounded
   metadata, and cross-account denial checks.
3. Restart the API and extension; prove metadata remains available while no
   checkpoint body or remote command exists.
4. Request deletion and prove the session cannot transition back to active.

Rollback to `disabled`. The tester must retain local history and account-level
delete access through the documented administrative recovery path.

### Session Gate S2: encrypted checkpoint writes

Confirm the dedicated session KMS key and checkpoint bucket are configured,
then run `set-cloud-session-stage.sh checkpoint-writes`.

1. Write and commit one portable checkpoint; replay intent/commit keys and prove
   one committed revision and one encrypted object.
2. Exercise lost response, stale parent, fork, digest mismatch, KMS denial, S3
   timeout, abandoned intent cleanup, and account/session ownership denial.
3. Scan PostgreSQL, object metadata, logs, errors, metrics, and backups for
   checkpoint plaintext, prompts, URLs, screenshots, credentials, cookies, and
   authorization headers.
4. Delete the session and prove its object cleanup is idempotent and retryable.

Rollback to `sessions`; existing committed checkpoints remain exportable and
deletable but no new checkpoint object may be written.

### Session Gate S3: same-device restore

Run `set-cloud-session-stage.sh checkpoint-restore`.

1. Restore on the originating device into `restored_paused`; verify the current
   page afresh and require explicit Continue before execution.
2. Exercise supported/unsupported schema, corrupt ciphertext, missing object,
   changed page, authentication-required page, stale browser references, pending
   approval, and outcome-unknown action cases.
3. Prove cookies, website login state, tab IDs, Chrome storage keys, prior
   approvals, and started-action authority are never restored.
4. Restart the extension and API during restore and prove the previous committed
   checkpoint remains readable.

Rollback to `checkpoint-writes`; metadata/export/delete and local restore remain
available, but cloud restore fails closed.

### Session Gate S4: same-device command delivery

Run `set-cloud-session-stage.sh commands`; takeover remains off.

1. Create a connection and lease, issue a content-free encrypted command, poll,
   acknowledge, journal locally before dispatch, start, and report one terminal
   result.
2. Exercise 25-device reconnect, duplicate polling/ack/result, expired command,
   stale generation, cancellation, device revocation, API restart, and lost
   response. Prove at most one browser dispatch attempt.
3. Measure reconnect-to-delivery p95 below five seconds while the Cloud API and
   Playground stay healthy with zero OOM/restart and no active swap thrashing.
4. Scan the command database, S3 objects, logs, errors, and metrics for action
   bodies and forbidden content.

Rollback to `checkpoint-restore`; revoke active leases, stop new commands, let
terminal journal records remain inspectable, and prove sessions/checkpoints are
still independently readable/deletable.

### Session Gate S5: explicit takeover

Run `set-cloud-session-stage.sh takeover` for two named tester devices.

1. Pause/checkpoint device A, explicitly approve takeover on device B, increment
   lease generation, revoke A, restore paused on B, re-ground, and require fresh
   approval before any consequential action.
2. Race old-device acknowledgement/result/cancel against the generation bump;
   prove every stale transition is rejected and only one active lease exists.
3. Exercise B disconnect and rollback; A must not silently regain authority.

Rollback to `commands` or `checkpoint-restore` depending on the finding. Never
repair a takeover by editing PostgreSQL rows.

### Session Gate S6: named-tester soak and release decision

Run at least 24 hours with one or two named testers. Require encrypted daily
backup plus isolated restore, deletion/export completion, KMS/S3 failure alarms,
zero privacy findings, zero duplicate effects, reconnect p95 below five seconds,
healthy Playground/API neighbors, at least 40% disk free, and no sustained swap
thrashing. Then record an owner release decision before widening the allowlist.

Any security, privacy, restore, deletion, duplicate-effect, latency, or neighbor
health failure returns to the last passing stage. Chrome Web Store approval does
not override these stop conditions.

## Review rejection or delayed approval

- Keep the current production flags at authentication-only or stricter.
- Do not activate credential writes or relay for an unpublished client.
- Address only the reviewer-requested permission, disclosure, or package issue;
  do not create a second Web Store item.
- Rebuild with the same stable extension identity, increment the patch version
  when the package changes, rerun release preflight, and resubmit.
