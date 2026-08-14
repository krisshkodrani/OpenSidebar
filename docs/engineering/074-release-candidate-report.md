# OpenSidebar 0.7.4 release candidate

Date: 2026-08-14

Status: ModelBench integration, clean full-suite verification, production
extension build, and refreshed backend deployment complete; named-tester browser
acceptance and an exact-commit package remain before Chrome Web Store submission.

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
- The service worker disables the manifest-global default configuration at
  startup. Only an explicitly attached workspace tab is enabled, so new tabs
  inherit `enabled: false` rather than briefly inheriting a global panel.
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
- Provisional extension package: `.artifacts/releases/opensidebar-v0.7.4.zip`.
- Provisional package SHA-256 (superseded by the final ModelBench gate fixes):
  `0170648EE2856C03E79807292F050C6F3E91190C4D6338BAB16A77AA78CB02CC`.

## ModelBench integration

- The release candidate now includes the six commits through `79704d26`, adding
  the MB-101 workspace-tab acceptance probe, deterministic release matrix,
  hosted target-session cookie forwarding, and scenario workspace packaging in
  the cloud-service image. These commits do not change extension runtime source.
- ModelBench catalog validation passed with 100 headline cases, MB-101, 50 role
  probes, and 119 legacy migration dispositions.
- The oracle passed 100 gold paths, rejected 300 near misses, and evaluated 888
  assertions. The target-quality audit passed 100 of 100 cases.
- The focused ModelBench/scenario-engine suite passed 33 tests. The final
  sidepanel visibility regression suite passed 7 tests.
- Repository RFC validation, decomposition ratchet, skill lint, E2E inventory,
  and lint passed. The three changed scenario packages typecheck directly.
- Production extension build and distribution verification passed and produced
  the package hash above.
- A clean full extension serial run passed from the integration worktree in
  16m17s. Direct TypeScript checks also passed for every shipped workspace,
  including the scenario packages, cloud service, sandbox, and sandbox
  infrastructure.
- The repository-wide inferred Nx typecheck remains unable to invoke package
  scripts because the local pnpm registry-signature check cannot reach the
  registry. Its only unresolved direct-project check is the parked
  `apps/temporal-spike` experiment, which is not in the root workspace list and
  has no installed `@temporalio/*` dependencies. It is not part of the 0.7.4
  extension, cloud image, or package.
- Live MB-101 execution exposed an invalid `groq` executor pin for MiniMax M3;
  OpenRouter lists no such endpoint. The release matrix now pins the executor to
  `minimax`, and a direct MiniMax M3 vision/tool probe passed with HTTP 200.
- MB-101 now creates a real grouped workspace through the gated E2E test API.
  Its final fixed attempt passed the state mutation and all six browser
  assertions: linked tab opened, same workspace group, both panels enabled,
  returned to source, and opening directly observed. MiniMax did not emit a
  terminal answer before the five-minute contract timeout, so the attempt is
  honestly retained as `valid_model_failure` rather than rerun until green.

## Backend deployment

- Image `opensidebar-cloud-service:0.7.4-rc2` was built from the integrated
  ModelBench head, including the scenario workspaces. Its local image ID is
  `sha256:8afc5b0a487e4015500fe3b801c5254fb9daf4ca0414d56beece51caf0124147`.
- RC2 passed the isolated no-public-port readiness, disabled-control, and
  Playground-login smoke, then was promoted with automatic rollback protection.
- The live container is healthy with zero restarts on that exact image and
  migration 020 is present.
- The pre-release Chrome 0.7.3 device is correctly classified as unsupported;
  no old client can receive a newly queued mission.
- Hosted MCP discovery returns 200 and unauthenticated `/mcp` returns the expected
  401 resource-metadata challenge.
- Remote missions and hosted MCP retain their existing named-tester boundary.
  Checkpoint write/restore, device command/takeover, and Temporal flags remain off.

## Deployment and acceptance gates

1. Done: deploy the refreshed backend while preserving the current named-tester
   allowlist and feature-flag values.
2. Done: verify the published 0.7.3 device is online but
   `remoteWork: unsupported`.
3. Load the normal 0.7.4 candidate and wait for one successful poll; verify the
   same device becomes `remoteWork: ready` without a new device record.
4. Complete an exact-existing-tab read-only mission and confirm grounded evidence.
5. Exercise duplicate-tab selection, workspace-return cancel visibility, backend
   restart, extension restart, OAuth refresh, and revocation.
6. Done: complete clean shipped-workspace verification, then rebuild, smoke, and
   promote the cloud-service candidate from the integrated release head.
7. Record the final ZIP SHA-256, then submit that exact artifact. Do not widen the
   tester allowlist or enable consequential remote actions during release.

## Rollback

Disable `REMOTE_MISSIONS_ENABLED` first. Hosted MCP can remain available for task
status/cancellation or be disabled separately with `HOSTED_MCP_ENABLED`. Local
OpenSidebar tasks and locally stored authentication continue to operate. The
database column and index are additive and need not be removed during rollback.
