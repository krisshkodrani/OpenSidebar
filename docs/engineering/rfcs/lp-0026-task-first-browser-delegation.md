# RFC LP-26 — Task-first browser delegation

Lifecycle status: Decision stamped
Date: 2026-07-30
Decision date: 2026-07-30 (owner approved implementation in session)
Scope: browser MCP contract and tools, extension bridge, delegated task
lifecycle, runtime interactions, sidepanel visibility, trace projection
Related: LP-4 verification, LP-7 observability, LP-15 runtime boundary, the
existing browser bridge and pi backend spike

## Problem

The existing bridge correctly starts OpenSidebar's real agent runtime, but its
primary contract is still a synchronous thick tool call. It leaves the caller
waiting for a whole run and does not expose a durable task lifecycle, current
plan, exact pending interaction, provider usage, verified result, or task trace
as independently queryable resources.

OpenSidebar is an autonomous browser agent. Codex or another supervisor should
delegate a complete bounded goal, inspect evidence, answer an exact
clarification or approval when allowed, and choose the next goal. It should not
drive OpenSidebar as a collection of click/type primitives.

## Chosen architecture

Add a task-first protocol around the existing runtime:

- `delegate_browser_task` validates policy, queues the task, starts it
  asynchronously through the existing runtime, and returns a `task_id`.
- `get_browser_task`, `list_browser_tasks`, and `get_browser_task_trace` project
  current state without starting provider calls.
- `continue_browser_task` and `approve_browser_checkpoint` resume the exact
  interaction rather than starting a replacement run.
- `cancel_browser_task` aborts the task and prevents later actions.
- `browser_bridge_status` is provider-free.

The bridge task service owns admission, lifecycle projection, policy metadata,
and correlation. Planning, execution, verification, approvals, browser actions,
memory, and full traces remain owned by the product runtime. V1 admits one
active delegated task globally. Existing synchronous intent tools remain
temporarily as compatibility tools.

## Policy and evidence

Delegation requires a non-empty goal, explicit navigation-domain allowlist, and
mandatory consequential-action checkpoints. It accepts optional preferred tab,
constraints, maximum turns, maximum cost, timeout, and allowed model roles.

The human Stop control is authoritative. A supervisor may relay an approval only
when task policy permits it and only for the exact pending checkpoint.
Clarification responses add context but never approve a consequential action.

Initial domain checks and max-turn/timeout controls land with the service. Hard
redirect enforcement and a pre-provider-call cost gate require runtime hooks;
until those exist, results disclose that a supplied cost budget was reported
but not hard-enforced. The implementation must not claim stronger enforcement.

`completed` is emitted only when the existing runtime reports verified
completion. MCP receives compact redacted evidence and a trace reference; full
fidelity remains in the existing trace system.

## File upload

Secure arbitrary local-file attachment is a separately gated follow-up. It must
authorize a canonical path for one task/origin/input, keep bytes out of MCP and
Native Messaging, use a temporary `chrome.debugger` attachment with
`DOM.setFileInputFiles`, bind approval to file and page state, detach on every
exit path, and complete permission/store-disclosure review. The Roomora AAB is a
supervised validation artifact, never a runtime special case.

## Decision

Status: Approved

Chosen path:

- Replace the primary synchronous bridge interaction with durable, asynchronous
  task-first delegation around OpenSidebar's existing agent runtime.
- Preserve the existing planner, executor, verifier, judge, approvals, memory,
  browser tools, costs, UI, and traces.
- Introduce the eight proposed task lifecycle MCP tools.
- Keep existing synchronous tools temporarily for compatibility.
- Permit Codex to relay only exact, state-bound approvals when explicitly
  allowed by task policy.
- Implement secure local-file attachment as a separately gated capability after
  the core task lifecycle.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Remove legacy synchronous tools in a separately announced breaking release.
- Support multiple concurrent delegated tasks after v1 tab leasing is proven.
- Add optional low-level diagnostic tools.

Do not do:

- Do not create a separate bridge execution loop.
- Do not expose browser primitives as the primary integration.
- Do not treat a broad task or clarification response as consequential-action
  approval.
- Do not transmit local-file bytes through MCP or Native Messaging.
- Do not add Roomora, Play Console, fixture, or benchmark-specific runtime
  logic.

Evidence required before merge:

- Protocol and lifecycle unit tests.
- Mock MCP integration test using the existing agent runtime.
- Approval, clarification, cancellation, budget, domain, redaction, and
  concurrency tests.
- Delegated task visibility and Stop-button precedence tests.
- Trace-viewer coverage for the complete delegated task.
- Secure file-attachment tests before that capability ships.
- `git diff origin/main...HEAD --stat` shows the implementation.
- Repository verification passes.

Next action:

- Implement
