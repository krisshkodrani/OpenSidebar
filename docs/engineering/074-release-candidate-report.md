# OpenSidebar 0.7.4 release candidate

Date: 2026-08-13

Status: automated verification and capability-aware backend deployment complete;
named-tester browser acceptance remains before Chrome Web Store submission.

## Release outcome

`0.7.4` is the first normal production build that can receive supervised remote
browser missions. Remote work remains bounded by the account switch, named-tester
server configuration, selected-device routing, and the extension's local safety
policy. The cloud coordinates encrypted mission state; it does not execute page
actions or receive raw browser state.

## Production hardening

- A device advertises `remote_browser_tasks_v1` only after a successful poll from
  a capable extension build. Online older builds are reported as unsupported and
  mission creation fails immediately instead of queueing work they cannot claim.
- Mission readiness expires with the normal three-minute device heartbeat and is
  cleared operationally by logout, revocation, browser shutdown, or loss of polls.
- Transient cloud refresh failures preserve the saved extension session. Only a
  definitive credential rejection clears it.
- The sidepanel is enabled only on OpenSidebar workspace tabs. Chrome hides it
  on unrelated tabs and restores it on return; the background worker keeps a
  remote mission durable while the panel is hidden.
- New ungrouped tabs are disabled at `tabs.onCreated`, before they can retain
  the manifest-global default panel. Activation also cross-checks Chrome's live
  `groupId` against the workspace record, and ungrouping is enforced even when
  it does not trigger another activation.
- Production and acceptance builds share the same remote worker. Acceptance-only
  diagnostics and release-ineligible markers remain excluded from normal builds.

## Automated evidence

- Cloud API and repository tests: passed, including incapable-device rejection.
- Remote worker, cancellation, runner, and sidepanel banner tests: passed.
- Cloud authenticated-fetch regression tests: passed.
- Shared/cloud and extension direct TypeScript builds: passed.
- Repository lint, RFC validation, and decomposition ratchet: passed.
- Full extension Vitest suite: passed serially. A parallel run first exposed and
  led to fixing an undefined test-time build constant; its later unrelated
  resource-contention timeouts all pass in the serial release run.
- Production build and distribution verification: passed for normal 0.7.4.
- Extension package: `.artifacts/releases/opensidebar-v0.7.4.zip`.
- Package SHA-256:
  `F11C1D8BAEFF9041611DA1DFD7072905BF66E62ADFC5CBC9A8A96BF2BAC28DEE`.

## Backend deployment

- Image `opensidebar-cloud-service:0.7.4-rc1` passed the isolated, no-public-port
  smoke and was promoted with automatic rollback protection.
- The live container is healthy with zero restarts and migration 020 is present.
- The pre-release Chrome 0.7.3 device is correctly classified as unsupported;
  no old client can receive a newly queued mission.
- Hosted MCP discovery returns 200 and unauthenticated `/mcp` returns the expected
  401 resource-metadata challenge.
- Remote missions and hosted MCP retain their existing named-tester boundary.
  Checkpoint write/restore, device command/takeover, and Temporal flags remain off.

## Deployment and acceptance gates

1. Deploy the backend migration and capability gate while preserving the current
   named-tester allowlist and feature-flag values.
2. Verify the published 0.7.3 device is online but `remoteWork: unsupported`.
3. Load the normal 0.7.4 candidate and wait for one successful poll; verify the
   same device becomes `remoteWork: ready` without a new device record.
4. Complete an exact-existing-tab read-only mission and confirm grounded evidence.
5. Exercise duplicate-tab selection, workspace-return cancel visibility, backend
   restart, extension restart, OAuth refresh, and revocation.
6. Record the final ZIP SHA-256, then submit that exact artifact. Do not widen the
   tester allowlist or enable consequential remote actions during release.

## Rollback

Disable `REMOTE_MISSIONS_ENABLED` first. Hosted MCP can remain available for task
status/cancellation or be disabled separately with `HOSTED_MCP_ENABLED`. Local
OpenSidebar tasks and locally stored authentication continue to operate. The
database column and index are additive and need not be removed during rollback.
