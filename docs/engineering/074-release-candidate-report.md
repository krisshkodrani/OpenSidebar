# OpenSidebar 0.7.4 release candidate

Date: 2026-08-14

Status: ModelBench integration, named-tester browser acceptance, clean full-suite
verification, and production extension build complete. The exact dependency-remediated
backend promotion and exact-commit package remain before Chrome Web Store submission.

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
- Rotating cloud-session refresh is serialized across extension contexts with a
  Web Lock and an in-process fallback. Each waiter re-reads the stored session
  inside the lock, preventing background, sidepanel, sync, and restore clients
  from concurrently consuming the same refresh token and triggering reuse-family
  revocation at the 15-minute access-token boundary.
- The Settings drawer and selected Settings section are restored for the current
  Chrome window while the browser session is alive. Tab switches, panel hiding,
  and sidepanel remounts no longer reset the view to Account; Chrome exit clears
  the navigation state, and credentials, link codes, and unsaved form drafts are
  never stored with it.
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
- An `isolated_tab` remote mission now joins an existing OpenSidebar workspace
  instead of manufacturing a mission-only group. The real workspace identity
  drives both Chrome placement and the orchestrator/UI event stream. With more
  than one eligible workspace, the mission pauses for an opaque group/window
  choice; with none, it fails before opening a tab.
- All remote target modes return encrypted, bounded target evidence: page
  origin/title, expected-URL match, window label, workspace title/membership,
  sidepanel enablement, and whether the tab was mission-created. Raw Chrome and
  workspace identifiers are not exposed to the coordinator.
- Production and acceptance builds share the same remote worker. Acceptance-only
  diagnostics and release-ineligible markers remain excluded from normal builds.

## Automated evidence

- Cloud API and repository tests: passed, including incapable-device rejection.
- Remote worker, cancellation, runner, and sidepanel banner tests: passed.
- Cloud authenticated-fetch regression tests: passed.
- Settings session regression tests passed for remount restoration,
  cross-instance synchronization, close synchronization, and per-window
  isolation. The full sidepanel suite passed: 31 files and 210 tests.
- The focused browser-bridge and remote-mission suite passed 58 tests after the
  isolated-tab grouping hardening. Dedicated gates prove execution cannot begin
  until the isolated tab has joined its workspace group, and fails closed if
  Chrome drops membership or the sidepanel configuration cannot be verified.
- Shared/cloud and extension direct TypeScript builds: passed.
- Repository lint, RFC validation, and decomposition ratchet: passed.
- Full extension Vitest suite: passed serially. A parallel run first exposed and
  led to fixing an undefined test-time build constant; its later unrelated
  resource-contention timeouts all pass in the serial release run.
- Production build and distribution verification: passed for normal 0.7.4.
- The final production dependency audit initially found 28 advisories, including
  a critical `fast-xml-parser` path through the pinned S3 client. AWS, MCP, Hono,
  DOMPurify, and the parked Temporal spike were upgraded together, and audited
  transitive versions are locked with workspace overrides. A frozen install and
  `pnpm audit --prod` now report no known vulnerabilities. The patched graph
  passes cloud typecheck/build and all 124 runnable cloud tests (2 PostgreSQL
  tests skipped), plus all 561 extension test files and 5,496 tests.
- The final existing-workspace binding/evidence slice passed 53 focused
  extension tests, all 124 runnable cloud tests (2 PostgreSQL tests skipped),
  changed-file ESLint, extension/cloud TypeScript checks, production build, and
  21-item distribution verification. A repository-wide Vitest run exceeded the
  five-minute local ceiling amid pre-existing high-volume test logging; no
  failure summary was produced. The full lint wrapper is currently blocked by
  the pre-existing 1,518-line `background.ts` decomposition ratchet (1,500 cap),
  which this slice does not modify.
- A final-completion guard now re-verifies group membership, sidepanel
  enablement, and URL binding after the agent stops, so a tab that leaves its
  workspace during execution cannot be reported as a successful remote result.
  Its focused unit suite passed 37 tests, extension TypeScript and changed-file
  ESLint passed, and the normal production build passed distribution checks.
- A real headless-Chrome E2E created an actual OpenSidebar tab group, ran the
  browser bridge through an isolated mission, and inspected Chrome after agent
  completion. Exactly one mission tab existed; its live group ID matched the
  source workspace and its sidepanel remained enabled at the production path.
- Live mission `55a5fa75-2e07-487c-a532-3fb0db447227` was claimed but returned
  no evidence for more than six minutes and was cancelled rather than inferred
  successful. During the run, the device's three-minute remote-work readiness
  expired because serialized delivery polling was occupied by execution. The
  first fix performed a delivery-only readiness refresh on alarm ticks while a
  mission was active, without concurrently dispatching fetched work. That
  focused slice passed 49 tests but still required live verification.
- Mission `331c98d5-e83d-4288-ad7e-2da7d4636e5c` disproved the alarm-only
  refresh: Chrome did not dispatch that alarm while the delivery event remained
  occupied, and readiness again expired at three minutes. It was cancelled.
  Readiness refresh now runs from the active execution/cancellation lifecycle,
  which is demonstrably alive throughout a stalled task. The device also
  publishes its bounded target binding immediately after the pre-execution
  Chrome verification, allowing MCP to inspect group, URL, and sidepanel state
  without waiting for model completion. The final focused slice passes 63 tests,
  and the exact real-Chrome grouping E2E passes after agent completion.
- Mission `c4067951-2706-4e2f-afbc-cefaec54eda4` on `b5302e5b` produced
  neither early binding nor terminal evidence before readiness expired, proving
  the live stall occurs before the verified target callback. It was cancelled.
  The browser runner now publishes bounded phase summaries while discovering
  the workspace, creating the grouped tab, verifying the sidepanel binding, and
  starting execution. The device-authenticated mission-status poll also refreshes
  remote readiness server-side, replacing reliance on a second delivery poll.
- Instrumented mission `a8e8465c-db84-4869-970d-21e47709722b` reached the
  server `running` transition but emitted none of the runner's first phase,
  isolating the stall to the awaited local sidepanel-status projection between
  those operations. It was cancelled. The local `chrome.storage` UI projection
  is now best-effort at dispatch time and cannot block browser execution; a
  regression test holds that write open indefinitely and proves the mission
  still reaches terminal execution.
- Mission `393b143f-9b1f-4e6a-9428-21168a36244e` on `179a15ac` then proved
  dispatch could create the target tab while the workspace-manager mutation
  queue still delayed its visible adoption; the user observed that tab outside
  the OpenSidebar group, and the mission was cancelled. Chrome's live group is
  now the placement authority: the target joins and verifies the source group
  before execution, while manager persistence runs as a non-blocking projection.
  The focused 58-test slice, production build, 21-item distribution check, and
  exact real-Chrome browser-bridge E2E all pass with this change.
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
- The parked `apps/temporal-spike` experiment remains outside the shipped 0.7.4
  extension and cloud image, but its dependency graph is now installed,
  typecheckable, and included in the clean repository audit.
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
- RC2 was healthy with zero restarts on that exact image before RC3 promotion;
  migration 020 was present.
- The pre-release Chrome 0.7.3 device is correctly classified as unsupported;
  no old client can receive a newly queued mission.
- Hosted MCP discovery returns 200 and unauthenticated `/mcp` returns the expected
  401 resource-metadata challenge.
- Remote missions and hosted MCP retain their existing named-tester boundary.
  Checkpoint write/restore, device command/takeover, and Temporal flags remain off.
- RC2 predates the bounded remote-target evidence parser. It remains the live
  rollback image. Image `opensidebar-cloud-service:0.7.4-rc3`, built from
  `f4b8b367`, passed the isolated smoke and was promoted with automatic rollback
  protection. It was healthy with zero restarts on image before RC4 promotion:
  `sha256:8a261a79949ed9f6b024a91919fa64cefc52ac5054367a5c78b693c09468dd82`;
  hosted MCP can now retain the bounded target contract.
- RC4, built from `f92ae95b`, added device-status readiness refresh and target
  phase transport. It passed isolated smoke and rollback-protected promotion;
  the live container is healthy with zero restarts on
  `sha256:2768e04cadf19c3ffa521af524f2cc8017cf6da323d6e95ecc81156e62269c57`.
- The final audit exposed a second manifest boundary: the Docker runtime manifest
  still pinned the pre-remediation AWS and Hono versions even though the
  workspace lockfile was clean. The runtime manifest now matches all six
  externally installed cloud dependencies, and release verification fails on
  any future drift. RC5, built from the verified prebuilt bundle at `cc3f60f6`,
  contains AWS clients 3.1106.0, Hono 4.13.1, the Hono Node server 2.1.0, and
  PostgreSQL client 8.22.0. Its isolated readiness, disabled-control, and
  Playground-login smoke passed before rollback-protected promotion. The live
  container is healthy with zero restarts on
  `sha256:014b23935f7397cd7cf621d6d27028627ab71c90e81c816096992fe874167528`;
  hosted MCP discovery returns 200, unauthenticated MCP remains 401, and the
  linked 0.7.4 device remained online and remote-work ready. Remote missions and
  hosted MCP stayed enabled for the named tester, while checkpoint restore,
  device commands/takeover, and both Temporal modes stayed disabled.

## Deployment and acceptance gates

### Task-centered workbench gate

- LP-38 is owner-approved and implemented. The sidepanel now projects local
  tasks, plans, decisions, watch mode, skill recording, and remote missions into
  one active work item with state-derived composer permissions.
- Remote work no longer leaves a permanent banner. Terminal missions remain
  visible for eight seconds, then move into collapsed per-workspace history;
  history is deduplicated and capped at 50 items. Mission IDs are available
  only under Details.
- Remote deliveries remain queued and unacknowledged while a local task or
  watch session controls the browser. The UI presents that delivery as incoming
  work without replacing the local task; execution resumes on a later poll once
  the browser is free.
- The 0.7.4 migration clears legacy chat, agent recovery, composer drafts, and
  remote-status UI state exactly once. Workspace definitions and tab groups,
  account/session data, settings, saved prompts, profile data, and skills are
  preserved.
- Verification: 32 focused workbench/remote-delivery tests pass; lint, RFC
  validation, the decomposition ratchet, affected-project TypeScript build, the
  production build, and the 21-item distribution check pass. The repository
  suite reached 5,488 passing tests; its product failure was fixed and passes in
  isolation, while the only other failure was an unrelated trace-retention
  setup timeout that also passes in isolation.

1. Done: deploy the refreshed backend while preserving the current named-tester
   allowlist and feature-flag values.
2. Done: verify the published 0.7.3 device is online but
   `remoteWork: unsupported`.
3. Done: the linked `0.7.4 Acceptance Test` device advertised extension version
   `0.7.4` and `remoteWork: ready` after the exact-build reload.
4. Switch between workspace tabs and hide/reopen the panel; verify Settings stays
   open on the selected section. Restart Chrome and verify the view resets.
5. Done: complete an exact-existing-tab read-only mission and confirm grounded
   evidence without navigation or new tabs. Mission
   `d34bce00-ff93-49ae-ad30-3fa24b0a37cc` completed successfully.
6. Reload the final binding fix and verify an isolated remote task opens exactly
   one tab inside the already-open OpenSidebar workspace group, the task is
   visible to that group's sidepanel, and returned evidence independently names
   the workspace/window and confirms group/panel/URL binding. Live missions
   `531e74ea-b5c0-4ee3-9319-e10a4cd0163d` and
   `86b6aecb-591c-4eeb-b03e-e7e64e1b97dd` confirmed the first fix did not enforce
   the live group/panel postconditions and are retained as failed evidence.
   Mission `67df9fbd-3ddf-4e2c-97f2-9370f4888045` also opened outside the group;
   RC2 stripped its target evidence, so it is retained as a failed acceptance
   attempt rather than inferred as a pass. Mission
   `55a5fa75-2e07-487c-a532-3fb0db447227` ran on RC3 but stalled without
   evidence and exposed readiness expiry during execution; it was cancelled.
   Mission `331c98d5-e83d-4288-ad7e-2da7d4636e5c` proved the first alarm-only
   readiness fix insufficient and was also cancelled. Mission
   `c4067951-2706-4e2f-afbc-cefaec54eda4` then proved the run stalls before the
   target callback. Instrumented mission
   `a8e8465c-db84-4869-970d-21e47709722b` isolated the blocker to the awaited
   local UI-status write before runner dispatch. Mission
   `393b143f-9b1f-4e6a-9428-21168a36244e` on the non-blocking-status build then
   opened outside the group and was cancelled. The final direct Chrome-group
   placement fix passes focused and real-Chrome E2E verification. After the
   exact-build reload, live mission
   `433d0374-76b1-40d3-b23b-d5c1d333ebb7` completed successfully on the linked
   `0.7.4 Acceptance Test` device. Its bounded target evidence independently
   reported `createdForMission: true`, `inWorkspace: true`,
   `sidePanelEnabled: true`, window `Window 1`, the expected OpenSidebar
   workspace title, origin `https://example.com`, title `Example Domain`, and
   `expectedUrlMatched: true`. The mission progressed through queued, running,
   and supervised completion to terminal `succeeded`; the device returned to
   `remoteWork: ready` with no external effects.
7. Exercise duplicate-tab selection, workspace-return cancel visibility, backend
   restart, extension restart, OAuth refresh, and revocation. The in-flight
   cancellation subgate exposed and fixed a readiness gap: aborting the local
   worker also stopped its active heartbeat while the orchestrator was still
   draining to a safe stop. A focused regression now holds that drain open and
   proves readiness polling continues until the worker settles; 56 focused
   delivery, cancellation, and browser-runner tests pass. After the exact-build
   reload, mission `8ab3199d-1e00-4840-ac81-3bd25036d7be` reached `running` and
   was cancelled, and follow-on mission
   `20bc3c92-cd5a-4db2-ae4f-7bcf5d52d5d8` moved immediately to `running` while
   the same device remained `online` and `remoteWork: ready`. Its browser result
   was correctly rejected because Chrome's active tab was outside an
   OpenSidebar workspace. Existing-tab retry
   `01cd91de-5a39-46c9-8526-a8e112c01a0b` then failed closed without creating
   or navigating a replacement when its requested tab was absent. Seven focused
   authentication tests now cover cross-context rotation, concurrent 401s,
   restarted clients, and transient/rejected refreshes. After the exact-build
   reload, the same linked device remained `online` and `remoteWork: ready`
   throughout a no-interaction 15-minute idle window. Post-boundary mission
   `c205ad76-86f8-456f-8a9f-65efe27fb78f` was then accepted and returned bounded
   evidence for one mission-created `https://example.com` tab in Window 1 with
   `inWorkspace: true`, `sidePanelEnabled: true`, and the expected title/URL.
   Ambiguous-workspace missions
   `31d09561-7041-4efb-b77b-a5b8d67d08ec` and
   `51c64fe5-ab2d-4420-8980-da92c917dec9` then exposed a continuation bug:
   target selection was accepted and browser execution completed, but the
   Codex evidence handoff was collapsed to terminal `outcome_unknown`. The
   target-selection resume path now preserves achieved evidence as
   `supervision_required`, matching the normal run path; 67 focused mission,
   delivery, runner, and browser-orchestration tests pass. After the exact-build
   reload, mission `58585a49-a8ac-4360-9ce9-bbd140193c97` presented two named
   workspace candidates, selected the group containing Google News by opaque
   handle, and returned authoritative target evidence for the mission-created
   `https://example.com` tab: `inWorkspace: true`, `sidePanelEnabled: true`,
   `createdForMission: true`, `expectedUrlMatched: true`, window `Window 1`,
   workspace title present, and page title `Example Domain`. Codex completed the
   evidence review and the mission reached terminal `succeeded`. Duplicate-tab
   missions `2a7f4a9b-9ff5-4f1b-af91-76b4383224d7` and
   `edead42c-489c-4195-86e7-fa2178e16f82` then consistently failed closed after
   selection because their short-lived opaque target handles existed only in
   MV3 service-worker memory and were lost between delivery polls. Target choices
   now persist in `chrome.storage.session`, remain bound to the mission session
   and five-minute expiry, are revalidated against the live tab/URL before use,
   and are removed after consumption. The 68 focused mission, delivery, runner,
   and browser-orchestration tests pass. After the exact-build reload, mission
   `7031920d-da8a-4e95-b9d3-535defb5fc29` selected one of five matching
   `https://example.com` tabs across two workspaces, crossed the same poll gap,
   and reached supervised terminal `succeeded`. Its authoritative target evidence
   reported the selected `Post-idle workspace-targeting...` group, Window 1,
   exact URL/title match, `inWorkspace: true`, `sidePanelEnabled: true`, and
   `createdForMission: false`; no replacement tab was created.
   Active-tab mission `6ed6e7e7-0bcc-40e1-b24e-0b06188f1426` then selected an
   unrelated ChatGPT tab in Window 2 and returned `inWorkspace: false` and
   `sidePanelEnabled: false`; it was stopped as `not_achieved`. Its agent summary
   also repeated a raw Chrome tab ID. Non-isolated targets now fail before agent
   execution unless both workspace membership and sidepanel enablement are
   verified, and the same binding (plus an expected URL when present) is
   rechecked at completion. Agent-authored evidence lines containing Chrome-local
   tab/group/window/workspace IDs or storage keys are removed at the transport
   boundary. The focused mission-worker and browser-runner suite passes 52 tests,
   with extension TypeScript and changed-file ESLint clean.
   After reloading the fixed build, mission
   `1a7305b6-25e8-4cc9-be9e-ca9fad7823ff` exercised the negative path: the
   active target was outside a workspace or lacked its sidepanel, so it was
   rejected before agent execution and retained as terminal `not_achieved`
   without leaking a browser identifier. Mission
   `6e91bc20-cfb9-4de1-8d67-636016541d04` then exercised the positive path on
   the active `https://example.com/` tab in Window 1. Structured evidence
   reported the exact page title, the named workspace, `inWorkspace: true`,
   `sidePanelEnabled: true`, `createdForMission: false`, no effects, and no raw
   browser identifiers; supervised completion reached terminal `succeeded`.
8. Complete clean shipped-workspace verification, then rebuild, smoke, and
   promote the dependency-remediated cloud-service candidate from the integrated
   release head. Verification is complete; the final backend promotion remains.
9. Record the final ZIP SHA-256, then submit that exact artifact. Do not widen the
   tester allowlist or enable consequential remote actions during release.

## Rollback

Disable `REMOTE_MISSIONS_ENABLED` first. Hosted MCP can remain available for task
status/cancellation or be disabled separately with `HOSTED_MCP_ENABLED`. Local
OpenSidebar tasks and locally stored authentication continue to operate. The
database column and index are additive and need not be removed during rollback.
