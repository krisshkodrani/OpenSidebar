# LP-35 — Hosted browser MCP and remote missions

Status: Approved. Owner Decision Stamp recorded 2026-08-11.

## Summary

Replace the experimental localhost browser MCP/WebSocket path with an
authenticated MCP service at `opensidebar.com`. Codex submits an intent-level
remote mission to a selected signed-in OpenSidebar extension; the extension's
existing agent runtime remains the browser executor and local safety authority.

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
  accountId: string;
  deviceId: string;
  instruction: string;
  initialUrl?: string;
  createdAt: string;
  expiresAt: string;
  state:
    | "queued"
    | "accepted"
    | "running"
    | "approval_required"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "outcome_unknown";
}
```

Persist ownership, routing, lifecycle, timestamps, an idempotency digest, and a
bounded outcome classification. Mission content and user-visible results are
transient or encrypted for the selected device. Logs and fleet telemetry exclude
instructions, URLs, approvals, page content, screenshots, and results.

## Hosted MCP contract

Initial tools:

- `browser_list_devices`
- `browser_start_task`
- `browser_get_task`
- `browser_respond_approval`
- `browser_cancel_task`

`browser_start_task` returns a mission ID. Callers poll `browser_get_task` for
bounded progress or terminal output. Approvals are ID-, digest-, and expiry-bound;
the extension revalidates local policy and fresh grounding before execution.

Typed domain tools are deferred. They may later become thin intent templates,
never a second runtime or hidden execution path.

## Authentication and selection

- Use a reviewed OAuth flow and narrowly scoped remote-mission credentials.
- Require a device ID; automatic selection is allowed only when exactly one
  eligible device is connected and the response identifies it.
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

Evidence required before merge:

- Satisfy every Evidence required item above, including hosted MCP conformance,
  real-browser safety/recovery tests, privacy audit, localhost removal, and full
  verification without raising decomposition budgets.

Next action:

- Implement
