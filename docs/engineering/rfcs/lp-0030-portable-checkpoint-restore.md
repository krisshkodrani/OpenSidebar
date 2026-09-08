# LP-30: Portable checkpoint and restore contract

Status: Approved. Owner Decision Stamp recorded 2026-08-08.

## Summary

Define the smallest environment-neutral state that can safely continue an
OpenSidebar task after extension restart or on another signed-in device. Replace
the assumption that serialized browser/runtime objects are durable truth with a
versioned projection, explicit compatibility policy, and mandatory re-grounding.

LP-29 stores an opaque encrypted checkpoint. This RFC defines the plaintext
payload before encryption and the restore state machine. LP-31 owns remote
command delivery and cross-device leases. LP-32 may later coordinate these
states but cannot change their meaning.

## Current-state constraints

The product already has local orchestrator checkpoints and navigation recovery.
They are scoped to a workspace, use Chrome persistence, expire, and may include
runtime state coupled to a live tab or service-worker lifecycle. Workspace and
tab IDs are useful local handles but are not portable identities. DOM element
IDs and page observations become stale after navigation or re-render. Existing
approval flows correlate by approval ID and must not become replayable grants.

The cloud format is therefore a new projection from current runtime state, not
an upload of `opensidebar:checkpoints:v1`, `NavigationState`, trace records, or
an `AgentLoop` object graph.

## Goals

- Resume the user's real objective with enough grounded history to avoid
  restarting from zero.
- Keep serialized data environment-neutral and bounded.
- Make corruption, incompatibility, stale pages, and incomplete writes visible.
- Preserve local safety authority and require fresh approval where context may
  have changed.
- Support deterministic migration from exactly one previous schema version.

## Non-goals

- Byte-identical replay of a browser tab or JavaScript heap.
- Restoring authenticated website state onto another browser.
- Reusing old DOM selectors or element IDs without new observation.
- Persisting every trace event or model token.
- Guaranteeing that a task remains feasible after external state changes.
- Continuing an in-flight network request or half-executed browser action.

## Identity model

- `sessionId`: cloud session identity, server-generated UUID.
- `checkpointId`: immutable checkpoint identity, server-generated UUID.
- `checkpointRevision`: positive integer, increases by exactly one within a
  session.
- `parentCheckpointId`: required after revision 1 and must reference the current
  committed checkpoint.
- `localWorkspaceId`: an ephemeral mapping stored only on the restoring device;
  never serialized into the portable payload.
- `runId`: identifies one attempt between restores; a restore always creates a
  new run ID so trace/diagnostic records cannot be confused with the old run.

## Checkpoint envelope

The decrypted `PortableCheckpointV1` is closed and rejects unknown fields:

```ts
interface PortableCheckpointV1 {
  schemaVersion: 1;
  sessionId: string;
  checkpointId: string;
  parentCheckpointId?: string;
  revision: number;
  createdAt: string;
  runtimeVersion: string;
  reason:
    | "periodic"
    | "before_navigation"
    | "after_verified_action"
    | "waiting_for_user"
    | "pause"
    | "terminal";
  objective: SessionObjectiveV1;
  conversation: ConversationProjectionV1;
  execution: ExecutionProjectionV1;
  grounding: GroundingHintV1;
  pending: PendingStateV1;
  usage: UsageProjectionV1;
}
```

### Objective

```ts
interface SessionObjectiveV1 {
  originalRequest: string;
  currentInterpretation: string;
  successCriteria: string[];
  userConstraints: string[];
}
```

Strings are normalized UTF-8, individually bounded, and projected through a
secret-field scanner. The checkpoint remains user content; scanners are
defense-in-depth, not a claim that sensitive content has been anonymized.

### Conversation projection

Store only messages necessary to continue:

- user requests and clarifications;
- assistant-visible decisions and concise progress summaries;
- model/tool messages still needed for unresolved work;
- compact verified results referenced by remaining steps.

Exclude hidden reasoning, raw streaming chunks, cache annotations, duplicate
observations, internal telemetry, and superseded planner drafts. Enforce limits
by deterministic compaction: preserve the objective and recent unresolved
turns, then replace older resolved spans with a structured summary containing
facts, provenance class, and uncertainty. Compaction itself is an agent-visible
operation and must never invent success.

### Execution projection

```ts
interface ExecutionProjectionV1 {
  plan: Array<{
    stepId: string;
    description: string;
    status: "pending" | "in_progress" | "completed" | "blocked";
    evidenceRefs: string[];
  }>;
  completedActions: Array<{
    actionId: string;
    kind: string;
    summary: string;
    observedOutcome: string;
    evidenceType: string;
  }>;
  unresolvedFacts: Array<{
    statement: string;
    confidence: "low" | "medium" | "high";
  }>;
  partialHandoff?: {
    completed: string[];
    remaining: string[];
    uncertain: string[];
  };
}
```

`completed` means directly observed completed at checkpoint time. Restore treats
it as historical evidence, not proof that external state remains unchanged.

### Grounding hint

```ts
interface GroundingHintV1 {
  lastKnownUrl?: string;
  expectedOrigins: string[];
  pageTitle?: string;
  pageFingerprint?: string;
  userVisibleStateSummary: string;
  requiredCapabilities: Array<"navigation" | "forms" | "downloads" | "tabs">;
}
```

URLs are stored only because cloud-session consent explicitly covers them. They
must not appear in list APIs, metrics, logs, Temporal history, or telemetry.
`pageFingerprint` is a coarse salted hash over reviewed stable attributes, not
a DOM snapshot and not a validator. No DOM tag/element IDs, selectors, tab IDs,
window IDs, frame IDs, or cookies are allowed.

### Pending state

```ts
type PendingStateV1 =
  | { kind: "none" }
  | {
      kind: "clarification";
      question: string;
      askedAt: string;
    }
  | {
      kind: "approval_required";
      actionSummary: string;
      risk: "low" | "medium" | "high";
      requestedAt: string;
      expiresAt: string;
    }
  | {
      kind: "browser_result_unknown";
      actionSummary: string;
      startedAt: string;
    };
```

An approval checkpoint deliberately omits the original approval ID and any
grant. On restore it becomes a new proposed action and a new approval request.
`browser_result_unknown` requires observation before retry; it may never be
converted automatically to either succeeded or failed.

### Usage projection

Store only cumulative prompt, completion, cached, image-estimate, and turn
counts needed to enforce the user's configured task limits. Do not persist
provider cost line items that expose credentials or arbitrary provider strings.

## Projection rules

Implement projection as a pure module under the reusable background runtime,
behind a `CheckpointPort`. It accepts a narrow snapshot assembled from the
orchestrator rather than importing Chrome persistence or the UI.

Before encryption it must:

1. validate the closed schema and all length/count limits;
2. reject credential-shaped fields and known secret property names recursively;
3. reject Chrome/environment-specific fields such as `tabId`, `windowId`,
   `frameId`, storage keys, selectors, and raw DOM nodes;
4. reject unsupported provider/model arbitrary strings where a reviewed enum or
   bounded catalog ID is required;
5. canonicalize JSON and calculate a plaintext checksum for in-process
   validation (the storage index exposes only the ciphertext checksum);
6. fail without replacing the previous checkpoint when projection is unsafe.

Initial plaintext cap: 8 MiB. Individual screenshots and attachments are not in
v1. Conversation compaction begins before 6 MiB to leave deterministic headroom.

## When checkpoints are created

Create a checkpoint at these semantic boundaries:

- after task acceptance and plan initialization;
- immediately before a navigation that may suspend the worker;
- after a browser action has been observed and its outcome classified;
- before waiting for clarification or approval;
- on explicit pause;
- after terminal completion/failure/cancellation;
- periodically after at most five verified actions or two minutes of active
  work, whichever comes first.

Do not checkpoint while a browser action's outcome is merely assumed. If the
worker is interrupted during an action, recovery uses `browser_result_unknown`.
Checkpointing is detached from the critical browser-action acknowledgment only
after the local durable checkpoint has succeeded.

## Atomic commit

1. Project and validate locally.
2. Save the same portable payload to the local checkpoint port.
3. Request an LP-29 upload intent with expected session revision and parent.
4. Encrypt/upload the immutable object.
5. Commit its checksum, size, schema, parent, and revision idempotently.
6. Server transaction marks the index committed and advances the latest pointer.
7. Only then mark local cloud state `synced`.

Failure at steps 3–6 preserves the local checkpoint and old cloud pointer. A
retry uses the same checkpoint and idempotency IDs. The server never accepts a
gap, duplicate revision with different checksum, or fork from a stale parent.

## Restore state machine

```text
selected
  -> downloading
  -> decrypting
  -> validating
  -> compatible | read_only_incompatible | corrupt
  -> binding_device
  -> awaiting_page
  -> regrounding
  -> ready_for_confirmation
  -> restored_paused
  -> running (only after explicit continue)
```

Detailed behavior:

1. Authenticate account and fetch the latest committed checkpoint.
2. Verify object checksum, GCM authentication, session/checkpoint IDs, parent,
   revision, schema, and runtime compatibility.
3. Create a new local workspace and run ID; never reuse serialized Chrome IDs.
4. Resolve a page:
   - reuse a user-selected current tab when its origin is allowed;
   - otherwise offer to open `lastKnownUrl` only if local navigation policy
     permits it;
   - never restore cookies or website login state.
5. Observe the live page through existing page/content ports.
6. Compare origin, title/fingerprint hints, and visible state. Classify as
   `matched`, `changed`, `unavailable`, or `unauthorized`.
7. Invalidate all historical element references. Re-plan the next action using
   current observation plus checkpoint history.
8. Present the restored objective, completed/remaining summary, changed-state
   warning, pending clarification/approval, and chosen page to the user.
9. Enter `restored_paused`. Only an explicit Continue starts execution.

If local safety settings are stricter than when the checkpoint was created,
the current local settings win. Cloud or checkpoint state cannot disable a gate.

## Approval and side-effect rules

- Every pending approval becomes a fresh approval with a new ID and current
  action details.
- A previously approved but not observed action is treated as unapproved and
  outcome-unknown.
- Completed external side effects are not automatically repeated. The agent
  must verify current state first.
- Actions without a reliable read-back (send, submit, purchase, delete) require
  user clarification when the prior outcome is unknown.
- Restore never submits a form, sends a message, downloads, uploads, or changes
  navigation before the user confirms continuation.

## Compatibility and migrations

Define `CURRENT_CHECKPOINT_SCHEMA = 1` and a registry of pure migrations.

- Current schema: fully restorable.
- Immediately previous schema: migrate in memory, validate current schema,
  restore, then write a new current checkpoint only after user continuation.
- Older/newer unsupported schema: metadata and export remain available; restore
  is read-only with a clear version message.
- Runtime version may add a stricter compatibility gate independent of schema
  when behavior or tool semantics changed.
- Migration never rewrites the historical encrypted object in place.

## Local/cloud merge policy

When the same session has local and cloud checkpoints:

- identical checkpoint IDs/checksums: use either, prefer local for latency;
- one is a strict descendant of the other: select the descendant;
- concurrent children of one parent: do not auto-merge agent state. Present
  both branches with device/time/status and let the user choose one; preserve the
  other for export or deletion;
- local unsynced checkpoint during cloud deletion: deletion wins for cloud; keep
  local data clearly marked local-only until the user deletes or creates a new
  session.

## APIs and ports

Shared contracts:

- `PortableCheckpointV1` and its closed validator;
- `CheckpointCompatibility` and `RestoreGroundingResult`;
- `CheckpointProjectionInput` (internal, narrow);
- `CheckpointPort` with `saveLocal`, `loadLocal`, `upload`, `loadCloud`, and
  `deleteLocal` capabilities implemented by environment adapters.

Sidepanel communicates through `UiRuntimePort`/runtime messages; it does not
call Chrome or cloud APIs directly. Reusable background code does not import the
AWS client.

## Failure behavior

- Projection rejection: keep running with local legacy durability if safe, mark
  cloud sync failed, and expose a coarse reason; never silently omit forbidden
  fields and claim a complete restore point.
- Local save failure: do not claim checkpoint durability or start cloud commit.
- Cloud outage: keep local portable checkpoints and bounded retry metadata.
- Corrupt latest cloud object: offer previous committed compatible revision and
  clearly label possible progress loss.
- Page unavailable/authentication required: restore paused and ask the user to
  open/sign into the page manually.
- Current page materially changed: preserve historical progress but re-plan; do
  not reuse pending commands.
- Migration failure: read-only/export, with no partial current-schema write.

## Testing and evidence

- Golden serialization corpus covers simple tasks, multi-step plans,
  clarification, approval wait, partial handoff, navigation, terminal states,
  and unknown browser outcomes.
- Forbidden-field/property fuzzing proves Chrome IDs, credentials, cookies,
  headers, raw DOM, traces, and approval grants are rejected.
- Golden corpus round-trips canonical JSON and produces deterministic projection
  apart from documented IDs/timestamps.
- Local interruption at every atomic-commit step preserves a valid previous
  checkpoint.
- Restore tests cover matching, changed, unavailable, unauthorized, and logged-
  out pages; all invalidate element references and pause before execution.
- Sensitive pending actions always require fresh approval; unknown irreversible
  outcomes clarify instead of retrying.
- Compatibility tests cover current, previous migratable, old read-only, newer
  read-only, corrupt, and runtime-incompatible checkpoints.
- Branch-conflict tests never silently merge or discard either branch.
- Overlay/headless fake ports replay the same portable contract without Chrome
  identifiers; real-browser E2E covers service-worker restart and navigation.
- Size/compaction tests stay under caps without dropping unresolved constraints
  or inventing completed work.

## Rollout

1. Land types, validator, projector, fake/local port, and golden corpus with no
   cloud writes.
2. Dual-write portable local checkpoints beside the existing local format and
   compare restore outcomes; existing local restore remains authoritative.
3. Switch local restore to the portable format after parity evidence and retain
   one-version fallback.
4. Enable LP-29 cloud upload for internal accounts.
5. Run interrupted-worker and real-page restore dogfood before opt-in beta.

Rollback disables cloud writes and restores from the latest valid local or
cloud portable checkpoint. Do not revert to deserializing environment-specific
cloud state.

## Decision

Status: Approved

Chosen path:

- Add a closed, bounded, environment-neutral `PortableCheckpointV1` projected
  from runtime state at verified semantic boundaries.
- Commit checkpoints append-only through the LP-29 revision protocol and always
  save locally before attempting cloud synchronization.
- Restore into a new local workspace/run, re-observe the page, invalidate stale
  references, show a summary, and remain paused until explicit continuation.
- Require fresh approval and direct observation for uncertain side effects.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Consider encrypted screenshot/attachment references after v1 checkpoint-size
  evidence.
- Generalize the portable projection into a full headless replay contract only
  when a concrete headless runtime requires it.

Do not do:

- Do not upload existing local checkpoint objects, raw traces, DOM snapshots,
  Chrome identifiers, credentials, browser authentication state, or approval
  grants.
- Do not claim a restored page matches without a fresh observation.
- Do not auto-merge divergent checkpoint branches or auto-repeat an uncertain
  irreversible action.

Evidence required before merge:

- All testing and evidence items above, dual-write parity, real-browser worker
  restart/navigation restoration, and privacy field audit.

Next action:

- Implement
