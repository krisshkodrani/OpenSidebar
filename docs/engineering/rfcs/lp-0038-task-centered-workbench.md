# LP-38 — Task-centered sidepanel workbench

Status: Decision stamped; implementation approved.

## Context

The sidepanel currently presents one browser-agent lifecycle through several
independent UI models: persisted chat messages, a plan/run card derived from
agent booleans, blocking interaction overlays, watch and recording controls,
and a global storage-backed remote-mission banner. Each surface decides for
itself what is active and what the composer means. The result is ambiguous
input routing, duplicated status, remote tasks detached from workspace history,
and terminal remote banners that remain until another mission or logout.

OpenSidebar is not merely a chat client. It is a supervised browser-work
surface in which conversation is one kind of task event alongside plans,
progress, decisions, browser evidence, recovery, and terminal outcomes.

## Principles

- A workspace contains work items; messages belong to a work item.
- One work item may control a workspace at a time.
- Execution runtimes remain authoritative. The UI consumes one normalized,
  revisioned projection rather than inferring lifecycle from unrelated flags.
- The composer is a command surface. Its label, command, and availability are
  explicit capabilities of the current work state.
- Plans, approvals, progress, and remote missions are not ordinary chat
  messages.
- Remote supervision ownership must be visible and must not permit conflicting
  local guidance.
- Terminal work leaves the active surface and becomes bounded history.

## Work model

A work item separates the axes that currently collapse into overlapping state:

- `kind`: `task`, `monitor`, or `recording`
- `origin`: `local` or `remote`
- `phase`: `queued`, `planning`, `awaiting_plan`, `running`, `awaiting_user`,
  `paused`, `stalled`, `recoverable`, or `terminal`
- `attention`: `none`, `plan_confirmation`, `approval`, `clarification`,
  `target_selection`, or `remote_supervision`
- `outcome`: `completed`, `partial`, `failed`, `stopped`, `cancelled`, or
  `unknown`
- `capabilities`: revision-bound commands currently accepted by the runtime

The background owns a `WorkSurfaceSnapshotV1` projection with an active item,
bounded task summaries, a device-level incoming-remote inbox, and the current
composer policy. Ordered `WorkEventV1` entries represent semantic messages,
plan versions, progress, decisions, evidence summaries, and results. React
renders the projection and sends revision-checked `WorkCommandV1` commands.

## Interaction contract

| State | Composer behavior | Primary controls |
| --- | --- | --- |
| Available | Start a task | Start, watch, saved prompt |
| Local planning | Draft preserved; sending disabled | Stop |
| Local running with guidance capability | Guide this task | Guide, pause, stop |
| Plan confirmation | Plan-specific feedback field | Approve, request changes, cancel |
| Clarification | Dedicated answer field | Answer, cancel |
| Approval | Dedicated decision surface | Allow or deny |
| Paused, stalled, or recoverable | Resume-with-guidance field | Resume, replan, stop |
| Remote queued | Generic input locked | Inspect or cancel |
| Remote active or supervised | Generic input locked | Cancel; deny when applicable; continue in Codex |
| Watch mode | Update watch instructions | Update, pause, stop watching |
| Skill recording | Composer hidden | Finish or cancel recording |
| Terminal | Start a new task | Inspect result; active notice auto-collapses |

Interaction-mode settings determine whether plan and approval states occur.
They do not override workspace exclusivity, clarification, local policy,
remote supervision ownership, or uncertainty.

## Surface and history

The calm-workbench layout has four parts:

1. Header with a compact incoming-remote indicator.
2. One expanded active workbench containing objective, origin, status,
   attention, plan, semantic conversation, progress, and result.
3. The latest 50 terminal tasks as collapsed chronological rows, expandable on
   demand.
4. A state-specific command surface at the bottom.

Terminal tasks expose a new-task composer immediately, show a completion notice
for eight seconds, and then collapse into history. Raw local and remote task IDs
are hidden from normal status and available only in expandable diagnostics.

## Runtime and collision handling

Add a background workspace-execution lease shared by local and remote runs.
Remote preparation is split into resolve workspace, acquire lease, create and
verify the tab, then execute. No remote tab opens before the lease is acquired.

If the selected workspace is busy, the cloud mission remains `queued` and its
encrypted progress reports bounded `workspace_busy` context. It appears in the
global inbox and retries when the lease is released, subject to normal expiry.
Lease acquisition is atomic; a losing local or remote start receives an honest
busy result. After MV3 restart, leases are rebuilt from authoritative durable
local-run and remote-delivery state rather than trusted as standalone records.

## Persistence and migration

- Persist versioned work history per workspace; prune the oldest terminal items
  above 50 and never prune the active item or remote inbox.
- Scope drafts by account, workspace, work item, and composer mode.
- Archive a terminal remote item before clearing its active local projection.
- Perform a one-time 0.7.4 reset of legacy workspace UI state: transcripts,
  composer drafts, agent/run recovery residue, remote-banner state, and
  workspace UI preferences.
- Preserve workspace definitions and Chrome groups, account/session data,
  settings, saved prompts, personal profile, and recorded skills.

## Prototype gate

Before product implementation, an interactive narrow-sidepanel prototype must
be reviewed in light and dark appearance at 320px and normal panel width. It
must cover available, planning, running, plan confirmation, clarification,
approval, recovery, remote queued, remote running, watch, recording, and
terminal states. Approval includes layout, copy, composer behavior, attention
hierarchy, inbox behavior, collapsed history, and diagnostic ID disclosure.

Prototype candidate: `.artifacts/ux/task-workbench-prototype.html` (local,
ignored release artifact). All 12 required states render without script errors
or horizontal overflow at 320px; the default running state was also inspected
at 360px and 736px. The owner approved the prototype on 2026-08-14 without
requested changes.

## Delivery

1. Approve the interactive prototype and record the approval below.
2. Add shared contracts, normalized background projection, workspace lease,
   command routing, and persistence migration.
3. Add the work slice, active workbench, task history, inbox, event renderers,
   and state-specific command surface.
4. Remove the superseded remote banner and split state/composer paths only
   after parity tests pass.
5. Run full sidepanel, overlay, remote-mission, MV3 restart, and real-Chrome
   acceptance before rebuilding the release candidate once.

## Decision

Status: Approved

Chosen path:

- Replace the chat-centered UI with the task-centered calm workbench described
  in this RFC.
- Keep one controlling work item per workspace and defer remote work when that
  workspace is busy.
- Allow contextual guidance only when the local runtime explicitly accepts it.
- Lock generic input during remote execution and blocking interaction states.
- Use an expanded active item, collapsed 50-task history, and global remote
  inbox.
- Reset legacy workspace UI state for 0.7.4 while preserving reusable and
  account data.
- Hide task IDs in expandable details.
- Block 0.7.4 until the complete redesign is implemented and accepted.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Cloud-synchronized task history.
- Concurrent controlling tasks within one workspace.
- Cross-device takeover and checkpoint restore.
- Search and filtering across task history.

Do not do:

- Do not model plans, approvals, progress, or remote missions as ordinary chat
  bubbles.
- Do not allow local messages to enter remotely supervised missions.
- Do not run two controlling tasks concurrently in one workspace.
- Do not expose raw mission IDs in the default UI.
- Do not delete settings, account data, workspace groups, saved prompts,
  profiles, or skills during migration.
- Do not enable checkpoint restore, device takeover, or consequential remote
  execution as part of this work.

Evidence required before merge:

- Owner-approved interactive prototype.
- Complete state/composer and revision-stale command tests.
- Migration, retention, terminal-archive ordering, and privacy tests.
- Workspace collision, expiry, cancellation, race, and MV3 restart proof.
- Sidepanel and overlay parity, keyboard/focus checks at 320px, and real-Chrome
  local and remote acceptance from one exact candidate build.
- Full repository release verification without increasing decomposition
  budgets.

Next action:

- Implement
