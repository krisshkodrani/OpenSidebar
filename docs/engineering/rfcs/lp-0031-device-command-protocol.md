# LP-31: Device reconnect and browser-command protocol

Status: Approved with edits. Owner Decision Stamp recorded 2026-08-08.

## Summary

Define an authenticated, lease-based protocol between the cloud session service
and an intermittently available Chrome extension. The protocol must tolerate
Manifest V3 worker suspension, network loss, response loss, duplicate delivery,
device revocation, and explicit cross-device takeover without producing an
unauthorized duplicate browser effect.

This RFC does not move browser tools to the cloud. The extension remains the
only component that can observe and act on the user's browser, and current local
safety policy remains authoritative. LP-32 may later drive this protocol through
Temporal, but the wire contract and exactly-once authorization rules remain
independent.

## Goals

- Resume delivery after extension/service-worker/network interruption.
- Ensure one authorized execution attempt for non-idempotent browser actions.
- Make uncertain outcomes explicit instead of retrying optimistically.
- Support device registration, revocation, same-device reconnect, and explicit
  cross-device takeover.
- Preserve extension and overlay/headless runtime boundaries through ports.

## Non-goals

- Exactly-once effects on arbitrary third-party websites; many sites provide no
  idempotency primitive. The protocol guarantees exactly one OpenSidebar
  authorization/execution attempt and honest unknown-state handling.
- Remote browser control without a signed-in, connected extension.
- Background execution on a device the user has not selected.
- Synchronizing cookies, profiles, tabs, or website authentication.
- Treating network acknowledgment as proof of a browser-visible result.

## Identities

```ts
type SessionId = string; // server UUID
type DeviceId = string; // random per installation, server registered
type ConnectionId = string; // random per live transport connection
type LeaseId = string; // server UUID for one active session-device lease
type CommandId = string; // server UUID, immutable command identity
type AttemptId = string; // UUID for one extension execution attempt
type IdempotencyKey = string; // caller-generated mutation dedupe key
```

`DeviceId` is account-scoped control-plane data and must never enter LP-25 fleet
telemetry. It is stored locally in extension-local storage and cannot be used as
a secret. Authentication comes from the LP-28 access token. A registration
record contains account ID, device ID, user-chosen display name, extension and
browser versions, created/last-seen timestamps, revocation time, and public
notification capability flags. It contains no browsing history or stable
hardware fingerprint.

## Device registration and sessions

After LP-28 authentication, the extension calls:

```text
POST   /v1/devices
GET    /v1/devices
PATCH  /v1/devices/{deviceId}
DELETE /v1/devices/{deviceId}
POST   /v1/devices/{deviceId}/connections
```

Registration is idempotent for the locally stored device ID. The server may
rotate a compromised/revoked ID but never silently un-revokes it. Device delete
revokes current connections, leases, and refresh capability for that device;
the underlying Cognito session/token revocation path is invoked as well.

Only one active execution lease exists per cloud session. Multiple devices may
view metadata, but only the leased device can accept commands or write execution
checkpoints.

## Transport

Use authenticated Server-Sent Events from the Lightsail service for
server-to-extension delivery and HTTPS mutations for acknowledgements,
heartbeats, and results. Caddy must disable buffering and response caching for
the event route. This is simpler to operate on the single host than a separate
WebSocket gateway while preserving the same semantic contract:

- server-to-extension notifications contain no provider credentials and only
  the command data necessary for the selected browser action;
- extension-to-server mutations use HTTPS with the same access token, device
  ID, connection ID, and lease proof;
- access-token refresh and reconnect do not change command identity;
- heartbeat interval defaults to 25 seconds while a cloud session is active;
  MV3 suspension is expected and does not equal cancellation;
- after 75 seconds without heartbeat the connection is offline, but its lease
  is not immediately reassigned;
- payload/body logging and socket frame tracing are disabled.

Lease, connection, command, acknowledgement, and idempotency state is stored in
PostgreSQL. SSE is only a wake-up/delivery mechanism; reconnect always recovers
truth from PostgreSQL, so losing an in-memory connection cannot lose a command.

The sidepanel never opens this transport directly. A background
`CloudSessionTransportPort` owns it; the UI uses runtime messages through
`sidepanel/runtime.ts`. Overlay/headless tests supply an in-memory port.

### Transport qualification gate

SSE is not the default merely because it works in a foreground browser. Before
the first device-command implementation, a production-shaped probe must run
through the real Caddy route and demonstrate all of the following with a
controllable clock and duplicate injector:

- foreground delivery and ordered reconnect using `Last-Event-ID`;
- MV3 service-worker suspension for 1, 5, and 15 minutes;
- access-token expiry and refresh while disconnected;
- Caddy and API-container restart during delivery;
- duplicate and out-of-order frames without duplicate command acceptance;
- 25 concurrently connected synthetic devices while Playground polling and a
  relay stub run on the same host;
- bounded reconnect backoff with no tight loop or permanent worker keepalive.

The pass condition is zero lost durable commands, zero duplicate dispatches,
and p95 reconnect-to-delivery below five seconds while whole-host resource
thresholds remain inside LP-32's limits. If any suspension/restart case fails,
v1 uses bounded HTTPS long polling (`GET .../commands?after=&wait=25`) with the
same sequence contract. WebSockets remain out of scope without a new Decision
Stamp.

## Session-device lease

```ts
interface SessionLeaseV1 {
  schemaVersion: 1;
  sessionId: SessionId;
  leaseId: LeaseId;
  deviceId: DeviceId;
  generation: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  checkpointRevision: number;
  state: "active" | "grace" | "revoked" | "expired";
}
```

- Acquisition requires current session revision and explicit user selection on
  that device.
- Lease duration is 90 seconds and renews with heartbeat while connected.
- Offline leases enter `grace` for five minutes to favor same-device reconnect
  and avoid accidental takeover.
- During grace, no new command is issued; an already-started attempt may report
  its result.
- Cross-device takeover before grace expiry requires explicit confirmation on
  the new device. The server increments `generation`, revokes the old lease, and
  requires LP-30 re-grounding before any command.
- A message with an old lease ID/generation may report diagnostic late arrival
  but cannot mutate session state or commit an execution result.

## Command contract

```ts
interface BrowserCommandV1 {
  schemaVersion: 1;
  sessionId: SessionId;
  commandId: CommandId;
  leaseId: LeaseId;
  leaseGeneration: number;
  checkpointRevision: number;
  createdAt: string;
  expiresAt: string;
  action: PortableBrowserActionV1;
  preconditions: BrowserPreconditionV1[];
  risk: "read" | "reversible_write" | "sensitive_write";
  approval?: {
    approvalId: string;
    approvedAt: string;
    expiresAt: string;
    actionDigest: string;
  };
}
```

`PortableBrowserActionV1` uses the existing reusable tool vocabulary but cannot
contain tab IDs, frame IDs, Chrome storage keys, credentials, cookies, arbitrary
request headers, or a persisted DOM element ID as sufficient targeting. Commands
that act on page elements include a semantic target description; the device
must resolve it against a fresh observation and may reject ambiguity.

`actionDigest` binds approval to canonical action, target description, page
origin, and checkpoint revision. Any material change invalidates approval.

## Command state machine

```text
pending
  -> leased
  -> delivered
  -> accepted
  -> started
  -> succeeded
  -> failed

pending|leased|delivered -> expired
pending|leased|delivered|accepted -> cancelled
started -> succeeded|failed|outcome_unknown
```

State transitions are monotonic and conditionally written against command,
lease generation, and prior state. Terminal states never transition. The server
stores command metadata and compact outcome classification, not raw page data or
tool results; continuation evidence belongs in the encrypted LP-30 checkpoint.

Definitions:

- `delivered`: transport handed the command to the device; not execution proof.
- `accepted`: device validated account/session/lease/revision/expiry/schema and
  local policy, then durably recorded the command locally.
- `started`: device atomically wrote an `AttemptRecord` before invoking the
  browser action.
- `succeeded`: fresh read-back proves intended state.
- `failed`: action did not achieve its effect and direct evidence permits a safe
  retry/re-plan.
- `outcome_unknown`: an effect may have happened but cannot be proven after
  interruption; never automatically retry sensitive or irreversible actions.

## Device execution journal

Before acting, the extension stores locally:

```ts
interface AttemptRecordV1 {
  commandId: string;
  attemptId: string;
  actionDigest: string;
  leaseGeneration: number;
  checkpointRevision: number;
  state:
    | "accepted"
    | "started"
    | "observed_succeeded"
    | "observed_failed"
    | "unknown";
  updatedAt: number;
}
```

This journal uses the background persistence port and survives service-worker
suspension. Receiving a duplicate command:

- no record: validate and accept normally;
- `accepted` but not `started`: resume the same attempt after revalidating page
  and approval;
- `started`: observe current state first; do not dispatch again;
- terminal observed state: return the same classification idempotently;
- digest/revision/generation mismatch: reject as conflict.

The journal is bounded by terminal age/count and deleted with local session data.
It never stores credentials or full action inputs beyond the canonical digest
and the minimum user-visible summary needed for recovery.

## Preconditions and act-check-act

Every command validates immediately before dispatch:

- current lease and generation;
- checkpoint revision;
- local safety settings and site/navigation policy;
- page origin and required capabilities;
- fresh observation time/fingerprint class;
- semantic target resolves uniquely;
- approval is present, unexpired, and digest-bound when required.

After dispatch, the extension observes the page and reports an outcome. A
successful DOM event or tool return is insufficient when the user objective
requires a visible state change. The product's existing act-check-act policy
remains authoritative.

## Command APIs

```text
POST /v1/sessions/{sessionId}/lease
POST /v1/sessions/{sessionId}/lease/heartbeat
POST /v1/sessions/{sessionId}/lease/takeover
DELETE /v1/sessions/{sessionId}/lease

GET  /v1/sessions/{sessionId}/commands?after=
POST /v1/sessions/{sessionId}/commands/{commandId}/accept
POST /v1/sessions/{sessionId}/commands/{commandId}/start
POST /v1/sessions/{sessionId}/commands/{commandId}/result
POST /v1/sessions/{sessionId}/commands/{commandId}/cancel
```

The extension cannot create arbitrary cloud commands. Until LP-32, commands are
created by the authenticated session API only in response to a local agent
request/checkpoint; the cloud does not independently plan browser actions. All
mutations require idempotency keys. Result APIs accept closed outcome codes and
an encrypted checkpoint reference, not arbitrary diagnostic strings.

## PostgreSQL records and transaction boundaries

The first migration adds closed tables for registered connections, execution
leases, commands, acknowledgements/results, and idempotency responses. Every
table includes `account_id` even when it can be reached through a session so
ownership can be checked in the same statement; foreign keys include the
account/session partition instead of relying on application joins.

- `device_connections`: connection ID, account/device IDs, transport, last
  acknowledged sequence, connected/seen/expiry timestamps, and revoked time.
- `session_leases`: account/session IDs, holder device/connection, generation,
  acquired/heartbeat/expiry/grace timestamps, and revision.
- `device_commands`: account/session IDs, command ID, sequence, lease
  generation, checkpoint revision, closed command/state enums, action digest,
  expiry, and timestamps. It contains no raw action body.
- `command_attempts`: command/attempt IDs, prior state, terminal outcome code,
  checkpoint reference, and transition timestamps.
- `device_idempotency`: account/device scope, operation, request-key hash,
  response status/body digest, and expiry.

Lease acquisition/takeover locks the session and lease rows, increments the
generation, revokes the previous holder, and records the new holder in one
`SERIALIZABLE` transaction. Command acceptance/start/result use conditional
updates over account, session, command, generation, expected state, and revision.
Terminal updates are monotonic. Idempotency insertion and the protected mutation
commit in one transaction; a uniqueness conflict returns the stored response.

Transaction tests must run against real PostgreSQL and cover two simultaneous
acquisitions, takeover versus heartbeat, result versus revocation, duplicated
idempotency keys, stale generation/revision, terminal replay, rollback after
injected failure at every write boundary, and cross-account identifiers that
otherwise collide. Tests must prove one lease winner and no partially visible
command transition.

## Reconnect algorithm

1. Refresh authentication if needed and register a new connection ID.
2. Load local device/session/lease and attempt journal.
3. Ask the server for lease state and commands after the last acknowledged
   sequence.
4. If the same lease is in grace, renew it; otherwise remain read-only until the
   user acquires/takes over.
5. Reconcile each command by ID and local attempt state.
6. For any `started` nonterminal command, observe before reporting or retrying.
7. Load the latest LP-30 checkpoint and compare revision.
8. Re-ground and remain paused when the page, revision, lease, device, or action
   digest changed.
9. Resume only after the user-visible session state is coherent.

## Cross-device takeover

Takeover is never automatic. The new device shows session title/status, previous
device display name/last seen, checkpoint time, and a warning that website login
state is not transferred.

On confirmation:

1. Revoke old lease and increment generation transactionally.
2. Notify the old connection; it stops accepting/starting commands immediately.
3. Wait for any already-started command result until a bounded deadline.
4. If no conclusive result arrives, mark it `outcome_unknown`.
5. Restore the latest committed LP-30 checkpoint on the new device.
6. Require the user to open/sign into the relevant page.
7. Re-ground and create fresh approvals.
8. Acquire the new execution lease only after restore confirmation.

Late results from the old device cannot advance state after generation change,
but may be retained as a coarse conflict diagnostic for operator investigation.
They never trigger a second action.

## Cancellation

- Cancellation is revisioned and idempotent.
- Before `started`, cancellation prevents execution and terminates the command.
- After `started`, the extension aborts where the browser/tool supports it, then
  observes state. The result is succeeded, failed, or unknown—not simply
  cancelled.
- Cancelling a session revokes issuance of new commands, but does not pretend an
  in-flight external side effect was rolled back.
- A revoked device can submit no result mutation; if revocation races a started
  command, recovery uses observation and user clarification.

## Security and privacy

- Cognito subject determines account; every command and lease access checks
  account, session, device, and generation.
- WebSocket/SSE tokens are short-lived and scoped to one account/device. URLs do
  not contain access tokens.
- WAF/throttles limit registration, connections, heartbeats, lease attempts, and
  result mutations separately.
- Server logs exclude command bodies, page origins, target descriptions,
  approval summaries, and outcome evidence.
- Device/session/command identifiers never enter LP-25 telemetry.
- A hostile page cannot call the background cloud port directly; runtime message
  sources and sender context are validated at the production shell.
- A stolen extension token may consume permitted relay/session operations until
  revocation, but cannot reveal provider keys or override local safety checks.

## Failure matrix

| Failure                                     | Required behavior                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Worker suspends before `accepted`           | Command may redeliver and validate normally                                              |
| Suspends after `accepted`, before `started` | Resume same attempt after revalidation                                                   |
| Suspends after `started`                    | Observe; never blindly repeat                                                            |
| Result reached server, response lost        | Same idempotency key returns terminal state                                              |
| Socket duplicates/reorders frames           | Sequence and state transition checks ignore stale frames                                 |
| Lease expires while action started          | Stop new actions; observe/report only within grace rules                                 |
| Device revoked                              | Close connection, reject lease/command mutations, require sign-in                        |
| Backend unavailable                         | Local agent may continue only in explicitly local-only mode; cloud session pauses safely |
| Page navigated/re-rendered                  | Preconditions fail; re-ground and re-plan                                                |
| Approval expires                            | Reject command and request a fresh approval                                              |
| Takeover races old result                   | Lease generation transaction decides; uncertain side effects clarify                     |

## Testing and evidence

- Pure state-machine property tests generate valid/invalid transition sequences
  and prove terminal monotonicity.
- Duplicate delivery at every transition yields at most one dispatch call.
- Crash injection before/after journal write, dispatch, observation, result send,
  and acknowledgment exercises reconnect behavior.
- Sensitive irreversible actions are never automatically retried from `started`
  or `outcome_unknown`.
- Lease expiry, grace, renewal, revocation, and takeover races are covered with a
  controllable clock.
- Cross-account/device/session/lease/generation authorization fuzz tests reject
  confused-deputy inputs.
- Local policy changes between delivery and start fail closed.
- Service-worker restart E2E proves journal persistence and duplicate
  suppression; generic-page E2E proves target re-resolution after re-render.
- Cross-device test uses two isolated browser profiles and proves old-device
  revocation plus new-device re-grounding/fresh approval.
- Transport outage/load tests validate reconnect backoff, heartbeat cost,
  connection quotas, and kill switches.
- Bundle/log audit finds no backend credential, access-token URL, raw command
  body, or account/device identifier in telemetry.

## Rollout

1. Land shared types, pure state machines, fake transport, and device journal.
2. Exercise same-device disconnect/reconnect against a local session API.
3. Internal cloud session delivery in read-only commands only.
4. Reversible writes, then sensitive writes after duplicate/crash evidence.
5. Cross-device takeover behind a separate feature flag.
6. Enable for opt-in beta only after privacy, revocation, and incident-response
   review.

Rollback disables new cloud commands and revokes leases. Local-only sessions
continue through existing runtime paths. Existing cloud sessions remain
viewable/exportable/deletable and can restore paused without remote commands.

## Decision

Status: Approved with edits

Chosen path:

- Add a port-based authenticated device transport, one execution lease per
  session, a monotonic command state machine, and a durable local attempt
  journal.
- Guarantee at most one OpenSidebar dispatch attempt per authorized command and
  handle unprovable external effects as `outcome_unknown`.
- Support same-device reconnect first and explicit cross-device takeover only
  after lease revocation, checkpoint restore, re-grounding, and fresh approval.
- Keep the extension as the browser executor and local safety authority.

Required edits before implementation:

- Prove SSE-through-Caddy behavior under MV3 suspension, token refresh, proxy
  restart, duplicate delivery, and the few-user load profile. Fall back to
  bounded HTTPS polling if the stream is unreliable; changing to WebSockets
  requires a recorded owner decision.
- Define PostgreSQL migrations and transaction tests for connection, lease,
  command, acknowledgement, and idempotency records.

Non-blocking follow-ups:

- Allow provider/site idempotency keys in portable actions when a reviewed
  adapter can prove their semantics.
- Add push notifications for waiting sessions after the core lease protocol is
  reliable.

Do not do:

- Do not claim exactly-once third-party website effects.
- Do not automatically take over a session, retry an outcome-unknown sensitive
  action, or use a stale approval.
- Do not let the extension connect directly to Temporal or let cloud state
  bypass local policy.

Evidence required before merge:

- All testing and evidence items above, including crash injection, two-profile
  takeover, duplicate suppression, revocation, auth fuzzing, and privacy audit.

Next action:

- Revise RFC
