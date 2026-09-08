# LP-35 — Hosted browser MCP and supervised remote missions

Status: Approved. Superseding owner Decision Stamp recorded 2026-08-12.

## Summary

Replace the experimental localhost browser MCP/WebSocket path with an
authenticated MCP service at `opensidebar.com`. Codex supervises a revisioned
intent-level mission on a selected signed-in OpenSidebar extension: it may plan,
judge bounded evidence, and replan, while the extension's existing agent runtime
remains the browser executor and local safety authority.

Reuse LP-28 account/device identity and LP-31 delivery, lease, sequencing,
idempotency, reconnect, and uncertain-outcome rules. Do not move browser
planning or browser tools into the cloud.

## Problem

The current integration requires a local Node MCP process, loopback WebSocket,
and hidden `opensidebar:browserMcpWsPort` setting. It is awkward for Codex and
duplicates transport and session machinery now present in the hosted control
plane.

LP-31 carries individual portable browser actions while the localhost bridge
starts a complete agent mission. These remain separate contracts so cloud state
does not become authoritative over local browser behavior.

## Goals

- Give Codex a stable HTTPS MCP endpoint at `opensidebar.com`.
- Deliver a complete user intent to one selected extension device.
- Preserve `AgentLoop`, local site policy, and approval gates as authorities.
- Survive MV3 suspension, reconnect, duplicates, restart, and lost responses.
- Remove localhost MCP, WebSocket, hidden-port, Docker, test, and doc surfaces
  after hosted parity.

## Non-goals

- Cloud browser planning, DOM interaction, screenshots, cookies, or credentials.
- Execution without a signed-in, connected extension.
- Low-level browser primitives for MCP callers.
- Exactly-once effects on third-party websites.
- Temporal authority or a permanent offline/local MCP compatibility path.

## Target boundary

```text
Codex -> authenticated HTTPS MCP at opensidebar.com
      -> durable encrypted mission delivery
      -> selected OpenSidebar extension
      -> existing agent runtime -> browser
```

The backend owns authentication, routing, durable metadata, delivery, and
monotonic lifecycle transitions. The extension owns grounding, planning, tools,
local safety, observation, and browser evidence.

## Remote mission contract

`RemoteMissionV1` is separate from LP-31's `BrowserCommandV1`:

```ts
interface RemoteMissionV1 {
  schemaVersion: 1;
  missionId: string;
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  sequence: number;
  state:
    | "queued"
    | "accepted"
    | "running"
    | "approval_required"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "outcome_unknown";
  resultCode?: "completed" | "not_achieved" | "cancelled" | "unknown";
}
```

Persist ownership, routing, lifecycle, timestamps, an idempotency digest, and a
bounded outcome classification. Mission content and user-visible results are
transient or encrypted for the selected device. Logs and fleet telemetry exclude
instructions, URLs, approvals, page content, screenshots, and results.

The encrypted delivery body is a separate `RemoteMissionPayloadV1` containing
`missionId`, `instruction`, optional `initialUrl`, and an explicit
`active_tab`/`isolated_tab` target context. Account callers and
ordinary status responses never receive that plaintext body. Only the selected
authenticated extension device may retrieve it.

Before publishing terminal metadata, the selected device uploads a separate
bounded result envelope containing only the terminal outcome, summary, and
sanitized diagnostic. It is KMS-envelope-encrypted under a distinct
mission/device-bound context. Terminal transitions fail closed when this result
is missing or its outcome disagrees with the requested state. Authorized
coordinators receive the decrypted bounded result through mission status; logs,
fleet telemetry, and PostgreSQL metadata do not.

## Hosted MCP contract

Initial tools:

- `browser_list_devices`
- `browser_start_task`
- `browser_get_task`
- `browser_continue_task`
- `browser_respond_approval`
- `browser_cancel_task`

`browser_start_task` returns a mission ID. Callers poll `browser_get_task` for
bounded progress or terminal output. Approvals are ID-, digest-, and expiry-bound;
the extension revalidates local policy and fresh grounding before execution.

`browser_continue_task` submits a revision-checked supervisor decision: continue,
retry with guidance, replace the remaining semantic plan, request more evidence,
request user input, select an ambiguous browser target, complete, or stop. A
target selection uses a short-lived opaque handle returned by the same mission;
it never carries a Chrome tab, group, or window ID. It is deliberately separate
from approval decisions. Codex owns the overall completion judgment; the
extension owns claims about browser observations, effects, local policy, and
uncertainty. Codex cannot convert `outcome_unknown` into verified success or
override a local deny.

## Supervisor, evidence, and persistence boundary

The same environment-neutral supervisor/worker protocol is used by hosted Codex,
an in-memory scripted test supervisor, and local dogfooding. Semantic steps contain
objectives, success criteria, and constraints, never selectors, Chrome tab IDs,
storage keys, or fixture answers. OpenSidebar may adapt low-level actions to live
page state without weakening the supervisor's goal, constraints, or prohibited
effects.

Unsubmitted composer drafts remain local-only and are scoped by local account and
workspace. They survive panel and browser restart, are cleared only after confirmed
submission or explicit discard, and never enter cloud sync, logs, traces, or
telemetry. Submitted mission instructions, plan revisions, bounded structured
evidence, approval previews, and terminal summaries are envelope-encrypted and
retained for 30 days by default. Manual mission/account deletion removes metadata
and every current and non-current object version.

Structured text evidence is the default. Screenshot or trace evidence is optional,
explicitly requested, consented, bounded, encrypted, and covered by the same
retention and deletion rules.

Each extension installation has a stable device ID and user-editable display name.
Renaming is available from the extension panel and account site, changes display
metadata only, and never changes mission ownership. Backend presence means recent
authenticated contact and bounded capability/status metadata; it never exposes
tabs, URLs, history, cookies, page content, or ordinary local tasks.

Typed domain tools are deferred. They may later become thin intent templates,
never a second runtime or hidden execution path.

## Authentication and selection

- Use a reviewed OAuth flow and narrowly scoped remote-mission credentials.
- Require a device ID; automatic selection is allowed only when exactly one
  eligible device is connected and the response identifies it.
- Resolve existing-page targets on the selected device. One exact match may
  continue automatically. Multiple matches pause the mission for Codex-side
  user selection using only encrypted bounded labels and mission-scoped opaque
  handles; never expose a general tab inventory.
- Device revocation invalidates pending delivery and future mutations.
- One mission execution lease belongs to one device; takeover is never automatic.

## Extension execution

Extract the intent-level behavior in
`background/browser-bridge/orchestrator-driver.ts` behind a neutral
`RemoteMissionRunner`. It owns mission start, correlation, cancellation,
completion capture, and approval continuation without transport knowledge.

The cloud transport accepts a mission only after validating account, device,
lease, expiry, schema, idempotency, and local policy. It durably records
acceptance before starting the agent. Duplicate or interrupted running missions
reconcile state and observation before any retry.

The sidepanel displays requester, instruction summary, state, approval,
cancellation, offline, and reconnect status. Remote work is never hidden locally.

## Approval policy

Codex can respond only after receiving bounded dry-run evidence. The extension
validates digest, expiry, origin, current local settings, and fresh grounding.
The first allowlisted release shows every remote consequential approval locally.
A valid Codex decision may resume without a second local click, but local policy
and a local deny/cancel always win.

## Migration and deletion

1. Add versioned contracts and lifecycle tests.
2. Extract `RemoteMissionRunner` from the localhost driver.
3. Add ownership-scoped backend persistence and APIs.
4. Connect extension cloud transport and local UI.
5. Add the hosted MCP facade as a thin API adapter.
6. Prove task, approval, cancellation, reconnect, duplicate, and revocation parity.
7. Remove `scripts/browser-mcp`, extension WebSocket client/startup, hidden port,
   Docker wiring, package scripts, local bridge E2Es, and setup documentation.
8. Rename bridge-specific shared approval types before deleting
   `shared-types/browser-bridge.ts`.

The localhost bridge remains only until parity passes, not as a fallback.

## Implementation status — 2026-08-12

Implemented on the `agent/hosted-browser-mcp` working branch:

- Versioned public metadata, encrypted payload, transition, approval, and run
  result contracts in `packages/shared-types/src/remote-missions.ts`.
- Pure input and monotonic lifecycle policy with bounded instruction, URL, and
  expiry validation.
- PostgreSQL migration and repository for account/device-scoped ordered mission
  metadata and idempotent creation.
- KMS-envelope-encrypted payload storage bound to account, device, and mission.
- Default-off authenticated HTTP APIs for mission creation/status, selected
  device delivery, and selected-device state transition.
- A transport-neutral `RemoteMissionRunner` adapter over the existing
  session-aware browser agent runner, including approval continuation.
- Focused backend and extension tests for lifecycle policy, encrypted-at-rest
  payloads, metadata-only status, device isolation, transitions, execution
  mapping, and approval mapping.
- A local `MissionWorker`, durable local attempt journal, scripted supervisor,
  and environment-neutral semantic plan/evidence/decision contracts.
- Local-only composer draft recovery and revision-checked device renaming in the
  extension and account site.
- Thirty-day encrypted mission retention, version-aware/manual cleanup, and
  orphan cleanup when metadata creation fails.
- A six-tool MCP SDK contract, thin mission operations adapter, and Streamable
  HTTP resource endpoint mounted only when `HOSTED_MCP_ENABLED=true`, with
  Codex-like in-memory and HTTP initialize conformance tests.
- A disabled authenticated extension delivery loop with alarm-based polling,
  a durable ordered local journal, hard read-only tool enforcement across
  initial/replanned/synthesized nodes, terminal lifecycle reporting, and a
  minimal local sidepanel status banner.
- Explicit active-tab versus isolated-tab execution, plus a separately
  encrypted terminal result/diagnostic artifact required before terminal state.
- An acceptance-only coordinator session cache that rotates the existing
  90-day refresh session after one link-code bootstrap. This is local test
  automation, not the hosted MCP OAuth credential design.
- A production-shaped named-tester read-only acceptance passed on 2026-08-13:
  the cached coordinator selected the named Chrome device, the extension bound
  to an already-open exact `example.com` tab without activation/navigation,
  used the encrypted cloud credential through the relay, and returned an
  encrypted grounded `Example Domain` result.
- Bounded state-addressed encrypted progress and approval-preview envelopes,
  outcome-addressed encrypted terminal artifacts, an idempotent coordinator
  cancellation endpoint, and an extension cancellation watcher. Restarted
  workers resume from `running` or preserve `approval_required` without
  replaying earlier lifecycle writes.
- An immutable KMS-encrypted approval-decision envelope bound to mission,
  approval ID, action digest, request time, decision time, approval expiry, and
  mission expiry. Only the selected device can retrieve it; the extension
  rechecks the binding and asks the existing local orchestrator to resume the
  same mission session. Immediately before a positive answer, the runner checks
  the current tab against the device's latest site-access policy; a local block
  is converted into a denial and allowed to drain. Missing restart state,
  denial, and expiry fail as not achieved rather than replaying an effect.
- The Phase 3 backend candidate passed a second real exact-existing-tab mission
  (`debe50c8-9c5a-4875-8b66-ba60842ead61`) after deployment. The existing
  accepted client returned a grounded encrypted result through the new
  outcome-addressed storage path; cancellation-watcher acceptance followed
  after the new client was reloaded.
- After reload, real mission `3f10bacc-24c0-44ad-97a8-1fc5fefe0c56` reached
  `running`, was coordinator-cancelled after 24.1 seconds, retained its encrypted
  `cancelled` result without a later overwrite, and caused no further model
  request after the one request already in flight. The separate queued probe
  missed the fetched delivery batch and is deliberately excluded from handoff
  evidence.
- Backend image `remote-mission-approval-v1-20260813` passed rollback-guarded
  deployment and exact-existing-tab compatibility mission
  `1c4fdf8b-a96d-4f34-a202-67540defd07b` in 76.5 seconds. The live profile is
  still hard read-only, so this proves non-regression without manufacturing a
  consequential website action.
- Browser, Codex integration, and acceptance test connections now have distinct
  identities. Repeated acceptance clients collapse into one history summary;
  active browsers expose explicit online/offline state and revocation remains
  locally authoritative.
- Duplicate exact-URL matches now pause in `target_selection_required`. The
  encrypted envelope contains only bounded page/group/window labels and opaque
  handles. Chrome identifiers remain in extension memory; handles are bound to
  the mission session, expire, are single-use across sibling choices, and are
  revalidated against the live exact URL before continuation.
- RFC 9728 protected-resource discovery and the hosted resource-server boundary
  are implemented default-off. They require a separate Cognito MCP app client
  and resource-bound namespaced scopes; website cookies and extension-client
  tokens are rejected, and dashboard revocation of the Codex integration wins
  locally. Streamable HTTP sessions are account/client-bound and creation,
  polling, and mutation have separate hashed per-account quotas.
- Codex supervisor decisions are stored in a distinct encrypted envelope and
  bound to the evidence step and plan revision. Retry, stronger-evidence,
  replacement-plan, input, completion, and stop decisions resume the same
  durable mission; the extension no longer declares semantic completion for
  this path.

Not yet implemented:

- A safe synthetic real-browser approval fixture and its named-tester evidence.
  The transport and same-process runner continuation are implemented and unit
  verified, while the active remote profile remains hard `read_only` and cannot
  produce a consequential approval.
- Real-browser duplicate-tab/group selection, synthetic approval, and explicit
  offline/revoked/partial-rollout visual evidence. The account-level remote-work
  switch and local target-selection handoff are implemented.
- Disabled exact-host deployment and real Codex OAuth acceptance. The separate
  Cognito resource server/public PKCE client are provisioned, and the resource
  endpoint plus complete mission/supervision adapter exist behind a disabled
  flag.
- Production-shaped real-browser restart, revocation, and two-device E2E evidence.
- Hosted/local parity cutover and deletion of the localhost WebSocket bridge.

All new backend behavior remains behind `REMOTE_MISSIONS_ENABLED=false` and
`HOSTED_MCP_ENABLED=false` by default. No hosted Codex-to-browser path is
operable until the reviewed backend is deployed and exact-host acceptance
passes.

The delivery sequence and acceptance gates are maintained in the
[hosted browser MCP roadmap](../hosted-browser-mcp-roadmap.md).

## Rollout

- Mission creation and delivery flags default off.
- Begin with named accounts and explicit devices.
- Local-only operation remains available during cloud failure.
- Rollback stops new work but does not claim to reverse started website effects.
- General availability requires privacy and Chrome Web Store disclosure review.

## Evidence required

- Lifecycle tests for transitions, expiry, cancellation, replay, and conflicts.
- Cross-account/device/session/lease authorization and credential-scope tests.
- Crash injection around acceptance, start, effect, result, and acknowledgement.
- Real-extension E2E for read-only completion, approval/denial/expiry,
  cancellation, MV3 restart, backend restart, revocation, and two-device conflict.
- Proof that consequential `outcome_unknown` work is not automatically retried.
- Privacy audit for logs, storage, metrics, and fleet telemetry.
- Hosted MCP conformance test with a Codex-like client.
- Repository search proving all localhost bridge surfaces are gone after cutover.
- Full verification with decomposition budgets unchanged or lower.

## Recommendation

Approve the hosted-only migration, explicit device selection unless exactly one
eligible device is connected, transient/device-encrypted content, and locally
visible/cancellable approvals. Permit a digest-bound Codex approval in the
allowlisted release without requiring a duplicate local click.

## Decision

Status: Approved

Chosen path:

- Replace localhost MCP/WebSocket with this hosted remote-mission design, reuse
  cloud device durability, and keep the extension authoritative for execution
  and safety.
- Require explicit device selection unless exactly one eligible device exists.
- Permit digest-bound, unexpired Codex approval without a second local click,
  while keeping it locally visible/cancellable and subject to local policy.
- Keep content transient or device-encrypted and persist bounded metadata only.
- Use a hybrid Codex supervisor: Codex owns semantic planning, evidence acceptance,
  replanning, and overall completion; OpenSidebar owns browser execution, browser
  evidence, local safety, and uncertainty.
- Save unsubmitted composer input locally only. Retain submitted encrypted mission
  content for 30 days with immediate deletion and version-aware cleanup.
- Expose user-editable device names and a separate `browser_continue_task` tool.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Add typed intent templates after generic mission production evidence.
- Consider streamed progress after job-style polling is reliable.

Do not do:

- Do not put browser planning, page access, credentials, or DOM tools in cloud.
- Do not bypass local policy, auto-take over, or retry uncertain consequences.
- Do not retain localhost MCP as a permanent production alternative.
- Do not introduce Temporal as an authority or dependency.
- Do not upload unsubmitted drafts, expose raw browser primitives, or let the
  supervisor override local policy or uncertainty.

Evidence required before merge:

- Satisfy every Evidence required item above, including hosted MCP conformance,
  real-browser safety/recovery tests, privacy audit, localhost removal, and full
  verification without raising decomposition budgets.
- Prove local draft recovery/non-upload, mission retention/deletion, supervisor
  revision conflicts, device rename stability, and worker/supervisor/validator
  judgment separation.

Next action:

- Implement
